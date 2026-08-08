.PHONY: help install-js test-engine demo-local demo-reset shop watch-cloud changefeed-dry changefeed propose mcp mcp-stdio web setup-db deploy-aws destroy-aws cockroach-ca

.DEFAULT_GOAL := help

help:
	@echo "Memstream — common targets"
	@echo ""
	@echo "  Local (no cloud):"
	@echo "    make install-js     Install npm workspaces (Node 20+)"
	@echo "    make test-engine    Run engine unit tests"
	@echo "    make demo-local     Index examples/demo-events.jsonl → data/memstream-chunks-ts.json"
	@echo "    make web            Next console + shop at http://127.0.0.1:3000"
	@echo "    make cockroach-ca   Download Cockroach Cloud CA → ~/.postgresql/root.crt"
	@echo ""
	@echo "  Cloud / AWS:"
	@echo "    cp .env.example .env   # CLUSTER_URL, CDC_S3_BUCKET, AWS_REGION"
	@echo "    make setup-db       Create memstream + application DBs + SQL"
	@echo "    make web            Connect → Configure → Enable (changefeed)"
	@echo "    make watch-cloud    Mode A: S3→Bedrock worker on your laptop"
	@echo "    make deploy-aws     Mode B: EC2 shop + watcher (see docs/AWS.md)"
	@echo "    make destroy-aws    Tear down the EC2 stack"
	@echo "    make changefeed     CDC CLI (or use Enable in the console)"
	@echo "    make mcp            Memstream MCP HTTP (:8765)"
	@echo ""
	@echo "  Demo rehearsal:"
	@echo "    make demo-reset     Reset shop + tickets + memory chunks"
	@echo "    make shop           Print shop URL"
	@echo ""
	@echo "Docs: README.md · docs/AWS.md · docs/DEMO_SCRIPT.md"

install-js:
	npm install --no-fund --no-audit

cockroach-ca:
	bash scripts/cockroach-ca.sh

test-engine:
	npm run test:engine

demo-local:
	bash scripts/run-local-ts.sh

# Reset shop + memory for video rehearsal (does not destroy AWS).
demo-reset:
	set -a && . ./.env && set +a && \
	npm run demo-reset --

# Demo shop is part of the Next app.
shop:
	@echo "Start the console if needed: make web"
	@echo "Shop: http://127.0.0.1:3000/shop"

# Create memstream + application DBs and apply sql/*.sql
# Needs CLUSTER_URL or MEMSTREAM_DATABASE_URL / DATABASE_URL in .env
setup-db:
	npm run setup-db --

watch-cloud:
	set -a && . ./.env && set +a && \
	MEMSTREAM_WATCH=true bash scripts/run-cloud-ts.sh

changefeed-dry:
	set -a && . ./.env && set +a && \
	npm run changefeed -- --dry-run

changefeed:
	set -a && . ./.env && set +a && \
	npm run changefeed --

propose:
	set -a && . ./.env && set +a && \
	npm run propose -- --out profiles/discovered.yaml

mcp:
	set -a && . ./.env && set +a && \
	MEMSTREAM_MCP_TRANSPORT=$${MEMSTREAM_MCP_TRANSPORT:-http} npm run mcp:ts --

# Stdio MCP (Cursor spawns the process). Prefer `make mcp` HTTP + Copy Memstream MCP from the console.
mcp-stdio:
	set -a && . ./.env && set +a && \
	MEMSTREAM_MCP_TRANSPORT=stdio npm run mcp:ts --

web:
	npm run build -w @memstream/engine
	npm run build -w @memstream/mcp
	npm run dev -w web

deploy-aws:
	bash scripts/deploy-aws.sh

destroy-aws:
	bash scripts/destroy-aws.sh
