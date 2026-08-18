import { ShopError } from "@memstream/engine";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveShop } from "@/lib/shop";

export type ShopSnapshot = {
  orders: Record<string, unknown>[];
  stock: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
  users: Record<string, unknown>[];
  backend: string;
};

export async function shopSnapshot(): Promise<ShopSnapshot> {
  const shop = await resolveShop();
  const empty: Record<string, unknown>[] = [];
  const settle = async <T,>(p: Promise<T> | T, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      console.error("[shop] snapshot query failed", err);
      return fallback;
    }
  };
  const [orders, stock, tickets, users] = await Promise.all([
    settle(Promise.resolve(shop.listOrders()), empty),
    settle(Promise.resolve(shop.listStock()), empty),
    settle(Promise.resolve(shop.listTickets()), empty),
    settle(Promise.resolve(shop.listUsers()), empty),
  ]);
  return { orders, stock, tickets, users, backend: shop.backend };
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ShopError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

export async function runShopMutation(
  req: Request,
  fallback: string,
  fn: (
    shop: Awaited<ReturnType<typeof resolveShop>>,
  ) => Promise<{ message: string }>,
): Promise<Response> {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  try {
    const shop = await resolveShop();
    const result = await fn(shop);
    const snapshot = await shopSnapshot();
    return NextResponse.json({ ...snapshot, message: result.message });
  } catch (err) {
    const status = err instanceof ShopError ? 400 : 500;
    return NextResponse.json(
      { error: errorMessage(err, fallback) },
      { status },
    );
  }
}
