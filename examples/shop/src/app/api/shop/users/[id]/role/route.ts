import { z } from "zod";
import { runShopMutation } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  role: z.string().trim().min(1).max(32),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const userId = id.trim();
  if (!userId || userId.length > 64) {
    return Response.json({ error: "Invalid user id" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }
  return runShopMutation(req, "Failed to set user role", (shop) =>
    Promise.resolve(shop.setUserRole({ userId, role: parsed.data.role })),
  );
}
