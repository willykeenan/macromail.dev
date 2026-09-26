"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { loginAction, signupAction, type AuthState } from "@/lib/auth-actions";
import { safePostAuthPath } from "@/lib/safe-next";

const inputClass =
  "w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2.5 text-[14px] text-fg " +
  "placeholder:text-fg-faint outline-none transition-colors " +
  "focus:border-accent/50 focus:ring-2 focus:ring-accent/25";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const action = isSignup ? signupAction : loginAction;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);
  const params = useSearchParams();
  const next = safePostAuthPath(params.get("next"));

  return (
    <Card className="p-7">
      <div className="text-center">
        <h1 className="text-[22px] font-[680] tracking-[-0.02em] text-fg">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-fg-muted">
          {isSignup ? "Create an account on this MacroMail server." : "Sign in to your MacroMail portal."}
        </p>
      </div>

      <form action={formAction} className="mt-7 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[13px] font-medium text-fg-muted">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className={inputClass} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-[13px] font-medium text-fg-muted">Password</label>
            {!isSignup && <span className="text-[12.5px] text-fg-faint">8+ characters</span>}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder={isSignup ? "At least 8 characters" : "••••••••"}
            className={inputClass}
          />
        </div>

        {state?.error && (
          <p role="alert" aria-live="polite" className="flex items-start gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {state.error}
          </p>
        )}

        <Button type="submit" size="md" className="mt-1 w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {isSignup ? "Create account" : "Sign in"}
          {!pending && <ArrowRight className="size-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-fg-muted">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-accent-hi hover:underline">
          {isSignup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </Card>
  );
}
