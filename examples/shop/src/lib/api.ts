import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";

/** Monorepo root (examples/shop → ../..) — or MEMSTREAM_ROOT on EC2 prebuilt. */
export function webRepoRoot(): string {
  const envRoot = process.env.MEMSTREAM_ROOT?.trim();
  if (envRoot) return resolve(envRoot);
  const cwd = process.cwd();
  if (cwd.endsWith("examples/shop") || cwd.endsWith("apps/web")) {
    return resolve(cwd, "../..");
  }
  return resolve(cwd);
}

export async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(detail: string, status = 400): NextResponse {
  return NextResponse.json({ detail }, { status });
}
