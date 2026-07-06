/**
 * GET  /api/documents  — list documents the current user can access
 * POST /api/documents  — create a document (creator becomes OWNER)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().min(1).max(200).default("Untitled Document"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  const docs = await withTenantScope(userId, (tx) =>
    tx.document.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        members: { where: { userId }, select: { role: true } },
      },
    })
  );

  return NextResponse.json({
    documents: docs.map((d) => ({ ...d, role: d.members[0]?.role, members: undefined })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const doc = await withTenantScope(userId, (tx) =>
    tx.document.create({
      data: {
        title: parsed.data.title,
        ownerId: userId,
        members: { create: { userId, role: "OWNER" } },
      },
    })
  );

  return NextResponse.json({ document: doc }, { status: 201 });
}
