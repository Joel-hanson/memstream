/** YAML memory profile loading. */

import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export interface WhenClause {
  columnsChanged: string[];
}

export interface Rule {
  name: string;
  table: string;
  when: WhenClause;
  chunkTemplate: string;
  tags: string[];
}

export interface ChangefeedConfig {
  tables: string[];
  sink: string;
}

export interface EmbeddingConfig {
  model: string;
  table: string;
  dimensions: number;
}

export interface DiscoveryConfig {
  enabled: boolean;
  mode: string;
}

export interface InsightsConfig {
  enabled: boolean;
  schedule: string;
}

export interface Profile {
  application: string;
  sourceDatabase: string;
  changefeed: ChangefeedConfig;
  rules: Rule[];
  embedding: EmbeddingConfig;
  discovery: DiscoveryConfig;
  insights: InsightsConfig;
}

/** Parse profile YAML text into a Profile (shared by file + DB loaders). */
export function parseProfileYaml(text: string): Profile {
  const raw = parseYaml(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProfileError("profile must be a YAML mapping");
  }

  const doc = raw as Record<string, unknown>;
  const rulesRaw = (doc.rules as unknown[]) || [];
  if (!rulesRaw.length) {
    throw new ProfileError("profile must include at least one rules entry");
  }

  const rules = rulesRaw.map(parseRule);
  const cf = (doc.changefeed as Record<string, unknown>) || {};
  const emb = (doc.embedding as Record<string, unknown>) || {};
  const disc = (doc.discovery as Record<string, unknown>) || {};
  const insights = (doc.insights as Record<string, unknown>) || {};

  return {
    application: String(doc.application ?? ""),
    sourceDatabase: String(doc.source_database ?? "defaultdb"),
    changefeed: {
      tables: Array.isArray(cf.tables) ? cf.tables.map(String) : [],
      sink: String(cf.sink ?? "s3"),
    },
    rules,
    embedding: {
      model: String(emb.model ?? ""),
      table: String(emb.table ?? "agent_memory_chunks"),
      dimensions: Number(emb.dimensions ?? 1024),
    },
    discovery: {
      enabled: Boolean(disc.enabled ?? false),
      mode: String(disc.mode ?? "off"),
    },
    insights: {
      enabled: Boolean(insights.enabled ?? false),
      schedule: String(insights.schedule ?? "manual"),
    },
  };
}

export function loadProfile(path: string): Profile {
  if (!existsSync(path)) {
    throw new ProfileError(`profile not found: ${path}`);
  }
  return parseProfileYaml(readFileSync(path, "utf-8"));
}

/** `profiles/commerce.yaml` | `commerce.yaml` | `commerce` → `commerce` */
export function profileIdFromRef(ref: string): string {
  const trimmed = ref.trim().replace(/\\/g, "/");
  const base = trimmed.includes("/")
    ? trimmed.split("/").pop() || trimmed
    : trimmed;
  return base.replace(/\.ya?ml$/i, "");
}

export function profilePathForId(id: string): string {
  return `profiles/${id}.yaml`;
}

function parseRule(item: unknown): Rule {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new ProfileError("each rule must be a mapping");
  }
  const rule = item as Record<string, unknown>;
  const whenRaw = (rule.when as Record<string, unknown>) || {};
  return {
    name: String(rule.name ?? ""),
    table: String(rule.table ?? ""),
    when: {
      columnsChanged: Array.isArray(whenRaw.columns_changed)
        ? whenRaw.columns_changed.map(String)
        : [],
    },
    chunkTemplate: String(rule.chunk_template ?? "").trim(),
    tags: Array.isArray(rule.tags) ? rule.tags.map(String) : [],
  };
}
