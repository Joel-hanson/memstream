/**
 * Typed console API client.
 * Uses consoleFetch (optional Bearer) and returns Result — no thrown network errors.
 */

import { consoleFetch } from "@/lib/console-fetch";
import { ApiError, err, ok, type Result } from "@/lib/result";
import type {
  ConnectConfig,
  JobStatus,
  MemstreamRun,
  PipelineStatus,
  ProfileDraft,
  ProfileInfo,
} from "@/lib/types";

export type DefaultsResponse = {
  has_url?: boolean;
  database_url_hint?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  connection_id?: string | null;
  platform_configured?: boolean;
  worker_compute?: "ec2" | "lambda";
  source?: string;
  demo_available?: boolean;
  is_demo?: boolean;
};

export type RunsListResponse = {
  configured?: boolean;
  runs?: MemstreamRun[];
  detail?: string;
};

export type PublicConnection = {
  id: string;
  workspace_id?: string;
  name?: string;
  has_url?: boolean;
  database_url_hint?: string;
  database_label?: string | null;
  bucket?: string | null;
  region?: string | null;
  prefix?: string | null;
  org_id?: string | null;
  is_active?: boolean;
  updated_at?: string | null;
};

export type UpsertConnectionBody = ConnectConfig & {
  id?: string;
  name?: string;
  org_id?: string;
};

export type OrgInfo = {
  id: string;
  name: string;
  created_at?: string | null;
};

export type OrgInviteInfo = {
  code: string;
  org_id: string;
  label?: string | null;
  expires_at?: string | null;
  redeemed_at?: string | null;
  created_at?: string | null;
};

export type OrgResponse = {
  configured?: boolean;
  org?: OrgInfo | null;
  orgs?: OrgInfo[];
  invite?: OrgInviteInfo;
  detail?: string;
};

export type UpsertConnectionResponse = {
  connection?: PublicConnection;
  detail?: string;
};

export type ConnectionsListResponse = {
  configured?: boolean;
  connections?: PublicConnection[];
  detail?: string;
};

export type ProposeBody = {
  connection_id?: string;
  database_url?: string;
  application?: string;
  tables?: string[];
};

export type ProposeResponse = {
  profile?: ProfileDraft;
  detail?: string;
};

export type SaveProfileBody = {
  id: string;
  profile: ProfileDraft;
};

export type SaveProfileResponse = {
  path?: string;
  tables?: string;
  detail?: string;
};

export type ProfileVersionInfo = {
  profile_id: string;
  version: number;
  application: string;
  source: string;
  created_at: string;
};

export type ProfileVersionsResponse = {
  versions?: ProfileVersionInfo[];
  detail?: string;
};

export type RestoreProfileBody = {
  id: string;
  version: number;
};

export type EnableBody = {
  connection_id?: string;
  database_url?: string;
  bucket: string;
  region?: string;
  prefix?: string;
  profile_path: string;
  tables: string;
  deploy?: boolean;
  worker_compute?: "ec2" | "lambda";
  stack_name?: string;
};

export type EnableResponse = {
  job_id: string;
  detail?: string;
};

export type PipelineBody = {
  connection_id?: string;
  database_url?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  profile_path?: string;
  tables?: string;
  stack_name?: string;
};

export type McpConfigResponse = {
  json?: string;
  ready?: boolean;
  detail?: string;
};

export type PatchRunBody = {
  status: "failed";
  error?: string;
};

function detailFromBody(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail?: unknown }).detail;
    if (typeof d === "string" && d.trim()) return d;
  }
  return fallback;
}

async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<Result<T>> {
  try {
    const res = await consoleFetch(path, init);
    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      return err(
        new ApiError(
          detailFromBody(data, res.statusText || "Request failed"),
          res.status,
          res.status === 404 ? "NOT_FOUND" : "API_ERROR",
        ),
      );
    }
    return ok(data as T);
  } catch (e) {
    return err(
      new ApiError(
        e instanceof Error ? e.message : "Network error",
        0,
        "NETWORK",
      ),
    );
  }
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

/** Typed Memstream console API. */
export const consoleApi = {
  defaults: {
    get: () => apiRequest<DefaultsResponse>("/api/defaults"),
  },

  profiles: {
    list: () =>
      apiRequest<{ profiles?: ProfileInfo[]; detail?: string }>(
        "/api/profiles",
      ),
    tables: (path: string) =>
      apiRequest<{ tables?: string }>(
        `/api/profiles/tables?path=${encodeURIComponent(path)}`,
      ),
    load: (path: string) =>
      apiRequest<{ profile?: ProfileDraft; detail?: string }>(
        `/api/profiles/load?path=${encodeURIComponent(path)}`,
      ),
    save: (body: SaveProfileBody) =>
      apiRequest<SaveProfileResponse>(
        "/api/profiles/save",
        jsonInit("POST", body),
      ),
    versions: (id: string) =>
      apiRequest<ProfileVersionsResponse>(
        `/api/profiles/versions?id=${encodeURIComponent(id)}`,
      ),
    restore: (body: RestoreProfileBody) =>
      apiRequest<SaveProfileResponse>(
        "/api/profiles/versions",
        jsonInit("POST", body),
      ),
  },

  runs: {
    list: () => apiRequest<RunsListResponse>("/api/runs"),
    patch: (id: string, body: PatchRunBody) =>
      apiRequest<{ run?: MemstreamRun; detail?: string }>(
        `/api/runs/${id}`,
        jsonInit("PATCH", body),
      ),
    delete: (id: string) =>
      apiRequest<{ ok?: boolean; detail?: string }>(
        `/api/runs/${id}`,
        jsonInit("DELETE"),
      ),
  },

  jobs: {
    get: (id: string) => apiRequest<JobStatus>(`/api/jobs/${id}`),
  },

  connection: {
    list: () => apiRequest<ConnectionsListResponse>("/api/connection"),
    activate: (id: string, orgId?: string) =>
      apiRequest<UpsertConnectionResponse>(
        "/api/connection",
        jsonInit("POST", { id, org_id: orgId }),
      ),
    put: (body: UpsertConnectionBody) =>
      apiRequest<UpsertConnectionResponse>(
        "/api/connection",
        jsonInit("PUT", body),
      ),
    useDemo: () =>
      apiRequest<UpsertConnectionResponse>(
        "/api/connection/demo",
        jsonInit("POST"),
      ),
  },

  cockroachCloud: {
    listClusters: (apiKey: string) =>
      apiRequest<{ clusters?: Array<{ id: string; name: string; state?: string }> }>(
        "/api/cockroach-cloud",
        jsonInit("POST", { action: "list_clusters", api_key: apiKey }),
      ),
    listSqlUsers: (apiKey: string, clusterId: string) =>
      apiRequest<{ users?: Array<{ name: string }> }>(
        "/api/cockroach-cloud",
        jsonInit("POST", {
          action: "list_sql_users",
          api_key: apiKey,
          cluster_id: clusterId,
        }),
      ),
    listDatabases: (apiKey: string, clusterId: string) =>
      apiRequest<{ databases?: string[] }>("/api/cockroach-cloud", jsonInit("POST", {
        action: "list_databases",
        api_key: apiKey,
        cluster_id: clusterId,
      })),
    preview: (body: {
      api_key: string;
      cluster_id: string;
      database?: string;
      sql_user: string;
      password: string;
    }) =>
      apiRequest<{
        database?: string;
        databases?: string[];
        tables?: string[];
        table_count?: number;
      }>("/api/cockroach-cloud", jsonInit("POST", { action: "preview", ...body })),
    save: (body: {
      api_key: string;
      cluster_id: string;
      database?: string;
      sql_user: string;
      password: string;
      bucket?: string;
      region?: string;
      prefix?: string;
      id?: string;
      name?: string;
      org_id?: string;
    }) =>
      apiRequest<UpsertConnectionResponse>(
        "/api/cockroach-cloud",
        jsonInit("POST", { action: "save", ...body }),
      ),
  },

  org: {
    get: () => apiRequest<OrgResponse>("/api/org"),
    create: (name: string) =>
      apiRequest<OrgResponse>(
        "/api/org",
        jsonInit("POST", { action: "create", name }),
      ),
    invite: (orgId: string, label?: string) =>
      apiRequest<OrgResponse>(
        "/api/org",
        jsonInit("POST", { action: "invite", org_id: orgId, label }),
      ),
    join: (code: string) =>
      apiRequest<OrgResponse & { org?: OrgInfo }>(
        "/api/org",
        jsonInit("POST", { action: "join", code }),
      ),
  },

  propose: (body: ProposeBody) =>
    apiRequest<ProposeResponse>("/api/propose", jsonInit("POST", body)),

  enable: (body: EnableBody) =>
    apiRequest<EnableResponse>("/api/enable", jsonInit("POST", body)),

  pipeline: (body: PipelineBody) =>
    apiRequest<PipelineStatus>("/api/pipeline", jsonInit("POST", body)),

  mcpConfig: () => apiRequest<McpConfigResponse>("/api/mcp-config"),
};
