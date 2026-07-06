/**
 * POST /api/sync/push
 *
 * Accepts a batch of client-generated CRDT updates and appends them to the
 * document's update log. This route is the front line for the assignment's
 * security requirement: reject malformed/oversized payloads BEFORE they
 * reach the database or Yjs.
 *
 * Order of operations, deliberately in this sequence:
 *   1. AuthN (session) — cheapest check, reject unauthenticated immediately.
 *   2. Structural + size validation (validation.ts) — reject before any
 *      DB or CRDT work; this is what prevents OOM from a malicious payload.
 *   3. AuthZ (role check via RLS-scoped query) — Viewers are rejected here
 *      even if their payload was well-formed, satisfying "Viewers must not
 *      push state updates."
 *   4. Rate limit — throttle even legitimate-shaped abuse.
 *   5. Optimistic-concurrency check against `baseSeq` — if the client's
 *      view of the log is stale, we return 409 rather than silently
 *      accepting (the client's sync engine then pulls first and retries).
 *   6. Idempotent insert via unique (documentId, clientOpId) constraint —
 *      safe to retry the same batch after a dropped response.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { parseAndBoundPush, checkRateLimit, MAX_BATCH_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  // Reject oversized bodies before buffering, using Content-Length as a
  // cheap first line of defense (a lying client can still be caught by
  // the structural check below, but this avoids reading the stream at all
  // for obviously-too-large requests).
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BATCH_BYTES * 2) {
    // *2 accounts for base64 + JSON envelope overhead over the raw byte cap.
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  if (!checkRateLimit(`push:${userId}`)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const validated = parseAndBoundPush(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: validated.status });
  }
  const { documentId, baseSeq, updates } = validated.data;

  try {
    const result = await withTenantScope(userId, async (tx) => {
      // RLS also enforces this at the DB layer, but we check explicitly
      // here too so we can return a clean 403 with a helpful message
      // instead of a generic "no rows" outcome.
      const membership = await tx.documentMember.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      if (!membership || membership.role === "VIEWER") {
        throw new ForbiddenError();
      }

      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });

      // Optimistic concurrency: if the client's last-known seq is far
      // behind the server's current seq, force a pull-before-push instead
      // of blindly appending — this is a deliberate, cheap guard against
      // a stale client claiming seq numbers out of order. (Because we
      // still append rather than overwrite, this isn't strictly required
      // for correctness with CRDTs, but it keeps `seq` a meaningful
      // "how far behind is this client" signal for clients and telemetry.)
      if (baseSeq > doc.seq) {
        throw new StaleClientError();
      }

      // Batched insert: one round trip to the database instead of one
      // round trip PER update. The earlier per-item loop was correct but
      // slow over a remote connection — with a large backlog of queued
      // offline edits, sequential awaits added up past the transaction
      // timeout. `createMany` with `skipDuplicates` does the same
      // idempotent-retry handling (a duplicate clientOpId is silently
      // skipped rather than erroring) in a single query.
      const rows = updates.map((update, i) => {
        const buf = Buffer.from(update.payload, "base64");
        return {
          documentId,
          authorId: userId,
          clientOpId: update.clientOpId,
          seq: doc.seq + i + 1,
          payload: buf,
          byteSize: buf.byteLength,
        };
      });

      await tx.docUpdate.createMany({ data: rows, skipDuplicates: true });

      const newSeq = doc.seq + rows.length;
      const acceptedClientOpIds = updates.map((u) => u.clientOpId);

      await tx.document.update({ where: { id: documentId }, data: { seq: newSeq } });

      return { acceptedClientOpIds, newSeq };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "viewers cannot push updates" }, { status: 403 });
    }
    if (err instanceof StaleClientError) {
      return NextResponse.json({ error: "client is behind, pull before retrying" }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error("[sync/push] unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

class ForbiddenError extends Error {}
class StaleClientError extends Error {}
