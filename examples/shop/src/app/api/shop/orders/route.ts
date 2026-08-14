import { z } from "zod";
import { runShopMutation } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sku: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(100).optional(),
  customer_id: z.string().trim().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid order" }, { status: 400 });
  }
  const { sku, quantity, customer_id } = parsed.data;
  return runShopMutation(req, "Failed to place order", (shop) =>
    Promise.resolve(
      shop.placeOrder({ sku, quantity, customerId: customer_id }),
    ),
  );
}
