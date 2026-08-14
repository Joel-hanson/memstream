import { describe, expect, it } from "vitest";
import {
  interestingColumns,
  narrativeColumns,
  proposeProfileDict,
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
    const rules = profile.rules as { table: string; when: { columns_changed: string[] } }[];
    expect(rules.some((r) => r.table === "case_notes" && r.when.columns_changed.includes("body"))).toBe(
      true,
    );
  });
});
