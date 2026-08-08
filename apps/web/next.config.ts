import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // Prebuilt EC2 artifact (Dockerfile.deploy) ships this standalone server.
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@memstream/engine", "@memstream/mcp"],
  serverExternalPackages: ["pg", "@aws-sdk/client-s3", "@aws-sdk/client-bedrock-runtime"],
  // EC2 demos: don't fail production build on lint/type noise (macOS junk, hook warnings).
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
