import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for secrets at rest (OAuth refresh tokens, bring-your-own
 * Anthropic keys). AES-256-GCM with a 32-byte key from TOKEN_ENC_KEY.
 *
 * TOKEN_ENC_KEY may be a base64 or hex string. Deployments fail closed when it
 * is absent; a dedicated local-only fallback keeps development zero-config.
 */
type EncryptionEnvironment = {
  TOKEN_ENC_KEY?: string;
  NODE_ENV?: string;
};

const LOCAL_DEVELOPMENT_KEY =
  "macromail-local-dev-encryption-key-never-use-on-a-deployment";

export function resolveTokenEncryptionKey(
  environment: EncryptionEnvironment = process.env,
): Buffer {
  const raw = environment.TOKEN_ENC_KEY?.trim();
  if (raw) {
    const buf =
      /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
    // Any other string: hash it down to 32 bytes deterministically.
    return createHash("sha256").update(raw).digest();
  }
  if (environment.NODE_ENV === "development") {
    return createHash("sha256").update(LOCAL_DEVELOPMENT_KEY).digest();
  }
  throw new Error("TOKEN_ENC_KEY is required outside local development");
}

/** Encrypt a UTF-8 string → "v1:<iv>:<tag>:<ciphertext>" (all base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveTokenEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value produced by encryptSecret. Returns null on any failure. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== "v1") return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      resolveTokenEncryptionKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/** SHA-256 hex digest — used to store API keys without keeping the plaintext. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
