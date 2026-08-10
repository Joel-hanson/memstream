/** Thin orgs + invite codes for SaaS entry (no full login yet). */

import { randomBytes } from "node:crypto";
import { withClientObjects } from "./db.js";
import {
  ensureMemstreamSchema,
  findRepoRoot,
  memstreamDatabaseUrl,
} from "./runs.js";

const ORG_ID_RE = /^org_[a-zA-Z0-9]{8,32}$/;
const INVITE_RE = /^inv_[a-zA-Z0-9_-]{8,48}$/;
const NAME_MAX = 80;

export type MemstreamOrg = {
  id: string;
  name: string;
  created_at: string | null;
};

export type MemstreamOrgInvite = {
  code: string;
  org_id: string;
  label: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string | null;
};

function requirePlatformUrl(root: string): string {
  const url = memstreamDatabaseUrl(root);
  if (!url) {
    throw new Error("MEMSTREAM_DATABASE_URL required for orgs");
  }
  return url;
}

function newOrgId(): string {
  return `org_${randomBytes(8).toString("hex")}`;
}

function newInviteCode(): string {
  return `inv_${randomBytes(9).toString("base64url")}`;
}

function normalizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("org name required");
  if (trimmed.length > NAME_MAX) {
    throw new Error(`org name max ${NAME_MAX} characters`);
  }
  return trimmed;
}

export async function createOrg(options: {
  name: string;
  root?: string;
}): Promise<MemstreamOrg> {
  const root = options.root ?? findRepoRoot();
  const name = normalizeName(options.name);
  const id = newOrgId();
  const url = requirePlatformUrl(root);
  await ensureMemstreamSchema(root);

  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      INSERT INTO memstream_orgs (id, name, created_at)
      VALUES ($1, $2, now())
      RETURNING id, name, created_at::text AS created_at
      `,
      [id, name],
    );
    const row = result.rows[0]!;
    return {
      id: String(row.id),
      name: String(row.name),
      created_at: row.created_at != null ? String(row.created_at) : null,
    };
  });
}

export async function getOrg(
  orgId: string,
  root = findRepoRoot(),
): Promise<MemstreamOrg | null> {
  const id = orgId.trim();
  if (!id) return null;
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT id, name, created_at::text AS created_at
      FROM memstream_orgs WHERE id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      created_at: row.created_at != null ? String(row.created_at) : null,
    };
  });
}

export async function listOrgs(
  root = findRepoRoot(),
  limit = 50,
): Promise<MemstreamOrg[]> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return [];
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT id, name, created_at::text AS created_at
      FROM memstream_orgs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      created_at: row.created_at != null ? String(row.created_at) : null,
    }));
  });
}

export async function createOrgInvite(options: {
  orgId: string;
  label?: string | null;
  /** Hours until expiry (default 168 = 7 days). */
  ttlHours?: number;
  root?: string;
}): Promise<MemstreamOrgInvite> {
  const root = options.root ?? findRepoRoot();
  const orgId = options.orgId.trim();
  if (!ORG_ID_RE.test(orgId)) throw new Error("invalid org id");
  const org = await getOrg(orgId, root);
  if (!org) throw new Error("org not found");

  const ttl = Math.min(Math.max(options.ttlHours ?? 168, 1), 24 * 90);
  const code = newInviteCode();
  const url = requirePlatformUrl(root);

  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      INSERT INTO memstream_org_invites
        (code, org_id, label, expires_at, created_at)
      VALUES (
        $1, $2, $3,
        now() + ($4::int * INTERVAL '1 hour'),
        now()
      )
      RETURNING
        code, org_id, label,
        expires_at::text AS expires_at,
        redeemed_at::text AS redeemed_at,
        created_at::text AS created_at
      `,
      [code, orgId, options.label?.trim() || null, ttl],
    );
    const row = result.rows[0]!;
    return {
      code: String(row.code),
      org_id: String(row.org_id),
      label: row.label != null ? String(row.label) : null,
      expires_at: row.expires_at != null ? String(row.expires_at) : null,
      redeemed_at: row.redeemed_at != null ? String(row.redeemed_at) : null,
      created_at: row.created_at != null ? String(row.created_at) : null,
    };
  });
}

export async function redeemOrgInvite(options: {
  code: string;
  root?: string;
}): Promise<{ org: MemstreamOrg; invite: MemstreamOrgInvite }> {
  const root = options.root ?? findRepoRoot();
  const code = options.code.trim();
  if (!INVITE_RE.test(code)) throw new Error("invalid invite code");
  const url = requirePlatformUrl(root);
  await ensureMemstreamSchema(root);

  return withClientObjects(url, async (client) => {
    const found = await client.query(
      `
      SELECT
        i.code, i.org_id, i.label,
        i.expires_at::text AS expires_at,
        i.redeemed_at::text AS redeemed_at,
        i.created_at::text AS created_at,
        o.name AS org_name,
        o.created_at::text AS org_created_at
      FROM memstream_org_invites i
      JOIN memstream_orgs o ON o.id = i.org_id
      WHERE i.code = $1
      `,
      [code],
    );
    const row = found.rows[0];
    if (!row) throw new Error("invite not found");
    if (row.redeemed_at) throw new Error("invite already used");
    if (row.expires_at && Date.parse(String(row.expires_at)) < Date.now()) {
      throw new Error("invite expired");
    }

    await client.query(
      `UPDATE memstream_org_invites SET redeemed_at = now() WHERE code = $1`,
      [code],
    );

    return {
      org: {
        id: String(row.org_id),
        name: String(row.org_name),
        created_at:
          row.org_created_at != null ? String(row.org_created_at) : null,
      },
      invite: {
        code: String(row.code),
        org_id: String(row.org_id),
        label: row.label != null ? String(row.label) : null,
        expires_at: row.expires_at != null ? String(row.expires_at) : null,
        redeemed_at: new Date().toISOString(),
        created_at: row.created_at != null ? String(row.created_at) : null,
      },
    };
  });
}

export function isOrgId(value: string | null | undefined): boolean {
  return Boolean(value && ORG_ID_RE.test(value.trim()));
}

export function isInviteCode(value: string | null | undefined): boolean {
  return Boolean(value && INVITE_RE.test(value.trim()));
}
