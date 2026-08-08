/** Resolve application DATABASE_URL from connection_id or request body (server-side). */

import {
  getActiveConnection,
  getConnection,
  resolveAppDatabaseUrl,
} from "@memstream/engine";
import { isBlockedConnectHost, isUsableDatabaseUrl } from "@/lib/connect-url";
import { webRepoRoot } from "@/lib/api";

export async function resolveRequestDatabaseUrl(options: {
  connectionId?: string | null;
  databaseUrl?: string | null;
  root?: string;
  /** When true, reject localhost / link-local / metadata hosts for caller-supplied URLs. */
  blockPrivateHosts?: boolean;
}): Promise<{ databaseUrl: string; error?: string }> {
  const root = options.root ?? webRepoRoot();
  const connectionId = options.connectionId?.trim() || "";
  if (connectionId) {
    const conn = await getConnection(connectionId, root);
    if (!conn?.database_url) {
      return { databaseUrl: "", error: "connection_id not found" };
    }
    return { databaseUrl: conn.database_url };
  }

  const fromBody = options.databaseUrl?.trim() || "";
  if (fromBody) {
    if (!isUsableDatabaseUrl(fromBody)) {
      return {
        databaseUrl: "",
        error: "Paste a real Cockroach DATABASE_URL (not a placeholder)",
      };
    }
    if (options.blockPrivateHosts !== false && isBlockedConnectHost(fromBody)) {
      return {
        databaseUrl: "",
        error:
          "database_url host is blocked (localhost / private / metadata). Use connection_id or set MEMSTREAM_ALLOW_PRIVATE_DB_URL=1",
      };
    }
    return { databaseUrl: fromBody };
  }

  const active = await getActiveConnection(root);
  if (active?.database_url) return { databaseUrl: active.database_url };

  const fromEnv = await resolveAppDatabaseUrl(null, root);
  if (fromEnv) return { databaseUrl: fromEnv };

  return { databaseUrl: "", error: "database_url or connection_id required" };
}
