import { join } from "node:path";
import { getShop, type Shop } from "@memstream/engine";
import { webRepoRoot } from "@/lib/api";
import { loadConnectDefaults, parseEnvFile } from "@/lib/env-defaults";

/**
 * Shop uses the active Connect URL when set; on EC2 falls back to DATABASE_URL
 * from the instance .env (CloudFormation parameter).
 */
export async function resolveShop(): Promise<Shop> {
  const root = webRepoRoot();
  const defaults = await loadConnectDefaults(root);
  const fileEnv = parseEnvFile(join(root, ".env"));
  const envUrl =
    process.env.DATABASE_URL?.trim() || fileEnv.DATABASE_URL?.trim() || "";
  const databaseUrl = defaults.database_url.trim() || envUrl;
  const backend =
    (process.env.SHOP_BACKEND as "memory" | "cockroach" | undefined) ||
    (databaseUrl ? "cockroach" : "memory");
  return getShop({
    cdcDir: join(root, "data/cdc/inbox"),
    databaseUrl,
    backend,
  });
}
