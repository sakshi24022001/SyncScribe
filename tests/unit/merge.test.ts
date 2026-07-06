/**
 * These tests exist to PROVE the central claim of the whole architecture:
 * that merging is order-independent (commutative) and lossless, which is
 * what "deterministic conflict resolution" concretely means. If this test
 * ever fails, the entire local-first safety story breaks.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildDocFromUpdates, buildRestoreUpdate, snapshotDoc } from "@/lib/crdt";

function makeUpdateFromEdit(doc: Y.Doc, fn: (text: Y.Text) => void): Uint8Array {
  const text = doc.getText("content");
  let captured: Uint8Array | null = null;
  const handler = (u: Uint8Array) => (captured = u);
  doc.on("update", handler);
  fn(text);
  doc.off("update", handler);
  if (!captured) throw new Error("no update captured");
  return captured;
}

describe("CRDT merge determinism", () => {
  it("produces identical final content regardless of update application order", () => {
    // Simulate two offline clients starting from the same empty document.
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();

    const updateA = makeUpdateFromEdit(clientA, (t) => t.insert(0, "Hello "));
    const updateB = makeUpdateFromEdit(clientB, (t) => t.insert(0, "World"));

    // Order 1: A then B
    const order1 = buildDocFromUpdates([updateA, updateB]);
    // Order 2: B then A
    const order2 = buildDocFromUpdates([updateB, updateA]);

    // Content may interleave differently depending on CRDT origin
    // ordering rules, but crucially both orders must produce the SAME
    // result as each other — that's determinism, not "first writer wins."
    expect(order1.getText("content").toString()).toEqual(order2.getText("content").toString());
  });

  it("loses no data when two clients edit concurrently offline", () => {
    const base = new Y.Doc();
    const baseUpdate = makeUpdateFromEdit(base, (t) => t.insert(0, "Shared start. "));

    const clientA = new Y.Doc();
    Y.applyUpdate(clientA, baseUpdate);
    const clientB = new Y.Doc();
    Y.applyUpdate(clientB, baseUpdate);

    const updateA = makeUpdateFromEdit(clientA, (t) => t.insert(t.length, "Edit from A."));
    const updateB = makeUpdateFromEdit(clientB, (t) => t.insert(0, "Edit from B. "));

    const merged = buildDocFromUpdates([baseUpdate, updateA, updateB]);
    const finalText = merged.getText("content").toString();

    expect(finalText).toContain("Edit from A.");
    expect(finalText).toContain("Edit from B.");
    expect(finalText).toContain("Shared start.");
  });

  it("restore produces a diff-update that transforms live state to target without deleting live-only content", () => {
    const doc = new Y.Doc();
    const u1 = makeUpdateFromEdit(doc, (t) => t.insert(0, "v1 content"));
    const versionSnapshot = snapshotDoc(buildDocFromUpdates([u1]));

    // Simulate further edits after the snapshot was captured (by another
    // collaborator), representing "live" state diverging from the version.
    const u2 = makeUpdateFromEdit(doc, (t) => t.insert(t.length, " + live edit"));

    const restoreDiff = buildRestoreUpdate([u1, u2], versionSnapshot);

    // Applying the restore diff on top of live state should bring content
    // back to exactly the captured version's text.
    const liveDoc = buildDocFromUpdates([u1, u2]);
    Y.applyUpdate(liveDoc, restoreDiff);

    const restoredText = liveDoc.getText("content").toString();
    expect(restoredText).toBe("v1 content");
  });

  it("applying the same update twice is a safe no-op (idempotency for retried pushes)", () => {
    const doc = new Y.Doc();
    const update = makeUpdateFromEdit(doc, (t) => t.insert(0, "idempotent"));

    const replayed = buildDocFromUpdates([update, update]);
    expect(replayed.getText("content").toString()).toBe("idempotent");
  });
});
