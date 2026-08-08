"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCustomerService2Line,
  RiFileCopyLine,
  RiShoppingBag3Line,
  RiTruckLine,
} from "@remixicon/react";
import {
  adjustStockAction,
  openTicketAction,
  placeOrderAction,
  setStockAction,
  setUserRoleAction,
  shipOrderAction,
} from "@/app/shop/actions";
import { MemstreamMark } from "@/components/memstream-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { consoleApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

const CUSTOMER_LABELS: Record<string, string> = {
  c1: "Alex",
  c2: "Sam",
};

/** Primary ask prompt from docs/DEMO_SCRIPT.md Beat 4. */
const DEMO_ASK_PROMPT = `Why is Alex upset about SKU-12?
1) Call Memstream search_memory first and cite the chunks.
2) Then use Cockroach Cloud MCP SQL to confirm the live order 100 status, SKU-12 stock, and any ticket for that order.
Answer in 3 short bullets: what happened, what memory shows, what SQL confirms.`;

/** Optional Path B: similarity over repeated stock drops. */
const STOCK_SIMILARITY_ASK = `Have we seen stock drops like SKU-12 before?
1) Call Memstream search_memory and cite similar inventory chunks.
2) Then use Cockroach Cloud MCP SQL to confirm current SKU-12 quantity in stock.
Answer in 2 short bullets: what memory shows, what SQL confirms.`;

/** saas-security / discovered users_role_change. */
const ROLE_CHANGE_ASK = `Did anyone get a privilege change in org-acme?
1) Call Memstream search_memory first and cite the role-change chunks.
2) Then use Cockroach Cloud MCP SQL to confirm user u1 (admin@acme.test) current role.
Answer in 2 short bullets: what memory shows, what SQL confirms.`;

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

function Step({
  n,
  title,
  done,
  active,
}: {
  n: number;
  title: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 border px-3 py-2",
        done && "border-foreground/20 bg-muted/40",
        active && !done && "border-foreground/40 bg-background",
        !active && !done && "border-border bg-muted/20 text-muted-foreground",
      )}
    >
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center text-[0.65rem] font-medium",
          done
            ? "bg-primary text-primary-foreground"
            : active
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <RiCheckLine className="size-3" /> : n}
      </div>
      <div className="truncate text-xs font-medium text-foreground">{title}</div>
    </div>
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
  cdc?: { path: string; preview: string }[];
  message?: string;
  error?: string;
  backend?: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stockAskCopied, setStockAskCopied] = useState(false);
  const [roleAskCopied, setRoleAskCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);

  const pendingOrders = orders.filter((o) => String(o.status) !== "shipped");
  const shippedOrders = orders.filter((o) => String(o.status) === "shipped");

  /** Demo script hero: prefer order 100 when still pending. */
  const heroOrder =
    pendingOrders.find((o) => String(o.id) === "100") ??
    pendingOrders[0] ??
    null;

  const ticketedOrderIds = new Set(
    tickets.map((t) => String(t.order_id ?? "")).filter(Boolean),
  );

  /** Prefer shipped order 100 for the complaint beat. */
  const ticketOrder =
    shippedOrders.find(
      (o) =>
        String(o.id) === "100" && !ticketedOrderIds.has(String(o.id)),
    ) ??
    shippedOrders.find((o) => !ticketedOrderIds.has(String(o.id))) ??
    null;

  const order100 = orders.find((o) => String(o.id) === "100") ?? null;
  const order100Shipped = order100
    ? String(order100.status) === "shipped"
    : shippedOrders.some((o) => String(o.id) === "100");
  const hasTicketFor100 = ticketedOrderIds.has("100");
  const hasAnyTicket = tickets.length > 0;

  const shipDone = order100Shipped || shippedOrders.length > 0;
  const ticketDone = hasTicketFor100 || (shipDone && hasAnyTicket && !ticketOrder);
  const dramaDone = shipDone && ticketDone;

  const phase: "ship" | "ticket" | "done" = !shipDone
    ? "ship"
    : ticketOrder
      ? "ticket"
      : "done";

  const otherPending = pendingOrders.filter(
    (o) => !heroOrder || String(o.id) !== String(heroOrder.id),
  );

  const sku12 = stock.find((r) => String(r.sku) === "SKU-12") ?? null;
  const sku12Qty = sku12 != null ? Number(sku12.quantity) : 0;
  const canDropSku12 = sku12Qty > 0;

  async function copyAskPrompt() {
    try {
      await navigator.clipboard.writeText(DEMO_ASK_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyStockAsk() {
    try {
      await navigator.clipboard.writeText(STOCK_SIMILARITY_ASK);
      setStockAskCopied(true);
      window.setTimeout(() => setStockAskCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyRoleAsk() {
    try {
      await navigator.clipboard.writeText(ROLE_CHANGE_ASK);
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
      await navigator.clipboard.writeText(result.value.json);
      setMcpCopied(true);
      window.setTimeout(() => setMcpCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-full max-w-xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center bg-primary text-primary-foreground">
              <MemstreamMark className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">Memstream</div>
              <div className="hidden text-xs text-muted-foreground sm:block">
                Demo shop
              </div>
            </div>
          </Link>
          <div className="ml-auto">
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/">
                <RiArrowLeftLine />
                Live console
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 pb-12">
        <div className="space-y-1">
          <h1 className="text-lg font-medium tracking-tight">
            Ship, then open a complaint
          </h1>
          <p className="text-sm text-muted-foreground">
            Two clicks here. Then check Live and ask in Cursor.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Step n={1} title="Ship Alex’s order" done={shipDone} active={phase === "ship"} />
          <Step
            n={2}
            title="Open complaint"
            done={ticketDone}
            active={phase === "ticket"}
          />
          <Step n={3} title="See it in Live" done={dramaDone} active={phase === "done"} />
        </div>

        {error ? (
          <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="border border-foreground/15 bg-muted/30 px-4 py-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Just now
            </div>
            <p className="mt-1">{message}</p>
          </div>
        ) : null}

        {/* Beat 1: Ship */}
        {phase === "ship" ? (
          <section className="space-y-3 border border-foreground/25 bg-muted/20 px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">1. Ship Alex’s order</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Updates the order status in Cockroach to shipped.
              </p>
            </div>

            {heroOrder ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border bg-background px-4 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium">
                      Order #{String(heroOrder.id)}
                    </span>
                    <Badge variant="outline">pending</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {customerLabel(String(heroOrder.customer_id))}
                    {orderSku(heroOrder) ? ` · ${orderSku(heroOrder)}` : ""}
                  </p>
                </div>
                <form action={shipOrderAction}>
                  <input
                    type="hidden"
                    name="order_id"
                    value={String(heroOrder.id)}
                  />
                  <PendingButton
                    label="Ship order"
                    pendingLabel="Shipping…"
                    size="lg"
                    icon={<RiTruckLine />}
                  />
                </form>
              </div>
            ) : (
              <div className="space-y-3 border border-dashed px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No pending orders. Place one for Alex, or run{" "}
                  <span className="font-mono text-foreground">make demo-reset</span>.
                </p>
                {stock.some((r) => Number(r.quantity) > 0) ? (
                  <form action={placeOrderAction} className="inline-flex">
                    <input type="hidden" name="sku" value="SKU-12" />
                    <input type="hidden" name="quantity" value="1" />
                    <input type="hidden" name="customer_id" value="c1" />
                    <PendingButton
                      label="Place order for Alex (SKU-12)"
                      pendingLabel="Ordering…"
                      icon={<RiShoppingBag3Line />}
                    />
                  </form>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {/* Beat 2: Ticket */}
        {phase === "ticket" && ticketOrder ? (
          <section className="space-y-3 border border-foreground/25 bg-muted/20 px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">2. Open a complaint</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Alex says the item arrived damaged. That ticket is the second write.
              </p>
            </div>

            <div className="space-y-3 border bg-background px-4 py-4">
              <p className="text-sm">
                Order #{String(ticketOrder.id)} shipped ·{" "}
                {customerLabel(String(ticketOrder.customer_id))}
                {orderSku(ticketOrder) ? ` · ${orderSku(ticketOrder)}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                “
                {orderSku(ticketOrder) || "SKU-12"} arrived damaged.”
              </p>
              <form action={openTicketAction}>
                <input
                  type="hidden"
                  name="order_id"
                  value={String(ticketOrder.id)}
                />
                <input type="hidden" name="body" value="" />
                <PendingButton
                  label="Open complaint ticket"
                  pendingLabel="Opening…"
                  size="lg"
                  icon={<RiCustomerService2Line />}
                />
              </form>
            </div>
          </section>
        ) : null}

        {/* Beat 3: Done / handoff */}
        {phase === "done" ? (
          <section className="space-y-4 border border-foreground/25 bg-muted/20 px-4 py-4">
            <div>
              <h2 className="text-sm font-medium">3. Check memory, then ask</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Both writes are in Cockroach. Open Live for the chunks, then ask
                in Cursor.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" asChild>
                <Link href="/">
                  See chunks in Live
                  <RiArrowRightLine />
                </Link>
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => void copyAskPrompt()}
              >
                <RiFileCopyLine />
                {copied ? "Copied ask" : "Copy ask prompt"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => void copyMcpConfig()}
              >
                <RiFileCopyLine />
                {mcpCopied ? "Copied MCP" : "Copy Memstream MCP"}
              </Button>
            </div>

            {tickets[0] ? (
              <p className="text-xs text-muted-foreground">
                Ticket {String(tickets[0].id)} · order{" "}
                {String(tickets[0].order_id)} · {String(tickets[0].status)}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Path B: optional after the main flow (same shop / commerce profile) */}
        {dramaDone ? (
          <section
            id="path-b"
            className="space-y-3 border border-dashed px-4 py-4"
          >
            <div>
              <h2 className="text-sm font-medium">
                Optional: similar stock drops
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                After the Alex story, drop SKU-12 again so memory has more than
                one inventory event. Then ask whether you have seen drops like
                this before.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={adjustStockAction}>
                <input type="hidden" name="sku" value="SKU-12" />
                <input type="hidden" name="delta" value="-1" />
                <PendingButton
                  label={
                    canDropSku12
                      ? `Drop SKU-12 by 1 (${sku12Qty} left)`
                      : "SKU-12 out of stock"
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
                {stockAskCopied ? "Copied ask" : "Copy similarity ask"}
              </Button>
            </div>
          </section>
        ) : null}

        {/* saas-security / discovered users_role_change */}
        {users.length > 0 ? (
          <section
            id="path-security"
            className="space-y-3 border border-dashed px-4 py-4"
          >
            <div>
              <h2 className="text-sm font-medium">
                Optional: role change (saas-security)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enable with saas-security or discovered (users watched). Promote
                a member to admin, then ask about privilege changes in Live.
              </p>
            </div>
            <ul className="space-y-2">
              {users.map((u) => {
                const id = String(u.id);
                const email = String(u.email ?? id);
                const role = String(u.role ?? "");
                const canPromote =
                  role === "member" || role === "viewer" || role === "user";
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
                          defaultValue={role === "admin" ? "member" : "admin"}
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

        {/* Compact next-hint while mid-flow after an action */}
        {phase === "ticket" && message ? (
          <p className="text-xs text-muted-foreground">
            Next: open the complaint above, then check Live.
          </p>
        ) : null}

        <div className="border-t pt-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? "Hide advanced"
              : "Advanced (inventory, other orders)"}
          </button>
        </div>

        {showAdvanced ? (
          <div className="space-y-6 border px-3 py-3">
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Inventory</h3>
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
                      <span className="font-medium">{sku}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {outOfStock ? "out of stock" : `${available} in stock`}
                      </span>
                    </div>
                    <form action={placeOrderAction} className="flex items-center gap-1">
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="quantity" value="1" />
                      <input type="hidden" name="customer_id" value="c1" />
                      <PendingButton
                        label="Order 1"
                        pendingLabel="…"
                        size="sm"
                        disabled={outOfStock}
                        icon={<RiShoppingBag3Line />}
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
                        defaultValue={String(row.quantity)}
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
            </section>

            {otherPending.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium">Other pending orders</h3>
                {otherPending.map((o) => (
                  <div
                    key={String(o.id)}
                    className="flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs"
                  >
                    <span>
                      #{String(o.id)} · {customerLabel(String(o.customer_id))}
                      {orderSku(o) ? ` · ${orderSku(o)}` : ""}
                    </span>
                    <form action={shipOrderAction}>
                      <input type="hidden" name="order_id" value={String(o.id)} />
                      <PendingButton
                        label="Ship"
                        pendingLabel="…"
                        size="sm"
                        icon={<RiTruckLine />}
                      />
                    </form>
                  </div>
                ))}
              </section>
            ) : null}

            {shippedOrders.length > 0 ? (
              <section className="space-y-1">
                <h3 className="text-xs font-medium">Shipped</h3>
                <p className="text-xs text-muted-foreground">
                  {shippedOrders
                    .map((o) => `#${String(o.id)}`)
                    .join(", ")}
                </p>
              </section>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Backend: {backend === "cockroach" ? "CockroachDB" : "in-memory"}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
