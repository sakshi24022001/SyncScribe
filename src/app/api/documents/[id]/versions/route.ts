/**
 * GET  /api/documents/:id/versions  — list the version timeline
 * POST /api/documents/:id/versions  — capture a new named snapshot
 *
 * A version snapshot is a full Yjs state (not a diff), captured by
 * rebuilding the Y.Doc from the current update log and encoding its state.
 * We store the full state (rather than, say, a text diff) because Yjs
 * snapshots are what let us compute a correct restore-update later
 * (see lib/crdt.ts buildRestoreUpdate) regardless of how much the
 * document has changed since — a text-diff based versioning scheme would
 * require re-deriving CRDT semantics on restore, which reintroduces
 * exactly the conflict risk CRDTs are meant to avoid.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { buildDocFromUpdates, snapshotDoc } from "@/lib/crdt";
import { z } from "zod";

export const runtime = "nodejs";

const captureSchema = z.object({
  label: z.string().max(200).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  const versions = await withTenantScope(userId, async (tx) => {
    const membership = await tx.documentMember.findUnique({
      where: { documentId_userId: { documentId, userId } },
    });
    if (!membership) throw new Error("forbidden");

    return tx.docVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        seqAtCapture: true,
        byteSize: true,
        isAutoCapture: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
      take: 100,
    });
  }).catch(() => null);

  if (versions === null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ versions });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  const body = captureSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const version = await withTenantScope(userId, async (tx) => {
      const membership = await tx.documentMember.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      // Viewers may still capture a version of what they're looking at —
      // capturing history is read-derived, not a mutation to the shared
      // live document, so we allow OWNER/EDITOR/VIEWER here but restore
      // stays gated to OWNER/EDITOR (see restore/route.ts).
      if (!membership) throw new Error("forbidden");

      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
      const updateRows = await tx.docUpdate.findMany({
        where: { documentId },
        orderBy: { seq: "asc" },
        select: { payload: true },
      });

      const ydoc = buildDocFromUpdates(updateRows.map((r) => new Uint8Array(r.payload)));
      const snapshot = Buffer.from(snapshotDoc(ydoc));

      return tx.docVersion.create({
        data: {
          documentId,
          authorId: userId,
          label: body.data.label,
          snapshot,
          seqAtCapture: doc.seq,
          byteSize: snapshot.byteLength,
          isAutoCapture: false,
        },
        select: { id: true, label: true, seqAtCapture: true, createdAt: true },
      });
    });

    return NextResponse.json({ version }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
}
