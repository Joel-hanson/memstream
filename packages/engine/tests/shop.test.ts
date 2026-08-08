import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryShop, ShopError } from "../src/shop.js";

describe("InMemoryShop placeOrder", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function shop(): InMemoryShop {
    const dir = mkdtempSync(join(tmpdir(), "memstream-shop-"));
    dirs.push(dir);
    const s = new InMemoryShop(dir);
    s.seed();
    return s;
  }

  it("decrements stock and creates a pending order", () => {
    const s = shop();
    const before = Number(s.stock["SKU-12"]!.quantity);
    const result = s.placeOrder({ sku: "SKU-12", quantity: 2 });
    expect(result.message).toContain("Placed order");
    expect(Number(s.stock["SKU-12"]!.quantity)).toBe(before - 2);
    const created = s.listOrders().find((o) => String(o.id) === "102");
    expect(created).toMatchObject({
      id: "102",
      sku: "SKU-12",
      quantity: 2,
      status: "pending",
      customer_id: "c1",
    });
  });

  it("rejects when stock is insufficient", () => {
    const s = shop();
    expect(() => s.placeOrder({ sku: "SKU-99", quantity: 99 })).toThrow(
      ShopError,
    );
    expect(Number(s.stock["SKU-99"]!.quantity)).toBe(10);
  });

  it("adds stock with adjustStock", () => {
    const s = shop();
    s.adjustStock("SKU-99", 5);
    expect(Number(s.stock["SKU-99"]!.quantity)).toBe(15);
  });

  it("opens a support ticket after ship with a story body", () => {
    const s = shop();
    s.shipOrder("100");
    const result = s.openTicket({ orderId: "100" });
    expect(result.message).toContain("Opened ticket");
    const tickets = s.listTickets();
    expect(tickets).toHaveLength(1);
    expect(String(tickets[0]!.body)).toContain("Alex");
    expect(String(tickets[0]!.body)).toContain("SKU-12");
    expect(String(tickets[0]!.body)).toContain("order 100");
    expect(result.cdcPath).toMatch(/tickets\//);
  });

  it("rejects tickets before ship", () => {
    const s = shop();
    expect(() => s.openTicket({ orderId: "100" })).toThrow(ShopError);
  });

  it("promotes a member user and emits users CDC", () => {
    const s = shop();
    expect(String(s.users.u1!.role)).toBe("member");
    const result = s.setUserRole({ userId: "u1", role: "admin" });
    expect(result.message).toContain("admin@acme.test");
    expect(result.message).toContain("member → admin");
    expect(String(s.users.u1!.role)).toBe("admin");
    expect(result.cdcPath).toMatch(/users\//);
  });

  it("rejects setting the same role twice", () => {
    const s = shop();
    expect(() => s.setUserRole({ userId: "u2", role: "owner" })).toThrow(
      ShopError,
    );
  });
});
