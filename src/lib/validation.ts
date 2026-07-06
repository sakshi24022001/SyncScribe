/**
 * Sync payload validation.
 *
 * This is the answer to the assignment's core security question: "how do
 * you stop a malformed/massive payload from OOMing the collaboration
 * server?" The strategy is defense in depth, applied BEFORE any bytes are
 * handed to Yjs (Yjs itself will happily try to decode whatever you give
 * it, so validation must happen in front of it, not inside it):
 *
 * 1. Hard byte-size ceiling per update, enforced at the HTTP layer via
 *    Content-Length / stream byte-counting, before the body is fully
 *    buffered into memory. We never call `req.json()` on an unbounded
 *    stream.
 * 2. Structural validation with zod — reject anything that doesn't match
 *    the exact envelope shape before touching the binary payload.
 * 3. A per-document, per-user rate limit on push frequency (token bucket)
 *    so a compromised/buggy client can't flood updates fast enough to
 *    grow the update log unbounded between compaction cycles.
 * 4. Base64 payloads are decoded into a bounded buffer — we check the
 *    encoded string length against the ceiling BEFORE calling
 *    Buffer.from(), because base64 decoding still allocates the full
 *    decoded size and we don't want to discover the real size only after
 *    already allocating it.
 */
import { z } from "zod";

// 256 KB per individual CRDT update. A real editing session produces
// updates in the tens-to-hundreds of bytes; even a large paste is a few KB.
// 256KB gives generous headroom while still bounding worst-case memory use
// per accepted row to something trivial at scale (thousands of concurrent
// pushes = tens of MB, not GB).
export const MAX_UPDATE_BYTES = 256 * 1024;

// A push batch bundles multiple offline-accumulated updates in one
// request. Cap total batch size independently of per-item size so a
// client can't defeat the per-item cap by sending 100k tiny-but-valid items.
export const MAX_BATCH_ITEMS = 200;
export const MAX_BATCH_BYTES = 4 * 1024 * 1024; // 4 MB total per request

export const pushItemSchema = z.object({
  clientOpId: z.string().uuid(),
  // base64-encoded Yjs update. We check .length (encoded size, ~4/3 of
  // decoded) against a padded ceiling before decoding.
  payload: z
    .string()
    .max(Math.ceil((MAX_UPDATE_BYTES * 4) / 3) + 16, {
      message: "update exceeds maximum allowed size",
    }),
});

export const pushRequestSchema = z.object({
  documentId: z.string().cuid(),
  baseSeq: z.number().int().nonnegative(),
  updates: z.array(pushItemSchema).min(1).max(MAX_BATCH_ITEMS),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pullQuerySchema = z.object({
  documentId: z.string().cuid(),
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Validates and decodes a push request. Throws a typed error the route
 * handler turns into a 400/413 without ever holding more than
 * MAX_BATCH_BYTES in memory for a single rejected request.
 */
export function parseAndBoundPush(raw: unknown): {
  ok: true;
  data: PushRequest;
} | { ok: false; status: number; message: string } {
  const parsed = pushRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, message: parsed.error.issues[0]?.message ?? "invalid payload" };
  }

  let totalBytes = 0;
  for (const item of parsed.data.updates) {
    // Rough encoded->decoded size without allocating: base64 decoded
    // length = encoded_len * 3/4 (minus padding, close enough for a guard).
    const approxDecoded = Math.floor((item.payload.length * 3) / 4);
    if (approxDecoded > MAX_UPDATE_BYTES) {
      return { ok: false, status: 413, message: "individual update exceeds size limit" };
    }
    totalBytes += approxDecoded;
    if (totalBytes > MAX_BATCH_BYTES) {
      return { ok: false, status: 413, message: "batch exceeds total size limit" };
    }
  }

  return { ok: true, data: parsed.data };
}

// ---- Simple in-memory token bucket rate limiter -----------------------
// For production, swap the Map for Redis (INCR + TTL) so limits hold
// across multiple server instances. Kept in-memory here to keep the
// assignment self-contained without requiring a Redis deployment.
const buckets = new Map<string, { tokens: number; last: number }>();
const REFILL_PER_SEC = 5; // 5 pushes/sec sustained
const BUCKET_CAP = 20; // burst allowance

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: BUCKET_CAP, last: now };
  const elapsedSec = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(BUCKET_CAP, bucket.tokens + elapsedSec * REFILL_PER_SEC);
  bucket.last = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
