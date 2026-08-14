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

function customerLabel(id: string, withId = false): string {
  const name = CUSTOMER[id] ?? id;
  if (!withId || !CUSTOMER[id]) return name;
  return `${name} (${id})`;
}

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export type ShopAskPersona = "customer" | "staff";

function intent(
  query: string,
): "stock" | "role" | "resume" | "pickup" | "order" {
  const q = query.toLowerCase();
  if (
    /where (did|do|have) we leave|left off|resume|hand ?off|last (spoke|talked|left)|catch me up/.test(
      q,
    )
  ) {
    return "resume";
  }
  if (/pick\s*-?up|picked up|collect(ed)?/.test(q)) return "pickup";
  if (
    /stock|inventory|drop|quantity|qty/.test(q) &&
    !/upset|ticket|damaged|alex|order|leave|left/.test(q)
  ) {
    return "stock";
  }
  if (/role|privilege|admin|org-acme|promote/.test(q)) return "role";
  return "order";
}

function productLabel(sku: string | null | undefined): string {
  if (!sku || sku === "SKU-12") return "Field Lamp";
  return sku;
}

function statusPhrase(status: string): string {
  const s = status.toLowerCase();
  if (s === "shipped") return "shipped";
  if (s === "pending") return "still being prepared";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return status;
}

/** Customer Support: second-person helpdesk prose (not ops bullets). */
function composeCustomerReply(
  query: string,
  facts: ShopSqlFacts,
  ticket: ShopSqlFacts["tickets"][number] | null,
): { reply: string; bullets: string[]; handoff?: string } {
  const order = facts.order;
  const who = order ? customerLabel(order.customer_id) : "Alex";
  const whoMem = order ? customerLabel(order.customer_id, true) : "Alex (c1)";
  const sku = order?.sku || "SKU-12";
  const product = productLabel(sku);
  const q = query.toLowerCase();
  const aboutDamage = /damage|broken|cracked|arrived (broken|damaged)/.test(q);
  const aboutReport = /report|ticket|get my|did you (get|see|receive)/.test(q);
  const aboutWhere = /where|status|track|shipped|arrive|delivery/.test(q);
  const aboutPickup =
    /pick\s*-?up|picked up|collect(ed)?|come (get|collect)|hasn.?t.*picked/.test(
      q,
    );
  const aboutAvailabilityFlip =
    /(free|available|around|home) this week|this week (works|i.?m (free|around|home))|not (just|only) weekends?|can do (weekdays|monday|tuesday|wednesday|thursday|friday)|actually.*(free|available)|i.?m in this week/.test(
      q,
    );

  const bullets: string[] = [];
  let reply: string;
  let handoff: string | undefined;

  if (ticket && ticket.status !== "closed") {
    const openLine = `you raised ticket ${ticket.id} on order ${ticket.order_id}`;
    const weekendAssumed = /weekend/i.test(ticket.body);
    if (aboutAvailabilityFlip) {
      reply = `Good to know, ${who} — thanks for the update. I've flagged that you're free this week, not just weekends, so our team can move the pickup for ticket ${ticket.id} up instead of waiting for Saturday.`;
      handoff = `${whoMem} says they're available THIS WEEK (not weekend-only) — please reschedule pickup for ticket ${ticket.id} on order ${ticket.order_id} sooner; the stored weekend-only preference from order 90 is outdated.`;
    } else if (aboutPickup) {
      reply = weekendAssumed
        ? `Hi ${who} — pickup for your ${product} on ticket ${ticket.id} is scheduled for the weekend. Our notes show you're usually away on weekdays, so we planned around that. Let us know if that's changed and we'll move it up.`
        : `Hi ${who} — I don't see a pickup window set yet on ticket ${ticket.id}. I'll have the team confirm a time and follow up.`;
      handoff = `${whoMem} asked why pickup hasn't happened on ticket ${ticket.id} (order ${ticket.order_id}); replied citing the weekend-only assumption from past notes.`;
    } else if (aboutDamage || aboutReport || /damage|damaged/.test(ticket.body)) {
      reply = `Sorry about that, ${who}. I can see ${openLine} about your ${product} arriving damaged. Order ${ticket.order_id} shows as ${order ? statusPhrase(order.status) : "shipped"}, and that case is still open — our team is looking into it.`;
    } else if (aboutWhere && order) {
      reply = `Hi ${who} — your ${product} order ${order.id} is ${statusPhrase(order.status)}. You also have open ticket ${ticket.id} on that order, and we’re following up on it.`;
    } else {
      reply = `Hi ${who} — ${openLine}: “${clip(ticket.body, 90)}”. Your order ${ticket.order_id} is currently ${order ? statusPhrase(order.status) : "on file"}, and we’re on it.`;
    }
    handoff =
      handoff ??
      `${whoMem} Field Lamp case: order ${ticket.order_id} ${order?.status ?? ""}; ticket ${ticket.id} open — “${clip(ticket.body, 80)}”. Prior late-delivery order 90 is closed.`;
  } else if (order) {
    if (aboutDamage || aboutReport) {
      reply = `Hi ${who} — I don’t see an open damage ticket on order ${order.id} yet. Your ${product} order is ${statusPhrase(order.status)}. If something arrived damaged, use Report damage on the order and we’ll open a ticket right away.`;
    } else {
      reply = `Hi ${who} — your ${product} order ${order.id} is ${statusPhrase(order.status)}. If anything looks off when it arrives, message us here and we’ll dig in.`;
    }
    handoff = `Asked about ${whoMem} / ${sku}: order ${order.id} is ${order.status}.`;
  } else {
    reply = `Hi ${who} — I couldn’t find your latest order just now. Give it a moment and ask again, or check the Orders list on the storefront.`;
    handoff = `Asked about ${whoMem} / ${sku}: order ${order?.id ?? "100"} is ${order?.status ?? "unknown"}.`;
  }

  bullets.push(reply);
  return { reply, bullets, handoff };
}

export function composeShopAskReply(
  query: string,
  hits: MemoryHit[],
  facts: ShopSqlFacts,
  persona: ShopAskPersona = "staff",
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

  // Storefront Support: personalized customer reply; staff keeps memory + SQL bullets.
  if (persona === "customer") {
    const customer = composeCustomerReply(query, facts, ticket);
    return {
      reply: customer.reply,
      bullets: customer.bullets,
      citations: [],
      sql,
      memory_ready,
      handoff: customer.handoff,
    };
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
    const who = order ? customerLabel(order.customer_id, true) : "Alex (c1)";
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
  } else if (kind === "pickup") {
    const who = order ? customerLabel(order.customer_id, true) : "Alex (c1)";
    const weekendAssumed = ticket ? /weekend/i.test(ticket.body) : false;
    const conflictNote =
      notes.find((n) => /this week|not (just|only) weekend/i.test(n.body)) ??
      null;
    bullets.push(
      ticket
        ? `Ticket ${ticket.id} on order ${ticket.order_id} is ${ticket.status}${weekendAssumed ? ": pickup was scheduled for the weekend based on " + who + "'s known weekday unavailability." : "."}`
        : `No open pickup ticket found for ${who}.`,
    );
    if (conflictNote) {
      bullets.push(
        `Conflict: latest case note (${conflictNote.id}, ${conflictNote.author}) says ${who} is available this week, not just weekends — “${clip(conflictNote.body, 140)}”. The stored weekend-only preference is stale.`,
      );
    } else {
      bullets.push(
        memory_ready
          ? `Memory shows the original weekend-only preference from order 90: ${memoryLine}`
          : memoryLine,
      );
    }
    const confirmParts: string[] = [];
    if (order) confirmParts.push(`order ${order.id} = ${order.status}`);
    if (ticket) confirmParts.push(`ticket ${ticket.id} = ${ticket.status}`);
    if (conflictNote) confirmParts.push(`note ${conflictNote.id}`);
    bullets.push(
      confirmParts.length
        ? `SQL confirms: ${confirmParts.join("; ")}.`
        : "SQL could not load order / ticket / case note rows.",
    );
    handoff = conflictNote
      ? `Staff reviewed ${who}'s pickup case — weekend-only assumption conflicts with the new "available this week" note (${conflictNote.id}); recommend rescheduling pickup to this week and updating ${who}'s preference.`
      : `Staff reviewed ${who}'s pickup case — ticket ${ticket?.id ?? "unknown"} still assumes weekend-only pickup from order 90 history; confirm with ${who} before assuming that still holds.`;
  } else {
    const who = order ? customerLabel(order.customer_id, true) : "Alex (c1)";
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
