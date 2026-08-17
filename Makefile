.PHONY: help install-js test-engine demo-local demo-reset demo-reset-shop watch-cloud changefeed-dry changefeed mcp mcp-stdio web shop setup-db deploy-aws destroy-aws logs cockroach-ca synth-infra cdk-diff

.DEFAULT_GOAL := help

help:
	@echo "Memstream — common targets"
	@echo ""
	@echo "  Local (no cloud):"
	@echo "    make install-js     Install npm workspaces (Node 20+)"
	@echo "    make test-engine    Run engine unit tests"
	@echo "    make demo-local     Index examples/demo-events.jsonl → data/memstream-chunks-ts.json"
	@echo "    make web            Memstream console at http://127.0.0.1:3000"
	@echo "    make shop           Example Acme shop at http://127.0.0.1:3001"
	@echo "    make cockroach-ca   Download Cockroach Cloud CA → ~/.postgresql/root.crt"
	@echo ""
	@echo "  Cloud / AWS:"
	@echo "    cp .env.example .env   # CLUSTER_URL, CDC_S3_BUCKET, AWS_REGION"
	@echo "    make setup-db       Create memstream + application DBs + SQL"
	@echo "    make web            Connect → Configure → Enable (changefeed)"
	@echo "    make watch-cloud    Mode A: S3→Bedrock worker on your laptop"
	@echo "    make deploy-aws     Mode B: EC2 demo box (Caddy HTTPS via sslip.io; see docs/AWS.md)"
	@echo "    make destroy-aws    Tear down the EC2 stack"
	@echo "    make logs           Tail Lambda + EC2 logs in one terminal"
	@echo "    make synth-infra    CDK → infra/ec2.yaml + infra/lambda.yaml"
	@echo "    make mcp            Memstream MCP HTTP (:8765)"
	@echo ""
	@echo "  Demo rehearsal:"
	@echo "    make demo-reset     Full reset to demo start (shop + platform clutter)"
	@echo "    make demo-reset-shop  Shop + memory only (narrow)"
	@echo ""
	@echo "Docs: README.md · docs/AWS.md · docs/SELF_HOST.md"

install-js:
	npm install --no-fund --no-audit

cockroach-ca:
	bash scripts/cockroach-ca.sh

test-engine:
	npm run test:engine

demo-local:
	bash scripts/run-local-ts.sh

# Full reset to demo beginning (cancels Memstream changefeeds; does not destroy AWS).
demo-reset:
	set -a && . ./.env && set +a && \
	npm run demo-reset --

# Narrow: shop seed + memory + CDC keys only.
demo-reset-shop:
	set -a && . ./.env && set +a && \
	npm run demo-reset -- --shop

# Create memstream + application DBs and apply sql/*.sql
# Needs CLUSTER_URL or MEMSTREAM_DATABASE_URL / DATABASE_URL in .env
setup-db:
	npm run setup-db --

watch-cloud:
	set -a && . ./.env && set +a && \
	MEMSTREAM_WATCH=true bash scripts/run-cloud-ts.sh

# Ops escape hatch — prefer Enable in the console.
changefeed-dry:
	set -a && . ./.env && set +a && \
	npm run changefeed -- --dry-run

changefeed:
	set -a && . ./.env && set +a && \
	npm run changefeed --

mcp:
	set -a && . ./.env && set +a && \
	MEMSTREAM_MCP_TRANSPORT=$${MEMSTREAM_MCP_TRANSPORT:-http} npm run mcp:ts --

# Stdio MCP (Cursor spawns the process). Prefer `make mcp` HTTP + Copy Memstream MCP from the console.
mcp-stdio:
	set -a && . ./.env && set +a && \
	MEMSTREAM_MCP_TRANSPORT=stdio npm run mcp:ts --

web:
	set -a && . ./.env && set +a && \
	npm run build -w @memstream/engine && \
	npm run build -w @memstream/mcp && \
	NEXT_PUBLIC_SHOP_URL=$${NEXT_PUBLIC_SHOP_URL:-http://127.0.0.1:3001} \
	npm run dev -w web

shop:
	set -a && . ./.env && set +a && \
	npm run build -w @memstream/engine && \
	NEXT_PUBLIC_MEMSTREAM_URL=$${NEXT_PUBLIC_MEMSTREAM_URL:-http://127.0.0.1:3000} \
	npm run dev -w @memstream/example-shop

deploy-aws:
	bash scripts/deploy-aws.sh

destroy-aws:
	bash scripts/destroy-aws.sh

# One terminal: Lambda CloudWatch + EC2 journalctl (via SSM). LOGS=lambda|ec2|all
logs:
	bash scripts/tail-aws-logs.sh

synth-infra:
	npm run synth -w @memstream/infra

# Dev escape hatch — prefer make synth-infra.
cdk-diff:
	npm run build -w @memstream/infra
	cd infra/cdk && npx cdk diff MemstreamEc2 MemstreamLambda || true
