import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// StylMe intentionally uses one environment source at the repository root.
// Non-NEXT_PUBLIC values remain server-only; Vercel deployments should define
// the same names in Project Settings because the local .env is never committed.
loadEnvConfig(resolve(process.cwd(), ".."), process.env.NODE_ENV === "development", console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "https://stylme-swoopstyl-api.vercel.app/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
