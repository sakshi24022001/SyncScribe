/**
 * POST /api/ai/summarize
 *
 * AI add-on feature (assignment: "good to have — AI-SDK/OpenAI/Gemini/Groq").
 * Implemented as summarize / tone-rewrite / action-item extraction over
 * the current document text, streamed back to the client via the Vercel
 * AI SDK so the UI can render tokens as they arrive instead of waiting on
 * a single blocking response.
 *
 * Deliberately NOT wired into the CRDT sync path: AI suggestions are
 * generated from a point-in-time text snapshot and inserted as a normal
 * local edit (going through the same Yjs update path as typing) if the
 * user accepts them — the AI has no special write path that could bypass
 * validation, rate limits, or role checks.
 */
import { NextRequest } from "next/server";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { auth } from "@/lib/auth";
import { withTenantScope } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_INPUT_CHARS = 20_000; // cap tokens sent to the model, cost + abuse control

const requestSchema = z.object({
  documentId: z.string().cuid(),
  text: z.string().max(MAX_INPUT_CHARS),
  mode: z.enum(["summarize", "action_items", "improve_clarity"]),
});

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPTS: Record<string, string> = {
  summarize: "Summarize the following document in 3-5 concise bullet points.",
  action_items: "Extract clear, actionable to-do items from the following document as a bullet list.",
  improve_clarity: "Rewrite the following text for clarity and concision. Preserve meaning and formatting intent.",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
  }

  const userId = session.user.id;

  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "invalid request" }), { status: 400 });
  }
  const { documentId, text, mode } = parsed.data;

  // Even a read-oriented AI feature respects document membership — a
  // non-member should not be able to exfiltrate document content via the
  // AI endpoint.
  const membership = await withTenantScope(userId, (tx) =>
    tx.documentMember.findUnique({
      where: { documentId_userId: { documentId, userId } },
    })
  );
  if (!membership) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: "You are a concise writing assistant embedded in a document editor.",
    prompt: `${PROMPTS[mode]}\n\n---\n${text}`,
  });

  return result.toTextStreamResponse();
}
