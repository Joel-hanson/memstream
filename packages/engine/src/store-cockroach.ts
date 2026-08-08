/** CockroachDB memory store adapter (node-postgres). */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { MemoryChunk } from "./models.js";
import { normalizeSourceTs } from "./timestamps.js";

const { Client } = pg;

export type QueryResultRow = unknown[];

export type SqlClient = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: QueryResultRow[] }>;
  end: () => Promise<void>;
};

export type ConnectFn = () => Promise<SqlClient> | SqlClient;

export function formatVector(values: number[]): string {
  return `[${values.map((v) => String(Number(v))).join(",")}]`;
}

export function parseVector(raw: unknown): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v) => Number(v));
  const text = String(raw).trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => Number(part.trim()));
  }
  throw new Error(`unsupported vector value: ${String(raw)}`);
}

function safeIdent(name: string): boolean {
  return Boolean(name) && /^[A-Za-z0-9]+$/.test(name.replace(/_/g, ""));
}

/** Drop sslrootcert= from a connection URL (CA comes from env / bundled path). */
export function stripSslRootCert(conninfo: string): string {
  return conninfo
    .replace(/([?&])sslrootcert=[^&]*/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "")
    .replace(/\?&/, "?");
}

/**
 * Reject weak SSL modes; ensure sslmode=verify-full for Cockroach Cloud.
 */
export function ensureVerifyFullSsl(conninfo: string): string {
  const mode = /[?&]sslmode=([^&]*)/i.exec(conninfo)?.[1]?.toLowerCase();
  if (mode === "disable" || mode === "allow" || mode === "prefer" || mode === "no-verify") {
    throw new Error(
      `sslmode=${mode} is not allowed. Use sslmode=verify-full with PGSSLROOTCERT / make cockroach-ca.`,
    );
  }
  if (mode === "verify-full") return conninfo;
  if (mode) {
    // require / verify-ca → upgrade to verify-full
    return conninfo.replace(/([?&]sslmode=)[^&]*/i, "$1verify-full");
  }
  const join = conninfo.includes("?") ? "&" : "?";
  return `${conninfo}${join}sslmode=verify-full`;
}

/**
 * Sanitize a Connect URL before encrypt/store: strip laptop CA paths, require verify-full.
 */
export function sanitizeDatabaseUrlForStorage(conninfo: string): string {
  return ensureVerifyFullSsl(stripSslRootCert(conninfo.trim()));
}

/** Resolve Cockroach CA file: env → home → packaged cloud paths. */
export function resolveSslRootCertPath(): string | null {
  const candidates = [
    process.env.MEMSTREAM_SSLROOTCERT?.trim(),
    process.env.PGSSLROOTCERT?.trim(),
    join(homedir(), ".postgresql", "root.crt"),
    process.env.LAMBDA_TASK_ROOT
      ? join(process.env.LAMBDA_TASK_ROOT, "certs", "root.crt")
      : "",
    "/var/task/certs/root.crt",
    "/opt/memstream/certs/root.crt",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Normalize a Postgres/Cockroach connection string for node-postgres.
 *
 * Prefer CA from MEMSTREAM_SSLROOTCERT / PGSSLROOTCERT / ~/.postgresql/root.crt
 * (or packaged cloud paths). Strip libpq-only sslrootcert=system and any
 * missing laptop path embedded in the URL.
 */
export function normalizeConninfo(conninfo: string): string {
  let url = conninfo
    .replace(/([?&])sslrootcert=system(?=&|$)/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");

  const match = /([?&])sslrootcert=([^&]*)/i.exec(url);
  if (match) {
    let certPath = match[2] || "";
    try {
      certPath = decodeURIComponent(certPath);
    } catch {
      /* keep raw */
    }
    if (!certPath || certPath === "system" || !existsSync(certPath)) {
      url = stripSslRootCert(url);
    }
  }

  const existing = extractSslRootCert(url);
  if (existing && existsSync(existing)) return url;

  const ca = resolveSslRootCertPath();
  if (ca) return setSslRootCert(stripSslRootCert(url), ca);

  const inCloud = Boolean(
    process.env.LAMBDA_TASK_ROOT ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.MEMSTREAM_SSLROOTCERT,
  );
  if (inCloud) {
    throw new Error(
      "Cockroach CA not found (MEMSTREAM_SSLROOTCERT / PGSSLROOTCERT / bundled certs/root.crt). " +
        "Run make cockroach-ca or bundle root.crt via deploy.",
    );
  }
  return url;
}

/** Read sslrootcert query value from a connection URL (decoded). */
export function extractSslRootCert(conninfo: string): string | null {
  const match = /[?&]sslrootcert=([^&]*)/i.exec(conninfo);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Set or replace sslrootcert= in a connection URL. */
export function setSslRootCert(conninfo: string, certPath: string): string {
  const encoded = certPath; // pg expects a raw path; do not over-encode slashes
  if (/[?&]sslrootcert=/i.test(conninfo)) {
    return conninfo.replace(
      /([?&]sslrootcert=)[^&]*/i,
      `$1${encoded}`,
    );
  }
  const join = conninfo.includes("?") ? "&" : "?";
  return `${conninfo}${join}sslrootcert=${encoded}`;
}

export class CockroachMemoryStore {
  readonly conninfo: string;
  readonly table: string;
  /** When set, saves stamp this id and searches filter to it (+ legacy NULL). */
  readonly connectionId: string | null;
  private readonly connect: ConnectFn;

  constructor(options: {
    conninfo: string;
    table?: string;
    connectionId?: string | null;
    connect?: ConnectFn;
  }) {
    const table = options.table ?? "agent_memory_chunks";
    if (!safeIdent(table)) {
      throw new Error(`unsafe table name: ${JSON.stringify(table)}`);
    }
    this.conninfo = options.conninfo;
    this.table = table;
    this.connectionId = options.connectionId?.trim() || null;
    this.connect = options.connect ?? (() => this.defaultConnect());
  }

  private async defaultConnect(): Promise<SqlClient> {
    const client = new Client({ connectionString: normalizeConninfo(this.conninfo) });
    await client.connect();
    return {
      query: async (text, params) => {
        const result = await client.query(text, params);
        return { rows: result.rows as QueryResultRow[] };
      },
      end: () => client.end(),
    };
  }

  async save(chunk: MemoryChunk): Promise<void> {
    const connectionId = chunk.connectionId ?? this.connectionId;
    const sql = `
      INSERT INTO ${this.table}
        (application, connection_id, table_name, rule_name, tags, body, embedding, source_ts)
      VALUES ($1, $2::UUID, $3, $4, $5, $6, $7::VECTOR, $8)
      RETURNING id
    `;
    const params = [
      chunk.application,
      connectionId,
      chunk.tableName,
      chunk.ruleName,
      chunk.tags,
      chunk.text,
      formatVector(chunk.embedding),
      normalizeSourceTs(chunk.sourceTs),
    ];
    const conn = await this.connect();
    try {
      const result = await conn.query(sql, params);
      const row = result.rows[0];
      if (row) {
        const id = Array.isArray(row) ? row[0] : (row as { id?: unknown }).id;
        if (id != null) chunk.id = String(id);
      }
      if (connectionId) chunk.connectionId = connectionId;
    } finally {
      await conn.end();
    }
  }

  async search(queryEmbedding: number[], topK = 5): Promise<MemoryChunk[]> {
    const scoped = Boolean(this.connectionId);
    const sql = scoped
      ? `
      SELECT id, application, connection_id::text, table_name, rule_name, tags, body, embedding, source_ts
      FROM ${this.table}
      WHERE connection_id = $3::UUID OR connection_id IS NULL
      ORDER BY embedding <=> $1::VECTOR
      LIMIT $2
    `
      : `
      SELECT id, application, connection_id::text, table_name, rule_name, tags, body, embedding, source_ts
      FROM ${this.table}
      ORDER BY embedding <=> $1::VECTOR
      LIMIT $2
    `;
    const params = scoped
      ? [formatVector(queryEmbedding), topK, this.connectionId]
      : [formatVector(queryEmbedding), topK];
    const conn = await this.connect();
    try {
      const result = await conn.query(sql, params);
      return result.rows.map((row) => mapRow(row));
    } finally {
      await conn.end();
    }
  }
}

function mapRow(row: QueryResultRow | Record<string, unknown>): MemoryChunk {
  if (Array.isArray(row)) {
    // id, application, connection_id, table_name, rule_name, tags, body, embedding, source_ts
    const sourceTs = row[8];
    return {
      id: String(row[0]),
      application: String(row[1]),
      connectionId: row[2] == null ? null : String(row[2]),
      tableName: String(row[3]),
      ruleName: String(row[4]),
      tags: Array.isArray(row[5]) ? row[5].map(String) : [],
      text: String(row[6]),
      embedding: parseVector(row[7]),
      sourceTs: sourceTs == null ? "" : String(sourceTs),
    };
  }
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    application: String(r.application),
    connectionId:
      r.connection_id == null ? null : String(r.connection_id),
    tableName: String(r.table_name),
    ruleName: String(r.rule_name),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    text: String(r.body),
    embedding: parseVector(r.embedding),
    sourceTs: r.source_ts == null ? "" : String(r.source_ts),
  };
}
