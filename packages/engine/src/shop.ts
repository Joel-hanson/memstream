/** In-memory + Cockroach demo shop. */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { withClientObjects } from "./db.js";

export class ShopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopError";
  }
}

export interface ShopActionResult {
  message: string;
  cdcPath?: string;
}

type JsonRow = Record<string, unknown>;

export interface PlaceOrderInput {
  sku: string;
  quantity?: number;
  customerId?: string;
}

export interface OpenTicketInput {
  orderId: string;
  body?: string;
  status?: string;
}

export interface AddCaseNoteInput {
  body: string;
  author?: string;
  orderId?: string | null;
  ticketId?: string | null;
}

export interface SetUserRoleInput {
  userId: string;
  role: string;
}

const CUSTOMER_NAMES: Record<string, string> = {
  c1: "Alex",
  c2: "Sam",
};

function customerName(customerId: string): string {
  return CUSTOMER_NAMES[customerId] ?? customerId;
}

/** Name plus id so agents don't mix this Alex up with another. */
function customerMemoryLabel(customerId: string): string {
  const name = CUSTOMER_NAMES[customerId];
  return name ? `${name} (${customerId})` : customerId;
}

function nextTicketId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^t-(\d+)$/i.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `t-${max + 1}`;
}

function nextCaseNoteId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^n-(\d+)$/i.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `n-${max + 1}`;
}

function defaultTicketBody(order: JsonRow): string {
  const customerId = String(order.customer_id ?? "");
  const customer = customerMemoryLabel(customerId);
  const sku =
    order.sku != null && String(order.sku).trim()
      ? String(order.sku)
      : "the item";
  const orderId = String(order.id);
  const base = `${customer} reports ${sku} arrived damaged after order ${orderId} shipped - please investigate.`;
  // Alex's known weekday unavailability (from order 90 history) auto-schedules
  // pickup for the weekend — demo hook for a stale-preference correction.
  if (customerId === "c1") {
    return `${base} Pickup scheduled for the weekend, since ${customer} is usually away on weekdays.`;
  }
  return base;
}

export interface Shop {
  readonly backend: string;
  listOrders(): Promise<JsonRow[]> | JsonRow[];
  listStock(): Promise<JsonRow[]> | JsonRow[];
  listTickets(): Promise<JsonRow[]> | JsonRow[];
  listCaseNotes(): Promise<JsonRow[]> | JsonRow[];
  listUsers(): Promise<JsonRow[]> | JsonRow[];
  shipOrder(orderId: string): Promise<ShopActionResult> | ShopActionResult;
  setStock(sku: string, quantity: number): Promise<ShopActionResult> | ShopActionResult;
  adjustStock(sku: string, delta: number): Promise<ShopActionResult> | ShopActionResult;
  placeOrder(input: PlaceOrderInput): Promise<ShopActionResult> | ShopActionResult;
  openTicket(input: OpenTicketInput): Promise<ShopActionResult> | ShopActionResult;
  addCaseNote(input: AddCaseNoteInput): Promise<ShopActionResult & { noteId?: string }> | (ShopActionResult & { noteId?: string });
  setUserRole(input: SetUserRoleInput): Promise<ShopActionResult> | ShopActionResult;
  listCdcFiles():
    | Promise<{ path: string; preview: string }[]>
    | { path: string; preview: string }[];
}

function nextOrderId(existingIds: string[]): string {
  let max = 100;
  for (const id of existingIds) {
    const n = Number(id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

function normalizePlaceOrder(input: PlaceOrderInput): {
  sku: string;
  quantity: number;
  customerId: string;
} {
  const sku = input.sku.trim();
  if (!sku) throw new ShopError("sku required");
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new ShopError("quantity must be a positive integer");
  }
  const customerId = (input.customerId || "c1").trim() || "c1";
  return { sku, quantity, customerId };
}

function normalizeSetUserRole(input: SetUserRoleInput): {
  userId: string;
  role: string;
} {
  const userId = input.userId.trim();
  if (!userId) throw new ShopError("user id required");
  const role = input.role.trim().toLowerCase();
  if (!role) throw new ShopError("role required");
  return { userId, role };
}

function asShopError(err: unknown, fallback: string): never {
  if (err instanceof ShopError) throw err;
  const detail =
    err instanceof Error && err.message.trim() ? err.message.trim() : fallback;
  throw new ShopError(detail);
}

export function emitCdcFile(
  cdcDir: string,
  options: {
    table: string;
    before: JsonRow;
    after: JsonRow;
    key: JsonRow;
  },
): string {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const record = {
    table: options.table,
    key: options.key,
    before: options.before,
    after: options.after,
    timestamp: ts,
  };
  const folder = join(cdcDir, options.table);
  mkdirSync(folder, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  const path = join(
    folder,
    `${stamp}-${randomBytes(4).toString("hex")}.ndjson`,
  );
  writeFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
  return path;
}

export function listCdcFiles(
  cdcDir: string,
  limit = 20,
): { path: string; preview: string }[] {
  try {
    if (!statSync(cdcDir).isDirectory()) return [];
  } catch {
    return [];
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".ndjson")) files.push(full);
    }
  };
  walk(cdcDir);
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files.slice(0, limit).map((path) => ({
    path: relative(cdcDir, path).replace(/\\/g, "/"),
    preview: readFileSync(path, "utf-8").slice(0, 240),
  }));
}

export class InMemoryShop implements Shop {
  readonly cdcDir: string;
  readonly backend = "memory";
  orders: Record<string, JsonRow> = {};
  stock: Record<string, JsonRow> = {};
  tickets: Record<string, JsonRow> = {};
  caseNotes: Record<string, JsonRow> = {};
  users: Record<string, JsonRow> = {};

  constructor(cdcDir: string) {
    this.cdcDir = cdcDir;
  }

  seed(): void {
    this.orders = {
      "90": {
        id: "90",
        customer_id: "c1",
        status: "shipped",
        note: "Shipped 1× SKU-12 for Alex (c1)",
        sku: "SKU-12",
        quantity: 1,
      },
      "100": {
        id: "100",
        customer_id: "c1",
        status: "pending",
        note: null,
        sku: "SKU-12",
        quantity: 1,
      },
      "101": {
        id: "101",
        customer_id: "c2",
        status: "pending",
        note: null,
        sku: "SKU-99",
        quantity: 1,
      },
    };
    this.stock = {
      "SKU-12": { sku: "SKU-12", warehouse_id: "east", quantity: 40 },
      "SKU-21": { sku: "SKU-21", warehouse_id: "east", quantity: 18 },
      "SKU-34": { sku: "SKU-34", warehouse_id: "west", quantity: 12 },
      "SKU-99": { sku: "SKU-99", warehouse_id: "west", quantity: 10 },
    };
    this.tickets = {
      "t-90": {
        id: "t-90",
        order_id: "90",
        status: "closed",
        body: "Alex (c1) reported late delivery on Field Lamp order 90 after asking for weekend delivery since they're away on weekdays; shipping credit issued and case closed.",
      },
    };
    this.caseNotes = {
      "n-89": {
        id: "n-89",
        order_id: "90",
        ticket_id: "t-90",
        author: "staff",
        body: "Alex (c1) mentioned they're away Monday-Friday for work and can only receive or hand off packages on weekends; that's why the order 90 redelivery moved to Saturday. Noting for future scheduling.",
      },
      "n-90": {
        id: "n-90",
        order_id: "90",
        ticket_id: "t-90",
        author: "staff",
        body: "Follow-up with Alex (c1) on late Field Lamp order 90 — shipping credit issued; case closed. Resume only if a new ticket opens.",
      },
    };
    this.users = {
      u1: {
        id: "u1",
        org_id: "org-acme",
        email: "admin@acme.test",
        role: "member",
      },
      u2: {
        id: "u2",
        org_id: "org-acme",
        email: "boss@acme.test",
        role: "owner",
      },
    };
  }

  listOrders(): JsonRow[] {
    return Object.values(this.orders).sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
  }

  listStock(): JsonRow[] {
    return Object.values(this.stock).sort((a, b) =>
      String(a.sku).localeCompare(String(b.sku)),
    );
  }

  listTickets(): JsonRow[] {
    return Object.values(this.tickets).sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
  }

  listCaseNotes(): JsonRow[] {
    return Object.values(this.caseNotes).sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
  }

  listUsers(): JsonRow[] {
    return Object.values(this.users).sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
  }

  shipOrder(orderId: string): ShopActionResult {
    const order = this.orders[orderId];
    if (!order) throw new ShopError(`unknown order: ${orderId}`);
    if (String(order.status) === "shipped") {
      throw new ShopError(`order ${orderId} is already shipped`);
    }
    const before = { ...order };
    order.status = "shipped";
    const sku =
      order.sku != null && String(order.sku).trim()
        ? String(order.sku)
        : null;
    const qty =
      order.quantity != null && order.quantity !== ""
        ? Number(order.quantity)
        : null;
    const who = customerMemoryLabel(String(order.customer_id ?? ""));
    order.note =
      sku && qty != null && Number.isFinite(qty)
        ? `Shipped ${qty}× ${sku} for ${who}`
        : `Shipped for ${who}`;
    const after = { ...order };
    const cdcPath = emitCdcFile(this.cdcDir, {
      table: "orders",
      before,
      after,
      key: { id: orderId },
    });
    return { message: `Shipped order ${orderId}`, cdcPath };
  }

  setStock(sku: string, quantity: number): ShopActionResult {
    const row = this.stock[sku];
    if (!row) throw new ShopError(`unknown sku: ${sku}`);
    if (quantity < 0) throw new ShopError("quantity must be >= 0");
    const before = { ...row };
    row.quantity = quantity;
    const after = { ...row };
    const cdcPath = emitCdcFile(this.cdcDir, {
      table: "stock",
      before,
      after,
      key: { sku },
    });
    return { message: `Stock ${sku} set to ${quantity}`, cdcPath };
  }

  adjustStock(sku: string, delta: number): ShopActionResult {
    const row = this.stock[sku];
    if (!row) throw new ShopError(`unknown sku: ${sku}`);
    const next = Number(row.quantity) + delta;
    if (next < 0) {
      throw new ShopError(
        `not enough stock for ${sku}: cannot subtract ${Math.abs(delta)} from ${row.quantity}`,
      );
    }
    return this.setStock(sku, next);
  }

  placeOrder(input: PlaceOrderInput): ShopActionResult {
    const { sku, quantity, customerId } = normalizePlaceOrder(input);
    const stock = this.stock[sku];
    if (!stock) throw new ShopError(`unknown sku: ${sku}`);
    const available = Number(stock.quantity);
    if (available < quantity) {
      throw new ShopError(
        `not enough stock for ${sku}: need ${quantity}, have ${available}`,
      );
    }

    const stockBefore = { ...stock };
    stock.quantity = available - quantity;
    const stockAfter = { ...stock };
    const stockCdc = emitCdcFile(this.cdcDir, {
      table: "stock",
      before: stockBefore,
      after: stockAfter,
      key: { sku },
    });

    const id = nextOrderId(Object.keys(this.orders));
    const order: JsonRow = {
      id,
      customer_id: customerId,
      status: "pending",
      note: null,
      sku,
      quantity,
    };
    this.orders[id] = order;
    const orderCdc = emitCdcFile(this.cdcDir, {
      table: "orders",
      before: {},
      after: order,
      key: { id },
    });

    return {
      message: `Placed order ${id} for ${quantity}× ${sku} (stock now ${stock.quantity})`,
      cdcPath: orderCdc || stockCdc,
    };
  }

  openTicket(input: OpenTicketInput): ShopActionResult {
    const orderId = input.orderId.trim();
    if (!orderId) throw new ShopError("order_id required");
    const order = this.orders[orderId];
    if (!order) throw new ShopError(`unknown order: ${orderId}`);
    if (String(order.status) !== "shipped") {
      throw new ShopError(`ship order ${orderId} before opening a ticket`);
    }
    const status = (input.status || "open").trim() || "open";
    const body = (input.body || "").trim() || defaultTicketBody(order);
    const id = nextTicketId(Object.keys(this.tickets));
    const ticket: JsonRow = {
      id,
      order_id: orderId,
      status,
      body,
    };
    this.tickets[id] = ticket;
    const cdcPath = emitCdcFile(this.cdcDir, {
      table: "tickets",
      before: {},
      after: ticket,
      key: { id },
    });
    return {
      message: `Opened ticket ${id} for order ${orderId}`,
      cdcPath,
    };
  }

  addCaseNote(input: AddCaseNoteInput): ShopActionResult & { noteId: string } {
    const body = input.body.trim();
    if (!body) throw new ShopError("case note body required");
    const author = (input.author || "agent").trim() || "agent";
    const orderId = input.orderId?.trim() || null;
    const ticketId = input.ticketId?.trim() || null;
    if (orderId && !this.orders[orderId]) {
      throw new ShopError(`unknown order: ${orderId}`);
    }
    const id = nextCaseNoteId(Object.keys(this.caseNotes));
    const note: JsonRow = {
      id,
      order_id: orderId,
      ticket_id: ticketId,
      author,
      body,
    };
    this.caseNotes[id] = note;
    const cdcPath = emitCdcFile(this.cdcDir, {
      table: "case_notes",
      before: {},
      after: note,
      key: { id },
    });
    return {
      message: `Saved case note ${id}`,
      cdcPath,
      noteId: id,
    };
  }

  setUserRole(input: SetUserRoleInput): ShopActionResult {
    const { userId, role } = normalizeSetUserRole(input);
    const user = this.users[userId];
    if (!user) throw new ShopError(`unknown user: ${userId}`);
    const beforeRole = String(user.role);
    if (beforeRole === role) {
      throw new ShopError(`user ${userId} already has role ${role}`);
    }
    const before = { ...user };
    user.role = role;
    const after = { ...user };
    const cdcPath = emitCdcFile(this.cdcDir, {
      table: "users",
      before,
      after,
      key: { id: userId },
    });
    return {
      message: `User ${userId} (${String(user.email)}) role ${beforeRole} → ${role}`,
      cdcPath,
    };
  }

  listCdcFiles(): { path: string; preview: string }[] {
    return listCdcFiles(this.cdcDir);
  }
}

export class CockroachShop implements Shop {
  readonly backend = "cockroach";
  readonly conninfo: string;
  readonly cdcDir: string | null;
  readonly alsoEmitLocal: boolean;
  private ready: Promise<void> | null = null;

  constructor(options: {
    conninfo: string;
    cdcDir?: string;
    alsoEmitLocal?: boolean;
  }) {
    this.conninfo = options.conninfo;
    this.cdcDir = options.cdcDir ?? null;
    this.alsoEmitLocal = Boolean(options.alsoEmitLocal && options.cdcDir);
  }

  /** Migrate demo columns / seed so place-order works on older clusters. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = withClientObjects(this.conninfo, async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS customers (
            id STRING PRIMARY KEY,
            name STRING NOT NULL
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS orders (
            id STRING PRIMARY KEY,
            customer_id STRING NOT NULL,
            status STRING NOT NULL,
            note STRING NULL,
            sku STRING NULL,
            quantity INT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS stock (
            sku STRING PRIMARY KEY,
            warehouse_id STRING NOT NULL,
            quantity INT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS tickets (
            id STRING PRIMARY KEY,
            order_id STRING NULL,
            status STRING NOT NULL,
            body STRING NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS case_notes (
            id STRING PRIMARY KEY,
            order_id STRING NULL,
            ticket_id STRING NULL,
            author STRING NOT NULL,
            body STRING NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id STRING PRIMARY KEY,
            org_id STRING NOT NULL,
            email STRING NOT NULL,
            role STRING NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await client.query(
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku STRING NULL`,
        );
        await client.query(
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INT NULL`,
        );
        await client.query(`
          INSERT INTO customers (id, name) VALUES
            ('c1', 'Alex'),
            ('c2', 'Sam')
          ON CONFLICT (id) DO NOTHING`);
        await client.query(`
          UPDATE customers SET name = 'Alex' WHERE id = 'c1' AND name IN ('Acme', 'c1')`);
        await client.query(`
          UPDATE customers SET name = 'Sam' WHERE id = 'c2' AND name IN ('Globex', 'c2')`);
        await client.query(`
          INSERT INTO stock (sku, warehouse_id, quantity) VALUES
            ('SKU-12', 'east', 40),
            ('SKU-21', 'east', 18),
            ('SKU-34', 'west', 12),
            ('SKU-99', 'west', 10)
          ON CONFLICT (sku) DO NOTHING`);
        await client.query(`
          INSERT INTO orders (id, customer_id, status, sku, quantity, note) VALUES
            ('90', 'c1', 'shipped', 'SKU-12', 1, 'Shipped 1× SKU-12 for Alex (c1)'),
            ('100', 'c1', 'pending', 'SKU-12', 1, NULL),
            ('101', 'c2', 'pending', 'SKU-99', 1, NULL)
          ON CONFLICT (id) DO NOTHING`);
        await client.query(`
          INSERT INTO tickets (id, order_id, status, body) VALUES
            (
              't-90',
              '90',
              'closed',
              'Alex (c1) reported late delivery on Field Lamp order 90 after asking for weekend delivery since they''re away on weekdays; shipping credit issued and case closed.'
            )
          ON CONFLICT (id) DO NOTHING`);
        await client.query(`
          INSERT INTO case_notes (id, order_id, ticket_id, author, body) VALUES
            (
              'n-89',
              '90',
              't-90',
              'staff',
              'Alex (c1) mentioned they''re away Monday-Friday for work and can only receive or hand off packages on weekends; that''s why the order 90 redelivery moved to Saturday. Noting for future scheduling.'
            ),
            (
              'n-90',
              '90',
              't-90',
              'staff',
              'Follow-up with Alex (c1) on late Field Lamp order 90 — shipping credit issued; case closed. Resume only if a new ticket opens.'
            )
          ON CONFLICT (id) DO NOTHING`);
        await client.query(`
          INSERT INTO users (id, org_id, email, role) VALUES
            ('u1', 'org-acme', 'admin@acme.test', 'member'),
            ('u2', 'org-acme', 'boss@acme.test', 'owner')
          ON CONFLICT (id) DO NOTHING`);
      }).catch((err) => {
        this.ready = null;
        asShopError(err, "failed to prepare shop schema");
      });
    }
    return this.ready;
  }

  async listOrders(): Promise<JsonRow[]> {
    await this.ensureReady();
    try {
      return await withClientObjects(this.conninfo, async (client) => {
        const result = await client.query(
          "SELECT id, customer_id, status, note, sku, quantity FROM orders ORDER BY id",
        );
        return result.rows;
      });
    } catch (err) {
      asShopError(err, "failed to list orders");
    }
  }

  async listStock(): Promise<JsonRow[]> {
    await this.ensureReady();
    try {
      return await withClientObjects(this.conninfo, async (client) => {
        const result = await client.query(
          "SELECT sku, warehouse_id, quantity FROM stock ORDER BY sku",
        );
        return result.rows;
      });
    } catch (err) {
      asShopError(err, "failed to list stock");
    }
  }

  async listTickets(): Promise<JsonRow[]> {
    await this.ensureReady();
    try {
      return await withClientObjects(this.conninfo, async (client) => {
        const result = await client.query(
          "SELECT id, order_id, status, body FROM tickets ORDER BY id",
        );
        return result.rows;
      });
    } catch (err) {
      asShopError(err, "failed to list tickets");
    }
  }

  async listCaseNotes(): Promise<JsonRow[]> {
    await this.ensureReady();
    try {
      return await withClientObjects(this.conninfo, async (client) => {
        const result = await client.query(
          "SELECT id, order_id, ticket_id, author, body FROM case_notes ORDER BY id",
        );
        return result.rows;
      });
    } catch (err) {
      asShopError(err, "failed to list case notes");
    }
  }

  async listUsers(): Promise<JsonRow[]> {
    await this.ensureReady();
    try {
      return await withClientObjects(this.conninfo, async (client) => {
        const result = await client.query(
          "SELECT id, org_id, email, role FROM users ORDER BY id",
        );
        return result.rows;
      });
    } catch (err) {
      asShopError(err, "failed to list users");
    }
  }

  private async getOrder(orderId: string): Promise<JsonRow> {
    const rows = await withClientObjects(this.conninfo, async (client) => {
      const result = await client.query(
        "SELECT id, customer_id, status, note, sku, quantity FROM orders WHERE id = $1",
        [orderId],
      );
      return result.rows;
    });
    if (!rows[0]) throw new ShopError(`unknown order: ${orderId}`);
    return rows[0];
  }

  private async getStock(sku: string): Promise<JsonRow> {
    const rows = await withClientObjects(this.conninfo, async (client) => {
      const result = await client.query(
        "SELECT sku, warehouse_id, quantity FROM stock WHERE sku = $1",
        [sku],
      );
      return result.rows;
    });
    if (!rows[0]) throw new ShopError(`unknown sku: ${sku}`);
    return rows[0];
  }

  async shipOrder(orderId: string): Promise<ShopActionResult> {
    await this.ensureReady();
    try {
      const before = await this.getOrder(orderId);
      if (String(before.status) === "shipped") {
        throw new ShopError(`order ${orderId} is already shipped`);
      }
      const sku =
        before.sku != null && String(before.sku).trim()
          ? String(before.sku)
          : null;
      const qty =
        before.quantity != null && before.quantity !== ""
          ? Number(before.quantity)
          : null;
      const who = customerMemoryLabel(String(before.customer_id ?? ""));
      const note =
        sku && qty != null && Number.isFinite(qty)
          ? `Shipped ${qty}× ${sku} for ${who}`
          : `Shipped for ${who}`;
      await withClientObjects(this.conninfo, async (client) => {
        await client.query(
          "UPDATE orders SET status = $1, note = $2, updated_at = now() WHERE id = $3",
          ["shipped", note, orderId],
        );
      });
      const after = await this.getOrder(orderId);
      let cdcPath: string | undefined;
      if (this.alsoEmitLocal && this.cdcDir) {
        cdcPath = emitCdcFile(this.cdcDir, {
          table: "orders",
          before,
          after,
          key: { id: orderId },
        });
      }
      return { message: `Shipped order ${orderId} in Cockroach`, cdcPath };
    } catch (err) {
      asShopError(err, "failed to ship order");
    }
  }

  async setStock(sku: string, quantity: number): Promise<ShopActionResult> {
    await this.ensureReady();
    try {
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        throw new ShopError("quantity must be an integer >= 0");
      }
      const before = await this.getStock(sku);
      await withClientObjects(this.conninfo, async (client) => {
        await client.query(
          "UPDATE stock SET quantity = $1, updated_at = now() WHERE sku = $2",
          [quantity, sku],
        );
      });
      const after = await this.getStock(sku);
      let cdcPath: string | undefined;
      if (this.alsoEmitLocal && this.cdcDir) {
        cdcPath = emitCdcFile(this.cdcDir, {
          table: "stock",
          before,
          after,
          key: { sku },
        });
      }
      return { message: `Stock ${sku} set to ${quantity} in Cockroach`, cdcPath };
    } catch (err) {
      asShopError(err, "failed to update stock");
    }
  }

  async adjustStock(sku: string, delta: number): Promise<ShopActionResult> {
    await this.ensureReady();
    try {
      const d = Math.trunc(Number(delta));
      if (!Number.isFinite(d) || d === 0) {
        throw new ShopError("delta must be a non-zero integer");
      }
      const before = await this.getStock(sku);
      const next = Number(before.quantity) + d;
      if (next < 0) {
        throw new ShopError(
          `not enough stock for ${sku}: cannot subtract ${Math.abs(d)} from ${before.quantity}`,
        );
      }
      return await this.setStock(sku, next);
    } catch (err) {
      asShopError(err, "failed to adjust stock");
    }
  }

  async placeOrder(input: PlaceOrderInput): Promise<ShopActionResult> {
    await this.ensureReady();
    try {
      const { sku, quantity, customerId } = normalizePlaceOrder(input);

      const result = await withClientObjects(this.conninfo, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO customers (id, name) VALUES ($1, $2)
             ON CONFLICT (id) DO NOTHING`,
            [customerId, customerName(customerId)],
          );

          const locked = await client.query(
            "SELECT sku, warehouse_id, quantity FROM stock WHERE sku = $1 FOR UPDATE",
            [sku],
          );
          const row = locked.rows[0] as JsonRow | undefined;
          if (!row) throw new ShopError(`unknown sku: ${sku}`);
          const have = Number(row.quantity);
          if (have < quantity) {
            throw new ShopError(
              `not enough stock for ${sku}: need ${quantity}, have ${have}`,
            );
          }
          const remaining = have - quantity;
          await client.query(
            "UPDATE stock SET quantity = $1, updated_at = now() WHERE sku = $2",
            [remaining, sku],
          );

          const ids = await client.query("SELECT id FROM orders");
          const orderId = nextOrderId(
            (ids.rows as JsonRow[]).map((r) => String(r.id)),
          );
          await client.query(
            `INSERT INTO orders (id, customer_id, status, sku, quantity, updated_at)
             VALUES ($1, $2, 'pending', $3, $4, now())`,
            [orderId, customerId, sku, quantity],
          );
          await client.query("COMMIT");
          return {
            orderId,
            remaining,
            stockBefore: row,
            stockAfter: { ...row, quantity: remaining },
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore rollback errors */
          }
          throw err;
        }
      });

      let cdcPath: string | undefined;
      if (this.alsoEmitLocal && this.cdcDir) {
        emitCdcFile(this.cdcDir, {
          table: "stock",
          before: result.stockBefore,
          after: result.stockAfter,
          key: { sku },
        });
        const orderAfter = await this.getOrder(result.orderId);
        cdcPath = emitCdcFile(this.cdcDir, {
          table: "orders",
          before: {},
          after: orderAfter,
          key: { id: result.orderId },
        });
      }

      return {
        message: `Placed order ${result.orderId} for ${quantity}× ${sku} (stock now ${result.remaining})`,
        cdcPath,
      };
    } catch (err) {
      asShopError(err, "failed to place order");
    }
  }

  async openTicket(input: OpenTicketInput): Promise<ShopActionResult> {
    await this.ensureReady();
    try {
      const orderId = input.orderId.trim();
      if (!orderId) throw new ShopError("order_id required");
      const order = await this.getOrder(orderId);
      if (String(order.status) !== "shipped") {
        throw new ShopError(`ship order ${orderId} before opening a ticket`);
      }
      const status = (input.status || "open").trim() || "open";
      const body = (input.body || "").trim() || defaultTicketBody(order);

      const ticket = await withClientObjects(this.conninfo, async (client) => {
        const ids = await client.query("SELECT id FROM tickets");
        const id = nextTicketId(
          (ids.rows as JsonRow[]).map((r) => String(r.id)),
        );
        await client.query(
          `INSERT INTO tickets (id, order_id, status, body, updated_at)
           VALUES ($1, $2, $3, $4, now())`,
          [id, orderId, status, body],
        );
        return { id, order_id: orderId, status, body };
      });

      let cdcPath: string | undefined;
      if (this.alsoEmitLocal && this.cdcDir) {
        cdcPath = emitCdcFile(this.cdcDir, {
          table: "tickets",
          before: {},
          after: ticket,
          key: { id: ticket.id },
        });
      }

      return {
        message: `Opened ticket ${ticket.id} for order ${orderId} in Cockroach`,
        cdcPath,
      };
    } catch (err) {
      asShopError(err, "failed to open ticket");
    }
  }

  async addCaseNote(
    input: AddCaseNoteInput,
  ): Promise<ShopActionResult & { noteId: string }> {
    await this.ensureReady();
    try {
      const body = input.body.trim();
      if (!body) throw new ShopError("case note body required");
      const author = (input.author || "agent").trim() || "agent";
      const orderId = input.orderId?.trim() || null;
      const ticketId = input.ticketId?.trim() || null;

      const note = await withClientObjects(this.conninfo, async (client) => {
        if (orderId) {
          const found = await client.query(
            "SELECT id FROM orders WHERE id = $1",
            [orderId],
          );
          if (!found.rows[0]) throw new ShopError(`unknown order: ${orderId}`);
        }
        const ids = await client.query("SELECT id FROM case_notes");
        const id = nextCaseNoteId(
          (ids.rows as JsonRow[]).map((r) => String(r.id)),
        );
        await client.query(
          `INSERT INTO case_notes (id, order_id, ticket_id, author, body, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [id, orderId, ticketId, author, body],
        );
        return {
          id,
          order_id: orderId,
          ticket_id: ticketId,
          author,
          body,
        };
      });

      let cdcPath: string | undefined;
      if (this.alsoEmitLocal && this.cdcDir) {
        cdcPath = emitCdcFile(this.cdcDir, {
          table: "case_notes",
          before: {},
          after: note,
          key: { id: note.id },
        });
      }

      return {
        message: `Saved case note ${note.id} in Cockroach`,
        cdcPath,
        noteId: note.id,
      };
    } catch (err) {
      asShopError(err, "failed to save case note");
    }
  }

  async setUserRole(input: SetUserRoleInput): Promise<ShopActionResult> {
    await this.ensureReady();
    const { userId, role } = normalizeSetUserRole(input);
    try {
      const result = await withClientObjects(this.conninfo, async (client) => {
        const found = await client.query(
          "SELECT id, org_id, email, role FROM users WHERE id = $1",
          [userId],
        );
        const row = found.rows[0];
        if (!row) throw new ShopError(`unknown user: ${userId}`);
        if (String(row.role) === role) {
          throw new ShopError(`user ${userId} already has role ${role}`);
        }
        const before: JsonRow = { ...row };
        await client.query(
          "UPDATE users SET role = $1, updated_at = now() WHERE id = $2",
          [role, userId],
        );
        const after: JsonRow = { ...row, role };
        return { before, after };
      });

      const cdcPath = this.cdcDir
        ? emitCdcFile(this.cdcDir, {
            table: "users",
            before: result.before,
            after: result.after,
            key: { id: userId },
          })
        : undefined;

      return {
        message: `User ${userId} (${String(result.after.email)}) role ${String(result.before.role)} → ${role}`,
        cdcPath,
      };
    } catch (err) {
      asShopError(err, "failed to set user role");
    }
  }

  listCdcFiles(): { path: string; preview: string }[] {
    if (!this.cdcDir) return [];
    return listCdcFiles(this.cdcDir);
  }
}

const shopKey = "__memstreamShop_v4";

export function getShop(options?: {
  cdcDir?: string;
  databaseUrl?: string;
  backend?: "memory" | "cockroach";
  alsoEmitLocal?: boolean;
}): Shop {
  const cdcDir = options?.cdcDir || "data/cdc/inbox";
  const databaseUrl =
    options?.databaseUrl?.trim() || process.env.DATABASE_URL?.trim() || "";
  const backend =
    options?.backend ||
    (process.env.SHOP_BACKEND as "memory" | "cockroach" | undefined) ||
    "memory";
  const alsoEmitLocal =
    options?.alsoEmitLocal ?? process.env.SHOP_ALSO_EMIT_LOCAL === "true";

  const g = globalThis as typeof globalThis & {
    [shopKey]?: Shop & { _key?: string };
  };
  const key = `${backend}:${databaseUrl ? "db" : "nodb"}:${cdcDir}`;
  const cached = g[shopKey];
  if (
    cached?._key === key &&
    typeof cached.listUsers === "function" &&
    typeof cached.setUserRole === "function" &&
    typeof cached.addCaseNote === "function" &&
    typeof cached.listCaseNotes === "function"
  ) {
    return cached;
  }

  let shop: Shop & { _key?: string };
  if (backend === "cockroach" && databaseUrl) {
    shop = new CockroachShop({
      conninfo: databaseUrl,
      cdcDir,
      alsoEmitLocal,
    }) as Shop & { _key?: string };
  } else {
    const mem = new InMemoryShop(cdcDir);
    mem.seed();
    shop = mem as Shop & { _key?: string };
  }
  shop._key = key;
  g[shopKey] = shop;
  return shop;
}
