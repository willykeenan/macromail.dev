import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "MacroMail — A self-hostable email tool for AI agents",
    template: "%s — MacroMail",
  },
  description: site.description,
  keywords: [
    "MacroMail",
    "self-host email",
    "open source email",
    "AI agent email",
    "MCP email",
    "SQLite",
  ],
  authors: [{ name: "MacroMail", url: site.url }],
  openGraph: {
    type: "website",
    url: site.url,
    title: "MacroMail — A self-hostable email tool for AI agents",
    description: site.description,
    siteName: "MacroMail",
  },
  twitter: {
    card: "summary_large_image",
    title: "MacroMail — A self-hostable email tool for AI agents",
    description: site.tagline,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
