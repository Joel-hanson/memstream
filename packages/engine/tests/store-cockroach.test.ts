import { describe, expect, it } from "vitest";
import type { MemoryChunk } from "../src/models.js";
import {
  CockroachMemoryStore,
  ensureVerifyFullSsl,
  formatVector,
  normalizeConninfo,
  sanitizeDatabaseUrlForStorage,
  stripSslRootCert,
  type SqlClient,
} from "../src/store-cockroach.js";

describe("normalizeConninfo", () => {
  it("leaves verify-full alone when no sslrootcert", () => {
    const url =
      "postgresql://u:p@host:26257/defaultdb?sslmode=verify-full";
    // May append CA if ~/.postgresql/root.crt exists — strip for assertion
    const out = normalizeConninfo(url);
    expect(out).toContain("sslmode=verify-full");
    expect(out).not.toContain("sslrootcert=system");
  });

  it("preserves a real sslrootcert path when the file exists", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(join(tmpdir(), "ms-cert-exist-"));
    const cert = join(dir, "root.crt");
    fs.writeFileSync(cert, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    try {
      const url = `postgresql://u:p@host:26257/db?sslmode=verify-full&sslrootcert=${cert}`;
      expect(normalizeConninfo(url)).toBe(url);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strips libpq-only sslrootcert=system", () => {
    expect(
      stripSslRootCert(
        "postgresql://u:p@host:26257/db?sslmode=verify-full&sslrootcert=system",
      ),
    ).toBe("postgresql://u:p@host:26257/db?sslmode=verify-full");
  });

  it("applies MEMSTREAM_SSLROOTCERT when URL has a missing laptop path", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(join(tmpdir(), "ms-ec2-cert-"));
    const bundled = join(dir, "root.crt");
    fs.writeFileSync(
      bundled,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
    const prev = process.env.MEMSTREAM_SSLROOTCERT;
    const prevPg = process.env.PGSSLROOTCERT;
    process.env.MEMSTREAM_SSLROOTCERT = bundled;
    delete process.env.PGSSLROOTCERT;
    try {
      const url =
        "postgresql://u:p@host:26257/db?sslmode=verify-full&sslrootcert=/Users/me/.postgresql/root.crt";
      expect(normalizeConninfo(url)).toBe(
        `postgresql://u:p@host:26257/db?sslmode=verify-full&sslrootcert=${bundled}`,
      );
    } finally {
      if (prev === undefined) delete process.env.MEMSTREAM_SSLROOTCERT;
      else process.env.MEMSTREAM_SSLROOTCERT = prev;
      if (prevPg === undefined) delete process.env.PGSSLROOTCERT;
      else process.env.PGSSLROOTCERT = prevPg;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes storage URLs: strip sslrootcert, force verify-full", () => {
    expect(
      sanitizeDatabaseUrlForStorage(
        "postgresql://u:p@h:26257/db?sslmode=require&sslrootcert=/Users/x/root.crt",
      ),
    ).toBe("postgresql://u:p@h:26257/db?sslmode=verify-full");
  });

  it("rejects weak sslmode on storage sanitize", () => {
    expect(() =>
      ensureVerifyFullSsl(
        "postgresql://u:p@h:26257/db?sslmode=disable",
      ),
    ).toThrow(/not allowed/);
  });
});

describe("CockroachMemoryStore", () => {
  it("formats vectors", () => {
    expect(formatVector([1.0, -0.5, 0.0])).toBe("[1,-0.5,0]");
  });

  it("saves a chunk and sets id", async () => {
    const statements: { sql: string; params?: unknown[] }[] = [];
    let ended = false;
    const conn: SqlClient = {
      query: async (sql, params) => {
        statements.push({ sql, params });
        return { rows: [{ id: "uuid-1" }] };
      },
      end: async () => {
        ended = true;
      },
    };
    const store = new CockroachMemoryStore({
      conninfo: "unused",
      connect: () => conn,
    });

    const chunk: MemoryChunk = {
      text: "Order 100 shipped",
      embedding: [0.1, 0.2],
      application: "acme-shop",
      tableName: "orders",
      ruleName: "order_status_change",
      tags: ["order", "status"],
      sourceTs: "2026-08-07T10:00:00Z",
      connectionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    await store.save(chunk);

    expect(chunk.id).toBe("uuid-1");
    expect(ended).toBe(true);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain("INSERT INTO agent_memory_chunks");
    expect(statements[0]!.params).toEqual([
      "acme-shop",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "orders",
      "order_status_change",
      ["order", "status"],
      "Order 100 shipped",
      "[0.1,0.2]",
      "2026-08-07T10:00:00Z",
    ]);
  });

  it("searches by vector distance", async () => {
    const statements: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlClient = {
      query: async (sql, params) => {
        statements.push({ sql, params });
        return {
          rows: [
            {
              id: "id-9",
              application: "acme-shop",
              connection_id: null,
              table_name: "orders",
              rule_name: "order_status_change",
              tags: ["order"],
              body: "Order 100 shipped",
              embedding: "[0.1,0.2]",
              source_ts: "2026-08-07T10:00:00Z",
            },
          ],
        };
      },
      end: async () => undefined,
    };
    const store = new CockroachMemoryStore({
      conninfo: "unused",
      connect: () => conn,
    });

    const hits = await store.search([0.1, 0.2], 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe("id-9");
    expect(hits[0]!.text).toBe("Order 100 shipped");
    expect(hits[0]!.embedding).toEqual([0.1, 0.2]);
    expect(statements[0]!.sql).toContain("ORDER BY embedding <=>");
    expect(statements[0]!.params).toEqual(["[0.1,0.2]", 3]);
  });

  it("scopes search when connectionId is set", async () => {
    const statements: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlClient = {
      query: async (sql, params) => {
        statements.push({ sql, params });
        return { rows: [] };
      },
      end: async () => undefined,
    };
    const store = new CockroachMemoryStore({
      conninfo: "unused",
      connectionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      connect: () => conn,
    });
    await store.search([0.1], 2);
    expect(statements[0]!.sql).toMatch(/connection_id = \$3/);
    expect(statements[0]!.params).toEqual([
      "[0.1]",
      2,
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
  });
});
