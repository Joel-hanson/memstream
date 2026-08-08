/** Encrypt secrets for Memstream platform DB (AES-256-GCM). */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./runs.js";

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

function keyFromMaterial(material: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, "hex");
  }
  return scryptSync(material, "memstream-secrets-v1", 32);
}

/**
 * 32-byte key from MEMSTREAM_SECRETS_KEY (required for new encrypts).
 * openssl rand -hex 32
 */
export function memstreamSecretsKey(root = findRepoRoot()): Buffer {
  const explicit = envOrFile("MEMSTREAM_SECRETS_KEY", root);
  if (!explicit) {
    throw new Error(
      "MEMSTREAM_SECRETS_KEY required to encrypt connection secrets (openssl rand -hex 32)",
    );
  }
  return keyFromMaterial(explicit);
}

/** Legacy fallback: key derived from platform URL (pre-secrets-key installs). */
function legacySecretsKey(root: string): Buffer | null {
  const platformUrl = envOrFile("MEMSTREAM_DATABASE_URL", root);
  if (!platformUrl) return null;
  return scryptSync(platformUrl, "memstream-secrets-v1", 32);
}

function decryptWithKey(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** Pack: iv(12) || tag(16) || ciphertext */
export function encryptSecret(plaintext: string, root = findRepoRoot()): Buffer {
  const key = memstreamSecretsKey(root);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSecret(blob: Buffer, root = findRepoRoot()): string {
  if (blob.length < 28) {
    throw new Error("Invalid ciphertext (too short)");
  }
  try {
    return decryptWithKey(blob, memstreamSecretsKey(root));
  } catch (primary) {
    const legacy = legacySecretsKey(root);
    if (!legacy) throw primary;
    try {
      return decryptWithKey(blob, legacy);
    } catch {
      throw primary;
    }
  }
}
