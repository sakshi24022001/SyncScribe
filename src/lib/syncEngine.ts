/**
 * Background Sync Engine.
 *
 * This is the module that answers the assignment's hardest question:
 * "push local changes and fetch remote changes without overwriting or
 * destroying the user's offline work, while handling state synchronization
 * race conditions."
 *
 * RACE CONDITIONS THIS ENGINE EXPLICITLY HANDLES:
 *
 * 1. "Reconnect storm" — network comes back while a push is already in
 *    flight from a previous attempt. Guarded by `syncing` flag + a
 *    single-flight promise so concurrent triggers (online event, timer,
 *    manual button, visibility change) coalesce into one sync cycle
 *    instead of firing overlapping requests that could double-apply ops.
 *
 * 2. "Local edit during sync" — user keeps typing while a push is in
 *    flight. New edits land in Yjs (and are queued to `pendingOps`)
 *    immediately; they are NOT held back by the in-flight request, and
 *    they are NOT lost if the in-flight push fails, because they were
 *    already written to IndexedDB before the request started.
 *
 * 3. "Server ack lost" (client sent, server applied, but response never
 *    arrived, e.g. tab closed / network dropped mid-response) — handled by
 *    client-generated `clientOpId` + a server-side unique constraint
 *    (documentId, clientOpId). On retry, the server treats the duplicate
 *    as already-applied (idempotent no-op) instead of double-inserting the
 *    same CRDT update, which would be harmless for Yjs (updates are
 *    idempotent to re-apply) but would waste log storage.
 *
 * 4. "Concurrent pull + push" — pulling remote updates while a local push
 *    is also being prepared. We apply remote updates directly into the
 *    live Y.Doc as they're just more CRDT ops; order of apply vs. push
 *    doesn't matter for correctness because CRDT merges commute (see
 *    lib/crdt.ts) — this is precisely why we chose a CRDT instead of a
 *    system requiring strict operation ordering.
 *
 * 5. Exponential backoff with jitter on failure, capped, so a flaky
 *    connection doesn't hammer the server or drain battery on mobile.
 */
import * as Y from "yjs";
import {
  enqueuePendingOp,
  getPendingOps,
  removePendingOps,
  getSyncCursor,
  setSyncCursor,
  saveLocalDoc,
  type PendingOp,
} from "./localdb";

export type SyncStatus = "offline" | "syncing" | "synced" | "error";

type Listener = (status: SyncStatus) => void;

const uint8ToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const base64ToUint8 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

export class DocumentSyncEngine {
  private ydoc: Y.Doc;
  private documentId: string;
  private listeners = new Set<Listener>();
  private status: SyncStatus = "offline";
  private inFlight: Promise<void> | null = null;
  private retryDelayMs = 1000;
  private readonly maxRetryDelayMs = 30_000;
  private destroyed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(documentId: string, ydoc: Y.Doc) {
    this.documentId = documentId;
    this.ydoc = ydoc;

    // Every local mutation (typing) fires this. We enqueue immediately —
    // this write is local-only (IndexedDB), never blocked by network.
    this.ydoc.on("update", this.handleLocalUpdate);

    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.triggerSync());
      window.addEventListener("offline", () => this.setStatus("offline"));
      this.setStatus(navigator.onLine ? "synced" : "offline");
    }
  }

  onStatusChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.listeners.forEach((l) => l(status));
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // `origin === "remote"` marks updates we applied FROM the server —
    // don't re-queue those for push, or we'd echo them back forever.
    if (origin === "remote") return;

    const op: PendingOp = {
      clientOpId: crypto.randomUUID(),
      documentId: this.documentId,
      payload: update,
      createdAt: Date.now(),
      attempts: 0,
    };

    // Fire-and-forget from the caller's perspective: typing never awaits this.
    void enqueuePendingOp(op).then(() => {
      void saveLocalDoc({
        documentId: this.documentId,
        title: "", // caller updates title separately via metadata API
        ydocState: Y.encodeStateAsUpdate(this.ydoc),
        updatedAt: Date.now(),
      });
      this.debouncedTriggerSync();
    });
  };

  /** Debounce rapid keystrokes into one sync pass instead of one request per character. */
  private debouncedTriggerSync() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.triggerSync(), 800);
  }

  /** Public entry point — safe to call redundantly (single-flight). */
  triggerSync(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setStatus("offline");
      return Promise.resolve();
    }
    if (this.inFlight) return this.inFlight; // coalesce concurrent callers

    this.inFlight = this.runSyncCycle().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runSyncCycle(): Promise<void> {
    this.setStatus("syncing");
    try {
      await this.pushPending();
      await this.pullRemote();
      this.retryDelayMs = 1000; // reset backoff on success
      this.setStatus("synced");
    } catch (err) {
      this.setStatus("error");
      this.scheduleRetry();
      // eslint-disable-next-line no-console
      console.error("[sync] cycle failed", err);
    }
  }

  private scheduleRetry() {
    const delay = this.retryDelayMs + Math.random() * 300; // jitter
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
    setTimeout(() => this.triggerSync(), delay);
  }

  private async pushPending(): Promise<void> {
    const pending = await getPendingOps(this.documentId);
    if (pending.length === 0) return;

    const baseSeq = await getSyncCursor(this.documentId);
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: this.documentId,
        baseSeq,
        updates: pending.map((op) => ({
          clientOpId: op.clientOpId,
          payload: uint8ToBase64(op.payload),
        })),
      }),
    });

    if (!res.ok) {
      // 409 = server has updates we haven't pulled yet; pull first, then
      // the NEXT sync cycle will retry the push against a fresher baseSeq.
      // This is the concrete answer to "server change and local change at
      // the same time" — we never let a push blindly overwrite; the server
      // never overwrites either (it's an append-only log), it just asks
      // the client to observe newer history before it decides what "next"
      // sequence to claim, avoiding a lost-update gap in the seq counter.
      if (res.status === 409) {
        await this.pullRemote();
        return;
      }
      throw new Error(`push failed: ${res.status}`);
    }

    const body = (await res.json()) as { acceptedClientOpIds: string[]; newSeq: number };
    await removePendingOps(body.acceptedClientOpIds);
    await setSyncCursor(this.documentId, body.newSeq);
  }

  private async pullRemote(): Promise<void> {
    const sinceSeq = await getSyncCursor(this.documentId);
    const res = await fetch(`/api/sync/pull?documentId=${this.documentId}&sinceSeq=${sinceSeq}`);
    if (!res.ok) throw new Error(`pull failed: ${res.status}`);

    const body = (await res.json()) as { updates: string[]; latestSeq: number };
    for (const b64 of body.updates) {
      // Tag origin "remote" so our own update handler above doesn't re-queue it.
      Y.applyUpdate(this.ydoc, base64ToUint8(b64), "remote");
    }
    if (body.updates.length > 0 || body.latestSeq !== sinceSeq) {
      await setSyncCursor(this.documentId, body.latestSeq);
      await saveLocalDoc({
        documentId: this.documentId,
        title: "",
        ydocState: Y.encodeStateAsUpdate(this.ydoc),
        updatedAt: Date.now(),
      });
    }
  }

  destroy() {
    this.destroyed = true;
    this.ydoc.off("update", this.handleLocalUpdate);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.listeners.clear();
  }
}
