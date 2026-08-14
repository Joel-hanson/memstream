/** CockroachDB Cloud API helpers (service account API key). */

const CLOUD_API = "https://cockroachlabs.cloud/api/v1";

/** Pin Cloud API version (recommended by Cockroach). */
const CC_VERSION = "2024-09-16";

export type CloudCluster = {
  id: string;
  name: string;
  state?: string;
  regions?: string[];
};

export type CloudSqlUser = {
  name: string;
};

async function cloudFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const key = apiKey.trim();
  if (!key) throw new Error("Cockroach Cloud API key required");
  const res = await fetch(`${CLOUD_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
      "Cc-Version": CC_VERSION,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      typeof body === "object" &&
      body &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : typeof body === "string" && body
          ? body
          : `Cloud API ${res.status}`;
    throw new Error(detail);
  }
  return body as T;
}

export async function listCloudClusters(
  apiKey: string,
): Promise<CloudCluster[]> {
  const params = new URLSearchParams({
    "pagination.limit": "100",
    "pagination.sort_order": "ASC",
  });
  const data = await cloudFetch<{
    clusters?: Array<{
      id?: string;
      name?: string;
      state?: string;
      regions?: Array<{ name?: string } | string>;
    }>;
  }>(apiKey, `/clusters?${params}`);
  return (data.clusters || [])
    .filter((c) => c.id && c.name)
    .map((c) => ({
      id: String(c.id),
      name: String(c.name),
      state: c.state ? String(c.state) : undefined,
      regions: (c.regions || [])
        .map((r) => (typeof r === "string" ? r : r?.name || ""))
        .filter(Boolean),
    }));
}

export async function listCloudSqlUsers(
  apiKey: string,
  clusterId: string,
): Promise<CloudSqlUser[]> {
  const id = encodeURIComponent(clusterId.trim());
  const data = await cloudFetch<{
    users?: Array<{ name?: string }>;
  }>(apiKey, `/clusters/${id}/sql-users`);
  return (data.users || [])
    .filter((u) => u.name)
    .map((u) => ({ name: String(u.name) }));
}

export async function listCloudDatabases(
  apiKey: string,
  clusterId: string,
): Promise<string[]> {
  const id = encodeURIComponent(clusterId.trim());
  const params = new URLSearchParams({
    "pagination.limit": "100",
    "pagination.sort_order": "ASC",
  });
  const data = await cloudFetch<{
    databases?: Array<{ name?: string }>;
  }>(apiKey, `/clusters/${id}/databases?${params}`);
  return (data.databases || [])
    .map((d) => (d.name ? String(d.name) : ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function getCloudConnectionString(
  apiKey: string,
  options: {
    clusterId: string;
    database?: string;
    sqlUser?: string;
  },
): Promise<string> {
  const id = encodeURIComponent(options.clusterId.trim());
  const params = new URLSearchParams();
  if (options.database?.trim()) params.set("database", options.database.trim());
  if (options.sqlUser?.trim()) params.set("sql_user", options.sqlUser.trim());
  const q = params.toString();
  const data = await cloudFetch<{
    connection_string?: string;
  }>(
    apiKey,
    `/clusters/${id}/connection-string${q ? `?${q}` : ""}`,
  );
  const url = data.connection_string?.trim() || "";
  if (!url) throw new Error("Cloud API returned an empty connection string");
  return url;
}

/** Insert or replace the password in a postgresql:// URL. */
export function injectSqlPassword(
  connectionString: string,
  password: string,
): string {
  const trimmed = connectionString.trim();
  if (!trimmed) throw new Error("connection string required");
  if (!password) throw new Error("SQL password required");
  try {
    const u = new URL(trimmed.replace(/^postgresql:/i, "http:"));
    u.password = password;
    return u.toString().replace(/^http:/i, "postgresql:");
  } catch {
    throw new Error("Invalid connection string from Cloud API");
  }
}

export async function buildCloudDatabaseUrl(options: {
  apiKey: string;
  clusterId: string;
  database: string;
  sqlUser: string;
  password: string;
}): Promise<string> {
  const base = await getCloudConnectionString(options.apiKey, {
    clusterId: options.clusterId,
    database: options.database,
    sqlUser: options.sqlUser,
  });
  let url = injectSqlPassword(base, options.password);
  // Ensure database path matches selection (API may default to defaultdb).
  try {
    const u = new URL(url.replace(/^postgresql:/i, "http:"));
    if (options.database.trim()) {
      u.pathname = `/${options.database.trim()}`;
    }
    if (options.sqlUser.trim()) {
      u.username = options.sqlUser.trim();
    }
    url = u.toString().replace(/^http:/i, "postgresql:");
  } catch {
    /* keep inject result */
  }
  return url;
}
