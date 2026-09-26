import { z } from "zod";
import {
  runAI, AI_MODELS, aiEnabled, aiDisabledResponse, keyFromRequest,
  extractJson, renderThread, AiDisabledError,
} from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { resolveUserAnthropicKey } from "@/lib/inbox/service";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({
  mode: z.enum(["new", "reply", "smart_replies"]).default("new"),
  intent: z.string().optional(),
  thread: z
    .object({
      text: z.string().optional(),
      subject: z.string().optional(),
      messages: z.array(z.any()).optional(),
    })
    .optional(),
  tone: z.string().optional(),
  voiceSample: z.string().optional(),
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
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request.", fix: "Provide a mode and an intent for new/reply." } },
      { status: 422 },
    );

  const { mode, intent, thread, tone, voiceSample } = parsed.data;

  try {
    if (mode === "smart_replies") {
      const out = await runAI({
        apiKey: key,
        model: AI_MODELS.fast,
        maxTokens: 300,
        temperature: 0.6,
        system:
          'You generate 3 short, distinct one-tap reply options to an email thread. Return STRICT JSON: {"replies": string[]}. Each reply <= 12 words. No prose outside JSON.',
        prompt: thread ? renderThread(thread) : intent ?? "",
      });
      const json = extractJson<{ replies: string[] }>(out);
      if (!json?.replies) return Response.json({ ok: false, code: "ai_bad_output", message: "Model returned unparseable output." }, { status: 502 });
      return Response.json({ ok: true, model: AI_MODELS.fast, replies: json.replies });
    }

    const isReply = mode === "reply";
    const system =
      `You are an expert email writer. Write a ${isReply ? "reply" : "new email"} ` +
      `${tone ? `in a ${tone} tone` : "in a clear, professional tone"}.` +
      (voiceSample ? `\nMatch the writing voice of these samples:\n${voiceSample}` : "") +
      `\nReturn STRICT JSON: {"subject": string, "body": string, "alts": string[]}. ` +
      `"alts" = up to 2 alternative bodies (e.g. a shorter and a firmer version). No prose outside JSON.`;

    const userParts: string[] = [];
    if (thread) userParts.push(`THREAD CONTEXT:\n${renderThread(thread)}`);
    if (intent) userParts.push(`INTENT: ${intent}`);

    const out = await runAI({
      apiKey: key,
      model: AI_MODELS.smart,
      maxTokens: 1100,
      temperature: 0.5,
      system,
      prompt: userParts.join("\n\n") || "Write a brief, friendly hello email.",
    });
    const json = extractJson<{ subject: string; body: string; alts?: string[] }>(out);
    if (!json?.body) return Response.json({ ok: false, code: "ai_bad_output", message: "Model returned unparseable output." }, { status: 502 });
    return Response.json({ ok: true, model: AI_MODELS.smart, subject: json.subject ?? "", body: json.body, alts: json.alts ?? [] });
  } catch (e) {
    if (e instanceof AiDisabledError) return Response.json(aiDisabledResponse(), { status: 503 });
    return Response.json({ ok: false, code: "ai_error", message: (e as Error).message }, { status: 500 });
  }
}
