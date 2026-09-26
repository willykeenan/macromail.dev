import Anthropic from "@anthropic-ai/sdk";

/** Model tiers — cheap for high-volume tasks, strong for hard reasoning. */
export const AI_MODELS = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-opus-4-8",
} as const;

export type AiModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

/**
 * Resolve which Anthropic key to use. MacroMail only uses the caller's own
 * key (request header or the key stored on their account). There is no
 * server-wide Anthropic key.
 */
export function resolveKey(override?: string | null): string | null {
  return override?.trim() || null;
}

/** True when AI can run with the given (optional) per-request key. */
export function aiEnabled(override?: string | null): boolean {
  return Boolean(resolveKey(override));
}

/** Sentinel thrown when AI is requested but no key is configured. */
export class AiDisabledError extends Error {
  constructor() {
    super("AI requires an Anthropic API key. Add your key in Settings (/app/settings), or send it as the x-anthropic-key header.");
    this.name = "AiDisabledError";
  }
}

function getClient(override?: string | null): Anthropic {
  const key = resolveKey(override);
  if (!key) throw new AiDisabledError();
  // Always the caller's own key; there is no deployment-wide client.
  return new Anthropic({ apiKey: key });
}

export interface RunAiOptions {
  system: string;
  prompt: string;
  model?: AiModel;
  maxTokens?: number;
  temperature?: number;
  /** Bring-your-own-key: the customer's Anthropic key for this request. */
  apiKey?: string | null;
}

/**
 * Run a single-turn Claude completion. Returns plain text.
 * Throws AiDisabledError when no key is available — callers degrade gracefully.
 * We never fabricate an AI result (MacroMail's honesty rule).
 */
export async function runAI({
  system,
  prompt,
  model = AI_MODELS.fast,
  maxTokens = 1024,
  temperature = 0.4,
  apiKey,
}: RunAiOptions): Promise<string> {
  const res = await getClient(apiKey).messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Read a bring-your-own Anthropic key from a request header, if present. */
export function keyFromRequest(req: Request): string | null {
  const key = req.headers.get("x-anthropic-key")?.trim();
  return key && key.length <= 512 ? key : null;
}

/** Tolerantly extract a JSON object/array from a model response. */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Flatten a structured thread (or raw text) into a single string for the model. */
export function renderThread(input: { text?: string; subject?: string; messages?: unknown[] }): string {
  if (input.text) return input.text;
  const msgs = Array.isArray(input.messages) ? input.messages : [];
  const lines = msgs.map((m) => {
    const mm = m as { from?: { email?: string; name?: string }; date?: string; bodyText?: string };
    const who = mm.from?.name || mm.from?.email || "Unknown";
    return `From: ${who} (${mm.date ?? ""})\n${mm.bodyText ?? ""}`;
  });
  return [`Subject: ${input.subject ?? "(no subject)"}`, "", lines.join("\n\n---\n\n")].join("\n");
}

/** Standard response when AI can't run (no key) — honest, never a fake result. */
export function aiDisabledResponse() {
  return {
    error: {
      code: "ai_not_configured",
      message: "Claude-powered AI is not enabled. No Anthropic API key is configured.",
      fix: "Add your Anthropic API key in Settings (/app/settings, stored AES-GCM encrypted), or send it as the x-anthropic-key header.",
    },
  };
}
