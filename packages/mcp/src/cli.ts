#!/usr/bin/env node
/** CLI for Memstream MCP — stdio (default) or HTTP streamable. */

import { parseArgs } from "node:util";
import { resolveMcpRuntime } from "./runtime.js";
import { runHttp } from "./http.js";
import { runStdio } from "./server.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      profile: {
        type: "string",
        default: process.env.MEMORY_PROFILE || "profiles/commerce.yaml",
      },
      embedder: {
        type: "string",
        default: process.env.MEMSTREAM_EMBEDDER || "bedrock",
      },
      store: {
        type: "string",
        default: process.env.MEMSTREAM_STORE || "cockroach",
      },
      "database-url": {
        type: "string",
        default: process.env.DATABASE_URL,
      },
      "connection-id": {
        type: "string",
        default: process.env.MEMSTREAM_CONNECTION_ID,
      },
      "aws-region": {
        type: "string",
        default: process.env.AWS_REGION || "us-east-1",
      },
      transport: {
        type: "string",
        default: process.env.MEMSTREAM_MCP_TRANSPORT || "stdio",
      },
      host: {
        type: "string",
        default: process.env.MEMSTREAM_MCP_HOST || "127.0.0.1",
      },
      port: {
        type: "string",
        default: process.env.MEMSTREAM_MCP_PORT || "8765",
      },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: memstream-mcp [options]

Options:
  --profile PATH          Memory profile YAML
  --embedder KIND         fake|bedrock (default bedrock)
  --store KIND            memory|cockroach (default cockroach)
  --database-url URL      Cockroach URL
  --connection-id UUID    Scope search to this Memstream connection
  --aws-region REGION     AWS region for Bedrock
  --transport KIND        stdio|http (default stdio; or MEMSTREAM_MCP_TRANSPORT)
  --host HOST             HTTP bind host (default 127.0.0.1)
  --port PORT             HTTP port (default 8765)
`);
    return 0;
  }

  const runtime = await resolveMcpRuntime({
    profile: values.profile as string,
    embedder: values.embedder as string,
    store: values.store as string,
    databaseUrl: values["database-url"] as string | undefined,
    connectionId: values["connection-id"] as string | undefined,
    awsRegion: values["aws-region"] as string,
  });

  const transport = String(values.transport || "stdio").toLowerCase();
  if (transport === "http") {
    await runHttp(runtime.embedder, runtime.store, {
      host: values.host as string,
      port: Number(values.port),
    });
    return 0;
  }

  await runStdio(runtime.embedder, runtime.store);
  return 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
