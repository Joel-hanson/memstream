/** Stage Cockroach Cloud CA into repo certs/root.crt for EC2/Lambda packages. */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  extractSslRootCert,
  resolveSslRootCertPath,
} from "./store-cockroach.js";

/**
 * Prefer env / ~/.postgresql / packaged CA, then a still-valid path embedded
 * in a connection URL (legacy).
 */
export function resolveCaCertPath(
  ...databaseUrls: (string | undefined)[]
): string {
  const fromEnv = resolveSslRootCertPath();
  if (fromEnv) return fromEnv;
  for (const url of databaseUrls) {
    if (!url?.trim()) continue;
    const fromUrl = extractSslRootCert(url);
    if (fromUrl && existsSync(fromUrl)) return fromUrl;
  }
  throw new Error(
    "Cockroach CA cert not found. Run `make cockroach-ca` (needs COCKROACH_CLUSTER_ID), " +
      "or place root.crt at ~/.postgresql/root.crt / set PGSSLROOTCERT.",
  );
}

/** Write certs/root.crt under repo root so EC2 tarball includes it. */
export function stageRepoCaCert(
  root: string,
  ...databaseUrls: (string | undefined)[]
): string {
  const src = resolveCaCertPath(...databaseUrls);
  const dir = join(root, "certs");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "root.crt");
  copyFileSync(src, dest);
  return dest;
}
