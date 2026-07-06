/**
 * GET /api/sync/pull?documentId=...&sinceSeq=...
 *
 * Returns every update with seq > sinceSeq. Uses a simple indexed range
 * scan (documentId, seq) — O(log n + k) where k is the number of new
 * updates, not O(total history), so reconnect after a long offline period
 * stays fast regardless of how old the document is.
 *
 * If the gap since `sinceSeq` is enormous (e.g. client has been offline
 * for months on a heavily-edited document), we cap the response to a
 * bounded window and tell the client to page — this is the server-side
 * half of the memory-management story: we never load an unbounded number
 * of update rows into a single response.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { pullQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

const MAX_UPDATES_PER_PULL = 500;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const parsed = pullQuerySchema.safeParse({
    documentId: searchParams.get("documentId"),
    sinceSeq: searchParams.get("sinceSeq") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  const { documentId, sinceSeq } = parsed.data;

  try {
    const result = await withTenantScope(userId, async (tx) => {
      const membership = await tx.documentMember.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      if (!membership) throw new ForbiddenError();

      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });

      const rows = await tx.docUpdate.findMany({
        where: { documentId, seq: { gt: sinceSeq } },
        orderBy: { seq: "asc" },
        take: MAX_UPDATES_PER_PULL,
      });

      return {
        updates: rows.map((r) => r.payload.toString("base64")),
        latestSeq: rows.length > 0 ? rows[rows.length - 1].seq : sinceSeq,
        serverSeq: doc.seq,
        truncated: rows.length === MAX_UPDATES_PER_PULL, // client should pull again immediately
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "not a member of this document" }, { status: 403 });
    }
    // eslint-disable-next-line no-console
    console.error("[sync/pull] unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

class ForbiddenError extends Error {}
