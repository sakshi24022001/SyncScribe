"use client";

/**
 * useDocument — the glue between:
 *   - a live Y.Doc (in-memory CRDT state, bound to the editor UI)
 *   - IndexedDB (durable local-first storage, loaded on mount)
 *   - DocumentSyncEngine (background reconciliation with the server)
 *
 * On mount: load the last known merged state from IndexedDB FIRST (no
 * network call), render it immediately, then kick off a background sync.
 * This is what satisfies "open, edit, and close documents with zero
 * network requests blocking the UI" — the network is strictly additive.
 */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { loadLocalDoc, saveLocalDoc } from "@/lib/localdb";
import { DocumentSyncEngine, type SyncStatus } from "@/lib/syncEngine";

export function useDocument(documentId: string) {
  const [ydoc] = useState(() => new Y.Doc());
  const [ytext] = useState(() => ydoc.getText("content"));
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [ready, setReady] = useState(false);
  const engineRef = useRef<DocumentSyncEngine | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Local load — instant, no network.
      const local = await loadLocalDoc(documentId);
      if (local && !cancelled) {
        Y.applyUpdate(ydoc, local.ydocState, "remote");
      }
      if (!cancelled) setReady(true);

      // 2. Start background sync engine (push queued ops + pull remote).
      const engine = new DocumentSyncEngine(documentId, ydoc);
      engineRef.current = engine;
      const unsubscribe = engine.onStatusChange(setStatus);
      engine.triggerSync();

      return () => {
        unsubscribe();
        engine.destroy();
      };
    })();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Persist merged state locally on every change, debounced by the browser's
  // natural event coalescing (Yjs already batches transaction updates).
  useEffect(() => {
    const handler = () => {
      void saveLocalDoc({
        documentId,
        title: "",
        ydocState: Y.encodeStateAsUpdate(ydoc),
        updatedAt: Date.now(),
      });
    };
    ydoc.on("update", handler);
    return () => ydoc.off("update", handler);
  }, [ydoc, documentId]);

  return { ydoc, ytext, status, ready };
}
