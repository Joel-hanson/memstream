/** Console operators — demo login with scrypt password hashes in platform DB. */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withClientObjects } from "./db.js";
import {
  ensureMemstreamSchema,
  findRepoRoot,
  memstreamDatabaseUrl,
} from "./runs.js";

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
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  return parseEnvFile(join(root, ".env"))[key]?.trim() || "";
}

/** Format: scrypt$<saltHex>$<hashHex> */
export function hashPassword(password: string, salt?: Buffer): string {
  const s = salt && salt.length >= 16 ? salt : randomBytes(16);
  const hash = scryptSync(password, s, 32);
  return `scrypt$${s.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length < 16 || expected.length !== 32) return false;
  const got = scryptSync(password, salt, 32);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

export type MemstreamOperator = {
  username: string;
  created_at: string | null;
  updated_at: string | null;
};

/** Upsert demo operator. Defaults to demo/demo when platform DB is set. */
export async function ensureDemoOperator(
  root = findRepoRoot(),
): Promise<MemstreamOperator | null> {
  if (envOrFile("MEMSTREAM_AUTH_DISABLED", root) === "1") return null;
  const username = envOrFile("MEMSTREAM_DEMO_USER", root) || "demo";
  const password = envOrFile("MEMSTREAM_DEMO_PASSWORD", root) || "demo";
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  // Only insert when missing — don't rotate hash on every request from env defaults.
  return withClientObjects(url, async (client) => {
    const existing = await client.query(
      `SELECT username, password_hash, created_at::text, updated_at::text
       FROM memstream_operators WHERE username = $1`,
      [username],
    );
    let operator: MemstreamOperator;
    if (existing.rows.length) {
      const row = existing.rows[0]!;
      // Refresh hash when explicit env password is set (operator may have changed it).
      if (envOrFile("MEMSTREAM_DEMO_PASSWORD", root)) {
        const passwordHash = hashPassword(password);
        const updated = await client.query(
          `
          UPDATE memstream_operators
          SET password_hash = $2, updated_at = now()
          WHERE username = $1
          RETURNING username, created_at::text, updated_at::text
          `,
          [username, passwordHash],
        );
        const u = updated.rows[0]!;
        operator = {
          username: String(u.username),
          created_at: u.created_at != null ? String(u.created_at) : null,
          updated_at: u.updated_at != null ? String(u.updated_at) : null,
        };
      } else {
        operator = {
          username: String(row.username),
          created_at: row.created_at != null ? String(row.created_at) : null,
          updated_at: row.updated_at != null ? String(row.updated_at) : null,
        };
      }
    } else {
      const passwordHash = hashPassword(password);
      const result = await client.query(
        `
        INSERT INTO memstream_operators (username, password_hash, created_at, updated_at)
        VALUES ($1, $2, now(), now())
        RETURNING username, created_at::text, updated_at::text
        `,
        [username, passwordHash],
      );
      const row = result.rows[0]!;
      operator = {
        username: String(row.username),
        created_at: row.created_at != null ? String(row.created_at) : null,
        updated_at: row.updated_at != null ? String(row.updated_at) : null,
      };
    }
    if (username !== "demo") {
      await client.query(
        `DELETE FROM memstream_operators WHERE username = 'demo'`,
      );
    }
    return operator;
  });
}

export async function countOperators(
  root = findRepoRoot(),
): Promise<number> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return 0;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `SELECT count(*)::int AS n FROM memstream_operators`,
    );
    return Number(result.rows[0]?.n ?? 0);
  });
}

/**
 * True when the console should gate on /login.
 * On whenever platform DB is configured, unless MEMSTREAM_AUTH_DISABLED=1.
 */
export async function authLoginRequired(
  root = findRepoRoot(),
): Promise<boolean> {
  if (envOrFile("MEMSTREAM_AUTH_DISABLED", root) === "1") return false;
  if (envOrFile("MEMSTREAM_DEMO_USER", root)) return true;
  if (envOrFile("MEMSTREAM_AUTH_REQUIRED", root) === "1") return true;
  if (!memstreamDatabaseUrl(root)) return false;
  try {
    await ensureDemoOperator(root);
    return (await countOperators(root)) > 0;
  } catch {
    return false;
  }
}

export async function verifyOperatorPassword(
  username: string,
  password: string,
  root = findRepoRoot(),
): Promise<boolean> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return false;
  await ensureMemstreamSchema(root);
  const user = username.trim();
  if (!user || !password) return false;
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `SELECT password_hash FROM memstream_operators WHERE username = $1`,
      [user],
    );
    if (!result.rows.length) return false;
    return verifyPassword(password, String(result.rows[0]!.password_hash));
  });
}
