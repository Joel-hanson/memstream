import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { shopSnapshot } from "@/lib/shop-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  try {
    return NextResponse.json(await shopSnapshot());
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim()
        ? err.message.trim()
        : "Failed to load shop";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
