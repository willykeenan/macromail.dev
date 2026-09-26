/**
 * The saved SMTP password is only ever sent back to the exact host, port and
 * username it was saved for. Changing any of them requires typing the password
 * again, so a borrowed session cannot redirect the stored secret to a server
 * the attacker controls.
 */
export interface SavedSmtpTarget {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass_enc: string | null;
}

export function sameSmtpTarget(
  saved: SavedSmtpTarget | null | undefined,
  next: { host: string; port: number; user: string },
): boolean {
  if (!saved?.smtp_host || !saved.smtp_user) return false;
  return (
    saved.smtp_host.trim().toLowerCase().replace(/\.$/, "") === next.host.trim().toLowerCase().replace(/\.$/, "") &&
    Number(saved.smtp_port || 465) === next.port &&
    saved.smtp_user.trim() === next.user.trim()
  );
}

export const SMTP_PASSWORD_REQUIRED =
  "Enter the SMTP password again. It is required when you change the host, port, or username.";

/**
 * Pick the password to use: the typed one, or the saved (encrypted) one only
 * when the target is unchanged.
 */
export function resolveSmtpPasswordSource(
  saved: SavedSmtpTarget | null | undefined,
  next: { host: string; port: number; user: string; pass: string },
): { typed: string } | { savedEnc: string } | { error: string } {
  const typed = next.pass.trim();
  if (typed) return { typed };
  if (saved?.smtp_pass_enc && sameSmtpTarget(saved, next)) return { savedEnc: saved.smtp_pass_enc };
  return { error: saved?.smtp_pass_enc ? SMTP_PASSWORD_REQUIRED : "SMTP password is required." };
}
