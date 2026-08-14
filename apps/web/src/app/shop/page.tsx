import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Shop lives in examples/shop (customer app). Keep /shop as a friendly redirect. */
export default function ShopRedirectPage() {
  const target = (
    process.env.NEXT_PUBLIC_SHOP_URL || "http://127.0.0.1:3001"
  ).replace(/\/$/, "");
  redirect(target);
}
