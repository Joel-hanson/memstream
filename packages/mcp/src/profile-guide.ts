/** Guidance for agents drafting meaningful Memstream memory profiles. */

export const PROFILE_GUIDE = `# Memstream memory profile guide

Use this when the user asks to make / draft / improve a memory profile.

## Goal

A profile tells Memstream which Cockroach tables to watch (changefeed) and how to
turn row changes into searchable agent-memory chunks.

\`propose_memory_profile\` is only a heuristic baseline (column-name rules). Prefer
reading \`memstream://schema\` plus this guide and drafting a **domain-meaningful**
profile from the user's intent.

## Workflow

1. Call \`get_connection\` if unsure the app DB is connected.
2. Read \`memstream://schema\` (tables/columns + hints).
3. Optionally read \`memstream://profiles/{id}\` for an existing example (e.g. commerce).
4. Draft YAML aimed at the user's goal (support handoffs, inventory, SaaS roles, …).
5. Show the draft to the user; after approval call \`save_memory_profile\`.
6. Tell them to **Configure → pick profile → Enable** in the Memstream console.
   Saving does **not** start the pipeline.

## YAML shape

\`\`\`yaml
application: my-app
source_database: defaultdb
changefeed:
  tables: [orders, tickets, case_notes]
  sink: s3
rules:
  - name: order_status_change
    table: orders
    when:
      columns_changed: [status]
    chunk_template: |
      Order {{id}} ({{sku}} × {{quantity}}) for customer {{customer_id}}
      status {{before.status}} → {{after.status}} at {{timestamp}}.
      Note: {{after.note}}
    tags: [order, status, shipping]
embedding:
  model: amazon.titan-embed-text-v2:0
  table: agent_memory_chunks
  dimensions: 1024
discovery:
  enabled: false
  mode: off
insights:
  enabled: false
  schedule: manual
\`\`\`

## How to choose tables and columns

- Prefer tables that record **events people care about**: orders, tickets, case
  notes, inventory, memberships — not pure lookup/static catalogs unless asked.
- Watch **state** columns: status, state, role, quantity, amount, price, total.
- Also watch **narrative** columns: body, note, author, description, comment,
  message, title, summary. These make chunks useful for agents.
- Include join keys in templates (\`order_id\`, \`customer_id\`, \`sku\`, \`ticket_id\`)
  even if you do not put them in \`columns_changed\`.
- Keep \`changefeed.tables\` exactly the set of tables that appear in rules.
- One rule per meaningful change; name rules \`table_intent\` (e.g. \`support_handoff\`).

## Chunk templates

- Write as short prose an agent would retrieve later, not raw dump of every column.
- Use Mustache-style fields: \`{{id}}\`, \`{{after.status}}\`, \`{{before.quantity}}\`,
  \`{{timestamp}}\`, \`{{after.body}}\`.
- Put the human story first (who/what/order), then the delta.
- Tags: 2–5 lowercase tokens for filtering (support, handoff, inventory, …).

## Intent examples

| User asks for | Typical tables | Watch |
| --- | --- | --- |
| Commerce / shipping | orders, stock | status, quantity, note |
| Support handoffs | tickets, case_notes | status, body, author |
| Inventory only | stock | quantity |
| SaaS security | users | role |

## Apply

- \`save_memory_profile\` persists YAML (same as console Save).
- Enable remains a console (or ops) step so changefeeds are intentional.
`;

export type SchemaTableSummary = {
  name: string;
  columns: string[];
  interesting_columns: string[];
  narrative_columns: string[];
  watchable_columns: string[];
  likely_memory_candidate: boolean;
};

export function summarizeSchemaTables(
  tables: Record<string, string[]>,
  interesting: (columns: string[]) => string[],
  narrative: (columns: string[]) => string[],
  watchable: (columns: string[], table?: string) => string[],
): SchemaTableSummary[] {
  return Object.keys(tables)
    .sort()
    .map((name) => {
      const columns = tables[name] || [];
      const interesting_columns = interesting(columns);
      const narrative_columns = narrative(columns);
      const watchable_columns = watchable(columns, name);
      return {
        name,
        columns,
        interesting_columns,
        narrative_columns,
        watchable_columns,
        likely_memory_candidate: watchable_columns.length > 0,
      };
    });
}
