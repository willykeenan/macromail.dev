import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-[420px]" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
