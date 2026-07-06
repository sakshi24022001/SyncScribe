/**
 * POST /api/ai/summarize
 *
 * TEMPORARILY STUBBED OUT.
 *
 * This route is disabled while getting the core deployment stable — it
 * was pulling in the `ai` / `@ai-sdk/openai` packages, which were causing
 * a build-time crash ("Failed to collect page data"). Rather than keep
 * debugging that in parallel with the rest of the deploy, this stub
 * removes those imports entirely so the build has one less variable.
 *
 * TO RE-ENABLE LATER:
 *   1. Confirm OPENAI_API_KEY is set in Vercel's environment variables.
 *   2. Restore the real implementation (see git history / project docs
 *      for the original streamText-based version).
 *   3. Redeploy and test in isolation before assuming it works.
 */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
  }

  return new Response(
    JSON.stringify({ error: "AI summarize feature is temporarily disabled" }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}
