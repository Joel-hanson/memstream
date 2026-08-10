/** Bundle + deploy Memstream Lambda worker (S3 → chunks). */

import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import {
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type NotificationConfiguration,
} from "@aws-sdk/client-s3";
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteAwsStack,
  describeStackOutputs,
  type DeleteAwsStackOptions,
} from "./deploy-aws.js";
import { resolveAppDatabaseUrl } from "./connections.js";
import { upsertDeployConfigSecret } from "./deploy-secrets.js";
import { INFRA_TEMPLATE } from "./constants.js";
import { infraTemplatePath } from "./infra-templates.js";
import type { Job } from "./jobs.js";
import { resolveCaCertPath } from "./ca-cert.js";
import { stripSslRootCert } from "./store-cockroach.js";
import { waitForStackSettle } from "./stack-wait.js";

export type DeployLambdaOptions = {
  root: string;
  /** Optional; falls back to Connect / DATABASE_URL. */
  databaseUrl?: string;
  memstreamDatabaseUrl?: string;
  connectionId?: string | null;
  bucket: string;
  prefix: string;
  region: string;
  stackName: string;
  profilePath: string;
  embedModel: string;
  deployObjectKey?: string;
  job?: Job;
};

function log(job: Job | undefined, line: string) {
  if (job) job.append(line);
  else console.log(line);
}

function engineSrcDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Strip laptop sslrootcert=; Lambda uses PGSSLROOTCERT=/var/task/certs/root.crt. */
function rewriteUrlForLambda(url: string): string {
  if (!url.trim()) return url;
  return stripSslRootCert(url.trim());
}

async function bundleLambdaZip(
  root: string,
  profilePath: string,
  caCertPath: string,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "memstream-lambda-"));
  const outJs = join(dir, "index.js");
  const zipPath = join(dir, "memstream-lambda.zip");
  const entry = join(engineSrcDir(), "lambda-handler.js");
  const entryTs = join(engineSrcDir(), "lambda-handler.ts");
  const entryPoint = existsSync(entry) ? entry : entryTs;

  const require = createRequire(import.meta.url);
  let esbuild: typeof import("esbuild");
  try {
    esbuild = require("esbuild") as typeof import("esbuild");
  } catch {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      "esbuild is required to package the Lambda worker (npm install in packages/engine)",
    );
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outJs,
    external: ["pg-native"],
    sourcemap: false,
    logLevel: "silent",
  });

  const stage = join(dir, "package");
  mkdirSync(stage, { recursive: true });
  copyFileSync(outJs, join(stage, "index.js"));

  const certDir = join(stage, "certs");
  mkdirSync(certDir, { recursive: true });
  copyFileSync(caCertPath, join(certDir, "root.crt"));

  const profilesSrc = join(root, "profiles");
  if (existsSync(profilesSrc)) {
    cpSync(profilesSrc, join(stage, "profiles"), { recursive: true });
  }
  const sqlSrc = join(root, "sql");
  if (existsSync(sqlSrc)) {
    cpSync(sqlSrc, join(stage, "sql"), { recursive: true });
  }

  const profileFull = join(root, profilePath);
  if (existsSync(profileFull) && !existsSync(join(stage, profilePath))) {
    mkdirSync(dirname(join(stage, profilePath)), { recursive: true });
    copyFileSync(profileFull, join(stage, profilePath));
  }

  writeFileSync(
    join(stage, "package.json"),
    JSON.stringify({ type: "commonjs", main: "index.js" }),
    "utf-8",
  );

  const zip = spawnSync("zip", ["-qr", zipPath, "."], {
    cwd: stage,
    encoding: "utf-8",
  });
  if (zip.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `zip failed: ${zip.stderr || zip.stdout || `exit ${zip.status}`}`,
    );
  }
  return zipPath;
}

async function uploadZip(
  zipPath: string,
  bucket: string,
  key: string,
  region: string,
): Promise<void> {
  const s3 = new S3Client({ region });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(zipPath),
      ContentType: "application/zip",
    }),
  );
}

function stackParameters(
  options: DeployLambdaOptions,
  deployKey: string,
  configSecretArn: string,
) {
  return [
    { ParameterKey: "CdcS3Bucket", ParameterValue: options.bucket },
    { ParameterKey: "CdcS3Prefix", ParameterValue: options.prefix || "cdc/" },
    { ParameterKey: "DeployObjectKey", ParameterValue: deployKey },
    { ParameterKey: "ConfigSecretArn", ParameterValue: configSecretArn },
    { ParameterKey: "DatabaseUrl", ParameterValue: "" },
    { ParameterKey: "MemstreamDatabaseUrl", ParameterValue: "" },
    {
      ParameterKey: "MemstreamConnectionId",
      ParameterValue: options.connectionId || "",
    },
    {
      ParameterKey: "BedrockEmbedModel",
      ParameterValue: options.embedModel || "amazon.titan-embed-text-v2:0",
    },
    {
      ParameterKey: "MemoryProfile",
      ParameterValue: options.profilePath || "commerce",
    },
  ];
}

async function currentStackStatus(
  cfn: CloudFormationClient,
  stackName: string,
): Promise<string | null> {
  try {
    const out = await cfn.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    return out.Stacks?.[0]?.StackStatus ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(msg)) return null;
    throw err;
  }
}

const NOTIFICATION_ID = "memstream-cdc-lambda";

function resolveLambdaTemplate(root: string): string {
  return infraTemplatePath(root, INFRA_TEMPLATE.LAMBDA);
}

function resolvePrebuiltLambdaZip(root: string): string | null {
  const paths = [
    join(root, "deploy", "memstream-lambda.zip"),
    ...(process.env.MEMSTREAM_ROOT?.trim()
      ? [
          join(
            process.env.MEMSTREAM_ROOT.trim(),
            "deploy",
            "memstream-lambda.zip",
          ),
        ]
      : []),
    "/opt/memstream/deploy/memstream-lambda.zip",
  ];
  return paths.find((p) => existsSync(p)) ?? null;
}

/** Merge Memstream Lambda trigger into existing bucket notification config. */
export async function ensureS3LambdaNotification(options: {
  bucket: string;
  prefix: string;
  functionArn: string;
  region: string;
  job?: Job;
}): Promise<void> {
  const s3 = new S3Client({ region: options.region });
  const prefix = options.prefix.replace(/^\//, "");
  let existing: NotificationConfiguration;
  try {
    existing = await s3.send(
      new GetBucketNotificationConfigurationCommand({
        Bucket: options.bucket,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read S3 notification config: ${msg}`);
  }

  const others = (existing.LambdaFunctionConfigurations || []).filter(
    (c) => c.Id !== NOTIFICATION_ID,
  );
  const config = {
    Id: NOTIFICATION_ID,
    LambdaFunctionArn: options.functionArn,
    Events: ["s3:ObjectCreated:*" as const],
    Filter: {
      Key: {
        FilterRules: [{ Name: "prefix" as const, Value: prefix }],
      },
    },
  };

  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: options.bucket,
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [...others, config],
        QueueConfigurations: existing.QueueConfigurations,
        TopicConfigurations: existing.TopicConfigurations,
        EventBridgeConfiguration: existing.EventBridgeConfiguration,
      },
    }),
  );
  log(
    options.job,
    `S3 notification → ${options.functionArn} (prefix ${prefix})`,
  );
}

/** Bundle handler, upload zip, create/update Lambda stack, wire S3 trigger. */
export async function deployLambdaStack(
  options: DeployLambdaOptions,
): Promise<{ functionArn: string | null; functionName: string | null }> {
  const region = options.region || "us-east-1";
  const stackName = options.stackName || "memstream-demo-lambda";
  const deployKey =
    options.deployObjectKey || "deploy/memstream-lambda.zip";
  const templatePath = resolveLambdaTemplate(options.root);

  log(options.job, `Bundling Lambda → s3://${options.bucket}/${deployKey}`);
  const memstreamUrl =
    options.memstreamDatabaseUrl ||
    process.env.MEMSTREAM_DATABASE_URL ||
    "";
  if (!memstreamUrl.trim()) {
    throw new Error(
      "MEMSTREAM_DATABASE_URL is required to deploy Lambda (platform DB + Connect)",
    );
  }
  const databaseUrl = await resolveAppDatabaseUrl(
    options.databaseUrl,
    options.root,
  );
  const resolved: DeployLambdaOptions = {
    ...options,
    databaseUrl,
    memstreamDatabaseUrl: memstreamUrl,
  };
  if (databaseUrl) {
    log(
      options.job,
      "Application DB URL from Connect / DATABASE_URL (Secrets Manager)",
    );
  } else {
    log(
      options.job,
      "No application DB URL yet — Lambda will load it from memstream_connections",
    );
  }

  const secret = await upsertDeployConfigSecret({
    stackName,
    region,
    values: {
      DATABASE_URL: rewriteUrlForLambda(databaseUrl || ""),
      MEMSTREAM_DATABASE_URL: rewriteUrlForLambda(memstreamUrl),
      MEMSTREAM_SECRETS_KEY: process.env.MEMSTREAM_SECRETS_KEY || "",
    },
  });
  log(options.job, `Deploy config secret ${secret.name}`);

  const prebuiltZip = resolvePrebuiltLambdaZip(options.root);
  let zipPath: string;
  let cleanupDir: string | null = null;
  if (prebuiltZip) {
    log(options.job, `Using prebuilt Lambda zip ${prebuiltZip}`);
    zipPath = prebuiltZip;
  } else {
    const caCertPath = resolveCaCertPath(databaseUrl, memstreamUrl);
    log(options.job, `Bundling Cockroach CA cert from ${caCertPath}`);
    zipPath = await bundleLambdaZip(
      options.root,
      options.profilePath,
      caCertPath,
    );
    cleanupDir = dirname(zipPath);
  }
  try {
    await uploadZip(zipPath, options.bucket, deployKey, region);
  } finally {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true });
  }

  const cfn = new CloudFormationClient({ region });
  const templateBody = readFileSync(templatePath, "utf-8");
  const parameters = stackParameters(resolved, deployKey, secret.arn);
  const status = await currentStackStatus(cfn, stackName);

  if (!status || status === "DELETE_COMPLETE") {
    log(options.job, `Creating stack ${stackName} in ${region}`);
    await cfn.send(
      new CreateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        Capabilities: ["CAPABILITY_IAM"],
        Parameters: parameters,
      }),
    );
    log(options.job, "Waiting for Lambda stack create…");
    await waitForStackSettle({
      client: cfn,
      stackName,
      mode: "create",
      maxWaitSeconds: 600,
      job: options.job,
    });
  } else {
    log(options.job, `Updating stack ${stackName} (status=${status})`);
    try {
      await cfn.send(
        new UpdateStackCommand({
          StackName: stackName,
          TemplateBody: templateBody,
          Capabilities: ["CAPABILITY_IAM"],
          Parameters: parameters,
        }),
      );
      log(options.job, "Waiting for Lambda stack update…");
      await waitForStackSettle({
        client: cfn,
        stackName,
        mode: "update",
        maxWaitSeconds: 600,
        job: options.job,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/No updates are to be performed/i.test(msg)) {
        log(
          options.job,
          "No stack template updates (refreshing function code).",
        );
      } else {
        throw err;
      }
    }
  }

  const outs = await describeStackOutputs(stackName, region);
  const functionArn = outs.FunctionArn || null;
  const functionName = outs.FunctionName || null;
  if (!functionArn || !functionName) {
    throw new Error(`Stack ${stackName} missing FunctionArn/FunctionName`);
  }

  const lambda = new LambdaClient({ region });
  await lambda.send(
    new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      S3Bucket: options.bucket,
      S3Key: deployKey,
    }),
  );
  log(options.job, `Updated Lambda code for ${functionName}`);

  await ensureS3LambdaNotification({
    bucket: options.bucket,
    prefix: options.prefix || "cdc/",
    functionArn,
    region,
    job: options.job,
  });

  log(options.job, `Lambda worker ready: ${functionName}`);
  return { functionArn, functionName };
}

export async function deleteLambdaStack(
  options: DeleteAwsStackOptions,
): Promise<{ deleted: boolean; waited: boolean }> {
  return deleteAwsStack(options);
}
