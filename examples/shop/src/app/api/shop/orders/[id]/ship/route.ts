import { runShopMutation } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const orderId = id.trim();
  if (!orderId || orderId.length > 64) {
    return Response.json({ error: "Invalid order id" }, { status: 400 });
  }
  return runShopMutation(req, "Failed to ship order", (shop) =>
    Promise.resolve(shop.shipOrder(orderId)),
  );
}
