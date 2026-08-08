/** Shared pg client helper. */

import pg from "pg";
import { normalizeConninfo, type SqlClient } from "./store-cockroach.js";

const { Client } = pg;

export async function withClient<T>(
  databaseUrl: string,
  fn: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: normalizeConninfo(databaseUrl) });
  await client.connect();
  const wrapped: SqlClient = {
    query: async (text, params) => {
      const result = await client.query({
        text,
        values: params,
        rowMode: "array",
      });
      return { rows: result.rows as unknown[][] };
    },
    end: () => client.end(),
  };
  try {
    return await fn(wrapped);
  } finally {
    await client.end();
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
  const client = new Client({ connectionString: normalizeConninfo(databaseUrl) });
  await client.connect();
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
    await client.end();
  }
}
