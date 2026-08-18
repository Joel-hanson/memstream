/** Memstream MCP server: memory search, schema resources, profile draft/save. */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  appDatabaseLabel,
  fetchPublicTables,
  interestingColumns,
  listProfiles,
  loadProfileDraft,
  narrativeColumns,
  parseProfileYaml,
  proposeFromDatabase,
  repoRoot,
  saveProfileYaml,
  searchMemories,
  watchableColumns,
  type Embedder,
  type MemoryStore,
} from "@memstream/engine";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { z } from "zod";
import { PROFILE_GUIDE, summarizeSchemaTables } from "./profile-guide.js";

export type McpServerContext = {
  embedder: Embedder;
  store: MemoryStore;
  databaseUrl?: string;
  connectionId?: string;
  root?: string;
};

function requireDatabaseUrl(ctx: McpServerContext): string {
  const url = ctx.databaseUrl?.trim() || "";
  if (!url) {
    throw new Error(
      "No application database URL. Connect in the Memstream console (or set DATABASE_URL) first.",
    );
  }
  return url;
}

function safeConnectionHint(databaseUrl: string): string {
  const label = appDatabaseLabel(databaseUrl);
  if (label) return label;
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "connected";
  }
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function resourceText(uri: string, text: string, mimeType = "text/markdown") {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

async function buildSchemaDocument(ctx: McpServerContext): Promise<{
  hint: string;
  body: string;
}> {
  const databaseUrl = requireDatabaseUrl(ctx);
  const tables = await fetchPublicTables(databaseUrl);
  const summary = summarizeSchemaTables(
    tables,
    interestingColumns,
    narrativeColumns,
    watchableColumns,
  );
  const hint = safeConnectionHint(databaseUrl);
  const body = JSON.stringify(
    {
      database_hint: hint,
      connection_id: ctx.connectionId || null,
      table_count: summary.length,
      tables: summary,
      note:
        "Heuristic flags only. Prefer domain-meaningful rules using memstream://profile-guide.",
    },
    null,
    2,
  );
  return { hint, body };
}

function parseProfileInput(options: {
  profile?: unknown;
  profile_yaml?: string;
}): Record<string, unknown> {
  if (options.profile_yaml?.trim()) {
    const raw = yamlParse(options.profile_yaml);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("profile_yaml must be a YAML mapping");
    }
    // Validate shape early (throws ProfileError on bad rules).
    parseProfileYaml(options.profile_yaml);
    return raw as Record<string, unknown>;
  }
  if (options.profile && typeof options.profile === "object") {
    const text = yamlStringify(options.profile, { sortMapEntries: false });
    parseProfileYaml(text);
    return options.profile as Record<string, unknown>;
  }
  throw new Error("Provide profile (object) or profile_yaml (string)");
}

function profileIdFromApplication(application: string): string {
  const slug = application
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "discovered";
}

export function createMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer({
    name: "memstream",
    version: "0.3.0",
  });

  // --- Resources ------------------------------------------------------------

  server.registerResource(
    "profile-guide",
    "memstream://profile-guide",
    {
      title: "Memory profile guide",
      description:
        "How to draft meaningful Memstream profiles from schema + user intent. Read before make_memory_profile / save.",
      mimeType: "text/markdown",
    },
    async (uri) => resourceText(uri.href, PROFILE_GUIDE),
  );

  server.registerResource(
    "schema",
    "memstream://schema",
    {
      title: "Connected application schema",
      description:
        "Public tables/columns on the connected app DB with watchable/narrative hints (no secrets).",
      mimeType: "application/json",
    },
    async (uri) => {
      const { body } = await buildSchemaDocument(ctx);
      return resourceText(uri.href, body, "application/json");
    },
  );

  server.registerResource(
    "profiles",
    new ResourceTemplate("memstream://profiles/{id}", {
      list: async () => {
        const root = ctx.root || repoRoot();
        const profiles = await listProfiles(root);
        return {
          resources: profiles.map((p) => ({
            uri: `memstream://profiles/${p.id}`,
            name: p.id,
            title: p.application || p.id,
            description: `Saved memory profile ${p.id}`,
            mimeType: "application/x-yaml",
          })),
        };
      },
      complete: {
        id: async (value) => {
          const root = ctx.root || repoRoot();
          const profiles = await listProfiles(root);
          const q = (value || "").toLowerCase();
          return profiles
            .map((p) => p.id)
            .filter((id) => !q || id.toLowerCase().includes(q))
            .slice(0, 20);
        },
      },
    }),
    {
      title: "Saved memory profiles",
      description:
        "Existing Memstream profiles (builtin seed + user saves). Example: memstream://profiles/commerce",
      mimeType: "application/x-yaml",
    },
    async (uri, variables) => {
      const id = String(variables.id || "").trim();
      if (!id) throw new Error("profile id required");
      const root = ctx.root || repoRoot();
      const draft = await loadProfileDraft(id, root);
      const yaml = yamlStringify(draft, { sortMapEntries: false });
      return resourceText(uri.href, yaml, "application/x-yaml");
    },
  );

  // --- Prompt ---------------------------------------------------------------

  server.registerPrompt(
    "make_memory_profile",
    {
      title: "Make memory profile",
      description:
        "Draft a meaningful Memstream memory profile from the connected schema and user goal, then save after approval.",
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe(
            "What memory should capture (e.g. support handoffs, shipping status, inventory)",
          ),
        application: z
          .string()
          .optional()
          .describe("Profile application name (default commerce)"),
        profile_id: z
          .string()
          .optional()
          .describe("Suggested profile id when saving"),
        tables: z
          .string()
          .optional()
          .describe("Optional comma-separated table allowlist"),
      },
    },
    async ({ goal, application, profile_id, tables }) => {
      const app = application?.trim() || "commerce";
      const id = profile_id?.trim() || profileIdFromApplication(app);
      const tableList = (tables || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const goalText =
        goal?.trim() ||
        "general application events that help agents answer support and ops questions";

      let schemaSnippet = "(schema unavailable — call list_watchable_tables)";
      try {
        const { body } = await buildSchemaDocument(ctx);
        schemaSnippet = body;
      } catch (err) {
        schemaSnippet = `Error loading schema: ${err instanceof Error ? err.message : String(err)}`;
      }

      const text = [
        "You are helping configure Memstream agent memory.",
        "",
        `User goal: ${goalText}`,
        `Suggested application: ${app}`,
        `Suggested profile_id: ${id}`,
        tableList.length
          ? `Prefer these tables: ${tableList.join(", ")}`
          : "Consider all public tables in the schema.",
        "",
        "Instructions:",
        "1. Read resource memstream://profile-guide (authoritative drafting rules).",
        "2. Use the schema JSON below (also available as memstream://schema).",
        "3. Optionally read memstream://profiles/commerce (or another id) as a quality example.",
        "4. Draft a domain-meaningful profile YAML (rich chunk_template + tags), not bare heuristics.",
        "5. Show the draft to the user. After they approve, call save_memory_profile.",
        "6. Saving does not Enable — remind them to Configure → Enable in the Memstream console.",
        "",
        "Connected schema:",
        "```json",
        schemaSnippet,
        "```",
        "",
        "Guide excerpt (full guide: memstream://profile-guide):",
        PROFILE_GUIDE.slice(0, 1800),
        "…",
      ].join("\n");

      return {
        description: `Draft Memstream profile for: ${goalText}`,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text },
          },
        ],
      };
    },
  );

  // --- Tools ----------------------------------------------------------------

  server.tool(
    "get_connection",
    "Show which Memstream application database this MCP session uses (no secrets). Call before proposing a profile if unsure.",
    {},
    async () => {
      const url = ctx.databaseUrl?.trim() || "";
      if (!url) {
        return textResult({
          connected: false,
          detail:
            "No application connection. Use Memstream console Connect (Cockroach Cloud or URL), then retry.",
        });
      }
      return textResult({
        connected: true,
        connection_id: ctx.connectionId || null,
        database_hint: safeConnectionHint(url),
      });
    },
  );

  server.tool(
    "list_watchable_tables",
    "List public tables/columns on the connected application DB that Memstream can watch. Prefer this before propose_memory_profile when the user wants to choose tables.",
    {
      include_columns: z
        .boolean()
        .default(true)
        .describe("Include column names per table"),
    },
    async ({ include_columns }) => {
      const databaseUrl = requireDatabaseUrl(ctx);
      const tables = await fetchPublicTables(databaseUrl);
      const summary = summarizeSchemaTables(
        tables,
        interestingColumns,
        narrativeColumns,
        watchableColumns,
      );
      return textResult({
        database_hint: safeConnectionHint(databaseUrl),
        table_count: summary.length,
        tables: summary.map((t) => ({
          name: t.name,
          column_count: t.columns.length,
          interesting_columns: t.interesting_columns,
          narrative_columns: t.narrative_columns,
          watchable_columns: t.watchable_columns,
          likely_memory_candidate: t.likely_memory_candidate,
          ...(include_columns ? { columns: t.columns } : {}),
        })),
      });
    },
  );

  server.tool(
    "list_memory_profiles",
    "List saved Memstream memory profiles (builtin + user). Read one via resource memstream://profiles/{id}.",
    {},
    async () => {
      const root = ctx.root || repoRoot();
      const profiles = await listProfiles(root);
      return textResult({
        profile_count: profiles.length,
        profiles: profiles.map((p) => ({
          id: p.id,
          application: p.application,
          path: p.path,
          resource_uri: `memstream://profiles/${p.id}`,
        })),
      });
    },
  );

  server.tool(
    "propose_memory_profile",
    "Heuristic baseline profile from schema column names (status/quantity/body/…). Prefer make_memory_profile prompt + save_memory_profile for meaningful drafts. Does not enable the pipeline.",
    {
      application: z
        .string()
        .default("discovered-app")
        .describe("Profile application name"),
      tables: z
        .array(z.string())
        .optional()
        .describe(
          "Optional allowlist of public table names. Omit to scan all public tables.",
        ),
      save: z
        .boolean()
        .default(false)
        .describe(
          "If true, save the suggested profile into Memstream profile storage (same as console Save).",
        ),
      profile_id: z
        .string()
        .optional()
        .describe(
          "Profile id when save=true (default derived from application)",
        ),
    },
    async ({ application, tables, save, profile_id }) => {
      const databaseUrl = requireDatabaseUrl(ctx);
      const root = ctx.root || repoRoot();
      const result = await proposeFromDatabase({
        databaseUrl,
        application: application?.trim() || "discovered-app",
        includeTables: tables?.length ? tables : undefined,
      });
      const profileYaml = yamlStringify(result.profile, {
        sortMapEntries: false,
      });

      let saved: { id: string; path: string } | null = null;
      if (save) {
        const savedResult = await saveProfileYaml({
          profile: result.profile,
          profileId:
            profile_id?.trim() ||
            profileIdFromApplication(application || "discovered-app"),
          root,
        });
        saved = { id: savedResult.id, path: savedResult.path };
      }

      return textResult({
        database_hint: safeConnectionHint(databaseUrl),
        tables_scanned: result.tables_scanned,
        profile: result.profile,
        profile_yaml: profileYaml,
        saved,
        next_steps: saved
          ? [
              "Profile saved. In Memstream console: Configure → pick this profile → Enable.",
              "After Enable, use search_memory for narrative questions and Cockroach MCP for SQL.",
            ]
          : [
              "Heuristic only. Prefer prompt make_memory_profile for meaningful templates, then save_memory_profile.",
              "Or call propose_memory_profile again with save=true and a profile_id.",
            ],
      });
    },
  );

  server.tool(
    "save_memory_profile",
    "Validate and save a memory profile (agent-drafted or edited YAML/object) into Memstream storage — same as console Save. Does not Enable the pipeline.",
    {
      profile_id: z
        .string()
        .describe("Profile id (letters, numbers, _, -; max 64)"),
      profile_yaml: z
        .string()
        .optional()
        .describe("Full profile as YAML text (preferred from drafts)"),
      profile: z
        .record(z.unknown())
        .optional()
        .describe("Full profile as a JSON object (alternative to profile_yaml)"),
    },
    async ({ profile_id, profile_yaml, profile }) => {
      const root = ctx.root || repoRoot();
      const id = profile_id.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
        throw new Error(
          "invalid profile_id (use letters, numbers, _, -; max 64 chars)",
        );
      }
      const parsed = parseProfileInput({ profile, profile_yaml });
      const saved = await saveProfileYaml({
        profile: parsed,
        profileId: id,
        root,
      });
      return textResult({
        saved: {
          id: saved.id,
          path: saved.path,
          application: saved.application,
          tables: saved.tables,
        },
        resource_uri: `memstream://profiles/${saved.id}`,
        next_steps: [
          "Profile saved. In Memstream console: Configure → pick this profile → Enable.",
          "Saving does not start changefeeds or the worker.",
        ],
      });
    },
  );

  server.tool(
    "search_memory",
    "Embed the query and return the nearest Memstream memory chunks for this connection. Use for narrative / similarity questions, then verify exact state with Cockroach SQL.",
    {
      query: z.string().describe("Natural-language memory query"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe("Number of chunks to return"),
    },
    async ({ query, top_k }) => {
      const hits = await searchMemories(
        ctx.embedder,
        ctx.store,
        query,
        top_k ?? 5,
      );
      return textResult(hits);
    },
  );

  return server;
}

export async function runStdio(ctx: McpServerContext): Promise<void> {
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
