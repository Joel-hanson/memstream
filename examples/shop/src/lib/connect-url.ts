/** Skip test / placeholder connection strings so Propose doesn't hit fake hosts. */

export function isUsableDatabaseUrl(url: string): boolean {
  const v = url.trim();
  if (!v || v.length < 10) return false;
  const lower = v.toLowerCase();
  if (
    lower.includes("example.invalid") ||
    lower.includes("example.com") ||
    lower.includes("changeme") ||
    lower.includes("your-cluster") ||
    lower.includes("user:password@")
  ) {
    return false;
  }
  try {
    const parsed = new URL(v.replace(/^postgresql:/i, "http:"));
    if (!parsed.hostname) return false;
  } catch {
    return false;
  }
  return true;
}

/** Host + db path for UI (never password). */
export function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^postgresql:/i, "http:"));
    const db = u.pathname.replace(/^\//, "") || "defaultdb";
    const user = u.username ? `${decodeURIComponent(u.username)}@` : "";
    return `${user}${u.hostname}/${db}`;
  } catch {
    return "";
  }
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h === "metadata" ||
    h === "metadata.google.internal" ||
    h.endsWith(".local")
  ) {
    return true;
  }
  if (h === "169.254.169.254" || h.startsWith("169.254.")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;

  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Block SSRF-ish targets for caller-supplied URLs unless
 * MEMSTREAM_ALLOW_PRIVATE_DB_URL=1.
 */
export function isBlockedConnectHost(url: string): boolean {
  if (process.env.MEMSTREAM_ALLOW_PRIVATE_DB_URL?.trim() === "1") return false;
  try {
    const parsed = new URL(url.replace(/^postgresql:/i, "http:"));
    return isPrivateOrLocalHost(parsed.hostname);
  } catch {
    return true;
  }
}
