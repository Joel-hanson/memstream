/**
 * Persistent memory profiles in the Memstream platform DB.
 * Files under profiles/ remain the git seed; runtime prefers Cockroach.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { withClientObjects } from "./db.js";
import {
  parseProfileYaml,
  ProfileError,
  profileIdFromRef,
  profilePathForId,
  type Profile,
} from "./profile.js";
import {
  ensureMemstreamSchema,
  findRepoRoot,
  memstreamDatabaseUrl,
} from "./runs.js";

const PROFILE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
/** Keep this many prior snapshots per profile (oldest pruned on save). */
export const PROFILE_VERSION_KEEP = 20;

export type StoredProfileInfo = {
  id: string;
  path: string;
  application: string;
  source: "builtin" | "user";
};

export type ProfileVersionInfo = {
  profile_id: string;
  version: number;
  application: string;
  source: string;
  created_at: string;
};

function requirePlatformUrl(root: string): string {
  const url = memstreamDatabaseUrl(root);
  if (!url) {
    throw new Error(
      "MEMSTREAM_DATABASE_URL required to store profiles in Cockroach",
    );
  }
  return url;
}

type ProfileSeed = { id: string; yamlText: string; application: string };

function loadProfileSeedsFromFiles(root: string): ProfileSeed[] {
  const profilesDir = join(root, "profiles");
  if (!existsSync(profilesDir)) return [];

  const seeds: ProfileSeed[] = [];
  for (const file of readdirSync(profilesDir).filter((f) =>
    f.endsWith(".yaml"),
  )) {
    const id = file.replace(/\.yaml$/, "");
    if (!PROFILE_ID_RE.test(id)) continue;
    const yamlText = readFileSync(join(profilesDir, file), "utf-8");
    let application = id;
    try {
      application = parseProfileYaml(yamlText).application || id;
    } catch {
      continue;
    }
    seeds.push({ id, yamlText, application });
  }
  return seeds;
}

/** Seed / refresh builtin profiles from profiles/*.yaml into the platform DB. */
export async function ensureProfilesSeeded(
  root = findRepoRoot(),
): Promise<number> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return 0;
  // Caller must have applied DDL (ensureMemstreamSchema). Do not call it here —
  // that would recurse when seeding from ensureMemstreamSchema.

  let seeded = 0;
  await withClientObjects(url, async (client) => {
    for (const seed of loadProfileSeedsFromFiles(root)) {
      const existing = await client.query(
        `SELECT source FROM memstream_profiles WHERE id = $1`,
        [seed.id],
      );
      const row = existing.rows[0] as { source?: string } | undefined;
      if (row?.source === "user") continue;

      await client.query(
        `INSERT INTO memstream_profiles (id, yaml, application, source, updated_at)
         VALUES ($1, $2, $3, 'builtin', now())
         ON CONFLICT (id) DO UPDATE SET
           yaml = EXCLUDED.yaml,
           application = EXCLUDED.application,
           source = 'builtin',
           updated_at = now()
         WHERE memstream_profiles.source = 'builtin'`,
        [seed.id, seed.yamlText, seed.application],
      );
      seeded += 1;
    }
  });
  return seeded;
}

/**
 * Overwrite every profiles/*.yaml row as builtin (including former "user"
 * edits), drop profile version history, and remove DB profiles that no
 * longer exist under profiles/.
 */
export async function forceReseedProfilesFromFiles(
  root = findRepoRoot(),
): Promise<number> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return 0;

  const seeds = loadProfileSeedsFromFiles(root);
  const seedIds = new Set(seeds.map((s) => s.id));

  let seeded = 0;
  await withClientObjects(url, async (client) => {
    try {
      await client.query(`DELETE FROM memstream_profile_versions`);
    } catch {
      /* table may not exist yet */
    }

    for (const seed of seeds) {
      await client.query(
        `INSERT INTO memstream_profiles (id, yaml, application, source, updated_at)
         VALUES ($1, $2, $3, 'builtin', now())
         ON CONFLICT (id) DO UPDATE SET
           yaml = EXCLUDED.yaml,
           application = EXCLUDED.application,
           source = 'builtin',
           updated_at = now()`,
        [seed.id, seed.yamlText, seed.application],
      );
      seeded += 1;
    }

    const existing = await client.query(`SELECT id FROM memstream_profiles`);
    for (const row of existing.rows as { id: string }[]) {
      if (!seedIds.has(row.id)) {
        await client.query(`DELETE FROM memstream_profiles WHERE id = $1`, [
          row.id,
        ]);
      }
    }
  });
  return seeded;
}

export async function listStoredProfiles(
  root = findRepoRoot(),
): Promise<StoredProfileInfo[]> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return listProfilesFromFiles(root);

  try {
    await ensureMemstreamSchema(root);

    return await withClientObjects(url, async (client) => {
      const result = await client.query(
        `SELECT id, application, source FROM memstream_profiles ORDER BY id`,
      );
      const rows = result.rows as {
        id: string;
        application: string;
        source: string;
      }[];
      if (!rows.length) return listProfilesFromFiles(root);
      return rows.map((r) => ({
        id: String(r.id),
        path: profilePathForId(String(r.id)),
        application: String(r.application || r.id),
        source: r.source === "user" ? "user" : "builtin",
      }));
    });
  } catch {
    // Offline / unreachable platform DB — ship with profiles/*.yaml.
    return listProfilesFromFiles(root);
  }
}

function listProfilesFromFiles(root: string): StoredProfileInfo[] {
  const profilesDir = join(root, "profiles");
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const id = file.replace(/\.yaml$/, "");
      let application = id;
      try {
        application = parseProfileYaml(
          readFileSync(join(profilesDir, file), "utf-8"),
        ).application;
      } catch {
        /* keep stem */
      }
      return {
        id,
        path: profilePathForId(id),
        application,
        source: "builtin" as const,
      };
    });
}

async function readYamlFromDb(
  id: string,
  root: string,
): Promise<string | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  try {
    await ensureMemstreamSchema(root);
    return await withClientObjects(url, async (client) => {
      const result = await client.query(
        `SELECT yaml FROM memstream_profiles WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as { yaml?: string } | undefined;
      return row?.yaml != null ? String(row.yaml) : null;
    });
  } catch {
    // Unreachable platform DB (stale .env, offline laptop) → file seed.
    return null;
  }
}

function readYamlFromFile(id: string, root: string): string | null {
  const path = join(root, "profiles", `${id}.yaml`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

/** Load Profile by id or path ref (DB first, then profiles/*.yaml). */
export async function resolveProfile(
  ref: string,
  root = findRepoRoot(),
): Promise<Profile> {
  const id = profileIdFromRef(ref);
  if (!id) throw new ProfileError("profile id required");

  const fromDb = await readYamlFromDb(id, root);
  if (fromDb != null) return parseProfileYaml(fromDb);

  const fromFile = readYamlFromFile(id, root);
  if (fromFile != null) return parseProfileYaml(fromFile);

  throw new ProfileError(
    `profile not found: ${id} (checked Memstream DB and profiles/${id}.yaml)`,
  );
}

export async function resolveProfileDraft(
  ref: string,
  root = findRepoRoot(),
): Promise<Record<string, unknown>> {
  const id = profileIdFromRef(ref);
  const fromDb = await readYamlFromDb(id, root);
  const text = fromDb ?? readYamlFromFile(id, root);
  if (text == null) {
    throw new Error(`profile not found: ${id}`);
  }
  parseProfileYaml(text);
  const raw = parseYaml(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("profile must be a YAML mapping");
  }
  return raw as Record<string, unknown>;
}

export async function saveStoredProfile(options: {
  profile: Record<string, unknown>;
  profileId?: string;
  root?: string;
}): Promise<{ id: string; path: string; application: string; tables: string }> {
  const profileId = options.profileId || "discovered";
  const root = options.root ?? findRepoRoot();
  if (!PROFILE_ID_RE.test(profileId)) {
    throw new Error(
      "invalid profile id (use letters, numbers, _, -; max 64 chars)",
    );
  }
  if (!options.profile || typeof options.profile !== "object") {
    throw new Error("profile must be an object");
  }
  if (!Array.isArray(options.profile.rules) || !options.profile.rules.length) {
    throw new Error("profile must include at least one rule");
  }

  const text = yamlStringify(options.profile, { sortMapEntries: false });
  const loaded = parseProfileYaml(text);
  const url = requirePlatformUrl(root);
  await ensureMemstreamSchema(root);

  await withClientObjects(url, async (client) => {
    await archiveProfileIfChanged(client, profileId, text);
    await client.query(
      `INSERT INTO memstream_profiles (id, yaml, application, source, updated_at)
       VALUES ($1, $2, $3, 'user', now())
       ON CONFLICT (id) DO UPDATE SET
         yaml = EXCLUDED.yaml,
         application = EXCLUDED.application,
         source = 'user',
         updated_at = now()`,
      [profileId, text, loaded.application],
    );
  });

  return {
    id: profileId,
    path: profilePathForId(profileId),
    application: loaded.application,
    tables: loaded.changefeed.tables.join(","),
  };
}

async function archiveProfileIfChanged(
  client: {
    query: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  profileId: string,
  newYaml: string,
): Promise<void> {
  const existing = await client.query(
    `SELECT yaml, application, source FROM memstream_profiles WHERE id = $1`,
    [profileId],
  );
  const row = existing.rows[0];
  if (!row || row.yaml == null) return;
  const prevYaml = String(row.yaml);
  if (prevYaml === newYaml) return;

  const max = await client.query(
    `SELECT coalesce(max(version), 0)::int AS v
     FROM memstream_profile_versions WHERE profile_id = $1`,
    [profileId],
  );
  const next = Number(max.rows[0]?.v ?? 0) + 1;
  await client.query(
    `
    INSERT INTO memstream_profile_versions
      (profile_id, version, yaml, application, source, created_at)
    VALUES ($1, $2, $3, $4, $5, now())
    `,
    [
      profileId,
      next,
      prevYaml,
      String(row.application || profileId),
      String(row.source || "user"),
    ],
  );

  const excess = await client.query(
    `
    SELECT version FROM memstream_profile_versions
    WHERE profile_id = $1
    ORDER BY version DESC
    OFFSET $2
    `,
    [profileId, PROFILE_VERSION_KEEP],
  );
  for (const old of excess.rows) {
    await client.query(
      `DELETE FROM memstream_profile_versions
       WHERE profile_id = $1 AND version = $2`,
      [profileId, Number(old.version)],
    );
  }
}

export async function listProfileVersions(
  profileId: string,
  root = findRepoRoot(),
  limit = 20,
): Promise<ProfileVersionInfo[]> {
  const id = profileIdFromRef(profileId);
  if (!id || !PROFILE_ID_RE.test(id)) return [];
  const url = memstreamDatabaseUrl(root);
  if (!url) return [];
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT profile_id, version, application, source, created_at::text AS created_at
      FROM memstream_profile_versions
      WHERE profile_id = $1
      ORDER BY version DESC
      LIMIT $2
      `,
      [id, Math.min(Math.max(limit, 1), 50)],
    );
    return (result.rows as ProfileVersionInfo[]).map((r) => ({
      profile_id: String(r.profile_id),
      version: Number(r.version),
      application: String(r.application || ""),
      source: String(r.source || "user"),
      created_at: String(r.created_at || ""),
    }));
  });
}

export async function restoreProfileVersion(options: {
  profileId: string;
  version: number;
  root?: string;
}): Promise<{ id: string; path: string; application: string; tables: string }> {
  const id = profileIdFromRef(options.profileId);
  if (!id || !PROFILE_ID_RE.test(id)) {
    throw new Error("invalid profile id");
  }
  const version = Number(options.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer");
  }
  const root = options.root ?? findRepoRoot();
  const url = requirePlatformUrl(root);
  await ensureMemstreamSchema(root);

  const yamlText = await withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT yaml FROM memstream_profile_versions
      WHERE profile_id = $1 AND version = $2
      `,
      [id, version],
    );
    const row = result.rows[0];
    if (!row?.yaml) {
      throw new Error(`profile version not found: ${id}@${version}`);
    }
    return String(row.yaml);
  });

  parseProfileYaml(yamlText);
  const raw = parseYaml(yamlText);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("stored version is not a valid profile mapping");
  }
  return saveStoredProfile({
    profile: raw as Record<string, unknown>,
    profileId: id,
    root,
  });
}
