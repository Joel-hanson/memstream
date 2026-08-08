import { ShopError } from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";
import { resolveShop } from "@/lib/shop";

export const runtime = "nodejs";

/** REST shop API — gated (UI uses server actions at /shop instead). */
export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const s = await resolveShop();
  const [orders, stock, cdc] = await Promise.all([
    Promise.resolve(s.listOrders()),
    Promise.resolve(s.listStock()),
    Promise.resolve(s.listCdcFiles()),
  ]);
  return jsonOk({ backend: s.backend, orders, stock, cdc });
}

export async function POST(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const body = ((await readJsonBody(req as never)) || {}) as {
    action?: string;
    order_id?: string;
    sku?: string;
    quantity?: number;
    customer_id?: string;
  };
  const s = await resolveShop();
  try {
    if (body.action === "ship") {
      const orderId = body.order_id?.trim();
      if (!orderId) return jsonError("order_id required");
      const result = await s.shipOrder(orderId);
      const [orders, stock, cdc] = await Promise.all([
        Promise.resolve(s.listOrders()),
        Promise.resolve(s.listStock()),
        Promise.resolve(s.listCdcFiles()),
      ]);
      return jsonOk({ ...result, orders, stock, cdc });
    }
    if (body.action === "stock") {
      const sku = body.sku?.trim();
      const quantity = Number(body.quantity);
      if (!sku) return jsonError("sku required");
      if (!Number.isFinite(quantity)) return jsonError("quantity required");
      const result = await s.setStock(sku, quantity);
      const [orders, stock, cdc] = await Promise.all([
        Promise.resolve(s.listOrders()),
        Promise.resolve(s.listStock()),
        Promise.resolve(s.listCdcFiles()),
      ]);
      return jsonOk({ ...result, orders, stock, cdc });
    }
    if (body.action === "place") {
      const sku = body.sku?.trim();
      if (!sku) return jsonError("sku required");
      const result = await s.placeOrder({
        sku,
        quantity: body.quantity,
        customerId: body.customer_id,
      });
      const [orders, stock, cdc] = await Promise.all([
        Promise.resolve(s.listOrders()),
        Promise.resolve(s.listStock()),
        Promise.resolve(s.listCdcFiles()),
      ]);
      return jsonOk({ ...result, orders, stock, cdc });
    }
    if (body.action === "adjust") {
      const sku = body.sku?.trim();
      const delta = Number(body.quantity);
      if (!sku) return jsonError("sku required");
      if (!Number.isFinite(delta) || delta === 0) {
        return jsonError("quantity (delta) required");
      }
      const result = await s.adjustStock(sku, delta);
      const [orders, stock, cdc] = await Promise.all([
        Promise.resolve(s.listOrders()),
        Promise.resolve(s.listStock()),
        Promise.resolve(s.listCdcFiles()),
      ]);
      return jsonOk({ ...result, orders, stock, cdc });
    }
    return jsonError("action must be ship, stock, place, or adjust");
  } catch (err) {
    if (err instanceof ShopError) return jsonError(err.message, 400);
    throw err;
  }
}
