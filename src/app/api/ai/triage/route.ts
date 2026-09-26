import { z } from "zod";
import {
  runAI, AI_MODELS, aiEnabled, aiDisabledResponse, keyFromRequest,
  extractJson, AiDisabledError,
} from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { resolveUserAnthropicKey } from "@/lib/inbox/service";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        subject: z.string(),
        snippet: z.string().optional(),
        from: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
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
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request.", fix: "Provide items: [{id, subject, snippet?, from?}]." } },
      { status: 422 },
    );

  const items = parsed.data.items;
  const list = items
    .map((it) => `- id:${it.id} | from:${it.from ?? "?"} | subject:${it.subject} | ${it.snippet ?? ""}`)
    .join("\n");

  try {
    const out = await runAI({
      apiKey: key,
      model: AI_MODELS.fast,
      maxTokens: 1200,
      temperature: 0.2,
      system:
        "You triage an email inbox. For EACH item, assign exactly one label from " +
        '["important","action_needed","newsletter","promotions","fyi"]. ' +
        'Return STRICT JSON: {"results": [{"id": string, "label": string, "confidence": number, "reason": string}]}. ' +
        "confidence in [0,1]. reason <= 12 words. No prose outside JSON.",
      prompt: list,
    });
    const json = extractJson<{ results: { id: string; label: string; confidence: number; reason: string }[] }>(out);
    if (!json?.results) return Response.json({ ok: false, code: "ai_bad_output", message: "Model returned unparseable output." }, { status: 502 });
    return Response.json({ ok: true, model: AI_MODELS.fast, results: json.results });
  } catch (e) {
    if (e instanceof AiDisabledError) return Response.json(aiDisabledResponse(), { status: 503 });
    return Response.json({ ok: false, code: "ai_error", message: (e as Error).message }, { status: 500 });
  }
}
