import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside a larger local workspace that also has a lockfile.
  // Keep Turbopack scoped to MacroMail so builds do not crawl sibling products.
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: [],
};

export default nextConfig;
