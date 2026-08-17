import {
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { withClientObjects, memstreamDatabaseUrl } from "@memstream/engine";
import { webRepoRoot } from "@/lib/api";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

type CheckStatus = "healthy" | "unhealthy" | "skipped" | "degraded";

type HealthCheck = {
  name: string;
  status: CheckStatus;
  latency_ms?: number;
  error?: string;
};

function publicCheckError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV === "production") {
    console.error("[health]", detail);
    return "unreachable";
  }
  return detail;
}

async function checkDatabase(root: string): Promise<HealthCheck> {
  const start = Date.now();
  const url = memstreamDatabaseUrl(root);
  if (!url) {
    return {
      name: "platform_db",
      status: "unhealthy",
      error: "MEMSTREAM_DATABASE_URL not set",
    };
  }
  try {
    await withClientObjects(url, async (client) => {
      await client.query("SELECT 1");
    });
    return {
      name: "platform_db",
      status: "healthy",
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "platform_db",
      status: "unhealthy",
      latency_ms: Date.now() - start,
      error: publicCheckError(err),
    };
  }
}

async function checkS3(): Promise<HealthCheck> {
  const env = getEnv();
  const bucket = env.CDC_S3_BUCKET;
  if (!bucket) {
    return { name: "s3", status: "skipped", error: "CDC_S3_BUCKET not set" };
  }
  const start = Date.now();
  const region = env.AWS_REGION || "us-east-1";
  try {
    const client = new S3Client({ region });
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return {
      name: "s3",
      status: "healthy",
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "s3",
      status: "degraded",
      latency_ms: Date.now() - start,
      error: publicCheckError(err),
    };
  }
}

export async function GET() {
  const root = webRepoRoot();
  const checks = await Promise.all([checkDatabase(root), checkS3()]);
  checks.push({
    name: "bedrock",
    status: "skipped",
    error: "not probed (avoid invoke cost)",
  });

  const dbUnhealthy = checks.some(
    (c) => c.name === "platform_db" && c.status === "unhealthy",
  );
  const anyDegraded = checks.some((c) => c.status === "degraded");
  const status = dbUnhealthy
    ? "unhealthy"
    : anyDegraded
      ? "degraded"
      : "healthy";

  return Response.json(
    {
      status,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: dbUnhealthy ? 503 : 200 },
  );
}
