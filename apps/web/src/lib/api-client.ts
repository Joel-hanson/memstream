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
};

export type RunsListResponse = {
  configured?: boolean;
  runs?: MemstreamRun[];
  detail?: string;
};

export type PublicConnection = {
  id: string;
  name?: string;
  has_url?: boolean;
  database_url_hint?: string;
  database_label?: string | null;
  bucket?: string | null;
  region?: string | null;
  prefix?: string | null;
  is_active?: boolean;
  updated_at?: string | null;
};

export type UpsertConnectionBody = ConnectConfig & {
  id?: string;
  name?: string;
};

export type UpsertConnectionResponse = {
  connection?: PublicConnection;
  detail?: string;
};

export type ProposeBody = {
  connection_id?: string;
  database_url?: string;
  application?: string;
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
    put: (body: UpsertConnectionBody) =>
      apiRequest<UpsertConnectionResponse>(
        "/api/connection",
        jsonInit("PUT", body),
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

export { ApiError, type Result } from "@/lib/result";
