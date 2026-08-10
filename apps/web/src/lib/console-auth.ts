/** Optional shared console token for sensitive /api routes. */

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonError, webRepoRoot } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let warnedOpen = false;

/** Console token from env or repo .env (empty = auth off for local DX). */
export function consoleToken(root = webRepoRoot()): string {
  return (
    getEnv().MEMSTREAM_CONSOLE_TOKEN ||
    process.env.MEMSTREAM_CONSOLE_TOKEN?.trim() ||
    parseEnvFile(join(root, ".env")).MEMSTREAM_CONSOLE_TOKEN?.trim() ||
    ""
  );
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * When MEMSTREAM_CONSOLE_TOKEN is set, require Authorization: Bearer <token>.
 * Returns a Response to short-circuit, or null when allowed.
 */
export function requireConsoleAuth(req: Request): Response | null {
  const expected = consoleToken();
  if (!expected) {
    if (!warnedOpen) {
      warnedOpen = true;
      console.warn(
        "[memstream] MEMSTREAM_CONSOLE_TOKEN unset — console APIs are open (local DX only)",
      );
    }
    return null;
  }
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const got = match?.[1]?.trim() || "";
  if (!got || !tokensEqual(got, expected)) {
    return jsonError("Unauthorized (set Authorization: Bearer …)", 401);
  }
  return null;
}

/**
 * Auth + rate limit for console APIs.
 * @param heavy Tighter budget for Enable / propose.
 */
export function guardConsoleApi(
  req: Request,
  options: { heavy?: boolean } = {},
): Response | null {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;
  return checkRateLimit(req, Boolean(options.heavy));
}
