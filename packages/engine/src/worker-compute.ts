/** Platform cloud worker target — from MEMSTREAM_WORKER_COMPUTE (.env only). */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type WorkerCompute = "ec2" | "lambda";

function readEnvFileValue(root: string, key: string): string {
  const path = join(root, ".env");
  if (!existsSync(path)) return "";
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const k = line.slice(0, eq).trim();
    if (k !== key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

export function resolveWorkerCompute(
  env: NodeJS.ProcessEnv = process.env,
  root?: string,
  override?: string,
): WorkerCompute {
  const fromOverride = (override || "").trim().toLowerCase();
  if (fromOverride === "lambda" || fromOverride === "ec2") return fromOverride;
  let raw = (env.MEMSTREAM_WORKER_COMPUTE || "").trim().toLowerCase();
  if (!raw && root) {
    raw = readEnvFileValue(root, "MEMSTREAM_WORKER_COMPUTE")
      .trim()
      .toLowerCase();
  }
  return raw === "lambda" ? "lambda" : "ec2";
}

/**
 * True when running inside the EC2 prebuilt artifact (shop + memstream-watch
 * already on this box). CloudFormation redeploy is not available there.
 */
export function isPrebuiltRuntime(
  env: NodeJS.ProcessEnv = process.env,
  from = process.cwd(),
): boolean {
  if ((env.MEMSTREAM_PREBUILT || "").trim() === "1") return true;
  const candidates = [
    env.MEMSTREAM_ROOT?.trim(),
    "/opt/memstream",
    from,
    resolve(from, ".."),
    resolve(from, "../.."),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (existsSync(join(dir, "PREBUILT"))) return true;
  }
  return false;
}

/** CloudFormation stack name for the active compute mode. */
export function cloudWorkerStackName(
  base: string,
  compute: WorkerCompute = resolveWorkerCompute(),
): string {
  const name = (base || "memstream-demo").trim() || "memstream-demo";
  return compute === "lambda" ? `${name}-lambda` : name;
}

export function workerComputeLabel(compute: WorkerCompute): string {
  return compute === "lambda" ? "Lambda" : "EC2";
}
