/**
 * POST /api/documents/:id/share
 *
 * Grants a role (EDITOR | VIEWER) to another user by email. Only the
 * document OWNER may share — EDITORs cannot grant further access, which
 * prevents privilege escalation via an invited editor re-sharing the doc
 * beyond what the owner intended.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const shareSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  const parsed = shareSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const membership = await withTenantScope(userId, async (tx) => {
      const requester = await tx.documentMember.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      if (!requester || requester.role !== "OWNER") {
        throw new Error("only the owner can share this document");
      }

      const targetUser = await tx.user.findUnique({ where: { email: parsed.data.email } });
      if (!targetUser) throw new Error("no user with that email");

      return tx.documentMember.upsert({
        where: { documentId_userId: { documentId, userId: targetUser.id } },
        create: { documentId, userId: targetUser.id, role: parsed.data.role },
        update: { role: parsed.data.role },
      });
    });

    return NextResponse.json({ membership }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "forbidden";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
