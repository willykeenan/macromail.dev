import { MAX_JSON_BODY_BYTES } from "@/lib/limits";

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: "invalid_json" | "payload_too_large"; message: string };

function tooLarge(maxBytes: number): JsonBodyResult {
  return {
    ok: false,
    status: 413,
    code: "payload_too_large",
    message: `Request body must be at most ${maxBytes} bytes.`,
  };
}

/**
 * Read and parse a JSON request body without ever buffering more than
 * `maxBytes`. A declared Content-Length over the cap is refused before any
 * byte is read; a chunked or lying body is cut off as soon as it passes it.
 */
export async function readJsonBody(req: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<JsonBodyResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, status: 400, code: "invalid_json", message: "Invalid Content-Length." };
    }
    if (n > maxBytes) return tooLarge(maxBytes);
  }
  if (!req.body) return { ok: false, status: 400, code: "invalid_json", message: "Request body must be JSON." };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "invalid_json", message: "Could not read the request body." };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, code: "invalid_json", message: "Request body must be valid JSON." };
  }
}
