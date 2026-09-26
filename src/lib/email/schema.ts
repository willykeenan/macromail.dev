import { z } from "zod";
import {
  MAX_ADDRESS_LENGTH,
  MAX_BODY_CHARS,
  MAX_RECIPIENTS,
  MAX_TAG_NAME,
  MAX_TAG_VALUE,
  MAX_TAGS,
} from "@/lib/limits";
import { assertHeaderValue, canonicalMailbox, parseMailbox } from "./address";

const mailbox = z.string().min(1).max(MAX_ADDRESS_LENGTH).superRefine((value, ctx) => {
  try {
    parseMailbox(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid mailbox.",
    });
  }
});

const headerValue = z.string().min(1).max(998).superRefine((value, ctx) => {
  try {
    assertHeaderValue(value, "Header");
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid header value.",
    });
  }
});

/** Accept one validated mailbox or a non-empty array of validated mailboxes. */
const recipients = z.union([mailbox, z.array(mailbox).min(1).max(MAX_RECIPIENTS)]);

const body = z.string().max(MAX_BODY_CHARS, `Body must be at most ${MAX_BODY_CHARS} characters.`);

const countRecipients = (v: string | string[] | undefined) => (v === undefined ? 0 : Array.isArray(v) ? v.length : 1);

export const sendSchema = z
  .object({
    from: mailbox,
    to: recipients,
    subject: headerValue,
    html: body.optional(),
    text: body.optional(),
    cc: recipients.optional(),
    bcc: recipients.optional(),
    reply_to: mailbox.optional(),
    tags: z
      .array(z.object({ name: z.string().max(MAX_TAG_NAME), value: z.string().max(MAX_TAG_VALUE) }))
      .max(MAX_TAGS)
      .optional(),
    internal_only: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.html) || Boolean(d.text), {
    message: "Either `html` or `text` is required.",
    path: ["html"],
  })
  .refine((d) => countRecipients(d.to) + countRecipients(d.cc) + countRecipients(d.bcc) <= MAX_RECIPIENTS, {
    message: `At most ${MAX_RECIPIENTS} recipients (to + cc + bcc) per email.`,
    path: ["to"],
  });

export type SendPayload = z.infer<typeof sendSchema>;

export const toArray = (v: string | string[] | undefined): string[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

/** Normalize a validated payload into the provider's SendEmailInput shape. */
export function normalizeSend(d: SendPayload) {
  return {
    from: canonicalMailbox(d.from),
    to: toArray(d.to)!.map(canonicalMailbox),
    subject: d.subject,
    html: d.html,
    text: d.text,
    cc: toArray(d.cc)?.map(canonicalMailbox),
    bcc: toArray(d.bcc)?.map(canonicalMailbox),
    reply_to: d.reply_to ? canonicalMailbox(d.reply_to) : undefined,
    tags: d.tags,
    internal_only: d.internal_only,
  };
}
