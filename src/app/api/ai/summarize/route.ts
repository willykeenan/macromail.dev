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
  thread: z.object({
    text: z.string().optional(),
    subject: z.string().optional(),
    messages: z.array(z.any()).optional(),
  }),
  style: z.enum(["bullets", "paragraph"]).default("bullets"),
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
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request.", fix: "Provide thread.text or a structured thread." } },
      { status: 422 },
    );

  const text = renderThread(parsed.data.thread);
  if (!text.trim())
    return Response.json({ error: { code: "validation_error", message: "Empty thread.", fix: "Paste the email or thread text to summarize." } }, { status: 422 });

  try {
    const out = await runAI({
      apiKey: key,
      model: AI_MODELS.smart,
      maxTokens: 800,
      temperature: 0.3,
      system:
        'You summarize email threads for a busy professional. Return STRICT JSON: ' +
        '{"tldr": string[], "actionItems": [{"text": string, "due"?: string}], ' +
        '"suggestedLabels": string[]}. ' +
        'tldr = 2-4 crisp bullets. suggestedLabels from ["important","action_needed","newsletter","promotions","fyi"]. ' +
        "No prose outside JSON.",
      prompt: text,
    });
    const json = extractJson<{ tldr: string[]; actionItems: { text: string; due?: string }[]; suggestedLabels: string[] }>(out);
    if (!json?.tldr) return Response.json({ ok: false, code: "ai_bad_output", message: "Model returned unparseable output." }, { status: 502 });
    return Response.json({
      ok: true,
      model: AI_MODELS.smart,
      tldr: json.tldr,
      actionItems: json.actionItems ?? [],
      suggestedLabels: json.suggestedLabels ?? [],
    });
  } catch (e) {
    if (e instanceof AiDisabledError) return Response.json(aiDisabledResponse(), { status: 503 });
    return Response.json({ ok: false, code: "ai_error", message: (e as Error).message }, { status: 500 });
  }
}
