import { resolveShop } from "@/lib/shop";
import { ShopClient } from "@/components/shop-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const shop = await resolveShop();
  const [orders, stock, tickets, users] = await Promise.all([
    Promise.resolve(shop.listOrders()),
    Promise.resolve(shop.listStock()),
    Promise.resolve(shop.listTickets()),
    Promise.resolve(shop.listUsers()),
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
