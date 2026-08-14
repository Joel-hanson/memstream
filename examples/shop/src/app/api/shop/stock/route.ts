import { z } from "zod";
import { runShopMutation } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    quantity: z.number().int().min(0).max(10_000).optional(),
    delta: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .refine((v) => v.quantity != null || v.delta != null, {
    message: "quantity or delta required",
  });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid stock update" }, { status: 400 });
  }
  const { sku, quantity, delta } = parsed.data;
  return runShopMutation(req, "Failed to update stock", (shop) => {
    if (delta != null) return Promise.resolve(shop.adjustStock(sku, delta));
    return Promise.resolve(shop.setStock(sku, quantity ?? 0));
  });
}
