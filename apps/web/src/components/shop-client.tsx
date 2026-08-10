"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  adjustStockAction,
  openTicketAction,
  placeOrderAction,
  setStockAction,
  setUserRoleAction,
  shipOrderAction,
} from "@/app/shop/actions";
import { ShopAskChat } from "@/components/shop-support-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { consoleApi } from "@/lib/api-client";
import {
  DEMO_ASK_PROMPT,
  productForSku,
  ROLE_CHANGE_ASK,
  SHOP_PRODUCTS,
  STOCK_SIMILARITY_ASK,
  STORE,
  type CatalogProduct,
} from "@/lib/shop-catalog";
import { cn, copyToClipboard } from "@/lib/utils";
import {
  RiAddLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCustomerService2Line,
  RiFileCopyLine,
  RiShoppingBag3Line,
  RiSparklingLine,
  RiTruckLine,
} from "@remixicon/react";

type Row = Record<string, unknown>;
type ShopMode = "customer" | "staff";

const CUSTOMER_LABELS: Record<string, string> = {
  c1: "Alex",
  c2: "Sam",
};

/** Demo customer browsing the storefront. */
const SHOPPER_ID = "c1";

function customerLabel(id: string): string {
  return CUSTOMER_LABELS[id] ?? id;
}

function orderSku(order: Row | null): string | null {
  if (!order || order.sku == null || order.sku === "") return null;
  return String(order.sku);
}

function PendingButton({
  label,
  pendingLabel,
  variant = "default",
  disabled = false,
  size = "default",
  icon,
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "secondary";
  disabled?: boolean;
  size?: "default" | "sm" | "lg";
  icon?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size={size}
      variant={variant}
      disabled={disabled || pending}
    >
      {pending ? <Spinner /> : icon}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ProductArt({
  product,
  className,
}: {
  product: CatalogProduct;
  className?: string;
}) {
  const bg = product.accent;
  if (product.lamp === "mug") {
    return (
      <svg viewBox="0 0 200 200" className={cn("size-full", className)} aria-hidden>
        <rect width="200" height="200" fill={bg} />
        <rect
          x="62"
          y="56"
          width="70"
          height="90"
          rx="8"
          fill="oklch(0.97 0.01 80)"
          stroke="oklch(0.4 0.03 55)"
          strokeWidth="1.5"
        />
        <path
          d="M132 78 H148 C158 78 164 90 164 102 C164 114 158 126 148 126 H132"
          fill="none"
          stroke="oklch(0.4 0.03 55)"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  const shade =
    product.lamp === "studio"
      ? "M78 118 C78 70 122 58 122 118"
      : product.lamp === "harbor"
        ? "M88 118 L100 72 L112 118 Z"
        : "M80 118 C80 72 120 64 120 118";

  return (
    <svg viewBox="0 0 200 200" className={cn("size-full", className)} aria-hidden>
      <rect width="200" height="200" fill={bg} />
      <ellipse cx="100" cy="168" rx="36" ry="7" fill="oklch(0.75 0.03 70)" />
      <path
        d="M78 168 L84 118 H116 L122 168 Z"
        fill="oklch(0.9 0.03 75)"
        stroke="oklch(0.4 0.03 55)"
        strokeWidth="1.5"
      />
      <path
        d={shade}
        fill="oklch(0.97 0.015 85)"
        stroke="oklch(0.4 0.03 55)"
        strokeWidth="1.5"
      />
      <circle cx="100" cy="100" r="7" fill="oklch(0.88 0.08 85)" />
    </svg>
  );
}

export function ShopClient({
  orders,
  stock,
  tickets,
  users = [],
  message,
  error,
  backend = "memory",
}: {
  orders: Row[];
  stock: Row[];
  tickets: Row[];
  users?: Row[];
  message?: string;
  error?: string;
  backend?: string;
}) {
  const [mode, setMode] = useState<ShopMode>("customer");
  const [copied, setCopied] = useState(false);
  const [stockAskCopied, setStockAskCopied] = useState(false);
  const [roleAskCopied, setRoleAskCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHint, setChatHint] = useState(false);

  const stockBySku = new Map(
    stock.map((r) => [String(r.sku), Number(r.quantity)]),
  );

  const ticketByOrder = new Map(
    tickets.map((t) => [String(t.order_id), t] as const),
  );

  const myOrders = orders
    .filter((o) => String(o.customer_id) === SHOPPER_ID)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const allOrders = [...orders].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );

  const hasMyTicket = myOrders.some((o) => ticketByOrder.has(String(o.id)));
  const dramaDone = hasMyTicket;

  const sku12Qty = stockBySku.get("SKU-12") ?? 0;
  const canDropSku12 = sku12Qty > 0;

  const lampProducts = SHOP_PRODUCTS.filter((p) => p.featured);
  const otherProducts = SHOP_PRODUCTS.filter((p) => !p.featured);

  useEffect(() => {
    setChatHint(dramaDone && mode === "customer");
  }, [dramaDone, mode]);

  async function copyAskPrompt() {
    try {
      await copyToClipboard(DEMO_ASK_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyStockAsk() {
    try {
      await copyToClipboard(STOCK_SIMILARITY_ASK);
      setStockAskCopied(true);
      window.setTimeout(() => setStockAskCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyRoleAsk() {
    try {
      await copyToClipboard(ROLE_CHANGE_ASK);
      setRoleAskCopied(true);
      window.setTimeout(() => setRoleAskCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyMcpConfig() {
    const result = await consoleApi.mcpConfig();
    if (!result.ok || !result.value.json) return;
    try {
      await copyToClipboard(result.value.json);
      setMcpCopied(true);
      window.setTimeout(() => setMcpCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-foreground/10 bg-[oklch(0.985_0.004_85)]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <div className="min-w-0 leading-tight">
            <div className="font-(family-name:--font-shop-display) text-xl tracking-tight">
              {STORE.name}
            </div>
            <div className="truncate text-[0.65rem] text-muted-foreground">
              {mode === "customer"
                ? `Shopping as ${STORE.customer}`
                : "Staff · fulfill, stock, roles"}
            </div>
          </div>

          <div
            className="ml-auto flex shrink-0 border border-foreground/15 p-0.5"
            role="tablist"
            aria-label="Shop mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "customer"}
              className={cn(
                "px-2.5 py-1 text-xs transition-colors",
                mode === "customer"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("customer")}
            >
              Shop
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "staff"}
              className={cn(
                "px-2.5 py-1 text-xs transition-colors",
                mode === "staff"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("staff")}
            >
              Staff
            </button>
          </div>

          {mode === "customer" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setChatOpen(true)}
            >
              <RiCustomerService2Line />
              Support
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChatOpen(true)}
              >
                <RiSparklingLine />
                Agent
              </Button>
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link href="/">
                  Live
                  <RiArrowRightLine />
                </Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pt-6 pb-28">
        {error ? (
          <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="animate-in fade-in slide-in-from-top-2 border border-foreground/15 bg-background px-4 py-3 duration-500">
            <div className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              Just now
            </div>
            <p className="mt-1 text-sm">{message}</p>
          </div>
        ) : null}

        {mode === "customer" ? (
          <>
            <section className="animate-in fade-in space-y-4 duration-700">
              <div>
                <h1 className="font-(family-name:--font-shop-display) text-3xl tracking-tight sm:text-4xl">
                  Lamps
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Browse and buy. If something arrives broken, report it on your
                  order — then ask Support.
                </p>
                {backend !== "cockroach" ? (
                  <p className="mt-2 text-xs text-destructive">
                    Shop is on in-memory backend — connect Cockroach for the full
                    demo.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {lampProducts.map((product) => {
                  const qty = stockBySku.get(product.sku) ?? 0;
                  const out = !(qty > 0);
                  return (
                    <article
                      key={product.sku}
                      className="flex flex-col border border-foreground/15 bg-background"
                    >
                      <div className="aspect-square border-b border-foreground/10">
                        <ProductArt product={product} />
                      </div>
                      <div className="flex flex-1 flex-col gap-3 p-3">
                        <div className="min-w-0 space-y-1">
                          <div className="font-(family-name:--font-shop-display) text-lg tracking-tight">
                            {product.name}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {product.blurb}
                          </p>
                          <p className="text-[0.65rem] text-muted-foreground">
                            {product.sku} · {out ? "sold out" : `${qty} left`}
                          </p>
                        </div>
                        <form action={placeOrderAction} className="mt-auto">
                          <input type="hidden" name="sku" value={product.sku} />
                          <input type="hidden" name="quantity" value="1" />
                          <input
                            type="hidden"
                            name="customer_id"
                            value={SHOPPER_ID}
                          />
                          <PendingButton
                            label={out ? "Sold out" : "Buy"}
                            pendingLabel="Buying…"
                            size="sm"
                            disabled={out}
                            icon={<RiShoppingBag3Line />}
                          />
                        </form>
                      </div>
                    </article>
                  );
                })}
              </div>

              {otherProducts.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {otherProducts.map((product) => {
                    const qty = stockBySku.get(product.sku) ?? 0;
                    const out = !(qty > 0);
                    return (
                      <article
                        key={product.sku}
                        className="flex items-center gap-3 border border-dashed px-3 py-2"
                      >
                        <div className="size-14 shrink-0 border border-foreground/10">
                          <ProductArt product={product} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {product.name}
                          </div>
                          <div className="text-[0.65rem] text-muted-foreground">
                            {product.sku} · {out ? "sold out" : `${qty} left`}
                          </div>
                        </div>
                        <form action={placeOrderAction}>
                          <input type="hidden" name="sku" value={product.sku} />
                          <input type="hidden" name="quantity" value="1" />
                          <input
                            type="hidden"
                            name="customer_id"
                            value={SHOPPER_ID}
                          />
                          <PendingButton
                            label="Buy"
                            pendingLabel="…"
                            size="sm"
                            variant="outline"
                            disabled={out}
                          />
                        </form>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="font-(family-name:--font-shop-display) text-2xl tracking-tight">
                  Your orders
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Staff ships from the Staff tab. You report damage and talk to
                  Support.
                </p>
              </div>

              <ul className="space-y-3">
                {myOrders.length === 0 ? (
                  <li className="border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    No orders yet — buy a lamp above.
                  </li>
                ) : (
                  myOrders.map((o) => {
                    const id = String(o.id);
                    const status = String(o.status);
                    const sku = orderSku(o);
                    const product = productForSku(sku);
                    const ticket = ticketByOrder.get(id);
                    const pending = status !== "shipped";
                    const canTicket = status === "shipped" && !ticket;
                    const done = Boolean(ticket);

                    return (
                      <li
                        key={id}
                        className={cn(
                          "border bg-background px-4 py-4",
                          done
                            ? "border-foreground/10 bg-muted/20"
                            : "border-foreground/20",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-medium">
                                Order #{id}
                              </span>
                              <Badge variant={pending ? "outline" : "default"}>
                                {pending ? "on the way" : "delivered"}
                              </Badge>
                              {ticket ? (
                                <Badge variant="outline">
                                  ticket {String(ticket.id)}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {product.name}
                              {sku ? (
                                <span className="text-muted-foreground/70">
                                  {" "}
                                  ({sku})
                                </span>
                              ) : null}
                            </p>
                            {pending ? (
                              <p className="text-xs text-muted-foreground">
                                Waiting for staff to ship this order.
                              </p>
                            ) : null}
                            {ticket ? (
                              <p className="text-sm text-muted-foreground">
                                “{String(ticket.body)}”
                              </p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {canTicket ? (
                              <form action={openTicketAction}>
                                <input
                                  type="hidden"
                                  name="order_id"
                                  value={id}
                                />
                                <input type="hidden" name="body" value="" />
                                <PendingButton
                                  label="Report damage"
                                  pendingLabel="Opening…"
                                  size="sm"
                                  icon={<RiCustomerService2Line />}
                                />
                              </form>
                            ) : null}
                            {done ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setChatOpen(true)}
                              >
                                <RiCustomerService2Line />
                                Ask Support
                              </Button>
                            ) : null}
                            {done ? (
                              <RiCheckLine className="size-4 self-center text-muted-foreground" />
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          </>
        ) : (
          <>
            <section className="space-y-4">
              <div>
                <h1 className="font-(family-name:--font-shop-display) text-3xl tracking-tight">
                  Fulfillment
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ship open orders. Customers report damage and use Support on
                  the Shop tab.
                </p>
              </div>

              <ul className="space-y-3">
                {allOrders.map((o) => {
                  const id = String(o.id);
                  const status = String(o.status);
                  const sku = orderSku(o);
                  const product = productForSku(sku);
                  const ticket = ticketByOrder.get(id);
                  const pending = status !== "shipped";

                  return (
                    <li
                      key={id}
                      className="border border-foreground/15 bg-background px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">Order #{id}</span>
                            <Badge variant="outline">{status}</Badge>
                            {ticket ? (
                              <Badge variant="outline">
                                ticket {String(ticket.id)}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {customerLabel(String(o.customer_id))} ·{" "}
                            {product.name}
                            {sku ? ` (${sku})` : ""}
                          </p>
                        </div>
                        {pending ? (
                          <form action={shipOrderAction}>
                            <input type="hidden" name="order_id" value={id} />
                            <PendingButton
                              label="Ship"
                              pendingLabel="Shipping…"
                              size="sm"
                              icon={<RiTruckLine />}
                            />
                          </form>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Shipped
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="font-(family-name:--font-shop-display) text-xl tracking-tight">
                  Inventory
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stock writes become memory too — use for the similarity ask.
                </p>
              </div>
              {stock.map((row) => {
                const sku = String(row.sku);
                const available = Number(row.quantity);
                const outOfStock = !(available > 0);
                return (
                  <div
                    key={sku}
                    className="flex flex-wrap items-center gap-2 border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 text-xs">
                      <span className="font-medium">
                        {productForSku(sku).name}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {sku} ·{" "}
                        {outOfStock ? "out of stock" : `${available} in stock`}
                      </span>
                    </div>
                    <form action={adjustStockAction}>
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="delta" value="-1" />
                      <PendingButton
                        label="−1"
                        pendingLabel="…"
                        size="sm"
                        variant="secondary"
                        disabled={outOfStock}
                      />
                    </form>
                    <form action={adjustStockAction}>
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="delta" value="10" />
                      <PendingButton
                        label="+10"
                        pendingLabel="…"
                        size="sm"
                        variant="secondary"
                        icon={<RiAddLine />}
                      />
                    </form>
                    <form
                      action={setStockAction}
                      className="flex items-center gap-1"
                    >
                      <input type="hidden" name="sku" value={sku} />
                      <Input
                        name="quantity"
                        className="h-7 w-16"
                        type="number"
                        min={0}
                        defaultValue={available}
                        aria-label={`Set quantity for ${sku}`}
                      />
                      <PendingButton
                        label="Set"
                        pendingLabel="…"
                        size="sm"
                        variant="outline"
                      />
                    </form>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <form action={adjustStockAction}>
                  <input type="hidden" name="sku" value="SKU-12" />
                  <input type="hidden" name="delta" value="-1" />
                  <PendingButton
                    label={
                      canDropSku12
                        ? `Drop Field Lamp (${sku12Qty} left)`
                        : "Field Lamp out of stock"
                    }
                    pendingLabel="Updating…"
                    size="sm"
                    variant="secondary"
                    disabled={!canDropSku12}
                  />
                </form>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyStockAsk()}
                >
                  <RiFileCopyLine />
                  {stockAskCopied ? "Copied ask" : "Copy stock ask"}
                </Button>
              </div>
            </section>

            {users.length > 0 ? (
              <section id="path-security" className="space-y-3">
                <div>
                  <h2 className="font-(family-name:--font-shop-display) text-xl tracking-tight">
                    Users & roles
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Admin path for saas-security — not customer Support.
                  </p>
                </div>
                <ul className="space-y-2">
                  {users.map((u) => {
                    const id = String(u.id);
                    const email = String(u.email ?? id);
                    const role = String(u.role ?? "");
                    const canPromote =
                      role === "member" ||
                      role === "viewer" ||
                      role === "user";
                    const nextRole = canPromote ? "admin" : "";
                    return (
                      <li
                        key={id}
                        className="flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{email}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {id} · {role}
                          </span>
                        </div>
                        {canPromote ? (
                          <form action={setUserRoleAction}>
                            <input type="hidden" name="user_id" value={id} />
                            <input type="hidden" name="role" value={nextRole} />
                            <PendingButton
                              label={`Promote to ${nextRole}`}
                              pendingLabel="Updating…"
                              size="sm"
                              variant="secondary"
                            />
                          </form>
                        ) : (
                          <form
                            action={setUserRoleAction}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="user_id" value={id} />
                            <Input
                              name="role"
                              className="h-7 w-24"
                              defaultValue={
                                role === "admin" ? "member" : "admin"
                              }
                              aria-label={`New role for ${email}`}
                            />
                            <PendingButton
                              label="Set role"
                              pendingLabel="…"
                              size="sm"
                              variant="outline"
                            />
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyRoleAsk()}
                >
                  <RiFileCopyLine />
                  {roleAskCopied ? "Copied ask" : "Copy role-change ask"}
                </Button>
              </section>
            ) : null}

            <section className="space-y-3 border border-foreground/15 bg-background px-4 py-4">
              <div>
                <h2 className="font-(family-name:--font-shop-display) text-xl tracking-tight">
                  Staff agent
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This is the Memstream wow — ask why Alex is upset, about stock
                  patterns, or role changes. Memory first, SQL to confirm.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setChatOpen(true)}
                >
                  <RiSparklingLine />
                  Ask the agent
                </Button>
                <Button type="button" size="lg" variant="outline" asChild>
                  <Link href="/">
                    See chunks in Live
                    <RiArrowRightLine />
                  </Link>
                </Button>
              </div>
            </section>

            <section className="space-y-3 border border-dashed px-4 py-4">
              <div>
                <h2 className="text-sm font-medium">Optional: Cursor + MCP</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Same questions over MCP if you want the IDE agent path on
                  camera.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyAskPrompt()}
                >
                  <RiFileCopyLine />
                  {copied ? "Copied ask" : "Copy Cursor ask"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyMcpConfig()}
                >
                  <RiFileCopyLine />
                  {mcpCopied ? "Copied MCP" : "Copy Memstream MCP"}
                </Button>
              </div>
            </section>
          </>
        )}
      </main>

      <ShopAskChat
        persona={mode === "staff" ? "staff" : "customer"}
        open={chatOpen}
        onOpenChange={setChatOpen}
        highlight={
          mode === "customer"
            ? chatHint && dramaDone
            : mode === "staff" && dramaDone
        }
      />
    </div>
  );
}
