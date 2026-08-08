#!/usr/bin/env node
/** Propose a memory profile from application schema. */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  fetchPublicTables,
  proposeProfileYaml,
} from "./discover.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "database-url": { type: "string", default: process.env.DATABASE_URL },
      application: { type: "string", default: "discovered-app" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(
      "Usage: memstream-propose --database-url URL [--application NAME] [--out PATH]",
    );
    return 0;
  }
  if (!values["database-url"]) {
    console.error("error: --database-url is required");
    return 2;
  }

  const tables = await fetchPublicTables(values["database-url"] as string);
  const yaml = proposeProfileYaml({
    application: values.application as string,
    tables,
  });
  if (values.out) {
    writeFileSync(values.out, yaml, "utf-8");
    console.error(`Wrote ${values.out}`);
  } else {
    console.log(yaml);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
