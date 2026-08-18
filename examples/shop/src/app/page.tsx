import { resolveShop } from "@/lib/shop";
import { ShopClient } from "@/components/shop-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShopPage() {
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
  return (
    <ShopClient
      orders={orders}
      stock={stock}
      tickets={tickets}
      users={users}
      backend={shop.backend}
    />
  );
}
