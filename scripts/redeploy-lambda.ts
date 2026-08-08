/** One-shot: redeploy Lambda worker with bundled Cockroach CA cert. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cloudWorkerStackName,
  deployLambdaStack,
  getActiveConnection,
  memstreamDatabaseUrl,
} from "../packages/engine/src/index.js";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const root = process.cwd();
  loadEnv(join(root, ".env"));
  const conn = await getActiveConnection(root);
  if (!conn?.database_url) {
    throw new Error("no active memstream connection — Connect in the console first");
  }
  const bucket = conn.bucket || process.env.CDC_S3_BUCKET || "";
  if (!bucket) throw new Error("CDC_S3_BUCKET missing");
  const region = conn.region || process.env.AWS_REGION || "us-east-1";
  const prefix = conn.prefix || process.env.CDC_S3_PREFIX || "cdc/";
  const stackName = cloudWorkerStackName(
    process.env.STACK_NAME || "memstream-demo",
    "lambda",
  );
  const profilePath = process.env.MEMORY_PROFILE || "profiles/commerce.yaml";
  console.log(`Redeploying ${stackName} → s3://${bucket}/${prefix}`);
  const result = await deployLambdaStack({
    root,
    databaseUrl: conn.database_url,
    memstreamDatabaseUrl: memstreamDatabaseUrl(root) || undefined,
    connectionId: conn.id,
    bucket,
    prefix,
    region,
    stackName,
    profilePath,
    embedModel:
      process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0",
  });
  console.log("OK", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
