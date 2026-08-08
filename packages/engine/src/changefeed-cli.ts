#!/usr/bin/env node
/** Create EXTERNAL CONNECTION + CHANGEFEED (or --dry-run). */

import { parseArgs } from "node:util";
import { createChangefeed } from "./changefeed.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "database-url": { type: "string", default: process.env.DATABASE_URL },
      "s3-bucket": { type: "string", default: process.env.CDC_S3_BUCKET },
      "s3-prefix": {
        type: "string",
        default: process.env.CDC_S3_PREFIX || "cdc/",
      },
      "aws-region": {
        type: "string",
        default: process.env.AWS_REGION || "us-east-1",
      },
      tables: {
        type: "string",
        default: process.env.MEMSTREAM_CHANGEFEED_TABLES || "orders,stock",
      },
      "connection-name": {
        type: "string",
        default: process.env.MEMSTREAM_EXTERNAL_CONNECTION || "memstream_s3",
      },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(
      "Usage: memstream-changefeed --database-url URL --s3-bucket NAME [--dry-run]",
    );
    return 0;
  }

  if (!values["database-url"] || !values["s3-bucket"]) {
    console.error("error: --database-url and --s3-bucket are required");
    return 2;
  }

  const result = await createChangefeed({
    databaseUrl: values["database-url"] as string,
    bucket: values["s3-bucket"] as string,
    prefix: values["s3-prefix"] as string,
    region: values["aws-region"] as string,
    tables: values.tables as string,
    connectionName: values["connection-name"] as string,
    dryRun: Boolean(values["dry-run"]),
  });

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
