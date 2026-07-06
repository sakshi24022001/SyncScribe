/**
 * POST /api/documents/:id/versions/:versionId/restore
 *
 * Restores a document to a prior snapshot WITHOUT destroying newer history
 * or corrupting other collaborators' in-progress state.
 *
 * Naive (wrong) implementations of "restore" either:
 *   (a) DELETE all updates after the target version, which permanently
 *       destroys any edits made by other users after that point — data
 *       loss, and actively dangerous if someone else is mid-edit; or
 *   (b) overwrite the document row directly, racing with any concurrent
 *       push and silently discarding it.
 *
 * Instead: we compute the CRDT diff between "current live state" and
 * "target snapshot state" (buildRestoreUpdate) and append THAT as one more
 * normal update in the log, authored by the user who requested the
 * restore. Collaborators receive it exactly like any other incoming
 * change through /api/sync/pull — their own concurrent edits merge with
 * it deterministically because it's still just a CRDT update, not a
 * history rewrite. This means: restoring is itself un-doable (it shows up
 * as a version in the timeline too), and it's safe even if someone else
 * pushes a change in the same instant.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { buildDocFromUpdates, buildRestoreUpdate } from "@/lib/crdt";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: documentId, versionId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  try {
    const result = await withTenantScope(userId, async (tx) => {
      const membership = await tx.documentMember.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      // Restoring mutates the shared document, so it requires the same
      // permission level as any other push: OWNER/EDITOR only.
      if (!membership || membership.role === "VIEWER") {
        throw new Error("forbidden");
      }

      const version = await tx.docVersion.findUniqueOrThrow({ where: { id: versionId } });
      if (version.documentId !== documentId) throw new Error("forbidden");

      const currentRows = await tx.docUpdate.findMany({
        where: { documentId },
        orderBy: { seq: "asc" },
        select: { payload: true },
      });
      const currentUpdates = currentRows.map((r) => new Uint8Array(r.payload));

      const restoreUpdate = buildRestoreUpdate(currentUpdates, new Uint8Array(version.snapshot));

      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
      const newSeq = doc.seq + 1;

      await tx.docUpdate.create({
        data: {
          documentId,
          authorId: userId,
          clientOpId: crypto.randomUUID(),
          seq: newSeq,
          payload: Buffer.from(restoreUpdate),
          byteSize: restoreUpdate.byteLength,
        },
      });
      await tx.document.update({ where: { id: documentId }, data: { seq: newSeq } });

      return { newSeq, restoredFromVersionId: versionId };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[restore] error", err);
    return NextResponse.json({ error: "forbidden or invalid version" }, { status: 403 });
  }
}
