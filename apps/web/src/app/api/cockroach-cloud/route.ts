import {
  buildCloudDatabaseUrl,
  fetchPublicTables,
  listCloudClusters,
  listCloudDatabases,
  listCloudSqlUsers,
  memstreamDatabaseUrl,
  upsertConnection,
  withClientObjects,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { maskDatabaseUrl } from "@/lib/connect-url";

export const runtime = "nodejs";

type Body = {
  action?: string;
  api_key?: string;
  cluster_id?: string;
  database?: string;
  sql_user?: string;
  password?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  name?: string;
  id?: string;
  org_id?: string;
};

function publicConnection(connection: {
  id: string;
  name: string;
  database_url: string;
  database_label: string | null;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  org_id?: string | null;
  is_active: boolean;
  updated_at: string | null;
}) {
  return {
    id: connection.id,
    workspace_id: connection.id,
    name: connection.name,
    has_url: Boolean(connection.database_url),
    database_url_hint: connection.database_url
      ? maskDatabaseUrl(connection.database_url)
      : "",
    database_label: connection.database_label,
    bucket: connection.bucket,
    region: connection.region,
    prefix: connection.prefix,
    org_id: connection.org_id,
    is_active: connection.is_active,
    updated_at: connection.updated_at,
  };
}

export async function POST(req: Request) {
  const denied = guardConsoleApi(req, { heavy: true });
  if (denied) return denied;

  const body = ((await readJsonBody(req as never)) || {}) as Body;
  const action = body.action?.trim() || "";
  const apiKey = body.api_key?.trim() || "";

  try {
    if (action === "list_clusters") {
      if (!apiKey) return jsonError("api_key required");
      const clusters = await listCloudClusters(apiKey);
      return jsonOk({ clusters });
    }

    if (action === "list_sql_users") {
      if (!apiKey) return jsonError("api_key required");
      const clusterId = body.cluster_id?.trim() || "";
      if (!clusterId) return jsonError("cluster_id required");
      const users = await listCloudSqlUsers(apiKey, clusterId);
      return jsonOk({ users });
    }

    if (action === "list_databases") {
      if (!apiKey) return jsonError("api_key required");
      const clusterId = body.cluster_id?.trim() || "";
      if (!clusterId) return jsonError("cluster_id required");
      const databases = await listCloudDatabases(apiKey, clusterId);
      return jsonOk({ databases });
    }

    if (action === "preview" || action === "save") {
      if (!apiKey) return jsonError("api_key required");
      const clusterId = body.cluster_id?.trim() || "";
      const database = body.database?.trim() || "defaultdb";
      const sqlUser = body.sql_user?.trim() || "";
      const password = body.password || "";
      if (!clusterId) return jsonError("cluster_id required");
      if (!sqlUser) return jsonError("sql_user required");
      if (!password) return jsonError("password required");

      const databaseUrl = await buildCloudDatabaseUrl({
        apiKey,
        clusterId,
        database,
        sqlUser,
        password,
      });

      if (action === "preview") {
        const databases = await withClientObjects(databaseUrl, async (client) => {
          const result = await client.query(
            `SELECT datname FROM pg_database
             WHERE datistemplate = false
             ORDER BY datname`,
          );
          return result.rows.map((r) => String(r.datname));
        }).catch(() => [] as string[]);

        let tables: string[] = [];
        try {
          const map = await fetchPublicTables(databaseUrl);
          tables = Object.keys(map).sort();
        } catch {
          tables = [];
        }

        return jsonOk({
          database,
          databases,
          tables,
          table_count: tables.length,
        });
      }

      const root = webRepoRoot();
      if (!memstreamDatabaseUrl(root)) {
        return jsonError(
          "MEMSTREAM_DATABASE_URL required to store the application connection",
          503,
        );
      }
      const orgId =
        body.org_id?.trim() ||
        req.headers.get("x-memstream-org")?.trim() ||
        undefined;
      const connection = await upsertConnection({
        databaseUrl,
        bucket: body.bucket,
        region: body.region,
        prefix: body.prefix,
        name: body.name,
        id: body.id,
        orgId: orgId || null,
        root,
      });
      return jsonOk({ connection: publicConnection(connection) });
    }

    return jsonError(
      "Unknown action (list_clusters | list_sql_users | list_databases | preview | save)",
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
