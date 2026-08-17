# Memstream deploy and operate

AWS setup, self-host, and the EC2 demo box.

Overview: [README](../README.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Paths

| Path | Use when | What you run |
| --- | --- | --- |
| Managed Lambda | Default for cloud | Console, application DB, S3, Lambda worker |
| Laptop worker | Debugging | Console locally, worker via `make watch-cloud` |
| EC2 demo box | Short-lived demo or single-box self-host | Console, shop, and optional worker on one EC2 instance |

The sequence is the same for all of them:

1. Create or reuse an AWS account.
2. Create an S3 bucket for Cockroach changefeed output.
3. Configure `.env`.
4. Create the Memstream platform DB and Cockroach CA.
5. Run the console and click Connect, Configure, Enable.
6. Run exactly one worker for that bucket/prefix.

---

## 1. AWS account and IAM

1. Create an account at [aws.amazon.com](https://aws.amazon.com/).
2. Turn on MFA for the root user.
3. Create a daily-use IAM user such as `memstream-dev`.
4. Attach:
   - `AmazonS3FullAccess` or a tighter bucket policy
   - `AmazonBedrockFullAccess` or at least `bedrock:InvokeModel`
5. Create a CLI access key and save the secret once.

If deploy or Enable needs more permissions, render the managed deployer policy:

```bash
# needs CDC_S3_BUCKET in .env
MEMSTREAM_ATTACH_DEPLOYER_POLICY=1 bash scripts/render-deployer-policy.sh
```

That renders from `infra/deployer-policy.json.template`. The rendered `infra/deployer-policy.json` is local and gitignored because it includes your bucket name.

Secrets go to Secrets Manager under `memstream/<stack>/config`. CloudFormation gets only the secret ARN.

If you edit infra, change TypeScript in `infra/cdk/` and run:

```bash
make synth-infra
```

That writes `infra/ec2.yaml` and `infra/lambda.yaml`, which are the templates used by deploy and Enable.

---

## 2. AWS CLI and bucket

```bash
aws configure
aws sts get-caller-identity
```

Create a bucket for changefeed objects:

```bash
export AWS_REGION=us-east-1
export CDC_S3_BUCKET=memstream-cdc-<yourname>-<random>
aws s3 mb "s3://${CDC_S3_BUCKET}" --region "$AWS_REGION"
```

Set AWS Billing budget alerts at `$5` and `$10` if you want a spend cap.

---

## 3. Bedrock smoke test

Titan Embed V2 is the default model:

```bash
aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id amazon.titan-embed-text-v2:0 \
  --content-type application/json \
  --accept application/json \
  --body '{"inputText":"hello","dimensions":1024,"normalize":true}' \
  /tmp/bedrock-out.json
```

If this fails with `AccessDenied`, fix IAM or region before continuing.

---

## 4. Platform config

```bash
cp .env.example .env
```

Minimum:

```bash
CLUSTER_URL='postgresql://.../defaultdb?sslmode=verify-full'
COCKROACH_CLUSTER_ID=...
MEMSTREAM_SECRETS_KEY=$(openssl rand -hex 32)
CDC_S3_BUCKET=memstream-cdc-yourname
CDC_S3_PREFIX=cdc/
AWS_REGION=us-east-1
BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0
MEMSTREAM_EMBEDDER=bedrock
MEMSTREAM_STORE=cockroach
MEMSTREAM_SOURCE=s3
MEMSTREAM_WORKER_COMPUTE=lambda   # or ec2 for demo / self-host box
```

Optional extra lock for a shared box:

```bash
MEMSTREAM_CONSOLE_TOKEN=$(openssl rand -hex 24)
NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN=$MEMSTREAM_CONSOLE_TOKEN
```

Do not reuse `MEMSTREAM_SECRETS_KEY` as a browser token. Keep AWS credentials in `~/.aws/credentials`, not in `.env`.

Cockroach URLs should use `sslmode=verify-full` without `sslrootcert=`. The CA comes from `PGSSLROOTCERT` or `~/.postgresql/root.crt`.

---

## 5. Create the databases

```bash
make setup-db
make cockroach-ca
```

Then:

1. Put the printed memstream URL into `.env` as `MEMSTREAM_DATABASE_URL`.
2. Keep your application DB URL for the console Connect step.
3. Confirm `MEMSTREAM_SECRETS_KEY` is set before Connect stores anything.

`make setup-db` creates only the platform DB. Application tables and `agent_memory_chunks` are applied when you click Enable on the application connection.

---

## 6. Run the control plane

Local console:

```bash
make install-js
make web
```

Optional demo shop:

```bash
make shop
```

In the browser:

1. Connect with the application DB URL.
2. Configure a profile such as `commerce`.
3. Enable to create schema, changefeed, and the selected worker path.

Health probe:

```bash
curl -s http://localhost:3000/api/health
```

---

## 7. Worker options

Run only one consumer per bucket/prefix.

### A. Managed Lambda

Default for cloud. Leave Start managed cloud worker on in Enable, or set `MEMSTREAM_WORKER_COMPUTE=lambda` in `.env`. Enable deploys the `*-lambda` stack and wires S3 to Lambda.

Logs:

```bash
make logs
# or
make logs LOGS=lambda
```

### B. Laptop worker

```bash
make watch-cloud
```

Turn off the managed worker in Enable if you use this path.

### C. EC2 demo / self-host box

```bash
MEMSTREAM_WORKER_COMPUTE=ec2 make deploy-aws
```

- Requires Docker locally to build the standalone app artifact.
- Wait for the script to print `Shop is up`.
- Optional: `SHOP_CIDR=YOUR_PUBLIC_IP/32` to limit public access.
- Shell access is through SSM, not SSH.

```bash
aws ssm start-session
```

The EC2 path can run console, shop, and optionally `memstream-watch` on the instance. Do not run that worker and Lambda against the same CDC prefix at the same time.

---

## 8. Self-host notes

Self-host uses the same packages:

- `apps/web` for the console and APIs
- `packages/engine` for changefeed, indexing, deploy, and worker logic
- `packages/mcp` for `search_memory`

You operate the platform DB (`MEMSTREAM_DATABASE_URL`), the console host, one worker path, and your AWS account and bucket.

Application tables and `agent_memory_chunks` still live in the customer application database.

Short version: [SELF_HOST.md](SELF_HOST.md).

---

## 9. Changefeed S3 auth

The changefeed runs inside Cockroach Cloud, not on your laptop, EC2 role, or Lambda role.

On the default path, deploy creates a dedicated IAM user with long-lived S3 credentials scoped to `${CDC_S3_PREFIX}`. Enable stores those credentials in `CREATE EXTERNAL CONNECTION`. Re-run Enable after deploy so the external connection is recreated with the fresh sink credentials.

Do not Enable from a laptop that only has `aws sso login` or `AWS_SESSION_TOKEN`. Those temporary session tokens are not used for the Cockroach sink.

For Cockroach Cloud setups that trust the cluster identity on a role, set `MEMSTREAM_CDC_ROLE_ARN` to use `AUTH=implicit&ASSUME_ROLE=...`.

Reference: [Cloud Storage Authentication](https://www.cockroachlabs.com/docs/stable/cloud-storage-authentication).

---

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| `Unable to locate credentials` | `aws configure` and `aws sts get-caller-identity` |
| Bedrock `AccessDeniedException` | IAM `bedrock:InvokeModel` and region |
| `NoSuchBucket` | Bucket name and `AWS_REGION` |
| Cockroach SSL or auth error | `make cockroach-ca`, `PGSSLROOTCERT`, `sslmode=verify-full` |
| `MEMSTREAM_SECRETS_KEY required` | Add it to `.env`, then redeploy the EC2 box |
| Missing `infra/ec2.yaml` or `infra/lambda.yaml` | Run `make synth-infra` |
| EC2 `s3:PutObject` denied | Update the EC2 stack so the instance role gets the latest S3 permissions |
| Changefeed `ExpiredToken` | Re-enable with the dedicated sink credentials, not SSO session creds |
| Lambda Secrets Manager denied | Update the stack so the execution role can create or read `memstream/*` secrets |
| `ShopUrl` or `ConsoleUrl` unreachable | Wait for userdata and TLS, confirm `SHOP_CIDR`, check `journalctl -u caddy` |
| No S3 objects | Check the changefeed job, sink auth, bucket prefix, and watched tables |
| Live chunks empty | Check profile rules, source rows, and worker logs |

Do not commit `.env` or paste secrets into chat.

---

## 11. Tear down

```bash
make destroy-aws
```

That destroys the EC2 demo stack only.

For Lambda, delete the run in the console or remove the `*-lambda` CloudFormation stack. S3 and Cockroach remain until you remove them yourself.
