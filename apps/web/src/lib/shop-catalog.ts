/** Demo storefront catalog — human names for shop SKUs. */

export const STORE = {
  name: "Acme Supply",
  tagline: "Lamps for the desk and the road.",
  customer: "Alex",
} as const;

export type CatalogProduct = {
  sku: string;
  name: string;
  blurb: string;
  accent: string;
  /** Visual variant for tile art. */
  lamp: "field" | "studio" | "harbor" | "mug";
  /** Featured in the main shop grid. */
  featured?: boolean;
};

/** Shop grid — lamps first; mug stays buyable but secondary. */
export const SHOP_PRODUCTS: CatalogProduct[] = [
  {
    sku: "SKU-12",
    name: "Field Lamp",
    blurb: "Ceramic base, linen shade, warm glow.",
    accent: "oklch(0.86 0.04 75)",
    lamp: "field",
    featured: true,
  },
  {
    sku: "SKU-21",
    name: "Studio Lamp",
    blurb: "Adjustable arm for late edits.",
    accent: "oklch(0.88 0.02 240)",
    lamp: "studio",
    featured: true,
  },
  {
    sku: "SKU-34",
    name: "Harbor Lamp",
    blurb: "Compact brass for small desks.",
    accent: "oklch(0.84 0.05 55)",
    lamp: "harbor",
    featured: true,
  },
  {
    sku: "SKU-99",
    name: "Travel Mug",
    blurb: "Double-wall steel for long hauls.",
    accent: "oklch(0.78 0.03 240)",
    lamp: "mug",
  },
];

export const CATALOG: Record<string, CatalogProduct> = Object.fromEntries(
  SHOP_PRODUCTS.map((p) => [p.sku, p]),
);

export function productForSku(sku: string | null | undefined): CatalogProduct {
  const key = (sku || "").trim();
  if (key && CATALOG[key]) return CATALOG[key];
  return {
    sku: key || "SKU",
    name: key || "Item",
    blurb: "In stock at Acme Supply.",
    accent: "oklch(0.7 0.02 50)",
    lamp: "field",
  };
}

export const DEMO_ASK_PROMPT = `Why is Alex upset about SKU-12?
1) Call Memstream search_memory first and cite the chunks (include prior order 90 / late delivery if present).
2) Then use Cockroach Cloud MCP SQL to confirm the live order 100 status, SKU-12 stock, and any ticket for that order.
Answer in 3 short bullets: what happened, what memory shows, what SQL confirms.`;

export const STOCK_SIMILARITY_ASK = `Have we seen stock drops like SKU-12 before?
1) Call Memstream search_memory and cite similar inventory chunks.
2) Then use Cockroach Cloud MCP SQL to confirm current SKU-12 quantity in stock.
Answer in 2 short bullets: what memory shows, what SQL confirms.`;

export const ROLE_CHANGE_ASK = `Did anyone get a privilege change in org-acme?
1) Call Memstream search_memory first and cite the role-change chunks.
2) Then use Cockroach Cloud MCP SQL to confirm user u1 (admin@acme.test) current role.
Answer in 2 short bullets: what memory shows, what SQL confirms.`;

export const RESUME_ASK = `Where did we leave off on Alex's Field Lamp case?
1) Call Memstream search_memory and cite prior handoffs / tickets (order 90 and order 100).
2) Confirm live SQL on orders, tickets, and case_notes.
Answer in 3 short bullets: last handoff, what memory shows, what SQL confirms.`;

/** Customer Support — natural shopper language (not analyst phrasing). */
export const SUPPORT_SUGGESTIONS = [
  "Where is my Field Lamp order?",
  "My lamp arrived damaged — what's going on?",
  "Did you get my damage report?",
] as const;

/**
 * Staff Agent — analytical asks that show memory + SQL (the Memstream pitch).
 * Same backend as Support; different persona and prompts.
 */
export const STAFF_AGENT_SUGGESTIONS = [
  "Why is Alex upset about the Field Lamp?",
  "Where did we leave off on Alex's Field Lamp case?",
  "Have we seen stock drops like SKU-12 before?",
] as const;
