# AWS for Memstream

One path: AWS account → Cockroach DBs → Enable changefeed → run the worker.

Cockroach: platform URL in `.env` (`MEMSTREAM_DATABASE_URL`), application URL in Connect.  
Video / MCP ask: [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Overview: [README](../README.md).

---

## Steps

### 1. AWS account + IAM

1. Create an account at [aws.amazon.com](https://aws.amazon.com/) (payment method required).
2. MFA on root. Create IAM user `memstream-dev` (not root for daily work).
3. Attach `AmazonS3FullAccess` + `AmazonBedrockFullAccess` (or tighter S3 + `bedrock:InvokeModel`).
4. Create CLI access key. Copy the secret once.
5. If `make deploy-aws` is denied, render a bucket-scoped deployer policy and attach it:

```bash
# needs CDC_S3_BUCKET in .env
bash scripts/render-deployer-policy.sh
aws iam put-user-policy --user-name memstream-dev \
  --policy-name memstream-deployer \
  --policy-document file://infra/deployer-policy.json
```

Template: `infra/deployer-policy.json.template` (S3 limited to `${CDC_S3_BUCKET}`).
### 2. CLI

```bash
aws configure          # region us-east-1, output json
aws sts get-caller-identity
```

### 3. S3 bucket

```bash
export AWS_REGION=us-east-1
export CDC_S3_BUCKET=memstream-cdc-<yourname>-<random>
aws s3 mb "s3://${CDC_S3_BUCKET}" --region "$AWS_REGION"
```

Same name goes in `.env` as `CDC_S3_BUCKET`.

### 4. Bedrock smoke test

Titan Embed V2 is on by default (no model-access page). Model: `amazon.titan-embed-text-v2:0`.

```bash
aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id amazon.titan-embed-text-v2:0 \
  --content-type application/json \
  --accept application/json \
  --body '{"inputText":"hello","dimensions":1024,"normalize":true}' \
  /tmp/bedrock-out.json
```

Access denied → IAM or wrong region.

### 5. Budget

Billing → Budgets → alert at $5 and $10. Skip Knowledge Bases / OpenSearch.

### 6. `.env`

```bash
cp .env.example .env
```

Quote Cockroach URLs (`&` breaks unquoted `source .env`):

```bash
CLUSTER_URL='postgresql://.../defaultdb?sslmode=verify-full'
COCKROACH_CLUSTER_ID=…          # Cloud Overview → make cockroach-ca
MEMSTREAM_SECRETS_KEY=$(openssl rand -hex 32)
# Optional lock for console APIs (also set NEXT_PUBLIC_… for the browser):
# MEMSTREAM_CONSOLE_TOKEN=…
# NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN=…
CDC_S3_BUCKET=memstream-cdc-yourname
CDC_S3_PREFIX=cdc/
AWS_REGION=us-east-1
BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0
MEMSTREAM_EMBEDDER=bedrock
MEMSTREAM_STORE=cockroach
MEMSTREAM_SOURCE=s3
MEMSTREAM_WORKER_COMPUTE=ec2   # or lambda
# Optional keyless CDC sink (AUTH=implicit + ASSUME_ROLE):
# MEMSTREAM_CDC_ROLE_ARN=arn:aws:iam::ACCOUNT:role/memstream-cdc
```

AWS keys: `aws configure` → `~/.aws/credentials` is enough (no keys in `.env`).
Connect URLs should use `sslmode=verify-full` **without** `sslrootcert=` — CA comes from `PGSSLROOTCERT` / `~/.postgresql/root.crt`.
### 7. Databases + CA (run before the app / deploy)

```bash
make setup-db          # platform only: memstream DB + sql/memstream.sql + profile seed
make cockroach-ca      # needs COCKROACH_CLUSTER_ID → ~/.postgresql/root.crt
```

1. Put the printed **memstream** URL in `.env` as `MEMSTREAM_DATABASE_URL`.
2. Set `MEMSTREAM_SECRETS_KEY` (`openssl rand -hex 32`) before Connect saves.
3. CA via `make cockroach-ca` (or download to `~/.postgresql/root.crt`).

**Application schema** (shop tables + `agent_memory_chunks` vector memory) is **not** part of `setup-db`. Connect → **Enable** applies `sql/application.sql` on the Connect URL (with VECTOR INDEX retry if needed).
### 8. Connect → Enable

```bash
make web
```

1. **Connect** — paste the printed **application** URL.
2. **Configure** — profile `commerce`.
3. **Enable** — creates changefeed → S3 (`orders`, `stock`, `tickets`).

Verify: `aws s3 ls "s3://${CDC_S3_BUCKET}/cdc/" --recursive` after a shop write.

### 9. Run the worker

**A — laptop** (debug):

```bash
make watch-cloud
# shop: http://127.0.0.1:3000/shop
```

**B — EC2** (demo on AWS):

```bash
make deploy-aws
# requires Docker (Colima/OrbStack/Desktop) — builds Next standalone locally; EC2 only unpacks + runs
# Apple Silicon / Colima defaults to linux/arm64 + t4g.micro (qemu amd64 next build SIGSEGVs)
# wait until the script prints "Shop is up" (~1–2 min after stack create)
# optional: SHOP_CIDR=YOUR_PUBLIC_IP/32 to lock the SG to your IP
# shell: aws ssm start-session (no SSH ingress)
```
Or in Enable: check **Start memory worker in the cloud**.

**Lambda** instead of EC2 watch: set `MEMSTREAM_WORKER_COMPUTE=lambda`, or in Enable → Advanced pick **Lambda**. Works from laptop or the EC2 console (prebuilt ships `infra/lambda.yaml` + zip; Enable stops `memstream-watch`). Do not run EC2 watch and Lambda on the same bucket/prefix.

### 10. Tear down

```bash
make destroy-aws    # EC2 stack only
```

Lambda: delete the run in the console, or delete `${STACK_NAME}-lambda` in CloudFormation. S3 + Cockroach stay.

---

## Cheat sheet

| | |
| --- | --- |
| Stack name | `memstream-demo` (EC2) / `memstream-demo-lambda` |
| Shop CIDR | `SHOP_CIDR` (default `0.0.0.0/0` — tighten to your IP/`32`) |
| Instance | `INSTANCE_TYPE=t3.micro` |
| Update EC2 code | `make destroy-aws && make deploy-aws` |
| EC2 logs | SSM → `journalctl -u memstream-shop -u memstream-watch -f` |
| Lambda logs | `aws logs tail /aws/lambda/memstream-demo-lambda-worker --follow` |
| CDC without long-lived keys | `MEMSTREAM_CDC_ROLE_ARN` + trust Cockroach Cloud identity (AUTH=implicit) |

Stacks do **not** create the Cockroach cluster, changefeed, or public MCP.

---

## Changefeed S3 auth

Changefeed runs **inside Cockroach Cloud**, not on your EC2/Lambda role.

- **Default:** Enable embeds AWS credentials from your laptop provider chain into `CREATE EXTERNAL CONNECTION` (often temporary STS keys). Prefer not committing long-lived keys.
- **Better (Cockroach Cloud Advanced):** create an IAM role your cluster can assume, set `MEMSTREAM_CDC_ROLE_ARN`, and trust Cockroach’s managed identity — sink URI uses `AUTH=implicit&ASSUME_ROLE=…` with no access keys. See [Cloud Storage Authentication](https://www.cockroachlabs.com/docs/stable/cloud-storage-authentication).

**Manual SQL (keys):**

```sql
CREATE EXTERNAL CONNECTION memstream_s3 AS
  's3://YOUR_BUCKET/cdc?AWS_ACCESS_KEY_ID=...&AWS_SECRET_ACCESS_KEY=...&AWS_REGION=us-east-1';
CREATE CHANGEFEED FOR TABLE orders, stock, tickets
  INTO 'external://memstream_s3' WITH updated, diff, format = json;
```

**Manual SQL (assume role):**

```sql
CREATE EXTERNAL CONNECTION memstream_s3 AS
  's3://YOUR_BUCKET/cdc?AUTH=implicit&ASSUME_ROLE=arn%3Aaws%3Aiam%3A%3A123456789012%3Arole%2Fmemstream-cdc&AWS_REGION=us-east-1';
```

---

## Alternatives (optional)

**Changefeed CLI** (needs `DATABASE_URL` in the shell):

```bash
set -a && source .env && set +a
make changefeed-dry && make changefeed
# full demo tables: MEMSTREAM_CHANGEFEED_TABLES=orders,stock,tickets
```

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Unable to locate credentials` | `aws configure` |
| Bedrock `AccessDeniedException` | IAM `bedrock:InvokeModel` / region |
| `NoSuchBucket` | Bucket name vs `AWS_REGION` |
| Cockroach SSL / auth | `PGSSLROOTCERT` / `make cockroach-ca`; URL `sslmode=verify-full` |
| `MEMSTREAM_SECRETS_KEY required` | `openssl rand -hex 32` in `.env`, then redeploy (`UserData` only runs on new instances) |
| Enable on EC2: `Missing template …/infra/ec2.yaml` | EC2 redeploy is skipped on prebuilt; for Lambda, redeploy so the artifact includes `infra/lambda.yaml` + `deploy/memstream-lambda.zip` |
| Enable on EC2: `s3:PutObject` AccessDenied | InstanceRole needs write on `${CDC_S3_PREFIX}*` — update stack (`make deploy-aws`); IAM applies without replace |
| ShopUrl unreachable | Wait for userdata; check console for `next build` errors; confirm `SHOP_CIDR` includes your IP |
| No S3 objects | Changefeed job; sink IAM / `MEMSTREAM_CDC_ROLE_ARN`; table names |
| Chunks empty | Profile rules; `diff`; cursor skipping keys |

Do not commit `.env` or paste secrets into chat.
