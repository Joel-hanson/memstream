export type ConnectConfig = {
  database_url: string;
  bucket: string;
  region: string;
  prefix: string;
};

export type ProfileInfo = {
  id: string;
  path: string;
  application: string;
};

export type ProfileRule = {
  name: string;
  table: string;
  when?: { columns_changed?: string[] };
  chunk_template?: string;
  tags?: string[];
  enabled?: boolean;
};

export type ProfileDraft = {
  application: string;
  source_database?: string;
  changefeed: { tables: string[]; sink: string };
  rules: ProfileRule[];
  embedding: {
    model: string;
    table: string;
    dimensions: number;
  };
  discovery?: Record<string, unknown>;
  insights?: Record<string, unknown>;
};

export type PipelineNode = {
  id?: string;
  label: string;
  count?: number;
  detail?: string;
  /** Short status shown next to the label (Ready / Waiting / Failed / …) */
  statusLabel?: string;
  /** Full technical detail for title/tooltip (e.g. s3://…) */
  hint?: string;
  state?: string;
  href?: string;
};

export type PipelineHealthStatus = "ok" | "degraded" | "down" | "unknown";
export type PipelineCheckStatus =
  | "ok"
  | "warn"
  | "error"
  | "idle"
  | "unknown";

export type PipelineHealth = {
  status: PipelineHealthStatus;
  connection: {
    status: PipelineCheckStatus;
    detail: string;
  };
  changefeed: {
    status: PipelineCheckStatus;
    jobs: number;
    running: number;
    detail: string;
  };
  memory: {
    status: PipelineCheckStatus;
    lag_seconds: number | null;
    latest_chunk_at: string | null;
    latest_cdc_at: string | null;
    processed_keys: number | null;
    last_processed_at: string | null;
    detail: string;
  };
};

export type PipelineStatus = {
  sources: PipelineNode[];
  bindings: PipelineNode[];
  core: {
    label?: string;
    subtitle?: string;
    state?: string;
    observability?: { name: string; status: string }[];
  };
  metrics: {
    chunks?: number | null;
    changefeed_jobs?: number | null;
    s3_objects?: number | null;
    latest_at?: string | null;
    by_rule?: { rule: string; count: number }[];
    lag_seconds?: number | null;
    latest_cdc_at?: string | null;
    processed_keys?: number | null;
    last_processed_at?: string | null;
  };
  health?: PipelineHealth;
  recent: {
    created_at: string;
    rule_name: string;
    table_name: string;
    body: string;
  }[];
  db_error?: string;
  db_ok?: boolean;
};

export type JobStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type JobStep = {
  id: string;
  label: string;
  detail: string;
  status: JobStepStatus;
};

export type JobStatus = {
  id: string;
  kind: string;
  status: string;
  log: string[];
  steps?: JobStep[];
  result?: { shop_url?: string; run_id?: string } | null;
  error?: string | null;
  /** False when recovered from a persisted run (in-memory job gone). */
  live?: boolean;
};

export type MemstreamRun = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  profile_path: string;
  tables: string;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  stack_name: string | null;
  shop_url: string | null;
  job_id: string | null;
  app_database_label: string | null;
  /** Workspace id (= connection id). */
  connection_id?: string | null;
  workspace_id?: string | null;
  log: string[];
  steps?: JobStep[];
  error: string | null;
  created_at: string | null;
  finished_at: string | null;
};

export const defaultConnect: ConnectConfig = {
  database_url: "",
  bucket: "",
  region: "us-east-1",
  prefix: "cdc/",
};
