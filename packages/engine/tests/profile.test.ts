import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadProfile,
  matchRules,
  profileIdFromRef,
  profilePathForId,
  renderChunk,
  resolveProfile,
  type ChangeEvent,
} from "../src/index.js";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);
const REPO_ROOT = join(FIXTURES, "..", "..", "..", "..");

describe("profile / rules / template", () => {
  it("loads commerce fixture", () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    expect(profile.application).toBe("acme-shop");
    expect(profile.rules.length).toBeGreaterThanOrEqual(2);
    expect(profile.embedding.dimensions).toBe(8);
  });

  it("matches status change rules", () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const event: ChangeEvent = {
      table: "orders",
      key: { id: "100" },
      before: { id: "100", status: "pending" },
      after: { id: "100", status: "shipped" },
      timestamp: "t",
    };
    const matched = matchRules(profile, event);
    expect(matched.map((r) => r.name)).toContain("order_status_change");
  });

  it("does not treat changefeed initial scans as stock or order column changes", () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const stockScan: ChangeEvent = {
      table: "stock",
      key: { sku: "SKU-12" },
      before: null,
      after: { sku: "SKU-12", warehouse_id: "east", quantity: 40 },
      timestamp: "t",
    };
    const orderScan: ChangeEvent = {
      table: "orders",
      key: { id: "90" },
      before: {},
      after: {
        id: "90",
        customer_id: "c1",
        status: "shipped",
        sku: "SKU-12",
        quantity: 1,
      },
      timestamp: "t",
    };
    expect(matchRules(profile, stockScan).map((r) => r.name)).not.toContain(
      "stock_drop",
    );
    expect(matchRules(profile, orderScan).map((r) => r.name)).not.toContain(
      "order_status_change",
    );
  });

  it("indexes new order inserts as order_placed", () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const placed: ChangeEvent = {
      table: "orders",
      key: { id: "103" },
      before: null,
      after: {
        id: "103",
        customer_id: "c1",
        status: "pending",
        sku: "SKU-21",
        quantity: 1,
      },
      timestamp: "t",
    };
    expect(matchRules(profile, placed).map((r) => r.name)).toEqual([
      "order_placed",
    ]);
  });

  it("still indexes ticket inserts (Report damage)", () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const opened: ChangeEvent = {
      table: "tickets",
      key: { id: "t-1" },
      before: null,
      after: {
        id: "t-1",
        order_id: "100",
        status: "open",
        body: "damaged",
      },
      timestamp: "t",
    };
    expect(matchRules(profile, opened).map((r) => r.name)).toContain(
      "ticket_opened",
    );
  });

  it("renders chunk templates", () => {
    const event: ChangeEvent = {
      table: "orders",
      key: { id: "100" },
      before: { id: "100", customer_id: "c1", status: "pending" },
      after: { id: "100", customer_id: "c1", status: "shipped" },
      timestamp: "2026-08-07T10:00:00Z",
    };
    const text = renderChunk(
      "Order {{id}} {{before.status}} → {{after.status}} at {{timestamp}}.",
      event,
    );
    expect(text).toBe(
      "Order 100 pending → shipped at 2026-08-07T10:00:00Z.",
    );
  });

  it("parses profile id from path refs", () => {
    expect(profileIdFromRef("profiles/commerce.yaml")).toBe("commerce");
    expect(profileIdFromRef("commerce")).toBe("commerce");
    expect(profilePathForId("commerce")).toBe("profiles/commerce.yaml");
  });

  it("falls back to profiles/*.yaml when platform DB is unreachable", async () => {
    const prev = process.env.MEMSTREAM_DATABASE_URL;
    process.env.MEMSTREAM_DATABASE_URL =
      "postgresql://nobody@127.0.0.1:1/memstream?sslmode=disable";
    try {
      const profile = await resolveProfile("commerce", REPO_ROOT);
      expect(profile.application).toBe("acme-shop");
      expect(profile.rules.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (prev === undefined) delete process.env.MEMSTREAM_DATABASE_URL;
      else process.env.MEMSTREAM_DATABASE_URL = prev;
    }
  });
});
