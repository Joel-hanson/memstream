"use server";

import { ShopError } from "@memstream/engine";
import { redirect } from "next/navigation";
import { resolveShop } from "@/lib/shop";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ShopError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

export async function shipOrderAction(formData: FormData) {
  const orderId = String(formData.get("order_id") || "").trim();
  try {
    const result = await (await resolveShop()).shipOrder(orderId);
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to ship order"))}`,
    );
  }
}

export async function setStockAction(formData: FormData) {
  const sku = String(formData.get("sku") || "").trim();
  const quantity = Math.floor(Number(formData.get("quantity")));
  try {
    const result = await (await resolveShop()).setStock(sku, quantity);
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to update stock"))}`,
    );
  }
}

export async function adjustStockAction(formData: FormData) {
  const sku = String(formData.get("sku") || "").trim();
  const delta = Math.trunc(Number(formData.get("delta")));
  try {
    const result = await (await resolveShop()).adjustStock(sku, delta);
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to adjust stock"))}`,
    );
  }
}

export async function placeOrderAction(formData: FormData) {
  const sku = String(formData.get("sku") || "").trim();
  const quantity = Math.floor(Number(formData.get("quantity") || 1));
  const customerId = String(formData.get("customer_id") || "c1").trim();
  try {
    const result = await (await resolveShop()).placeOrder({
      sku,
      quantity,
      customerId,
    });
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to place order"))}`,
    );
  }
}

export async function openTicketAction(formData: FormData) {
  const orderId = String(formData.get("order_id") || "").trim();
  const body = String(formData.get("body") || "").trim();
  try {
    const result = await (await resolveShop()).openTicket({
      orderId,
      body: body || undefined,
    });
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to open ticket"))}`,
    );
  }
}

export async function setUserRoleAction(formData: FormData) {
  const userId = String(formData.get("user_id") || "").trim();
  const role = String(formData.get("role") || "").trim();
  try {
    const result = await (await resolveShop()).setUserRole({ userId, role });
    redirect(`/shop?msg=${encodeURIComponent(result.message)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(
      `/shop?err=${encodeURIComponent(errorMessage(err, "Failed to set user role"))}`,
    );
  }
}
