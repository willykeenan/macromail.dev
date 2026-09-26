import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="h-[460px]" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
