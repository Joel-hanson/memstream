/** Client-side helpers for editing / previewing profile chunk templates. */

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

const SAMPLE_BY_KEY: Record<string, string> = {
  timestamp: "2026-08-07T14:02:11Z",
  table: "orders",
  id: "1042",
  customer_id: "c_9",
  order_id: "1042",
  sku: "SKU-88",
  warehouse_id: "wh_east",
  status: "shipped",
  quantity: "12",
  amount: "49.00",
  role: "admin",
  body: "Customer asked for ETA",
};

function sampleForKey(key: string): string {
  if (SAMPLE_BY_KEY[key]) return SAMPLE_BY_KEY[key]!;
  if (key.startsWith("before.")) {
    const field = key.slice("before.".length);
    const after = sampleForKey(field);
    if (field === "status" || field === "state") return "pending";
    if (field === "quantity" || field === "qty" || field === "amount") {
      const n = Number(after);
      return Number.isFinite(n) ? String(n + 5) : `old_${after}`;
    }
    return `old_${after}`;
  }
  if (key.startsWith("after.")) {
    return sampleForKey(key.slice("after.".length));
  }
  // Prefer a stable fake for unknown columns
  if (/_id$/.test(key)) return "x_1";
  return key;
}

/** Render a template with sample values (mirrors engine renderChunk collapse). */
export function previewChunkTemplate(template: string): string {
  const text = template.replace(PLACEHOLDER, (_m, key: string) =>
    sampleForKey(String(key).trim()),
  );
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Unique placeholders in a template, in appearance order. */
export function extractTemplateTokens(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = String(match[1] ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Suggested insert tokens from a rule's table / watched columns. */
export function suggestedTokens(rule: {
  table?: string;
  when?: { columns_changed?: string[] };
}): string[] {
  const cols = rule.when?.columns_changed ?? [];
  const tokens = ["id", "timestamp", "table"];
  for (const col of cols) {
    tokens.push(col, `before.${col}`, `after.${col}`);
  }
  return [...new Set(tokens)];
}

export function truncateTemplate(template: string, max = 72): string {
  const oneLine = template.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export function insertTokenAtCursor(
  value: string,
  token: string,
  selectionStart: number,
  selectionEnd: number,
): { next: string; cursor: number } {
  const insert = `{{${token}}}`;
  const next =
    value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
  return { next, cursor: selectionStart + insert.length };
}
