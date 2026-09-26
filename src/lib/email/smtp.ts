/**
 * SMTP provider — live outbound through the signed-in user's own SMTP account
 * (AUTH LOGIN over TLS). There is no server-wide SMTP account; MacroMail never
 * sends from the server owner's mailbox.
 *
 * Pure Node tls/net — no nodemailer dependency. Port 465 uses implicit TLS;
 * 587 and 2525 use STARTTLS. The TCP connection is pinned to a resolved
 * public IP so the SSRF check cannot be rebound.
 */

import { randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { EmailProvider, SendEmailInput } from "./types";
import {
  assertSendHeaders,
  canonicalMailbox,
  isValidDomain,
  mailboxAddress,
  resolveMessageIdDomain,
} from "./address";
import {
  resolveSafeSmtpTarget,
  smtpUsesStartTls,
  type SmtpConnectTarget,
} from "@/lib/smtp-guard";

export { smtpUsesStartTls };

export interface SmtpEnvConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromDomain?: string;
}

/** Extract bare email from `Name <email@x>` or plain address. */
export function extractEmail(addr: string): string {
  return mailboxAddress(addr);
}

export function buildMime(input: SendEmailInput, messageIdDomain: string): string {
  assertSendHeaders(input);
  if (!isValidDomain(messageIdDomain)) throw new Error("Message-ID domain is invalid.");

  const hasHtml = Boolean(input.html);
  const hasText = Boolean(input.text);
  const headers = [
    `From: ${canonicalMailbox(input.from)}`,
    `To: ${input.to.map(canonicalMailbox).join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.map(canonicalMailbox).join(", ")}` : null,
    input.reply_to ? `Reply-To: ${canonicalMailbox(input.reply_to)}` : null,
    `Subject: ${input.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <mm-${Date.now().toString(36)}-${randomUUID().replace(/-/g, "")}@${messageIdDomain}>`,
    "MIME-Version: 1.0",
  ].filter(Boolean) as string[];

  let body: string;
  if (hasHtml && hasText) {
    const boundary = `mm_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.text!,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.html!,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else if (hasHtml) {
    headers.push('Content-Type: text/html; charset="utf-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    body = input.html!;
  } else {
    headers.push('Content-Type: text/plain; charset="utf-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    body = input.text || "";
  }

  const stuffed = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => (l.startsWith(".") ? `.${l}` : l))
    .join("\r\n");

  return headers.join("\r\n") + "\r\n\r\n" + stuffed + "\r\n";
}

/** Caps on what a (possibly hostile) SMTP server can make us buffer. */
export const MAX_SMTP_RESPONSE_BYTES = 64 * 1024;
export const MAX_SMTP_RESPONSE_LINES = 100;
/** Hard wall-clock limit for one whole SMTP operation (connect → QUIT). */
export const SMTP_OPERATION_DEADLINE_MS = 30_000;
/** Idle limit per socket. */
const SMTP_IDLE_TIMEOUT_MS = 15_000;

/**
 * An SMTP failure with a message that is safe to show the user. The server's
 * raw reply (banners, hostnames) stays in `detail` and is never returned, so
 * the SMTP test cannot be used to read other hosts' banners.
 */
export class SmtpError extends Error {
  readonly publicMessage: string;
  readonly detail: string;
  constructor(publicMessage: string, detail = "") {
    super(publicMessage);
    this.name = "SmtpError";
    this.publicMessage = publicMessage;
    this.detail = detail;
  }
}

const SAFE_GUARD_MESSAGE = /^SMTP (host|port|from-domain) /;

/** A user-safe message for any error thrown while talking SMTP. */
export function publicSmtpError(e: unknown): string {
  if (e instanceof SmtpError) return e.publicMessage;
  const err = e as { message?: unknown; code?: unknown } | null;
  const message = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.code === "string" ? err.code : "";
  if (SAFE_GUARD_MESSAGE.test(message)) return message;
  if (/^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)$/.test(code)) {
    return "Could not connect to the SMTP server.";
  }
  if (/^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED)/.test(code) || /certificate|tls|ssl/i.test(message)) {
    return "Could not open a secure (TLS) connection to the SMTP server.";
  }
  return "SMTP send failed.";
}

function replyCode(reply: string): string {
  const m = /^(\d{3})/.exec(reply.trim());
  return m ? m[1]! : "???";
}

/**
 * Read one (possibly multi-line) SMTP reply. Rejects — and destroys the
 * socket — on oversized replies, too many lines, malformed lines, or close.
 */
export function readSmtpResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let scanFrom = 0;
    let lines = 0;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("close", onClose);
    };
    const fail = (e: Error) => {
      cleanup();
      socket.destroy();
      reject(e);
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.length > MAX_SMTP_RESPONSE_BYTES) {
        fail(new SmtpError("The SMTP server sent an oversized reply.", `reply over ${MAX_SMTP_RESPONSE_BYTES} bytes`));
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf("\n", scanFrom)) !== -1) {
        const line = buf.slice(scanFrom, nl).replace(/\r$/, "");
        scanFrom = nl + 1;
        if (!line) continue;
        lines += 1;
        if (lines > MAX_SMTP_RESPONSE_LINES) {
          fail(new SmtpError("The SMTP server sent an oversized reply.", `reply over ${MAX_SMTP_RESPONSE_LINES} lines`));
          return;
        }
        if (/^\d{3}(?: |$)/.test(line)) {
          cleanup();
          resolve(buf.slice(0, scanFrom));
          return;
        }
        if (!/^\d{3}-/.test(line)) {
          fail(new SmtpError("The SMTP server sent an invalid reply.", line.slice(0, 200)));
          return;
        }
      }
    };
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onClose = () => {
      cleanup();
      reject(new SmtpError("The SMTP server closed the connection.", "closed"));
    };
    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("close", onClose);
  });
}

type Stage = "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "quit";

const STAGE_MESSAGE: Record<Stage, string> = {
  greeting: "The SMTP server did not accept the connection",
  ehlo: "The SMTP server rejected EHLO",
  starttls: "The SMTP server does not support STARTTLS",
  auth: "SMTP authentication failed",
  mail: "The SMTP server rejected the sender",
  rcpt: "The SMTP server rejected a recipient",
  data: "The SMTP server rejected the message",
  quit: "The SMTP server did not close cleanly",
};

async function expectCode(socket: Socket, code: number, stage: Stage): Promise<string> {
  const reply = await readSmtpResponse(socket);
  const got = replyCode(reply);
  if (got !== String(code)) {
    throw new SmtpError(`${STAGE_MESSAGE[stage]} (code ${got}).`, reply.trim().slice(0, 200));
  }
  return reply;
}

async function cmd(socket: Socket, line: string, expect: number, stage: Stage): Promise<string> {
  socket.write(line + "\r\n");
  return expectCode(socket, expect, stage);
}

type Track = (socket: Socket) => void;

function withIdleTimeout<T extends Socket>(socket: T, reject: (e: Error) => void): T {
  socket.setTimeout(SMTP_IDLE_TIMEOUT_MS, () => {
    socket.destroy();
    reject(new SmtpError("The SMTP server took too long to respond.", "idle timeout"));
  });
  socket.on("error", reject);
  return socket;
}

function connectTls(target: SmtpConnectTarget, port: number, track: Track): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tlsConnect(
      {
        host: target.address,
        port,
        servername: target.servername,
        rejectUnauthorized: true,
      },
      () => resolve(s),
    );
    track(s);
    withIdleTimeout(s, reject);
  });
}

function connectPlain(target: SmtpConnectTarget, port: number, track: Track): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = netConnect(
      {
        host: target.address,
        port,
        family: target.family === 6 ? 6 : 4,
      },
      () => resolve(s),
    );
    track(s);
    withIdleTimeout(s, reject);
  });
}

function upgradeTls(socket: Socket, servername: string, track: Track): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tlsConnect(
      {
        socket,
        servername,
        rejectUnauthorized: true,
      },
      () => resolve(s),
    );
    track(s);
    withIdleTimeout(s, reject);
  });
}

export interface SmtpRunOptions {
  /** Whole-operation deadline. Defaults to SMTP_OPERATION_DEADLINE_MS. */
  deadlineMs?: number;
  /** Test seam: resolve the connect target (defaults to the SSRF-guarded resolver). */
  resolveTarget?: (host: string, port: number) => Promise<SmtpConnectTarget>;
}

/**
 * Run one SMTP operation under a hard deadline. Every socket it opens is
 * destroyed when the deadline fires or the operation ends.
 */
async function runWithDeadline<T>(deadlineMs: number, run: (track: Track) => Promise<T>): Promise<T> {
  const sockets = new Set<Socket>();
  const track: Track = (socket) => {
    sockets.add(socket);
  };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      reject(new SmtpError("The SMTP server took too long to respond.", `deadline ${deadlineMs}ms`));
    }, deadlineMs);
  });
  const work = run(track);
  work.catch(() => {
    /* settled by the race below; avoid an unhandled rejection after a timeout */
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
  }
}

async function openSmtpTls(cfg: SmtpEnvConfig, track: Track, opts: SmtpRunOptions): Promise<Socket> {
  const target = await (opts.resolveTarget ?? resolveSafeSmtpTarget)(cfg.host, cfg.port);
  if (!smtpUsesStartTls(cfg.port)) {
    const socket = await connectTls(target, cfg.port, track);
    await expectCode(socket, 220, "greeting");
    await cmd(socket, "EHLO macromail.dev", 250, "ehlo");
    return socket;
  }
  const plain = await connectPlain(target, cfg.port, track);
  await expectCode(plain, 220, "greeting");
  await cmd(plain, "EHLO macromail.dev", 250, "ehlo");
  await cmd(plain, "STARTTLS", 220, "starttls");
  const tls = await upgradeTls(plain, target.servername, track);
  await cmd(tls, "EHLO macromail.dev", 250, "ehlo");
  return tls;
}

async function authLogin(socket: Socket, cfg: SmtpEnvConfig): Promise<void> {
  await cmd(socket, "AUTH LOGIN", 334, "auth");
  await cmd(socket, Buffer.from(cfg.user).toString("base64"), 334, "auth");
  await cmd(socket, Buffer.from(cfg.pass).toString("base64"), 235, "auth");
}

export class SmtpProvider implements EmailProvider {
  readonly name: string;
  readonly live = true;
  private cfg: SmtpEnvConfig;
  private opts: SmtpRunOptions;

  constructor(cfg: SmtpEnvConfig, opts: SmtpRunOptions = {}) {
    this.cfg = cfg;
    this.opts = opts;
    this.name = `SMTP (${cfg.host})`;
  }

  async send(input: SendEmailInput): Promise<{ provider_message_id: string }> {
    assertSendHeaders(input);

    // Optional domain allowlist for the From address.
    const configuredFromDomain = this.cfg.fromDomain?.trim().toLowerCase();
    if (configuredFromDomain) {
      if (!isValidDomain(configuredFromDomain)) {
        throw new Error("SMTP from-domain setting is not a valid domain.");
      }
      const fromEmail = extractEmail(input.from);
      const domain = fromEmail.split("@")[1] || "";
      if (domain !== configuredFromDomain) {
        throw new Error(
          `SMTP from-domain mismatch: got ${domain}, expected ${configuredFromDomain}`,
        );
      }
    }

    const cfg = this.cfg;
    const opts = this.opts;
    return runWithDeadline(opts.deadlineMs ?? SMTP_OPERATION_DEADLINE_MS, async (track) => {
      const socket = await openSmtpTls(cfg, track, opts);
      await authLogin(socket, cfg);

      const mailFrom = extractEmail(input.from);
      await cmd(socket, `MAIL FROM:<${mailFrom}>`, 250, "mail");

      const recipients = [
        ...new Set(
          (input.envelope_to ?? [...input.to, ...(input.cc || []), ...(input.bcc || [])]).map(extractEmail),
        ),
      ];
      if (!recipients.length) throw new SmtpError("No outbound recipients.", "empty envelope");
      for (const r of recipients) {
        await cmd(socket, `RCPT TO:<${r}>`, 250, "rcpt");
      }

      await cmd(socket, "DATA", 354, "data");
      const mime = buildMime(input, resolveMessageIdDomain(input.from, configuredFromDomain));
      socket.write(mime);
      if (!mime.endsWith("\r\n")) socket.write("\r\n");
      socket.write(".\r\n");
      const done = await expectCode(socket, 250, "data");
      await cmd(socket, "QUIT", 221, "quit").catch(() => "");

      const m = done.match(/queued as\s+([A-Za-z0-9._@-]{1,100})/i) || done.match(/id[= ]([A-Za-z0-9._@-]{1,100})/i);
      return {
        provider_message_id: m?.[1] || `smtp-${Date.now().toString(36)}`,
      };
    });
  }
}

/** AUTH LOGIN against the user's SMTP account, then QUIT. Does not send mail. */
export async function testSmtpAuth(cfg: SmtpEnvConfig, opts: SmtpRunOptions = {}): Promise<void> {
  await runWithDeadline(opts.deadlineMs ?? SMTP_OPERATION_DEADLINE_MS, async (track) => {
    const socket = await openSmtpTls(cfg, track, opts);
    await authLogin(socket, cfg);
    await cmd(socket, "QUIT", 221, "quit").catch(() => "");
  });
}
