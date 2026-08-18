/**
 * Deploy-time secrets — AWS Secrets Manager, not CloudFormation parameters.
 * CFN / Lambda only receive the secret ARN (non-sensitive).
 */

import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export type DeployConfigSecret = {
  DATABASE_URL?: string;
  MEMSTREAM_DATABASE_URL?: string;
  MEMSTREAM_SECRETS_KEY?: string;
  DEMO_APPLICATION_DATABASE_URL?: string;
  MEMSTREAM_DEMO_USER?: string;
  MEMSTREAM_DEMO_PASSWORD?: string;
};

const SECRET_KEYS = [
  "DATABASE_URL",
  "MEMSTREAM_DATABASE_URL",
  "MEMSTREAM_SECRETS_KEY",
  "DEMO_APPLICATION_DATABASE_URL",
  "MEMSTREAM_DEMO_USER",
  "MEMSTREAM_DEMO_PASSWORD",
] as const;

function compactSecret(values: DeployConfigSecret): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const v = values[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

/** Stable secret name per stack (EC2 demo or Lambda worker). */
export function deployConfigSecretName(stackName: string): string {
  const safe = stackName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_+=.@-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `memstream/${safe || "demo"}/config`;
}

export async function upsertDeployConfigSecret(options: {
  stackName: string;
  region: string;
  values: DeployConfigSecret;
}): Promise<{ arn: string; name: string }> {
  const name = deployConfigSecretName(options.stackName);
  const client = new SecretsManagerClient({ region: options.region });
  const secretString = JSON.stringify(compactSecret(options.values));

  try {
    const created = await client.send(
      new CreateSecretCommand({
        Name: name,
        Description: `Memstream deploy config for stack ${options.stackName}`,
        SecretString: secretString,
        Tags: [
          { Key: "app", Value: "memstream" },
          { Key: "stack", Value: options.stackName },
        ],
      }),
    );
    const arn = created.ARN;
    if (!arn) throw new Error(`CreateSecret returned no ARN for ${name}`);
    return { arn, name };
  } catch (err) {
    const exists =
      (err instanceof Error && err.name === "ResourceExistsException") ||
      (err instanceof Error &&
        /ResourceExistsException|already exists/i.test(err.message));
    if (!exists) throw err;
    const put = await client.send(
      new PutSecretValueCommand({
        SecretId: name,
        SecretString: secretString,
      }),
    );
    let arn = put.ARN;
    if (!arn) {
      const got = await client.send(
        new GetSecretValueCommand({ SecretId: name }),
      );
      arn = got.ARN;
    }
    if (!arn) throw new Error(`Could not resolve ARN for secret ${name}`);
    return { arn, name };
  }
}

export async function getDeployConfigSecret(
  secretId: string,
  region: string,
): Promise<DeployConfigSecret> {
  const client = new SecretsManagerClient({ region });
  const out = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const raw = out.SecretString;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const secret: DeployConfigSecret = {};
    for (const key of SECRET_KEYS) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) secret[key] = v;
    }
    return secret;
  } catch {
    return {};
  }
}

/**
 * If CONFIG_SECRET_ARN / MEMSTREAM_CONFIG_SECRET_ARN is set, load into process.env
 * (does not overwrite already-set non-empty values).
 */
export async function applyDeployConfigSecretFromEnv(
  region = process.env.AWS_REGION || "us-east-1",
): Promise<boolean> {
  const secretId =
    process.env.CONFIG_SECRET_ARN?.trim() ||
    process.env.MEMSTREAM_CONFIG_SECRET_ARN?.trim() ||
    "";
  if (!secretId) return false;
  const values = await getDeployConfigSecret(secretId, region);
  for (const key of SECRET_KEYS) {
    const v = values[key]?.trim();
    if (v && !process.env[key]?.trim()) {
      process.env[key] = v;
    }
  }
  return true;
}
