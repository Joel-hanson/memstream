import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";

/** Monorepo root (apps/web → ../..) — or MEMSTREAM_ROOT on EC2 prebuilt. */
export function webRepoRoot(): string {
  const envRoot = process.env.MEMSTREAM_ROOT?.trim();
  if (envRoot) return resolve(envRoot);
  return resolve(process.cwd().endsWith("apps/web") ? "../.." : process.cwd());
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
