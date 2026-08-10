/** Validated process env for the control plane (optional fields = local DX). */

import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalNonEmpty = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: optionalNonEmpty,
  MEMSTREAM_DATABASE_URL: optionalNonEmpty,
  CDC_S3_BUCKET: z.preprocess(
    emptyToUndefined,
    z.string().min(3).optional(),
  ),
  CDC_S3_PREFIX: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  AWS_REGION: z.preprocess(
    emptyToUndefined,
    z.string().default("us-east-1"),
  ),
  MEMSTREAM_CONSOLE_TOKEN: optionalNonEmpty,
  MEMSTREAM_SECRETS_KEY: optionalNonEmpty,
  MEMSTREAM_WORKER_COMPUTE: z.preprocess(
    emptyToUndefined,
    z.enum(["ec2", "lambda"]).optional(),
  ),
  STACK_NAME: optionalNonEmpty,
  BEDROCK_EMBED_MODEL: optionalNonEmpty,
});

export type MemstreamEnv = z.infer<typeof envSchema>;

let cached: MemstreamEnv | null = null;

/** Parse and cache env — warns on invalid shapes; never throws at import time. */
export function getEnv(
  source: NodeJS.ProcessEnv = process.env,
): MemstreamEnv {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.warn(
      "[memstream] env validation issues:",
      parsed.error.flatten().fieldErrors,
    );
    const fallback = envSchema.parse({
      NODE_ENV: source.NODE_ENV || "development",
      AWS_REGION: source.AWS_REGION || "us-east-1",
    });
    if (source === process.env) cached = fallback;
    return fallback;
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Reset cache (tests). */
export function resetEnvCache(): void {
  cached = null;
}
