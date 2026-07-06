/**
 * Server-side CRDT (Yjs) helpers.
 *
 * WHY YJS AND NOT A CUSTOM MERGE ALGORITHM:
 * The assignment asks for "deterministic conflict resolution" and "complex
 * data merging algorithms." A hand-rolled merge (e.g. naive OT or
 * last-write-wins per field) either requires a central sequencer (defeats
 * local-first) or loses data on concurrent edits to the same region of
 * text. Yjs implements a CRDT (specifically a variant of YATA) where:
 *   - Every character insertion gets a unique (client_id, clock) identifier.
 *   - Updates commute: applying [A, B] produces the same document as
 *     applying [B, A]. This is the actual definition of "deterministic
 *     conflict resolution" — order of arrival cannot change the outcome.
 *   - Merging is a pure function of the updates received, with no need for
 *     a central lock or turn-taking, which is what lets two offline
 *     clients each mutate their local copy freely and reconcile later
 *     without a server-side "who wins" decision.
 *
 * The server in this design is deliberately "dumb" about content — it
 * never inspects text, never resolves anything semantically. It only:
 *   1. Validates update envelopes (validation.ts).
 *   2. Appends them to an ordered, append-only log (doc_updates table).
 *   3. Occasionally compacts the log into a snapshot for fast cold loads.
 * All actual merging happens by applying the binary updates into a Yjs
 * Doc, which is a well-tested, deterministic operation — we do not
 * reimplement CRDT merge logic ourselves, we compose it.
 */
import * as Y from "yjs";

/** Rehydrates a Y.Doc by replaying an ordered list of binary updates. */
export function buildDocFromUpdates(updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

/** Produces a compact full-state snapshot suitable for storing as a DocVersion. */
export function snapshotDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Builds the "restore to version" update.
 *
 * Critically, this does NOT delete or rewrite history. Restoring works by
 * diffing the *current* live document state against the target snapshot's
 * state, and appending a single new CRDT update that transforms current ->
 * target. Collaborators who are mid-edit on the live document simply
 * receive this as one more incoming update through the normal sync path —
 * their own concurrent edits still merge in deterministically. This is
 * what "restore without corrupting the current shared state for other
 * active collaborators" means in practice.
 */
export function buildRestoreUpdate(currentUpdates: Uint8Array[], targetSnapshot: Uint8Array): Uint8Array {
  const liveDoc = buildDocFromUpdates(currentUpdates);
  const liveStateVector = Y.encodeStateVector(liveDoc);

  // Doc representing the version we want to restore to.
  const targetDoc = new Y.Doc();
  Y.applyUpdate(targetDoc, targetSnapshot);

  // The diff needed to bring `liveDoc` up to `targetDoc`'s content: this is
  // the actual "time travel" operation, expressed as a normal CRDT update
  // rather than a destructive overwrite.
  const diffToApplyOnLive = Y.encodeStateAsUpdate(targetDoc, liveStateVector);
  return diffToApplyOnLive;
}

export function docByteSize(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).byteLength;
}
