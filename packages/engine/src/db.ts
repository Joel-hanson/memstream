/** Shared pg helpers — pooled connections for the control-plane hot path. */

import pg from "pg";
import { normalizeConninfo, type SqlClient } from "./store-cockroach.js";

const { Pool } = pg;

const pools = new Map<string, pg.Pool>();

function getPool(databaseUrl: string): pg.Pool {
  const key = normalizeConninfo(databaseUrl);
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({
      connectionString: key,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pools.set(key, pool);
  }
  return pool;
}

/** Close all cached pools (CLI shutdown / tests). */
export async function closePools(): Promise<void> {
  const pending = [...pools.values()].map((p) => p.end());
  pools.clear();
  await Promise.all(pending);
}

export async function withClient<T>(
  databaseUrl: string,
  fn: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const pool = getPool(databaseUrl);
  const client = await pool.connect();
  const wrapped: SqlClient = {
    query: async (text, params) => {
      const result = await client.query({
        text,
        values: params,
        rowMode: "array",
      });
      return { rows: result.rows as unknown[][] };
    },
    end: async () => {
      /* pooled — release via finally */
    },
  };
  try {
    return await fn(wrapped);
  } finally {
    client.release();
  }
}

export async function withClientObjects<T>(
  databaseUrl: string,
  fn: (client: {
    query: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; fields: { name: string }[] }>;
  }) => Promise<T>,
): Promise<T> {
  const pool = getPool(databaseUrl);
  const client = await pool.connect();
  try {
    return await fn({
      query: async (text, params) => {
        const result = await client.query(text, params);
        return {
          rows: result.rows as Record<string, unknown>[],
          fields: result.fields.map((f) => ({ name: f.name })),
        };
      },
    });
  } finally {
    client.release();
  }
}
