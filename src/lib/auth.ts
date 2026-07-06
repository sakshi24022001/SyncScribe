/**
 * Auth.js (NextAuth v5) configuration.
 *
 * JWT session strategy (not database sessions) — the session token itself
 * carries the user id, so every API route can authenticate without a DB
 * round trip on every request; the DB round trip only happens for
 * document-level ROLE checks (owner/editor/viewer), which are inherently
 * per-resource and can't be baked into a generic session token.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});

/** Resolves a document member's role for the current user, or null if not a member. */
export async function getDocumentRole(userId: string, documentId: string) {
  const membership = await prisma.documentMember.findUnique({
    where: { documentId_userId: { documentId, userId } },
  });
  return membership?.role ?? null;
}
