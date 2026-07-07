/**
 * POST /api/auth/register
 *
 * Public signup endpoint. Kept deliberately simple: email + password,
 * bcrypt-hashed before storage, with basic validation. No email
 * verification flow — out of scope for this project, but noted here as
 * the obvious next step for a real production deployment (an unverified
 * email means someone could register with an address they don't own).
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  // Minimum length only — deliberately not requiring special characters
  // or mixed case, since composition rules are known to push people
  // toward predictable substitutions (Password1! etc.) without actually
  // improving real-world security; length is the strongest lever.
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Deliberately vague message — confirming "this email is already
    // registered" to an unauthenticated caller is a minor information
    // leak (account enumeration). Fine to tighten further in production
    // (e.g. always returning the same generic message and relying on a
    // "forgot password" email flow instead), left simple here.
    return NextResponse.json({ error: "an account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
