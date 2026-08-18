import { describe, expect, it } from "vitest";
import {
  interestingColumns,
  isIdentityTable,
  narrativeColumns,
  proposeProfileDict,
  sourceDatabaseFromUrl,
  watchableColumns,
} from "../src/discover.js";

describe("watchable / narrative columns", () => {
  it("flags status metrics and narrative text", () => {
    const cols = [
      "id",
      "status",
      "body",
      "author",
      "order_id",
      "updated_at",
    ];
    expect(interestingColumns(cols)).toEqual(["status"]);
    expect(narrativeColumns(cols)).toEqual(["body", "author"]);
    expect(watchableColumns(cols)).toEqual(["status", "body", "author"]);
  });

  it("treats user tables as identity (email + name)", () => {
    expect(isIdentityTable("user")).toBe(true);
    expect(isIdentityTable("users")).toBe(true);
    expect(isIdentityTable("app.user")).toBe(true);
    expect(isIdentityTable("customers")).toBe(false);
    const cols = ["id", "email", "name", "created_at"];
    expect(watchableColumns(cols, "user")).toEqual(["email", "name"]);
  });

  it("includes case_notes-style tables in propose", () => {
    const profile = proposeProfileDict({
      application: "commerce",
      tables: {
        case_notes: ["id", "order_id", "ticket_id", "author", "body", "updated_at"],
        customers: ["id", "name"],
      },
    });
    const cf = profile.changefeed as { tables: string[] };
    expect(cf.tables).toContain("case_notes");
    expect(cf.tables).not.toContain("customers");
    const rules = profile.rules as {
      table: string;
      name: string;
      when: { columns_changed?: string[] };
    }[];
    expect(rules.some((r) => r.table === "case_notes" && r.when.columns_changed?.includes("body"))).toBe(
      true,
    );
    expect(rules.some((r) => r.table === "customers")).toBe(false);
  });

  it("proposes rules for a user table without status columns", () => {
    const profile = proposeProfileDict({
      application: "demo",
      tables: {
        user: ["id", "email", "name", "created_at"],
      },
    });
    const cf = profile.changefeed as { tables: string[] };
    expect(cf.tables).toContain("user");
    const rules = profile.rules as {
      table: string;
      when: { columns_changed?: string[] };
    }[];
    expect(rules.some((r) => r.table === "user" && r.when.columns_changed?.includes("email"))).toBe(
      true,
    );
    expect(rules.some((r) => r.table === "user" && r.when.columns_changed?.includes("name"))).toBe(
      true,
    );
  });

  it("does not auto-rule unmatched tables when others already matched", () => {
    const profile = proposeProfileDict({
      application: "demo",
      tables: {
        users: ["user_id", "email"],
        aaa: ["id", "created_at"],
      },
    });
    const cf = profile.changefeed as { tables: string[] };
    expect(cf.tables).toEqual(["users"]);
    const rules = profile.rules as { name: string; table: string }[];
    expect(rules.some((r) => r.table === "aaa")).toBe(false);
    expect(rules.some((r) => r.table === "users")).toBe(true);
  });

  it("falls back to row-change rules when no heuristic columns exist", () => {
    const profile = proposeProfileDict({
      application: "demo",
      tables: {
        items: ["id", "sku", "created_at"],
      },
    });
    const cf = profile.changefeed as { tables: string[] };
    expect(cf.tables).toEqual(["items"]);
    const rules = profile.rules as { name: string; table: string }[];
    expect(rules).toEqual([
      expect.objectContaining({ name: "items_row_change", table: "items" }),
    ]);
  });

  it("reads the database name from a Cockroach URL", () => {
    expect(
      sourceDatabaseFromUrl(
        "postgresql://u:p@cluster.aws-ap-south-1.cockroachlabs.cloud:26257/demo?sslmode=verify-full",
      ),
    ).toBe("demo");
  });
});
