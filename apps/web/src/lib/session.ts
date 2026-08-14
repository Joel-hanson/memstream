/** Signed session cookie for console login (HMAC-SHA256). */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { webRepoRoot } from "@/lib/api";
import { getEnv } from "@/lib/env";

export const SESSION_COOKIE = "memstream_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

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

function sessionSecret(root = webRepoRoot()): string {
  const fromEnv =
    getEnv().MEMSTREAM_SECRETS_KEY ||
    process.env.MEMSTREAM_SECRETS_KEY?.trim() ||
    parseEnvFile(join(root, ".env")).MEMSTREAM_SECRETS_KEY?.trim() ||
    "";
  if (fromEnv) return fromEnv;
  const token =
    getEnv().MEMSTREAM_CONSOLE_TOKEN ||
    process.env.MEMSTREAM_CONSOLE_TOKEN?.trim() ||
    parseEnvFile(join(root, ".env")).MEMSTREAM_CONSOLE_TOKEN?.trim() ||
    "";
  if (token) return token;
  return "memstream-dev-session";
}

function sign(payload: string, root = webRepoRoot()): string {
  return createHmac("sha256", sessionSecret(root)).update(payload).digest("hex");
}

export function createSessionValue(
  username: string,
  root = webRepoRoot(),
): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const body = `${username.trim()}.${exp}`;
  return `${body}.${sign(body, root)}`;
}

export function parseSessionValue(
  raw: string | undefined | null,
  root = webRepoRoot(),
): { username: string } | null {
  const value = raw?.trim() || "";
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [username, expStr, sig] = parts;
  if (!username || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const body = `${username}.${expStr}`;
  const expected = sign(body, root);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { username };
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie") || "";
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function sessionCookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
