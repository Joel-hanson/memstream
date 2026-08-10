import {
  formatCaseNoteChunk,
  saveMemoryTexts,
  searchMemories,
} from "@memstream/engine";
import { resolveMcpRuntime } from "@memstream/mcp";
import { z } from "zod";
import { webRepoRoot } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadConnectDefaults } from "@/lib/env-defaults";
import { composeShopAskReply, type ShopSqlFacts } from "@/lib/shop-ask";
import { resolveShop } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  query: z.string().trim().min(1).max(500),
  top_k: z.number().int().min(1).max(10).optional(),
  /** customer = Support chat; staff = Staff agent */
  persona: z.enum(["customer", "staff"]).optional(),
});

async function loadSqlFacts(): Promise<ShopSqlFacts> {
  const shop = await resolveShop();
  const [orders, stock, tickets, notes] = await Promise.all([
    Promise.resolve(shop.listOrders()),
    Promise.resolve(shop.listStock()),
    Promise.resolve(shop.listTickets()),
    Promise.resolve(shop.listCaseNotes()),
  ]);

  const orderRow =
    orders.find((o) => String(o.id) === "100") ??
    orders.find((o) => String(o.customer_id) === "c1" && String(o.status) !== "shipped") ??
    orders.find((o) => String(o.customer_id) === "c1") ??
    orders[0] ??
    null;
  const stockRow =
    stock.find((r) => String(r.sku) === "SKU-12") ?? stock[0] ?? null;
  const orderId = orderRow ? String(orderRow.id) : "100";
  const relatedTickets = tickets.filter(
    (t) => String(t.order_id) === orderId || String(t.order_id) === "90",
  );
  const pastOrders = orders
    .filter((o) => String(o.customer_id) === "c1" && String(o.id) !== orderId)
    .map((o) => ({
      id: String(o.id),
      status: String(o.status ?? ""),
      sku:
        o.sku != null && String(o.sku).trim() ? String(o.sku) : null,
    }));

  return {
    order: orderRow
      ? {
          id: String(orderRow.id),
          status: String(orderRow.status ?? ""),
          customer_id: String(orderRow.customer_id ?? ""),
          sku:
            orderRow.sku != null && String(orderRow.sku).trim()
              ? String(orderRow.sku)
              : null,
          quantity:
            orderRow.quantity != null && orderRow.quantity !== ""
              ? Number(orderRow.quantity)
              : null,
          note:
            orderRow.note != null && String(orderRow.note).trim()
              ? String(orderRow.note)
              : null,
        }
      : null,
    pastOrders,
    stock: stockRow
      ? {
          sku: String(stockRow.sku),
          quantity: Number(stockRow.quantity),
        }
      : null,
    tickets: relatedTickets.map((t) => ({
      id: String(t.id),
      order_id: String(t.order_id),
      status: String(t.status ?? ""),
      body: String(t.body ?? ""),
    })),
    caseNotes: notes.map((n) => ({
      id: String(n.id),
      order_id: n.order_id != null ? String(n.order_id) : null,
      ticket_id: n.ticket_id != null ? String(n.ticket_id) : null,
      author: String(n.author ?? ""),
      body: String(n.body ?? ""),
    })),
  };
}

export async function POST(req: Request) {
  const limited = checkRateLimit(req, true);
  if (limited) return limited;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { detail: "query is required (1–500 chars)" },
      { status: 400 },
    );
  }

  const { query, top_k: topK = 5, persona = "customer" } = parsed.data;

  try {
    const defaults = await loadConnectDefaults();
    const runtimeCtx = await resolveMcpRuntime({
      root: webRepoRoot(),
      databaseUrl: defaults.database_url || undefined,
      connectionId: defaults.connection_id || undefined,
      awsRegion: defaults.region || undefined,
    });

    const [hits, facts] = await Promise.all([
      searchMemories(runtimeCtx.embedder, runtimeCtx.store, query, topK),
      loadSqlFacts(),
    ]);

    const result = composeShopAskReply(query, hits, facts);

    let caseNoteId: string | undefined;
    if (result.handoff && defaults.database_url) {
      try {
        const shop = await resolveShop();
        const openTicket =
          facts.tickets.find(
            (t) =>
              t.order_id === (facts.order?.id ?? "100") &&
              t.status !== "closed",
          ) ?? null;
        const saved = await shop.addCaseNote({
          body: result.handoff,
          author: persona === "staff" ? "staff" : "support",
          orderId: facts.order?.id ?? "100",
          ticketId: openTicket?.id ?? null,
        });
        caseNoteId = saved.noteId;

        // Fast path: index into the same vector memory so staff can resume
        // without waiting on CDC (changefeed still covers other writers).
        if (caseNoteId) {
          const text = formatCaseNoteChunk({
            id: caseNoteId,
            author: persona === "staff" ? "staff" : "support",
            orderId: facts.order?.id ?? "100",
            ticketId: openTicket?.id ?? null,
            body: result.handoff,
          });
          await saveMemoryTexts(runtimeCtx.store, runtimeCtx.embedder, [
            {
              text,
              application: "acme-shop",
              tableName: "case_notes",
              ruleName: "support_handoff",
              tags: ["support", "handoff", "conversation"],
              sourceTs: new Date().toISOString(),
              connectionId: defaults.connection_id || null,
            },
          ]);
        }
      } catch (persistErr) {
        console.error(
          "shop ask: could not persist case note",
          persistErr instanceof Error ? persistErr.message : persistErr,
        );
      }
    }

    return Response.json({ ...result, case_note_id: caseNoteId });
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim()
        ? err.message.trim()
        : "Support ask failed";
    return Response.json({ detail: message }, { status: 500 });
  }
}
