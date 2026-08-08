/**
 * Product-facing names for Memstream UI and enable steps.
 * Prefer these over infra jargon (CDC, changefeed, vector index) in primary labels.
 * Technical detail can stay in secondary text / Advanced.
 */

export const PRODUCT = {
  brand: "Memstream",
  tagline: "Agent memory on CockroachDB",
  /** Main console view after enable */
  live: "Live",
  /** Searchable memory product */
  memory: "Agent memory",
  memoryChunks: "Memory chunks",
  recentMemory: "Recent memory",
  /** Setup journey */
  connect: "Connect",
  configure: "Configure",
  enable: "Enable",
  shop: "Demo shop",
} as const;

export type ResourceId =
  | "schema"
  | "changefeed"
  | "s3"
  | "embed"
  | "vectors"
  | "worker";

export type ResourceCopy = {
  id: ResourceId;
  /** Short name shown in lists */
  label: string;
  /** One-line plain explanation */
  blurb: string;
};

/** Canonical enable / Live resource names: same order, same words everywhere. */
export const RESOURCES: ResourceCopy[] = [
  {
    id: "schema",
    label: "Memory tables",
    blurb: "Creates the Cockroach tables used for agent memory",
  },
  {
    id: "changefeed",
    label: "Live changes",
    blurb: "Streams writes from your app tables",
  },
  {
    id: "s3",
    label: "Change storage",
    blurb: "Stores the change stream in S3",
  },
  {
    id: "embed",
    label: "Embeddings",
    blurb: "Embeds change text for vector search",
  },
  {
    id: "vectors",
    label: "Agent memory",
    blurb: "Stores chunks agents can search",
  },
  {
    id: "worker",
    label: "Memory worker",
    blurb: "Reads changes and writes memory",
  },
];

export function resourceById(id: string): ResourceCopy | undefined {
  return RESOURCES.find((r) => r.id === id);
}

export function resourceLabel(id: string): string {
  return resourceById(id)?.label ?? id;
}

/** Pipeline / Live map node labels (aligned with RESOURCES where possible). */
export const PIPELINE_LABELS = {
  database: "Your database",
  liveChanges: "Live changes",
  watchedTables: "Watched tables",
  memstream: "Memstream",
  changeStorage: "Change storage",
  embeddings: "Embeddings",
  agentMemory: "Agent memory",
  memoryWorker: "Memory worker",
  demoShop: "Demo shop",
} as const;

export type StepStatusCopy =
  | "Waiting"
  | "Working"
  | "Ready"
  | "Failed"
  | "Skipped";

export function stepStatusCopy(
  status: "pending" | "running" | "done" | "failed" | "skipped",
): StepStatusCopy {
  switch (status) {
    case "running":
      return "Working";
    case "done":
      return "Ready";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Waiting";
  }
}

/** Initial enable job steps with consistent labels. */
export function buildEnableSteps(options: {
  tables: string;
  bucket: string;
  prefix: string;
  deploy: boolean;
  stackName: string;
  embedModel?: string;
}): {
  id: ResourceId;
  label: string;
  detail: string;
  status: "pending";
}[] {
  const byId = Object.fromEntries(RESOURCES.map((r) => [r.id, r])) as Record<
    ResourceId,
    ResourceCopy
  >;
  return [
    {
      id: "schema",
      label: byId.schema.label,
      detail: byId.schema.blurb,
      status: "pending",
    },
    {
      id: "changefeed",
      label: byId.changefeed.label,
      detail: options.tables
        ? `Watches ${options.tables}`
        : byId.changefeed.blurb,
      status: "pending",
    },
    {
      id: "s3",
      label: byId.s3.label,
      detail: options.bucket
        ? `s3://${options.bucket}/${options.prefix}`
        : byId.s3.blurb,
      status: "pending",
    },
    {
      id: "embed",
      label: byId.embed.label,
      detail: options.embedModel || byId.embed.blurb,
      status: "pending",
    },
    {
      id: "vectors",
      label: byId.vectors.label,
      detail: byId.vectors.blurb,
      status: "pending",
    },
    {
      id: "worker",
      label: byId.worker.label,
      detail: options.deploy
        ? `Cloud box · ${options.stackName}`
        : "Runs locally (cloud box off)",
      status: "pending",
    },
  ];
}
