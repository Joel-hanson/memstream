/** In-app AWS deploy: package → S3 → CloudFormation (no deploy-aws.sh). */

import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stageRepoCaCert } from "./ca-cert.js";
import { resolveAppDatabaseUrl } from "./connections.js";
import { upsertDeployConfigSecret } from "./deploy-secrets.js";
import { infraTemplatePath } from "./infra-templates.js";
import type { Job } from "./jobs.js";
import { INFRA_TEMPLATE, WORKER_COMPUTE } from "./constants.js";
import { waitForStackSettle } from "./stack-wait.js";

export type DeployAwsOptions = {
  root: string;
  /** Optional; falls back to Connect / DATABASE_URL. Empty is OK on EC2. */
  databaseUrl?: string;
  /** Platform DB for CDC cursor + connections; defaults to MEMSTREAM_DATABASE_URL. */
  memstreamDatabaseUrl?: string;
  bucket: string;
  prefix: string;
  region: string;
  stackName: string;
  profilePath: string;
  embedModel: string;
  instanceType?: string;
  shopCidr?: string;
  keyName?: string;
  deployObjectKey?: string;
  job?: Job;
};

function log(job: Job | undefined, line: string) {
  if (job) job.append(line);
  else console.log(line);
}

function packageSourceTarball(
  root: string,
  databaseUrl: string | undefined,
  memstreamDatabaseUrl?: string,
): string {
  stageRepoCaCert(root, databaseUrl, memstreamDatabaseUrl);
  const script = join(root, "scripts", "package-prebuilt.sh");
  if (!existsSync(script)) {
    throw new Error(`Missing ${script}`);
  }
  const proc = spawnSync("bash", [script], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (proc.status !== 0) {
    throw new Error(
      `prebuilt package failed: ${proc.stderr || proc.stdout || `exit ${proc.status}`}`,
    );
  }
  const lines = (proc.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tarball = lines[lines.length - 1];
  if (!tarball || !existsSync(tarball)) {
    throw new Error(
      `prebuilt package did not print a tarball path (stdout=${proc.stdout})`,
    );
  }
  return tarball;
}

async function uploadTarball(
  tarball: string,
  bucket: string,
  key: string,
  region: string,
): Promise<void> {
  const s3 = new S3Client({ region });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(tarball),
      ContentType: "application/gzip",
    }),
  );
}

function stackParameters(
  options: DeployAwsOptions,
  deployKey: string,
  configSecretArn: string,
) {
  const params = [
    { ParameterKey: "CdcS3Bucket", ParameterValue: options.bucket },
    { ParameterKey: "CdcS3Prefix", ParameterValue: options.prefix || "cdc/" },
    { ParameterKey: "DeployObjectKey", ParameterValue: deployKey },
    { ParameterKey: "ConfigSecretArn", ParameterValue: configSecretArn },
    // Intentionally empty — secrets live in Secrets Manager
    { ParameterKey: "DatabaseUrl", ParameterValue: "" },
    { ParameterKey: "MemstreamDatabaseUrl", ParameterValue: "" },
    { ParameterKey: "MemstreamSecretsKey", ParameterValue: "" },
    {
      ParameterKey: "MemstreamWorkerCompute",
      ParameterValue:
        process.env.MEMSTREAM_WORKER_COMPUTE === WORKER_COMPUTE.LAMBDA
          ? WORKER_COMPUTE.LAMBDA
          : WORKER_COMPUTE.EC2,
    },
    {
      ParameterKey: "BedrockEmbedModel",
      ParameterValue: options.embedModel || "amazon.titan-embed-text-v2:0",
    },
    {
      ParameterKey: "MemoryProfile",
      ParameterValue: options.profilePath || "commerce",
    },
    {
      ParameterKey: "InstanceType",
      ParameterValue: options.instanceType || "t3.micro",
    },
    {
      ParameterKey: "ShopCidr",
      ParameterValue: options.shopCidr || "0.0.0.0/0",
    },
  ];
  const keyName = options.keyName || process.env.KEY_NAME || "";
  if (keyName) {
    params.push({ ParameterKey: "KeyName", ParameterValue: keyName });
  }
  return params;
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

/** Upload source + create/update EC2 CloudFormation stack. Returns ShopUrl if present. */
export async function deployAwsStack(
  options: DeployAwsOptions,
): Promise<{ shopUrl: string | null }> {
  const region = options.region || "us-east-1";
  const stackName = options.stackName || "memstream-demo";
  const deployKey = options.deployObjectKey || "deploy/memstream-prebuilt.tgz";
  const templatePath = infraTemplatePath(options.root, INFRA_TEMPLATE.EC2);

  const memstreamUrl =
    options.memstreamDatabaseUrl ||
    process.env.MEMSTREAM_DATABASE_URL ||
    "";
  if (!memstreamUrl.trim()) {
    throw new Error(
      "MEMSTREAM_DATABASE_URL is required to deploy (platform DB + Connect)",
    );
  }
  if (!(process.env.MEMSTREAM_SECRETS_KEY || "").trim()) {
    log(
      options.job,
      "WARN: MEMSTREAM_SECRETS_KEY unset — Connect/Enable on EC2 cannot encrypt connection secrets",
    );
  }

  const databaseUrl = await resolveAppDatabaseUrl(
    options.databaseUrl,
    options.root,
  );
  if (databaseUrl) {
    log(
      options.job,
      "Application DB URL from Connect / DATABASE_URL (stored in Secrets Manager)",
    );
  } else {
    log(
      options.job,
      "No application DB URL yet — EC2 will load it from memstream_connections",
    );
  }

  const secret = await upsertDeployConfigSecret({
    stackName,
    region,
    values: {
      DATABASE_URL: databaseUrl || "",
      MEMSTREAM_DATABASE_URL: memstreamUrl,
      MEMSTREAM_SECRETS_KEY: process.env.MEMSTREAM_SECRETS_KEY || "",
    },
  });
  log(
    options.job,
    `Deploy config secret ${secret.name} (ARN not logged)`,
  );

  const resolved: DeployAwsOptions = {
    ...options,
    databaseUrl,
    memstreamDatabaseUrl: memstreamUrl,
  };

  log(
    options.job,
    `Packaging source → s3://${options.bucket}/${deployKey}`,
  );
  const tarball = packageSourceTarball(
    options.root,
    databaseUrl || undefined,
    memstreamUrl,
  );
  try {
    await uploadTarball(tarball, options.bucket, deployKey, region);
  } finally {
    rmSync(tarball, { force: true });
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
    log(options.job, "Waiting for stack create…");
    await waitForStackSettle({
      client: cfn,
      stackName,
      mode: "create",
      maxWaitSeconds: 900,
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
      log(options.job, "Waiting for stack update…");
      await waitForStackSettle({
        client: cfn,
        stackName,
        mode: "update",
        maxWaitSeconds: 900,
        job: options.job,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/No updates are to be performed/i.test(msg)) {
        log(
          options.job,
          "No stack updates needed (tarball refreshed in S3).",
        );
      } else {
        throw err;
      }
    }
  }

  const outs = await describeStackOutputs(stackName, region);
  const shopUrl = outs.ShopUrl || null;
  if (shopUrl) log(options.job, `Shop URL: ${shopUrl}`);
  return { shopUrl };
}

export async function describeStackOutputs(
  stackName: string,
  region: string,
): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region });
  try {
    const out = await cfn.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    const items = out.Stacks?.[0]?.Outputs || [];
    const map: Record<string, string> = {};
    for (const item of items) {
      if (item.OutputKey && item.OutputValue != null) {
        map[item.OutputKey] = item.OutputValue;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export type DeleteAwsStackOptions = {
  stackName: string;
  region: string;
  /** Wait for CloudFormation delete to finish (can take several minutes). */
  wait?: boolean;
  job?: Job;
};

/** Delete the Memstream EC2 CloudFormation stack. */
export async function deleteAwsStack(
  options: DeleteAwsStackOptions,
): Promise<{ deleted: boolean; waited: boolean }> {
  const { stackName, region, wait = false, job } = options;
  const cfn = new CloudFormationClient({ region });
  try {
    await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  } catch {
    log(job, `Stack ${stackName} not found (already gone)`);
    return { deleted: false, waited: false };
  }
  log(job, `Deleting CloudFormation stack ${stackName}…`);
  await cfn.send(new DeleteStackCommand({ StackName: stackName }));
  if (!wait) {
    log(job, `Stack ${stackName} delete started`);
    return { deleted: true, waited: false };
  }
  await waitForStackSettle({
    client: cfn,
    stackName,
    mode: "delete",
    maxWaitSeconds: 900,
    job,
  });
  log(job, `Deleted stack ${stackName}`);
  return { deleted: true, waited: true };
}
