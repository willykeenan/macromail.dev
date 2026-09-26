import { z } from "zod";
import { runAI, AI_MODELS, aiEnabled, aiDisabledResponse, keyFromRequest, AiDisabledError } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { resolveUserAnthropicKey } from "@/lib/inbox/service";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({
  question: z.string().min(1),
  context: z.string().optional(),
});

export async function POST(req: Request) {
  if (!requestOriginOk(req)) {
    return Response.json({ error: { code: "forbidden_origin", message: mutationOriginError() } }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const key = await resolveUserAnthropicKey(user.id, keyFromRequest(req));
  if (!aiEnabled(key)) return Response.json(aiDisabledResponse(), { status: 503 });

  const read = await readJsonBody(req);
  if (!read.ok && read.status === 413) {
    return Response.json({ error: { code: "payload_too_large", message: read.message } }, { status: 413 });
  }
  const parsed = schema.safeParse(read.ok ? read.value : null);
  if (!parsed.success)
    return Response.json(
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request.", fix: "Provide a question." } },
      { status: 422 },
    );

  const { question, context } = parsed.data;
  try {
    const answer = await runAI({
      apiKey: key,
      model: AI_MODELS.fast,
      maxTokens: 900,
      temperature: 0.4,
      system:
        "You are MacroMail's AI email assistant. Be concise, practical, and friendly. " +
        "If the user pastes an email or thread, help them understand or respond to it. " +
        "Use plain text (short paragraphs or bullets). Never invent facts about the user's inbox you weren't given.",
      prompt: context ? `${question}\n\n---\nContext:\n${context}` : question,
    });
    return Response.json({ ok: true, model: AI_MODELS.fast, answer });
  } catch (e) {
    if (e instanceof AiDisabledError) return Response.json(aiDisabledResponse(), { status: 503 });
    return Response.json({ ok: false, code: "ai_error", message: (e as Error).message }, { status: 500 });
  }
}
