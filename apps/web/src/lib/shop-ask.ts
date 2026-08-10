/** Compose demo support replies from memory hits + live SQL facts. */

import type { MemoryHit } from "@memstream/engine";

export type ShopSqlFacts = {
  order?: {
    id: string;
    status: string;
    customer_id: string;
    sku: string | null;
    quantity: number | null;
    note: string | null;
  } | null;
  /** Past / other Alex orders for resume narrative. */
  pastOrders?: Array<{
    id: string;
    status: string;
    sku: string | null;
  }>;
  stock?: { sku: string; quantity: number } | null;
  tickets: Array<{ id: string; order_id: string; status: string; body: string }>;
  caseNotes: Array<{
    id: string;
    order_id: string | null;
    ticket_id: string | null;
    author: string;
    body: string;
  }>;
};

export type ShopAskCitation = {
  table_name: string;
  rule_name: string;
  body: string;
  source_ts: string;
};

export type ShopAskResult = {
  reply: string;
  bullets: string[];
  citations: ShopAskCitation[];
  sql: {
    order_status?: string;
    stock_qty?: number;
    ticket_summary?: string;
    case_note_summary?: string;
  };
  memory_ready: boolean;
  /** Short handoff line persisted to case_notes after the ask. */
  handoff?: string;
};

const CUSTOMER: Record<string, string> = { c1: "Alex", c2: "Sam" };

function customerLabel(id: string): string {
  return CUSTOMER[id] ?? id;
}

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function intent(query: string): "stock" | "role" | "resume" | "order" {
  const q = query.toLowerCase();
  if (
    /where (did|do|have) we leave|left off|resume|hand ?off|last (spoke|talked|left)|catch me up/.test(
      q,
    )
  ) {
    return "resume";
  }
  if (
    /stock|inventory|drop|quantity|qty/.test(q) &&
    !/upset|ticket|damaged|alex|order|leave|left/.test(q)
  ) {
    return "stock";
  }
  if (/role|privilege|admin|org-acme|promote/.test(q)) return "role";
  return "order";
}

export function composeShopAskReply(
  query: string,
  hits: MemoryHit[],
  facts: ShopSqlFacts,
): ShopAskResult {
  const kind = intent(query);
  const citations: ShopAskCitation[] = hits.slice(0, 4).map((h) => ({
    table_name: h.table_name,
    rule_name: h.rule_name,
    body: h.body,
    source_ts: h.source_ts,
  }));
  const memory_ready = citations.length > 0;
  const memoryLine = memory_ready
    ? citations
        .slice(0, 2)
        .map((c) => clip(c.body, 120))
        .join(" · ")
    : "No memory chunks matched yet — wait for Live, then ask again.";

  const order = facts.order;
  const stock = facts.stock;
  const tickets = facts.tickets;
  const notes = facts.caseNotes;
  const ticket =
    tickets.find((t) => t.order_id === order?.id && t.status !== "closed") ??
    tickets.find((t) => t.order_id === order?.id) ??
    tickets[0] ??
    null;
  const latestNote = notes[notes.length - 1] ?? null;

  const sql: ShopAskResult["sql"] = {};
  if (order) sql.order_status = `${order.id}:${order.status}`;
  if (stock) sql.stock_qty = stock.quantity;
  if (ticket) {
    sql.ticket_summary = `${ticket.id} (${ticket.status})`;
  } else if (tickets.length === 0) {
    sql.ticket_summary = "none";
  }
  if (latestNote) {
    sql.case_note_summary = `${latestNote.id} (${latestNote.author})`;
  }

  const bullets: string[] = [];
  let handoff: string | undefined;

  if (kind === "stock") {
    bullets.push(
      stock
        ? `Live stock for ${stock.sku} is ${stock.quantity} units.`
        : "Could not read SKU-12 stock from SQL.",
    );
    bullets.push(
      memory_ready
        ? `Memory shows similar inventory activity: ${memoryLine}`
        : memoryLine,
    );
    handoff = stock
      ? `Staff checked SKU-12 stock — live quantity ${stock.quantity}.`
      : `Staff asked about stock; SQL stock row missing.`;
  } else if (kind === "role") {
    bullets.push(
      memory_ready
        ? `Memory cites privilege activity: ${memoryLine}`
        : memoryLine,
    );
    bullets.push(
      "Confirm the live role with Cockroach SQL on the users table (or ask again in Cursor with Cockroach MCP).",
    );
    handoff = `Staff reviewed org-acme privilege / role-change memory.`;
  } else if (kind === "resume") {
    const who = order ? customerLabel(order.customer_id) : "Alex";
    const past =
      facts.pastOrders?.filter((o) => o.id !== order?.id) ?? [];
    bullets.push(
      latestNote
        ? `Last handoff (${latestNote.id}, ${latestNote.author}): “${clip(latestNote.body, 140)}”`
        : ticket
          ? `Open thread on ticket ${ticket.id} (${ticket.status}) for order ${ticket.order_id}.`
          : `No case note yet for ${who} — start from live order ${order?.id ?? "100"}.`,
    );
    bullets.push(
      memory_ready
        ? `Memory (history + live): ${memoryLine}`
        : memoryLine,
    );
    const confirmParts: string[] = [];
    if (order) confirmParts.push(`order ${order.id} = ${order.status}`);
    if (past[0]) confirmParts.push(`past order ${past[0].id} = ${past[0].status}`);
    if (ticket) confirmParts.push(`ticket ${ticket.id} = ${ticket.status}`);
    if (latestNote) confirmParts.push(`note ${latestNote.id}`);
    bullets.push(
      confirmParts.length
        ? `SQL confirms: ${confirmParts.join("; ")}.`
        : "SQL could not load order / ticket / case note rows.",
    );
    handoff = `Staff resumed ${who}'s case — reviewed last handoff and live order ${order?.id ?? "100"}.`;
  } else {
    const who = order ? customerLabel(order.customer_id) : "Alex";
    const sku = order?.sku || "SKU-12";
    const pastHit = citations.some(
      (c) =>
        /\border\s*90\b/i.test(c.body) ||
        /\bt-90\b/i.test(c.body) ||
        /late delivery/i.test(c.body),
    );
    const what =
      ticket && ticket.status !== "closed"
        ? `${who} opened a support ticket on order ${ticket.order_id}: “${clip(ticket.body, 100)}”`
        : order
          ? `Order ${order.id} for ${who} (${sku}) is currently ${order.status}.`
          : "Order 100 was not found in SQL yet.";
    bullets.push(what);
    if (pastHit || (facts.pastOrders && facts.pastOrders.length > 0)) {
      bullets.push(
        memory_ready
          ? `Memory also has prior Field Lamp history: ${memoryLine}`
          : memoryLine,
      );
    } else {
      bullets.push(
        memory_ready
          ? `Memory (change story): ${memoryLine}`
          : memoryLine,
      );
    }
    const confirmParts: string[] = [];
    if (order) confirmParts.push(`order ${order.id} = ${order.status}`);
    if (stock) confirmParts.push(`${stock.sku} stock = ${stock.quantity}`);
    if (ticket) confirmParts.push(`ticket ${ticket.id} = ${ticket.status}`);
    bullets.push(
      confirmParts.length
        ? `SQL confirms: ${confirmParts.join("; ")}.`
        : "SQL could not load order / stock / ticket rows.",
    );
    handoff =
      ticket && ticket.status !== "closed"
        ? `${who} Field Lamp case: order ${ticket.order_id} ${order?.status ?? ""}; ticket ${ticket.id} open — “${clip(ticket.body, 80)}”. Prior late-delivery order 90 is closed.`
        : `Asked about ${who} / ${sku}: order ${order?.id ?? "100"} is ${order?.status ?? "unknown"}.`;
  }

  const reply = bullets.map((b, i) => `${i + 1}. ${b}`).join("\n");
  return { reply, bullets, citations, sql, memory_ready, handoff };
}
