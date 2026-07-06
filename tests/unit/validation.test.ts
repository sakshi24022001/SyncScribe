import { describe, expect, it, beforeEach } from "vitest";
import { parseAndBoundPush, checkRateLimit, MAX_UPDATE_BYTES } from "@/lib/validation";

const uuid = () => crypto.randomUUID();
const cuid = "clv0000000000000000000000";

describe("parseAndBoundPush", () => {
  it("accepts a well-formed small batch", () => {
    const result = parseAndBoundPush({
      documentId: cuid,
      baseSeq: 0,
      updates: [{ clientOpId: uuid(), payload: Buffer.from("hi").toString("base64") }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an oversized individual update (anti-OOM guard)", () => {
    const oversized = Buffer.alloc(MAX_UPDATE_BYTES + 1024, 1).toString("base64");
    const result = parseAndBoundPush({
      documentId: cuid,
      baseSeq: 0,
      updates: [{ clientOpId: uuid(), payload: oversized }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("rejects malformed structural payloads before touching binary data", () => {
    const result = parseAndBoundPush({ documentId: "not-a-cuid", updates: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects batches exceeding item count cap", () => {
    const updates = Array.from({ length: 500 }, () => ({
      clientOpId: uuid(),
      payload: Buffer.from("x").toString("base64"),
    }));
    const result = parseAndBoundPush({ documentId: cuid, baseSeq: 0, updates });
    expect(result.ok).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows bursts up to capacity then throttles", () => {
    const key = `test-${uuid()}`;
    let allowed = 0;
    for (let i = 0; i < 30; i++) {
      if (checkRateLimit(key)) allowed++;
    }
    // Burst cap is 20 tokens; the 30th rapid call should have been throttled.
    expect(allowed).toBeLessThan(30);
    expect(allowed).toBeGreaterThanOrEqual(15);
  });
});
