/**
 * Prisma client + RLS-scoped transaction helper.
 *
 * Every request-handling code path should call `withTenantScope(userId, fn)`
 * instead of using `prisma` directly for anything touching documents,
 * updates, or versions. This sets the Postgres session variable that our
 * RLS policies key off of (`prisma/rls.sql`), *inside a transaction*, so
 * there's no window where a connection is reused for another user before
 * the variable is reset (connection pooling makes this a real risk if you
 * set the variable outside a transaction).
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

/**
 * Runs `fn` with `app.current_user_id` set for the duration of a single
 * transaction, so every RLS policy sees the correct tenant boundary.
 * SET LOCAL is transaction-scoped and automatically resets on commit —
 * this is what makes it safe to reuse pooled connections.
 */
export async function withTenantScope<T>(
  userId: string,
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    },
    {
      maxWait: 10_000,
      timeout: 20_000,
    }
  );
}
