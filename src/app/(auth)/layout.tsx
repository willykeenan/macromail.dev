import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      {/* ambient backdrop — matches the marketing layout */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(91,140,255,.18),transparent)] blur-2xl" />
        <div className="absolute -top-24 right-[8%] h-[360px] w-[480px] rounded-full bg-[radial-gradient(closest-side,rgba(155,107,255,.14),transparent)] blur-2xl" />
      </div>

      <Link href="/" className="mb-9 transition-opacity hover:opacity-90">
        <Logo />
      </Link>

      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}
