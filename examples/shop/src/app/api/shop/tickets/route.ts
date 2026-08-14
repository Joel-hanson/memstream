import { z } from "zod";
import { runShopMutation } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  order_id: z.string().trim().min(1).max(64),
  body: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid ticket" }, { status: 400 });
  }
  return runShopMutation(req, "Failed to open ticket", (shop) =>
    Promise.resolve(
      shop.openTicket({
        orderId: parsed.data.order_id,
        body: parsed.data.body || undefined,
      }),
    ),
  );
}
