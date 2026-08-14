import { describe, expect, it } from "vitest";
import { formatCaseNoteChunk, DEMO_HISTORY_SEEDS } from "../src/demo-history.js";

describe("demo-history", () => {
  it("formats case note chunks like the commerce profile template", () => {
    const text = formatCaseNoteChunk({
      id: "n-1",
      author: "staff",
      orderId: "100",
      ticketId: "t-1",
      body: "Waiting on warehouse replace.",
      timestamp: "2026-08-09T12:00:00.000Z",
    });
    expect(text).toContain("Case note n-1 (staff)");
    expect(text).toContain("order 100");
    expect(text).toContain("Waiting on warehouse replace.");
  });

  it("ships four curated history seeds", () => {
    expect(DEMO_HISTORY_SEEDS).toHaveLength(4);
    expect(DEMO_HISTORY_SEEDS.map((s) => s.tableName).sort()).toEqual([
      "case_notes",
      "case_notes",
      "orders",
      "tickets",
    ]);
  });

  it("seeds the weekend-availability note before the order 90 backstory", () => {
    const [first] = DEMO_HISTORY_SEEDS;
    expect(first!.body).toContain("n-89");
    expect(first!.body).toContain("weekends");
    expect(first!.body).toContain("Alex (c1)");
    expect(new Date(first!.sourceTs).getTime()).toBeLessThan(
      new Date(DEMO_HISTORY_SEEDS[1]!.sourceTs).getTime(),
    );
  });
});
