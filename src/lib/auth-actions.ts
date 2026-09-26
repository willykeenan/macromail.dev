"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  authenticateUser,
  clientIpFromHeaders,
  clearSessionCookie,
  registerUser,
  requireMutationOrigin,
  setSessionCookieForUser,
} from "@/lib/auth";
import { safePostAuthPath } from "@/lib/safe-next";

export type AuthState = { error?: string } | undefined;

function clean(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Email + password sign-in. */
export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };

  const email = clean(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safePostAuthPath(clean(formData, "next"));

  if (!email || !password) return { error: "Enter your email and password." };

  const ip = clientIpFromHeaders(await headers());
  const result = await authenticateUser(email, password, ip);
  if ("error" in result) return { error: result.error };

  await setSessionCookieForUser(result.user.id);
  redirect(next);
}

/**
 * Email + password sign-up. Creates the user immediately (no confirmation email),
 * then signs them in.
 */
export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };

  const email = clean(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safePostAuthPath(clean(formData, "next"), "/app/accounts");

  const ip = clientIpFromHeaders(await headers());
  const created = await registerUser(email, password, { ip });
  if ("error" in created) return { error: created.error };

  await setSessionCookieForUser(created.user.id);
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const originError = await requireMutationOrigin();
  if (!originError) {
    await clearSessionCookie();
  }
  redirect("/login");
}
