#!/usr/bin/env node
/**
 * Bundle Lambda handler → zip (used by package-prebuilt and local deploy).
 * Usage: node package-lambda-zip.mjs <out.zip> [root-for-certs-profiles]
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, "..");
const outZip = resolve(process.argv[2] || join(tmpdir(), "memstream-lambda.zip"));
const contentRoot = resolve(process.argv[3] || engineRoot);

const entryCandidates = [
  process.argv[4] ? resolve(process.argv[4]) : "",
  join(contentRoot, "worker", "dist", "lambda-handler.js"),
  join(engineRoot, "dist", "lambda-handler.js"),
  join(engineRoot, "src", "lambda-handler.ts"),
].filter(Boolean);
const entryPoint = entryCandidates.find((p) => existsSync(p));
if (!entryPoint) {
  console.error(
    "error: missing lambda-handler (build @memstream/engine or pass handler path)",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  console.error("error: esbuild required (npm install in packages/engine)");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "memstream-lambda-"));
const stage = join(dir, "package");
mkdirSync(stage, { recursive: true });

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(stage, "index.js"),
  external: ["pg-native"],
  sourcemap: false,
  logLevel: "silent",
});

const certCandidates = [
  join(contentRoot, "certs", "root.crt"),
  join(engineRoot, "certs", "root.crt"),
  join(process.env.HOME || "", ".postgresql", "root.crt"),
].filter(Boolean);
const cert = certCandidates.find((p) => existsSync(p));
if (cert) {
  mkdirSync(join(stage, "certs"), { recursive: true });
  copyFileSync(cert, join(stage, "certs", "root.crt"));
}

for (const name of ["profiles", "sql"]) {
  const src = join(contentRoot, name);
  if (existsSync(src)) cpSync(src, join(stage, name), { recursive: true });
}

writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({ type: "commonjs", main: "index.js" }),
);

mkdirSync(dirname(outZip), { recursive: true });
if (existsSync(outZip)) rmSync(outZip);

const zip = spawnSync("zip", ["-qr", outZip, "."], {
  cwd: stage,
  encoding: "utf-8",
});
rmSync(dir, { recursive: true, force: true });
if (zip.status !== 0) {
  console.error(`zip failed: ${zip.stderr || zip.stdout || zip.status}`);
  process.exit(1);
}

const bytes = readFileSync(outZip).byteLength;
console.error(`Lambda zip → ${outZip} (${bytes} bytes)`);
console.log(outZip);
