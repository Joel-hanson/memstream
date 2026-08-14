/** Auth for Memstream HTTP MCP (`/api/mcp`). Cursor sends Authorization headers. */

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyOperatorPassword } from "@memstream/engine";
import { jsonError, webRepoRoot } from "@/lib/api";
import { getEnv } from "@/lib/env";

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

function envOrFile(key: string, root: string): string {
  const fromGet =
    key === "MEMSTREAM_CONSOLE_TOKEN"
      ? getEnv().MEMSTREAM_CONSOLE_TOKEN
      : undefined;
  if (fromGet?.trim()) return fromGet.trim();
  return (
    process.env[key]?.trim() ||
    parseEnvFile(join(root, ".env"))[key]?.trim() ||
    ""
  );
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Shared secret for MCP Bearer auth (MCP token, else console token). */
export function mcpBearerToken(root = webRepoRoot()): string {
  return (
    envOrFile("MEMSTREAM_MCP_TOKEN", root) ||
    envOrFile("MEMSTREAM_CONSOLE_TOKEN", root)
  );
}

export function mcpDemoCredentials(root = webRepoRoot()): {
  username: string;
  password: string;
} {
  return {
    username: envOrFile("MEMSTREAM_DEMO_USER", root) || "demo",
    password: envOrFile("MEMSTREAM_DEMO_PASSWORD", root) || "demo",
  };
}

function authDisabled(root: string): boolean {
  return envOrFile("MEMSTREAM_AUTH_DISABLED", root) === "1";
}

/** True when MCP should require Authorization (same gates as console login). */
export function mcpAuthRequired(root = webRepoRoot()): boolean {
  if (authDisabled(root)) return false;
  if (mcpBearerToken(root)) return true;
  if (envOrFile("MEMSTREAM_AUTH_REQUIRED", root) === "1") return true;
  if (envOrFile("MEMSTREAM_DEMO_USER", root)) return true;
  if (envOrFile("MEMSTREAM_DATABASE_URL", root)) return true;
  return false;
}

function parseAuthorization(header: string): {
  kind: "bearer" | "basic" | "none";
  value: string;
  username?: string;
  password?: string;
} {
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer?.[1]) {
    return { kind: "bearer", value: bearer[1].trim() };
  }
  const basic = /^Basic\s+(.+)$/i.exec(header);
  if (basic?.[1]) {
    try {
      const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) return { kind: "none", value: "" };
      return {
        kind: "basic",
        value: basic[1].trim(),
        username: decoded.slice(0, colon),
        password: decoded.slice(colon + 1),
      };
    } catch {
      return { kind: "none", value: "" };
    }
  }
  return { kind: "none", value: "" };
}

/**
 * Gate `/api/mcp`. Cursor cannot use session cookies reliably, so accept:
 * - Bearer MEMSTREAM_MCP_TOKEN (or MEMSTREAM_CONSOLE_TOKEN)
 * - Basic demo/demo (same memstream_operators as /login)
 */
export async function requireMcpAuth(req: Request): Promise<Response | null> {
  const root = webRepoRoot();
  if (!mcpAuthRequired(root)) return null;

  const parsed = parseAuthorization(req.headers.get("authorization") || "");
  const expectedToken = mcpBearerToken(root);

  if (parsed.kind === "bearer" && expectedToken) {
    if (tokensEqual(parsed.value, expectedToken)) return null;
    return jsonError("Unauthorized (invalid MCP Bearer token)", 401);
  }

  if (parsed.kind === "basic" && parsed.username && parsed.password != null) {
    const ok = await verifyOperatorPassword(
      parsed.username,
      parsed.password,
      root,
    );
    if (ok) return null;
    const demo = mcpDemoCredentials(root);
    if (
      parsed.username === demo.username &&
      tokensEqual(parsed.password, demo.password)
    ) {
      return null;
    }
    return jsonError(
      "Unauthorized (use Basic demo/demo or Bearer MEMSTREAM_MCP_TOKEN)",
      401,
    );
  }

  if (expectedToken) {
    return jsonError(
      "Unauthorized (Authorization: Bearer <MEMSTREAM_MCP_TOKEN>)",
      401,
    );
  }

  return jsonError(
    "Unauthorized (Authorization: Basic base64(demo:demo) — same as console login)",
    401,
  );
}

/** Authorization header value to paste into Cursor MCP config. */
export function mcpCursorAuthHeader(root = webRepoRoot()): string | null {
  if (!mcpAuthRequired(root)) return null;
  const token = mcpBearerToken(root);
  if (token) return `Bearer ${token}`;
  const { username, password } = mcpDemoCredentials(root);
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
