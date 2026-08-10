# Architecture Review: Memstream

**Review Date**: August 8, 2026  
**Product**: Memstream - Live agent memory for CockroachDB applications  
**Stage**: Hackathon MVP → Production-ready product  
**Tech Stack**: TypeScript, Next.js 15, React 19, CockroachDB, AWS (S3, Bedrock, EC2)

> **Status (2026-08-08):** Locked product calls and what’s shipped live in [`TARGET_ARCHITECTURE.md`](./TARGET_ARCHITECTURE.md). This file remains the original review dump; checkmarks below mark progress against it.

### Implementation status (vs this review)

| Item | Status |
| --- | --- |
| Console feature split (Issue #1) | ✅ Partial — UI in `features/console/`; orchestrator still large (Zustand rewrite backlog) |
| Fragmented state (Issue #2) | ✅ Done — `PlatformState`; runs DB SoT; `session.env` retired |
| Dual DB / multi-tenancy model | ✅ Clarified — keep split; orgs + workspace (`connection_id`) |
| Secrets in CFN params | ✅ Done — Secrets Manager `ConfigSecretArn` |
| DB connection pooling | ✅ Done — pooled `withClient*` in `db.ts` |
| `/api/health` | ✅ Done |
| Graceful CLI shutdown | ✅ Done — SIGINT/SIGTERM + `closePools` |
| CDK migrate (Task 3.2) | ✅ Done — `infra/cdk` synth → committed `infra/*.yaml` (do **not** delete YAML) |
| Retry + circuit breakers (Task 2.3) | ✅ Done — cockatiel on Bedrock + S3 |
| API rate limiting (Task 2.3) | ✅ Done — `guardConsoleApi` / `checkRateLimit` |
| Env validation (Quick Win #5) | ✅ Done — `apps/web/src/lib/env.ts` (zod) |
| Magic strings | ✅ Done — `packages/engine/src/constants.ts` (`RUN_STATUS`, `WORKER_COMPUTE`, …) |
| Typed API client | ✅ Done |
| AES key via AWS KMS | ❌ Backlog |
| Zustand console state | ❌ Backlog |
| Observability (Task 2.2) | ❌ Backlog (pino / metrics / Sentry) |

---

## Executive Summary

### Current State
- ✅ Successfully migrated from Python to TypeScript
- ✅ Clean domain separation with monorepo structure
- ✅ Working end-to-end with real AWS infrastructure
- ✅ **CRITICAL (partial)**: Console split — features extracted; orchestrator remains (~1.3k lines)
- ✅ **HIGH**: PlatformState unifies CDC / jobs / connections (`session.env` gone)
- ✅ **HIGH**: Dual-DB kept by design; orgs + workspace on platform DB
- ✅ **MEDIUM**: CDK source of truth; generated CFN YAML for Enable
- ✅ **SECURITY**: Deploy secrets via Secrets Manager (not CFN param values)

### Estimated Refactoring Effort
- **Critical fixes** (maintainability): 40-60 hours — *mostly landed; Zustand optional*
- **Production hardening** (reliability): 30-40 hours — *pool, health, shutdown done; more observability backlog*
- **Architecture evolution** (scalability): 60-80 hours  
- **Total**: ~150 hours over 2 months

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [Architecture Problems](#2-architecture-problems)
3. [Code Quality Issues](#3-code-quality-issues)
4. [Security Issues](#4-security-issues)
5. [Production Readiness Gaps](#5-production-readiness-gaps)
6. [Refactoring Roadmap](#6-refactoring-roadmap)
7. [Quick Wins](#7-quick-wins-do-these-first)
8. [Things to Remove](#8-things-to-remove)
9. [Implementation Guides](#9-implementation-guides)

---

## 1. Critical Issues

### Issue #1: The 2,620-Line Console Component 🔴 → ✅ PARTIAL

**Status**: Feature modules under `apps/web/src/features/console/` (Connect / Configure / Enable / Live / Runs). `console-app.tsx` remains an orchestrator (~1.3k). Full Zustand provider rewrite is backlog.

**Problem**:
- Single component with 2,620 lines
- 42 separate `useState` hooks
- Violates Single Responsibility Principle
- Impossible to test effectively
- Re-renders entire tree on any state change
- Business logic mixed with UI rendering

**Current Structure**:
```tsx
export function ConsoleApp() {
  // State (42 hooks!)
  const [modal, setModal] = useState<Modal>(null);
  const [connect, setConnect] = useState<ConnectConfig>(defaultConnect);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profilePath, setProfilePath] = useState("profiles/commerce.yaml");
  // ... 38 more useState hooks ...

  // Effects
  useEffect(() => { /* 100+ lines of boot logic */ }, []);
  useEffect(() => { /* polling */ }, [watching, credentialsSet, refreshPipeline]);
  
  // Handlers (20+ functions, 500+ lines)
  const onConnect = async () => { /* 30 lines */ };
  const onConfigure = async () => { /* 40 lines */ };
  const onEnable = async () => { /* 50 lines */ };
  // ... 17 more handlers ...

  // Render (1,500+ lines)
  return (
    <div>
      {/* Header */}
      {/* Main content with 5+ conditional sections */}
      {/* 5 modals (Connect, Configure, Enable, Runs, Delete) */}
    </div>
  );
}
```

**Target Structure**:
```
apps/web/src/
  features/
    connection/
      - ConnectionModal.tsx       (150 lines)
      - useConnection.ts         (80 lines)
      - connection-api.ts        (50 lines)
    configuration/
      - ConfigureModal.tsx       (180 lines)
      - ProfileTemplateTab.tsx   (100 lines)
      - DiscoverTab.tsx          (120 lines)
      - useProfiles.ts           (90 lines)
      - profile-api.ts           (60 lines)
    enable/
      - EnableModal.tsx          (200 lines)
      - EnableProgress.tsx       (100 lines)
      - useEnableFlow.ts         (120 lines)
      - enable-api.ts            (70 lines)
    memory/
      - MemoryView.tsx           (150 lines)
      - MemoryMetrics.tsx        (80 lines)
      - RecentChunks.tsx         (100 lines)
      - useMemoryStats.ts        (90 lines)
      - memory-api.ts            (50 lines)
    runs/
      - RunsSheet.tsx            (150 lines)
      - RunsList.tsx             (100 lines)
      - useRuns.ts               (80 lines)
      - runs-api.ts              (50 lines)
  providers/
    - AppStateProvider.tsx       (100 lines - Zustand)
  pages/
    - ConsolePage.tsx            (300 lines - orchestration only)
```

**Priority**: 🔴 CRITICAL - Do this first → ✅ PARTIAL (see status table)

---

### Issue #2: Fragmented State Management 🔴 → ✅ DONE

**Status**: `PlatformState` (`packages/engine/src/state-manager.ts`) — CDC via `cdcKeys`/`buildKeyState`, jobs via `getJob` (JobStore cache + `memstream_runs`), connections via platform DB. `session.env` no longer written.

```typescript
// 1. In-Memory (lost on restart)
const jobStore = new JobStore();

// 2. Filesystem
ProcessedState.fromFile('.memstream-state/state.json')

// 3. Database
DbProcessedState(databaseUrl) // memstream_cdc_keys table

// 4. Session files
writeSessionEnv({ DATABASE_URL: "..." }) // session.env file
```

**Issues**:
- No single source of truth
- State can drift between stores
- Hard to debug
- Race conditions possible
- Restart loses in-memory state

**Solution**: Database-first with optional cache

```typescript
// packages/engine/src/state-manager.ts

interface StateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class UnifiedStateManager {
  private cache = new Map<string, { value: string; expires: number }>();
  private readonly ttl = 5000; // 5 second cache

  constructor(
    private db: StateStore,
    private cacheEnabled = true
  ) {}

  async get(key: string): Promise<string | null> {
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) {
        return cached.value;
      }
    }

    // Fallback to database
    const value = await this.db.get(key);
    
    if (value && this.cacheEnabled) {
      this.cache.set(key, { value, expires: Date.now() + this.ttl });
    }

    return value;
  }

  async set(key: string, value: string): Promise<void> {
    // Write-through: DB first, then cache
    await this.db.set(key, value);
    
    if (this.cacheEnabled) {
      this.cache.set(key, { value, expires: Date.now() + this.ttl });
    }
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(key);
    this.cache.delete(key);
  }

  clearCache() {
    this.cache.clear();
  }
}

// Usage
const stateManager = new UnifiedStateManager(
  new DatabaseStateStore(memstreamDatabaseUrl)
);

// All state operations go through this
await stateManager.set('last_processed_key', cdcKey);
const lastKey = await stateManager.get('last_processed_key');
```

**Priority**: 🔴 CRITICAL → ✅ DONE (`PlatformState`)

---

**Current Setup**:
```
┌─────────────────────────────────────────┐
│  Memstream Platform DB                  │
│  (MEMSTREAM_DATABASE_URL)               │
│  - memstream_runs                       │
│  - memstream_connections (encrypted)    │
│  - memstream_profiles                   │
│  - memstream_cdc_keys                   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Application DB                         │
│  (DATABASE_URL from Connect modal)      │
│  - customers, orders, stock (app data)  │
│  - agent_memory_chunks (VECTOR)         │
└─────────────────────────────────────────┘
```

**Problems**:
1. No clear multi-tenancy story
2. Confusion about "whose data lives where"
3. Two connection strings to manage
4. No atomic transactions across boundaries
5. PLAN.md says this is temporary but it's fully implemented

**Decision Required**: Choose one path forward

**Option A: Single Database (Recommended for MVP)**
```sql
-- One DATABASE_URL with schemas
CREATE SCHEMA IF NOT EXISTS memstream;

-- Platform tables
CREATE TABLE memstream.runs (...);
CREATE TABLE memstream.connections (...);
CREATE TABLE memstream.profiles (...);

-- Application tables
CREATE TABLE public.customers (...);
CREATE TABLE public.orders (...);

-- Memory (co-located with app data)
CREATE TABLE public.agent_memory_chunks (...);
```

**Benefits**:
- Simpler deployment (one connection string)
- Atomic transactions
- One connection pool
- Clear path to multi-tenancy (add `tenant_id`)
- Less confusion

**Option B: Keep Separation (Multi-tenant SaaS)**
```typescript
// Explicit workspace model
interface TenantWorkspace {
  id: string;
  name: string;
  platformDbUrl: string;     // Shared: all metadata
  applicationDbUrl: string;  // Isolated: customer data
}

// Clear boundaries documented
// Platform DB: Runs, connections, profiles, CDC tracking
// Application DB: App tables + memory chunks (per customer)
```

**Action**: Decide based on product direction
- **Staying single-tenant demo**: Merge databases (Option A)
- **Building multi-tenant SaaS**: Document boundaries clearly (Option B)

**Priority**: ⚠️ HIGH

---

## 2. Architecture Problems

### Problem: Infrastructure as YAML → ✅ DONE

**Status**: AWS CDK TypeScript is the source of truth (`infra/cdk/`). `make synth-infra` writes generated `infra/ec2.yaml` + `infra/lambda.yaml` for Enable / CloudFormation deploy. Edit stacks in CDK, not by hand in YAML. Do **not** delete the generated templates.
```yaml
# infra/ec2.yaml
AWSTemplateFormatVersion: "2010-09-09"
Parameters:
  InstanceType:
    Type: String
    Default: t3.micro
```

**Problem**: You're TypeScript experts writing YAML

**Recommendation**: AWS CDK
```typescript
// infra/memstream-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface MemstreamStackProps extends cdk.StackProps {
  cdcBucket: string;
  databaseUrl: string;
  instanceType?: ec2.InstanceType;
}

export class MemstreamStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly shopUrl: string;

  constructor(scope: Construct, id: string, props: MemstreamStackProps) {
    super(scope, id, props);

    // Security group
    const sg = new ec2.SecurityGroup(this, 'MemstreamSG', {
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true }),
      description: 'Memstream console/shop',
      allowAllOutbound: true
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'Console');

    // IAM role
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
      ]
    });

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${props.cdcBucket}`,
        `arn:aws:s3:::${props.cdcBucket}/*`
      ]
    }));

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*']
    }));

    // EC2 instance
    this.instance = new ec2.Instance(this, 'MemstreamInstance', {
      instanceType: props.instanceType || ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      vpc: ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true }),
      role,
      securityGroup: sg,
      userData: this.createUserData(props)
    });

    // Outputs (type-safe!)
    this.shopUrl = `http://${this.instance.instancePublicDnsName}:3000/shop`;
    new cdk.CfnOutput(this, 'ShopUrl', { value: this.shopUrl });
  }

  private createUserData(props: MemstreamStackProps): ec2.UserData {
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf install -y nodejs tar gzip',
      `export DATABASE_URL="${props.databaseUrl}"`,
      'cd /opt/memstream',
      // ... rest of setup
    );
    return userData;
  }
}

// infra/bin/deploy.ts
const app = new cdk.App();
new MemstreamStack(app, 'MemstreamDemo', {
  cdcBucket: process.env.CDC_S3_BUCKET!,
  databaseUrl: process.env.DATABASE_URL!
});
```

**Benefits**:
- Type safety
- IDE autocomplete
- Reusable constructs
- Better testing
- Same language as app
- Easier refactoring

**Migration Path**:
1. Install CDK: `npm install -D aws-cdk-lib constructs`
2. Create `infra/` TypeScript stack
3. Test against staging
4. Switch from `make deploy-aws` (bash + cfn) to `cdk deploy`
5. Remove YAML files

**Priority**: ⚠️ MEDIUM (do after critical fixes)

---

### Problem: No Observability

**Missing**:
- Structured logging
- Metrics collection
- Error tracking
- Distributed tracing
- Health checks

**Add Observability Layer**:

```typescript
// packages/engine/src/observability/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  base: {
    service: 'memstream',
    environment: process.env.NODE_ENV,
  },
});

// Usage
logger.info({ 
  msg: 'Processing CDC batch',
  bucket: 'my-bucket',
  keys: 15,
  duration_ms: 234 
});
```

```typescript
// packages/engine/src/observability/metrics.ts
import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const metrics = {
  chunksProcessed: new Counter({
    name: 'memstream_chunks_processed_total',
    help: 'Total memory chunks created',
    labelNames: ['profile', 'table', 'rule'],
    registers: [registry]
  }),
  
  cdcProcessingDuration: new Histogram({
    name: 'memstream_cdc_processing_duration_seconds',
    help: 'Time to process CDC batch',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [registry]
  }),
  
  embeddingRequests: new Counter({
    name: 'memstream_embedding_requests_total',
    help: 'Total embedding API calls',
    labelNames: ['model', 'status'],
    registers: [registry]
  })
};

// Usage
const end = metrics.cdcProcessingDuration.startTimer();
try {
  await processBatch();
  metrics.chunksProcessed.inc({ profile: 'commerce', table: 'orders', rule: 'status_change' });
} finally {
  end();
}
```

```typescript
// packages/engine/src/observability/tracing.ts
import * as Sentry from '@sentry/node';

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

export function wrapWithTracing<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const transaction = Sentry.startTransaction({ op: operation });
  
  return fn()
    .then(result => {
      transaction.setStatus('ok');
      return result;
    })
    .catch(error => {
      transaction.setStatus('internal_error');
      Sentry.captureException(error);
      throw error;
    })
    .finally(() => transaction.finish());
}
```

**Add Metrics Endpoint**:
```typescript
// apps/web/src/app/api/metrics/route.ts
import { metrics } from '@memstream/engine/observability';

export async function GET() {
  return new Response(await metrics.registry.metrics(), {
    headers: { 'Content-Type': metrics.registry.contentType }
  });
}
```

**Priority**: ⚠️ HIGH (needed for production)

---

## 3. Code Quality Issues

### Issue: Inconsistent Error Handling

**Current**: Three different patterns
```typescript
// Pattern 1: Silent failure
try {
  await consoleFetch("/api/profiles");
} catch {
  /* ignore prefill failures */
}

// Pattern 2: setState
if (!res.ok) {
  setError(data.detail || "API unreachable");
  return;
}

// Pattern 3: Throw
throw new Error("Connection failed");
```

**Solution**: Unified error handling with Result types

```typescript
// lib/result.ts
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => 
  ({ ok: true, value });

export const Err = <E>(error: E): Result<never, E> => 
  ({ ok: false, error });

// lib/errors.ts
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromResponse(res: Response, data: any): ApiError {
    return new ApiError(
      data.code || 'API_ERROR',
      data.detail || data.message || 'Request failed',
      res.status,
      data
    );
  }
}

export class ValidationError extends Error {
  constructor(message: string, public fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ValidationError';
  }
}

// lib/api-client.ts
export async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<Result<T, ApiError>> {
  try {
    const res = await fetch(endpoint, options);
    const data = await res.json();
    
    if (!res.ok) {
      return Err(ApiError.fromResponse(res, data));
    }
    
    return Ok(data as T);
  } catch (e) {
    if (e instanceof ApiError) {
      return Err(e);
    }
    return Err(new ApiError(
      'NETWORK_ERROR',
      e instanceof Error ? e.message : 'Network request failed'
    ));
  }
}

// Usage in components
const result = await apiCall<ProfileInfo[]>('/api/profiles');

if (!result.ok) {
  // Type-safe error handling
  if (result.error.code === 'NOT_FOUND') {
    setError('Profiles not found');
  } else {
    setError(result.error.message);
  }
  return;
}

// Type-safe success
const profiles = result.value; // ProfileInfo[]
setProfiles(profiles);
```

**Priority**: ⚠️ MEDIUM

---

### Issue: Database Connection Leaks → ✅ DONE (pooling)

**Status**: `packages/engine/src/db.ts` caches `pg.Pool` per URL; `withClient*` checkout/release; `closePools()` on CLI shutdown. Worker `store-cockroach` still Client-per-call by design.

**Current**: Manual connection management
```typescript
// Scattered throughout codebase
const client = await pg.connect();
await client.query("SELECT ...");
// ⚠️ No guarantee of release on error
```

**Solution**: Resource management pattern

```typescript
// packages/engine/src/db.ts
import { Pool } from 'pg';

// Single connection pool
const pools = new Map<string, Pool>();

export function getPool(connectionString: string): Pool {
  if (!pools.has(connectionString)) {
    pools.set(connectionString, new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    }));
  }
  return pools.get(connectionString)!;
}

export async function withDb<T>(
  connectionString: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool(connectionString);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  connectionString: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withDb(connectionString, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

// Usage
const runs = await withDb(memstreamDatabaseUrl, async (client) => {
  const result = await client.query(
    'SELECT * FROM memstream_runs ORDER BY created_at DESC LIMIT 10'
  );
  return result.rows;
});

// Transactional updates
await withTransaction(memstreamDatabaseUrl, async (client) => {
  await client.query('INSERT INTO memstream_runs ...');
  await client.query('UPDATE memstream_connections ...');
  // Both succeed or both rollback
});
```

**Priority**: 🔴 CRITICAL → ✅ DONE (pooled `withClient*`)

---

### Issue: Magic Strings → ✅ DONE

**Status**: Shared consts in `packages/engine/src/constants.ts` (`RUN_STATUS`, `JOB_STEP_STATUS`, `WORKER_COMPUTE`, `EVENT_SOURCE`, `EMBEDDER_KIND`, `STORE_KIND`, `INFRA_TEMPLATE`) + helpers `isActiveRunStatus` / `isTerminalRunStatus`. Console re-exports via `features/console/constants`.
```typescript
if (status === "succeeded") { }
if (compute === "ec2") { }
if (source === "s3") { }
```

**Solution**: Const enums and type unions

```typescript
// lib/constants.ts

export const RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
} as const;

export type RunStatus = typeof RUN_STATUS[keyof typeof RUN_STATUS];

export const WORKER_COMPUTE = {
  EC2: 'ec2',
  LAMBDA: 'lambda'
} as const;

export type WorkerCompute = typeof WORKER_COMPUTE[keyof typeof WORKER_COMPUTE];

export const EVENT_SOURCE = {
  FILESYSTEM: 'filesystem',
  S3: 's3'
} as const;

export type EventSource = typeof EVENT_SOURCE[keyof typeof EVENT_SOURCE];

export const EMBEDDER_TYPE = {
  BEDROCK: 'bedrock',
  FAKE: 'fake'
} as const;

export type EmbedderType = typeof EMBEDDER_TYPE[keyof typeof EMBEDDER_TYPE];

// Usage (type-safe!)
import { RUN_STATUS, type RunStatus } from '@/lib/constants';

function isComplete(status: RunStatus): boolean {
  return status === RUN_STATUS.SUCCEEDED || status === RUN_STATUS.FAILED;
}

// TypeScript will error if you use an invalid string
// isComplete('complete'); // ❌ Type error!
isComplete(RUN_STATUS.SUCCEEDED); // ✅ Works
```

**Priority**: ⚠️ LOW (nice-to-have, do during refactor) → ✅ DONE

---

### Issue: Secrets in CloudFormation Parameters 🔴 → ✅ DONE

**Status**: Deploy config in Secrets Manager (`memstream/<stack>/config`); CFN only gets `ConfigSecretArn`. See Track A.4 in TARGET_ARCHITECTURE.

**Current**:
```yaml
Parameters:
  DatabaseUrl:
    Type: String
    NoEcho: true  # ⚠️ Still visible in CloudFormation events!
  MemstreamSecretsKey:
    Type: String
    NoEcho: true  # ⚠️ Visible in stack events, EC2 metadata
```

**Problem**: `NoEcho` doesn't prevent secrets from appearing in:
- CloudFormation stack events (visible in console)
- CloudWatch logs
- EC2 instance user data
- Stack template stored in S3

**Solution**: AWS Secrets Manager

```typescript
// infra/secrets.ts (CDK)
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const dbSecret = new secretsmanager.Secret(this, 'DatabaseUrl', {
  secretName: '/memstream/database-url',
  description: 'Memstream application database URL',
  // Optional: auto-rotation
  rotationSchedule: secretsmanager.RotationSchedule.rate(cdk.Duration.days(30))
});

const secretsKeySecret = new secretsmanager.Secret(this, 'SecretsKey', {
  secretName: '/memstream/secrets-key',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ purpose: 'connection encryption' }),
    generateStringKey: 'key',
    excludePunctuation: true,
    passwordLength: 64
  }
});

// Grant instance read access
dbSecret.grantRead(instanceRole);
secretsKeySecret.grantRead(instanceRole);

// In user data, retrieve secrets
userData.addCommands(
  `export DATABASE_URL=$(aws secretsmanager get-secret-value \\
    --secret-id ${dbSecret.secretName} \\
    --query SecretString --output text)`,
  `export MEMSTREAM_SECRETS_KEY=$(aws secretsmanager get-secret-value \\
    --secret-id ${secretsKeySecret.secretName} \\
    --query 'SecretString' --output text | jq -r .key)`
);
```

**Manual Setup** (if not using CDK yet):
```bash
# Store secrets
aws secretsmanager create-secret \
  --name /memstream/database-url \
  --secret-string "postgresql://user:pass@host/db"

aws secretsmanager create-secret \
  --name /memstream/secrets-key \
  --secret-string '{"key":"64-char-hex-string"}'

# Update CloudFormation to reference (not pass values)
# In EC2 user data:
DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id /memstream/database-url \
  --query SecretString --output text)
```

**Priority**: 🔴 CRITICAL (security risk) → ✅ DONE

---

### Issue: Encryption Key Management

**Current**: AES key in environment variable
```bash
# .env
MEMSTREAM_SECRETS_KEY=0123456789abcdef...  # 64-char hex
```

**Problems**:
- Passed to EC2 via CloudFormation parameter (visible)
- In process environment (accessible to all code)
- No rotation strategy
- Manual key generation

**Solution**: AWS KMS

```typescript
// packages/engine/src/secrets.ts

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({ region: process.env.AWS_REGION });

export async function encryptSecret(plaintext: string): Promise<string> {
  const command = new EncryptCommand({
    KeyId: process.env.KMS_KEY_ID, // ARN from environment
    Plaintext: Buffer.from(plaintext, 'utf-8')
  });
  
  const result = await kms.send(command);
  return Buffer.from(result.CiphertextBlob!).toString('base64');
}

export async function decryptSecret(ciphertext: string): Promise<string> {
  const command = new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, 'base64')
  });
  
  const result = await kms.send(command);
  return Buffer.from(result.Plaintext!).toString('utf-8');
}

// Usage in connections.ts
export async function upsertConnection(input: UpsertConnectionInput) {
  // Use KMS instead of manual AES
  const encrypted = await encryptSecret(input.database_url);
  
  await db.query(
    'INSERT INTO memstream_connections (database_url_ciphertext, ...) VALUES ($1, ...)',
    [encrypted, ...]
  );
}

export async function resolveAppDatabaseUrl(connectionId: string): Promise<string> {
  const row = await db.query(
    'SELECT database_url_ciphertext FROM memstream_connections WHERE id = $1',
    [connectionId]
  );
  
  return decryptSecret(row.database_url_ciphertext);
}
```

**Setup**:
```typescript
// infra/kms.ts (CDK)
const kmsKey = new kms.Key(this, 'MemstreamKey', {
  description: 'Memstream connection string encryption',
  enableKeyRotation: true, // Auto-rotate annually
});

// Grant instance decrypt permission
kmsKey.grantDecrypt(instanceRole);

// Output key ID
new cdk.CfnOutput(this, 'KmsKeyId', { value: kmsKey.keyId });
```

**Benefits**:
- AWS manages key material
- Automatic rotation
- Fine-grained IAM permissions
- Audit trail in CloudTrail
- No key in environment variables

**Priority**: 🔴 CRITICAL (security improvement) → ❌ BACKLOG (still `MEMSTREAM_SECRETS_KEY` env / AES)

---

### Missing: Health Checks → ✅ DONE

**Status**: `GET /api/health` — platform DB required; optional S3 `HeadBucket`; Bedrock skipped (cost).

**Add to API routes**:

```typescript
// apps/web/src/app/api/health/route.ts

import { memstreamDatabaseUrl } from '@memstream/engine';
import { getPool } from '@memstream/engine/db';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy';
  latency_ms?: number;
  error?: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    if (!memstreamDatabaseUrl()) {
      return { name: 'database', status: 'unhealthy', error: 'MEMSTREAM_DATABASE_URL not set' };
    }
    
    const pool = getPool(memstreamDatabaseUrl());
    await pool.query('SELECT 1');
    
    return {
      name: 'database',
      status: 'healthy',
      latency_ms: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function checkS3(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const bucket = process.env.CDC_S3_BUCKET;
    if (!bucket) {
      return { name: 's3', status: 'unhealthy', error: 'CDC_S3_BUCKET not set' };
    }
    
    const s3 = new S3Client({ region: process.env.AWS_REGION });
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    
    return {
      name: 's3',
      status: 'healthy',
      latency_ms: Date.now() - start
    };
  } catch (error) {
    return {
      name: 's3',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function checkBedrock(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    
    // Minimal embed test
    const command = new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v2:0',
      body: JSON.stringify({ inputText: 'health check' })
    });
    
    await bedrock.send(command);
    
    return {
      name: 'bedrock',
      status: 'healthy',
      latency_ms: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'bedrock',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function GET() {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkS3(),
    checkBedrock()
  ]);
  
  const results: HealthCheck[] = checks.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      name: ['database', 's3', 'bedrock'][i],
      status: 'unhealthy',
      error: result.reason?.message || 'Check failed'
    };
  });
  
  const allHealthy = results.every(r => r.status === 'healthy');
  
  return Response.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: results
    },
    { status: allHealthy ? 200 : 503 }
  );
}
```

**Usage**:
- Kubernetes liveness/readiness probes: `GET /api/health`
- Monitoring systems (Datadog, New Relic): Poll every 30s
- Load balancer health checks

**Priority**: 🔴 CRITICAL (needed for production) → ✅ DONE

---

### Missing: Graceful Shutdown → ✅ DONE

**Status**: CLI watch uses `createShutdownController` (SIGINT/SIGTERM) + `closePools()`.

**Add to worker**:

```typescript
// packages/engine/src/graceful-shutdown.ts

import { logger } from './observability/logger.js';

export class GracefulShutdown {
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  constructor(private timeout = 30000) {
    this.setupSignalHandlers();
  }

  registerHandler(name: string, handler: () => Promise<void>) {
    this.shutdownHandlers.push(async () => {
      logger.info({ msg: `Shutting down: ${name}` });
      await handler();
      logger.info({ msg: `Shut down complete: ${name}` });
    });
  }

  private setupSignalHandlers() {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        logger.info({ msg: `Received ${signal}, starting graceful shutdown` });
        this.shutdown();
      });
    });
  }

  private async shutdown() {
    if (this.isShuttingDown) {
      logger.warn({ msg: 'Shutdown already in progress' });
      return;
    }
    
    this.isShuttingDown = true;

    const timeoutHandle = setTimeout(() => {
      logger.error({ msg: `Shutdown timeout after ${this.timeout}ms, forcing exit` });
      process.exit(1);
    }, this.timeout);

    try {
      // Run all handlers in sequence
      for (const handler of this.shutdownHandlers) {
        await handler();
      }
      
      clearTimeout(timeoutHandle);
      logger.info({ msg: 'Graceful shutdown complete' });
      process.exit(0);
    } catch (error) {
      clearTimeout(timeoutHandle);
      logger.error({ err: error, msg: 'Error during shutdown' });
      process.exit(1);
    }
  }
}

// Usage in cli.ts
import { GracefulShutdown } from './graceful-shutdown.js';

const shutdown = new GracefulShutdown(30000);

// Register cleanup handlers
shutdown.registerHandler('indexer', async () => {
  // Wait for current batch to complete
  await indexer.waitForCurrentBatch();
});

shutdown.registerHandler('database', async () => {
  // Close all connection pools
  await closeAllPools();
});

shutdown.registerHandler('metrics', async () => {
  // Flush metrics
  await metricsRegistry.pushMetrics();
});

// Start processing
await indexer.run();
```

**Priority**: ⚠️ HIGH (prevents data loss)

---

### Missing: Rate Limiting → ✅ DONE

**Status**: `apps/web/src/lib/rate-limit.ts` + `guardConsoleApi` on console routes (stricter for Enable/propose).

```typescript
// lib/rate-limit.ts

import { LRUCache } from 'lru-cache';

interface RateLimitOptions {
  interval: number;  // Time window in ms
  uniqueTokenPerInterval: number;  // Max unique IPs
  maxRequests: number;  // Max requests per interval
}

export class RateLimiter {
  private tokenCache: LRUCache<string, number[]>;

  constructor(private options: RateLimitOptions) {
    this.tokenCache = new LRUCache({
      max: options.uniqueTokenPerInterval,
      ttl: options.interval,
    });
  }

  async check(token: string): Promise<{ success: boolean; remaining: number }> {
    const now = Date.now();
    const timestamps = this.tokenCache.get(token) || [];
    
    // Remove expired timestamps
    const validTimestamps = timestamps.filter(
      t => now - t < this.options.interval
    );

    if (validTimestamps.length >= this.options.maxRequests) {
      return { success: false, remaining: 0 };
    }

    validTimestamps.push(now);
    this.tokenCache.set(token, validTimestamps);

    return {
      success: true,
      remaining: this.options.maxRequests - validTimestamps.length
    };
  }
}

// Middleware
import { NextRequest, NextResponse } from 'next/server';

const limiter = new RateLimiter({
  interval: 60 * 1000,  // 1 minute
  uniqueTokenPerInterval: 500,
  maxRequests: 10  // 10 requests per minute
});

export async function rateLimit(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 
             req.headers.get('x-real-ip') || 
             'unknown';
  
  const result = await limiter.check(ip);
  
  if (!result.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { 
        status: 429,
        headers: { 'X-RateLimit-Remaining': '0' }
      }
    );
  }
  
  return null; // Allow request
}

// Usage in API routes
// apps/web/src/app/api/enable/route.ts
import { rateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const rateLimitResult = await rateLimit(req);
  if (rateLimitResult) return rateLimitResult;
  
  // ... rest of handler
}
```

**Priority**: ⚠️ HIGH (prevent abuse)

---

### Missing: Retry Logic & Circuit Breakers → ✅ DONE

**Status**: `packages/engine/src/resilience.ts` (`resilientBedrock`, `resilientS3`) via cockatiel.

import { retry, CircuitBreaker, ExponentialBackoff } from 'cockatiel';

// Retry policy with exponential backoff
export const retryPolicy = retry(
  ExponentialBackoff.builder()
    .maxAttempts(3)
    .initialDelay(100)
    .maxDelay(5000)
    .build()
);

// Circuit breaker
export const breaker = new CircuitBreaker({
  halfOpenAfter: 10_000,  // Try again after 10s
  breakAfter: 5,          // Break after 5 failures
});

// Combined policy
export const resilientCall = retryPolicy.wrap(breaker);

// Usage
import { resilientCall } from '@/lib/resilience';

// Embed with retry + circuit breaker
const embedding = await resilientCall.execute(async () => {
  return bedrock.embed(text);
});

// S3 operations
const cdcFiles = await resilientCall.execute(async () => {
  return s3.listObjectsV2({ Bucket, Prefix });
});
```

**Priority**: ⚠️ HIGH (reliability)

---

## 6. Refactoring Roadmap

### Phase 1: Critical Fixes (Week 1-2)
**Goal**: Make codebase maintainable

#### Task 1.1: Break Up `console-app.tsx` (Priority 🔴) → ✅ PARTIAL
**Estimated**: 16-20 hours

1. **Create feature folders** (2h)
   ```bash
   mkdir -p apps/web/src/features/{connection,configuration,enable,memory,runs}
   ```

2. **Extract Connection modal** (3h)
   - Move to `features/connection/ConnectionModal.tsx`
   - Extract state to `useConnection.ts` hook
   - Create `connection-api.ts` for API calls
   - Test in isolation

3. **Extract Configuration modal** (4h)
   - Move to `features/configuration/ConfigureModal.tsx`
   - Split template/discover tabs into separate components
   - Extract profile logic to `useProfiles.ts`
   - Create `profile-api.ts`

4. **Extract Enable modal** (4h)
   - Move to `features/enable/EnableModal.tsx`
   - Extract progress component
   - Create `useEnableFlow.ts` hook
   - Create `enable-api.ts`

5. **Extract Runs sheet** (2h)
   - Move to `features/runs/RunsSheet.tsx`
   - Create `useRuns.ts` hook
   - Create `runs-api.ts`

6. **Create orchestration page** (3h)
   - Slim `ConsolePage.tsx` that imports features
   - Add global state provider (Zustand)
   - Test complete flow

**Success Criteria**:
- No component over 300 lines
- Each feature independently testable
- State clearly scoped to features

#### Task 1.2: Unified API Client (Priority 🔴) → ✅ DONE
**Estimated**: 4-6 hours

1. **Create base client** (2h)
   ```typescript
   // lib/api/client.ts
   - Centralized fetch wrapper
   - Error handling
   - Request/response logging
   ```

2. **Add type-safe endpoints** (2h)
   ```typescript
   // lib/api/endpoints.ts
   - runs: { list, get, create, update, delete }
   - profiles: { list, get, save, load, propose }
   - connections: { get, upsert }
   - enable: { start, status }
   - memory: { list, search }
   ```

3. **Replace inline fetch calls** (2h)
   - Update all API routes to use client
   - Add Zod schemas for validation

**Success Criteria**:
- All API calls go through client
- Runtime validation with Zod
- Consistent error handling

#### Task 1.3: Database Connection Management (Priority 🔴) → ✅ DONE
**Estimated**: 6-8 hours

1. **Create connection pool manager** (2h)
   ```typescript
   // packages/engine/src/db.ts
   - getPool(url)
   - withDb(url, fn)
   - withTransaction(url, fn)
   ```

2. **Replace direct pg usage** (4h)
   - Update all DB calls to use `withDb`
   - Ensure no leaks
   - Add connection pool metrics

3. **Add monitoring** (2h)
   - Pool size metrics
   - Query duration logging
   - Connection error tracking

**Success Criteria**:
- No manual `client.release()` calls
- All queries use `withDb` or `withTransaction`
- Pool metrics visible

#### Task 1.4: Health Checks (Priority 🔴) → ✅ DONE
**Estimated**: 3-4 hours

1. **Implement `/api/health`** (2h)
   - Database check
   - S3 check
   - Bedrock check

2. **Add to deployment** (1h)
   - Update EC2 userdata to use health check
   - Add to systemd service monitoring

3. **Document** (1h)
   - Health check contract
   - Response format
   - Integration with monitoring

**Success Criteria**:
- Health endpoint returns 200/503
- All dependencies checked
- Used by deployment scripts

---

### Phase 2: Production Hardening (Week 3-4)
**Goal**: Make it production-ready

#### Task 2.1: Secrets Management (Priority 🔴 Security) → ✅ DONE (Secrets Manager; KMS key backlog)
**Estimated**: 8-10 hours

1. **Set up AWS Secrets Manager** (2h)
   - Create secrets for DB URLs
   - Create secret for encryption key
   - Set up IAM permissions

2. **Update code to read from Secrets Manager** (4h)
   - Modify connection code
   - Update encryption/decryption
   - Add caching layer

3. **Remove secrets from CloudFormation** (2h)
   - Update templates
   - Update deployment scripts
   - Test deployment

4. **Documentation** (2h)
   - Secret setup guide
   - Rotation procedures
   - Access control

**Success Criteria**:
- No secrets in CloudFormation parameters
- Secrets retrieved from Secrets Manager
- Rotation documented

#### Task 2.2: Observability (Priority ⚠️)
**Estimated**: 10-12 hours

1. **Add structured logging** (3h)
   - Install pino
   - Create logger wrapper
   - Add to all major operations

2. **Add metrics** (4h)
   - Install prom-client
   - Define key metrics
   - Add `/api/metrics` endpoint
   - Instrument engine operations

3. **Add error tracking** (2h)
   - Set up Sentry (or similar)
   - Add to error boundaries
   - Add to worker

4. **Dashboards** (3h)
   - Create Grafana dashboard
   - Document metrics
   - Set up alerts

**Success Criteria**:
- All operations logged
- Key metrics exposed
- Errors tracked in Sentry

#### Task 2.3: Resilience (Priority ⚠️) → ✅ DONE

**Status**:
1. ✅ cockatiel retry + circuit breakers — `packages/engine/src/resilience.ts`; wrapped Bedrock embed + S3 list/get
2. ✅ Graceful shutdown — CLI SIGINT/SIGTERM + `closePools`
3. ✅ Rate limiting — `guardConsoleApi` (heavy budget for Enable/propose)

1. **Add retry logic** (2h)
   - Install cockatiel
   - Wrap Bedrock calls
   - Wrap S3 calls

2. **Add circuit breakers** (2h)
   - Configure breakers
   - Add monitoring
   - Test failure scenarios

3. **Graceful shutdown** (2h)
   - Implement shutdown handler
   - Add to worker
   - Test SIGTERM handling

4. **Rate limiting** (2h)
   - Implement rate limiter
   - Add to API routes
   - Test limits

**Success Criteria**:
- Transient failures auto-retry
- Circuit breakers prevent cascading failures
- Worker shuts down gracefully
- API rate-limited

#### Task 2.4: Testing (Priority ⚠️)
**Estimated**: 8-10 hours

1. **Add E2E tests** (4h)
   - Install Playwright
   - Test connection flow
   - Test enable flow
   - Test memory view

2. **Add integration tests** (4h)
   - Test API routes
   - Test worker pipeline
   - Test database operations

3. **CI/CD** (2h)
   - Add test run to CI
   - Add lint checks
   - Add type checking

**Success Criteria**:
- Critical paths tested
- Tests run in CI
- Coverage > 60%

---

### Phase 3: Architecture Evolution (Week 5-8)
**Goal**: Scalable foundation

#### Task 3.1: Database Strategy Decision (Priority ⚠️)
**Estimated**: 16-20 hours

**Option A: Merge Databases** (if staying single-tenant)
1. **Plan migration** (4h)
   - Design schema namespaces
   - Create migration scripts
   - Plan rollback strategy

2. **Execute migration** (8h)
   - Create memstream schema
   - Migrate platform tables
   - Update all code references
   - Test thoroughly

3. **Cleanup** (4h)
   - Remove dual-URL logic
   - Update documentation
   - Simplify deployment

**Option B: Document Boundaries** (if going multi-tenant)
1. **Document architecture** (2h)
   - Clear boundaries doc
   - Data flow diagrams
   - Security model

2. **Add tenant isolation** (10h)
   - Add tenant_id to tables
   - Row-level security
   - Test isolation

3. **Multi-tenancy UX** (8h)
   - Workspace switcher
   - Tenant management
   - Billing hooks

**Success Criteria**:
- Clear, documented database strategy
- Code reflects chosen model
- Path to scale defined

#### Task 3.2: Migrate to CDK (Priority ⚠️) → ✅ DONE

**Note**: Keep synthesized `infra/ec2.yaml` + `infra/lambda.yaml` for Enable/deploy — do not `rm` after CDK.
**Estimated**: 12-16 hours

1. **Set up CDK project** (2h)
   - Install dependencies
   - Create stack structure
   - Set up app entry point

2. **Port EC2 stack** (6h)
   - Convert YAML to TypeScript
   - Add type-safe props
   - Create constructs

3. **Port Lambda stack** (4h)
   - Convert YAML
   - Share constructs with EC2

4. **Test & deploy** (4h)
   - Deploy to test account
   - Verify outputs
   - Update deployment scripts

**Success Criteria**:
- All infrastructure as TypeScript
- Type-safe configuration
- Deployments work identically

#### Task 3.3: Schema Management (Priority ⚠️)
**Estimated**: 8-10 hours

1. **Set up Drizzle ORM** (3h)
   - Install drizzle-orm + drizzle-kit
   - Define schemas
   - Generate initial migration

2. **Replace raw SQL** (4h)
   - Update query functions
   - Use type-safe queries
   - Test thoroughly

3. **Migration system** (3h)
   - Set up migration scripts
   - Document process
   - Add to deployment

**Success Criteria**:
- Type-safe database queries
- Migration system in place
- Zero raw SQL strings

#### Task 3.4: Admin Dashboard (Priority ⚠️)
**Estimated**: 16-20 hours

1. **Design admin routes** (2h)
   - `/admin/runs` - view all runs
   - `/admin/metrics` - system metrics
   - `/admin/logs` - recent errors

2. **Implement views** (10h)
   - Runs list with filters
   - Real-time metrics
   - Log viewer
   - Connection manager

3. **Add authentication** (4h)
   - Admin password/key
   - JWT tokens
   - Protected routes

4. **Polish** (4h)
   - Responsive design
   - Error states
   - Loading states

**Success Criteria**:
- Admins can view system state
- Metrics visible
- Auth protects routes

---

## 7. Quick Wins (Do These First) → ✅ DONE

**Status**: #1 Connect modal extracted (`features/console`); #2 constants; #3 `consoleApi`; #4 `/api/health`; #5 zod `lib/env.ts`.

These can be done in **~8 hours** total for immediate improvement:

### Win #1: Extract Connection Modal (4h)

```bash
# 1. Create structure
mkdir -p apps/web/src/features/connection
touch apps/web/src/features/connection/{ConnectionModal.tsx,useConnection.ts,connection-api.ts}

# 2. Move code
# Extract lines 1819-1908 from console-app.tsx to ConnectionModal.tsx
# Extract connection state logic to useConnection.ts
# Extract API calls to connection-api.ts

# 3. Import in console-app.tsx
# Replace <Dialog open={modal === "connect"}> with <ConnectionModal />

# 4. Test
npm run dev -w web
# Verify connection flow works
```

### Win #2: Add Constants File (30min)

```typescript
// lib/constants.ts
export const RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
} as const;

export const WORKER_COMPUTE = {
  EC2: 'ec2',
  LAMBDA: 'lambda'
} as const;

export const MODAL_NAMES = {
  CONNECT: 'connect',
  CONFIGURE: 'configure',
  ENABLE: 'enable'
} as const;

// Replace all magic strings
// Before: if (status === "succeeded")
// After:  if (status === RUN_STATUS.SUCCEEDED)
```

### Win #3: API Client Wrapper (2h)

```typescript
// lib/api/client.ts
export async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<Result<T, ApiError>> {
  // ... implementation from section 3
}

// lib/api/endpoints.ts
export const api = {
  runs: {
    list: () => apiCall<MemstreamRun[]>('/api/runs'),
    get: (id: string) => apiCall<MemstreamRun>(`/api/runs/${id}`)
  },
  profiles: {
    list: () => apiCall<ProfileInfo[]>('/api/profiles')
  }
};

// Replace in console-app.tsx
// Before: await consoleFetch('/api/runs')
// After:  await api.runs.list()
```

### Win #4: Health Check Endpoint (1h)

```typescript
// apps/web/src/app/api/health/route.ts
// ... implementation from section 5

// Test:
curl http://localhost:3000/api/health
```

### Win #5: env Validation (30min)

```typescript
// lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  MEMSTREAM_DATABASE_URL: z.string().url().optional(),
  CDC_S3_BUCKET: z.string().min(3).optional(),
  AWS_REGION: z.string().default('us-east-1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

export const env = envSchema.parse(process.env);

// Use everywhere:
// Before: process.env.CDC_S3_BUCKET
// After:  env.CDC_S3_BUCKET  // Type-safe!
```

**Total Quick Wins Time**: ~8 hours
**Impact**: Immediate code quality improvement

---

## 8. Things to Remove

### Potential Dead Code

Run these checks:

```bash
# 1. Find unused exports
npx ts-prune

# 2. Find unused dependencies
npx depcheck

# 3. Find TODO/FIXME comments
rg "TODO|FIXME" --type ts --type tsx

# 4. Find commented code
rg "^\s*//.*\{" --type ts --type tsx
```

### Likely Candidates for Removal

1. **Test/demo artifacts**:
   ```bash
   # Check if these are still needed:
   examples/demo-events.jsonl
   data/memstream-chunks-ts.json
   ```

2. **Duplicate type definitions**:
   ```bash
   # Find duplicate interfaces
   grep -r "interface MemstreamRun" apps/ packages/
   grep -r "interface Profile" apps/ packages/
   # Consolidate into single source of truth
   ```

3. **Old scripts** (if not used):
   ```bash
   # Verify usage before removing
   scripts/run-local-ts.sh
   scripts/package-prebuilt.sh
   ```

4. **Unused profiles**:
   ```bash
   # Check if all profiles in profiles/ are used
   ls profiles/
   # Keep: commerce.yaml, saas-security.yaml
   # Remove if unused: discovered.yaml (regenerated anyway)
   ```

### Consolidation Opportunities

1. **Merge similar types**:
   ```typescript
   // Find in both apps/web/src/lib/types.ts and packages/engine/src/models.ts
   // Keep one canonical definition in packages/engine
   ```

2. **DRY up API routes**:
   ```typescript
   // Many routes have similar structure:
   // - Parse body
   // - Validate
   // - Call engine function
   // - Return JSON
   // Could create a wrapper to reduce duplication
   ```

---

## 9. Implementation Guides

### Guide A: Breaking Up `console-app.tsx`

**Step-by-step process for extracting one modal**

#### Example: Extract Connection Modal

**Step 1: Identify boundaries** (15min)
```typescript
// In console-app.tsx, find:
// - State used by Connection modal
const [connect, setConnect] = useState<ConnectConfig>(defaultConnect);
const [connectionId, setConnectionId] = useState<string | null>(null);
const [hasStoredUrl, setHasStoredUrl] = useState(false);
const [urlHint, setUrlHint] = useState("");

// - Handlers used by Connection modal
const onSaveConnect = async () => { ... };

// - JSX for the modal
<Dialog open={modal === "connect"}>...</Dialog>
```

**Step 2: Create feature folder** (5min)
```bash
mkdir -p apps/web/src/features/connection
touch apps/web/src/features/connection/{ConnectionModal.tsx,useConnection.ts,connection-api.ts,types.ts}
```

**Step 3: Extract types** (10min)
```typescript
// features/connection/types.ts
export interface ConnectConfig {
  database_url: string;
  bucket: string;
  region: string;
  prefix: string;
}

export interface ConnectionState {
  config: ConnectConfig;
  connectionId: string | null;
  hasStoredUrl: boolean;
  urlHint: string;
}
```

**Step 4: Extract API calls** (15min)
```typescript
// features/connection/connection-api.ts
import { apiCall } from '@/lib/api/client';
import type { ConnectConfig } from './types';

export async function saveConnection(config: ConnectConfig, connectionId?: string) {
  return apiCall('/api/connection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config, id: connectionId })
  });
}

export async function getDefaults() {
  return apiCall<{
    has_url?: boolean;
    database_url_hint?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    connection_id?: string;
  }>('/api/defaults');
}
```

**Step 5: Create custom hook** (30min)
```typescript
// features/connection/useConnection.ts
import { useState } from 'react';
import { saveConnection, getDefaults } from './connection-api';
import type { ConnectConfig, ConnectionState } from './types';

const defaultConfig: ConnectConfig = {
  database_url: '',
  bucket: '',
  region: 'us-east-1',
  prefix: 'cdc/'
};

export function useConnection() {
  const [state, setState] = useState<ConnectionState>({
    config: defaultConfig,
    connectionId: null,
    hasStoredUrl: false,
    urlHint: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConfig = (patch: Partial<ConnectConfig>) => {
    setState(s => ({ ...s, config: { ...s.config, ...patch } }));
  };

  const loadDefaults = async () => {
    const result = await getDefaults();
    if (!result.ok) return;
    
    const data = result.value;
    if (data.connection_id) {
      setState(s => ({ ...s, connectionId: data.connection_id }));
    }
    if (data.has_url) {
      setState(s => ({
        ...s,
        hasStoredUrl: true,
        urlHint: data.database_url_hint || ''
      }));
    }
    updateConfig({
      bucket: data.bucket || '',
      region: data.region || 'us-east-1',
      prefix: data.prefix || 'cdc/'
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveConnection(state.config, state.connectionId || undefined);
      if (!result.ok) {
        setError(result.error.message);
        return { success: false };
      }
      
      if (result.value.connection?.id) {
        setState(s => ({ ...s, connectionId: result.value.connection.id }));
      }
      return { success: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connection');
      return { success: false };
    } finally {
      setBusy(false);
    }
  };

  return {
    state,
    busy,
    error,
    updateConfig,
    loadDefaults,
    save
  };
}
```

**Step 6: Create modal component** (45min)
```typescript
// features/connection/ConnectionModal.tsx
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { useConnection } from './useConnection';

interface ConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ConnectionModal({ open, onOpenChange, onSuccess }: ConnectionModalProps) {
  const { state, busy, error, updateConfig, loadDefaults, save } = useConnection();

  useEffect(() => {
    if (open) {
      void loadDefaults();
    }
  }, [open]);

  const handleSave = async () => {
    const result = await save();
    if (result.success) {
      onSuccess();
      onOpenChange(false);
    }
  };

  const credentialsSet = state.hasStoredUrl || state.config.database_url.length > 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect</DialogTitle>
          <DialogDescription>
            Connect a Cockroach application database
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>Cockroach DATABASE_URL</FieldLabel>
          {state.hasStoredUrl && !state.config.database_url ? (
            <FieldDescription>
              Saved connection: <span className="font-mono">{state.urlHint}</span>
            </FieldDescription>
          ) : null}
          <Input
            type="password"
            placeholder="postgresql://..."
            value={state.config.database_url}
            onChange={(e) => updateConfig({ database_url: e.target.value })}
          />
        </Field>

        <Field>
          <FieldLabel>AWS Region</FieldLabel>
          <Input
            value={state.config.region}
            onChange={(e) => updateConfig({ region: e.target.value })}
          />
        </Field>

        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={!credentialsSet || busy} onClick={handleSave}>
            {busy ? 'Saving...' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 7: Update console-app.tsx** (15min)
```typescript
// apps/web/src/components/console-app.tsx

// Remove extracted state, handlers, JSX

// Add import
import { ConnectionModal } from '@/features/connection/ConnectionModal';

// Replace Dialog with:
<ConnectionModal
  open={modal === 'connect'}
  onOpenChange={(open) => setModal(open ? 'connect' : null)}
  onSuccess={() => setModal('configure')}
/>
```

**Step 8: Test** (15min)
```bash
npm run dev -w web

# Test in browser:
# 1. Open console
# 2. Click "Connect"
# 3. Enter credentials
# 4. Click "Continue"
# 5. Verify state persists
```

**Repeat for other modals**: Configure, Enable, Runs, Delete

**Expected outcome**:
- `console-app.tsx`: 2,620 lines → ~400 lines
- Each feature: ~150-200 lines
- Testable in isolation
- Clear separation of concerns

---

### Guide B: Setting Up State Management with Zustand

**Why Zustand**: Simpler than Redux, better than 42 useState hooks

**Step 1: Install** (2min)
```bash
cd apps/web
npm install zustand
```

**Step 2: Define store** (30min)
```typescript
// apps/web/src/stores/console-store.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface ConnectConfig {
  database_url: string;
  bucket: string;
  region: string;
  prefix: string;
}

interface ConsoleState {
  // Connection
  connection: ConnectConfig | null;
  connectionId: string | null;
  setConnection: (config: ConnectConfig) => void;
  setConnectionId: (id: string | null) => void;

  // Profile
  activeProfile: string | null;
  profiles: ProfileInfo[];
  setActiveProfile: (path: string) => void;
  setProfiles: (profiles: ProfileInfo[]) => void;

  // Runs
  runs: MemstreamRun[];
  activeRunId: string | null;
  setRuns: (runs: MemstreamRun[]) => void;
  setActiveRunId: (id: string | null) => void;
  addRun: (run: MemstreamRun) => void;
  updateRun: (id: string, updates: Partial<MemstreamRun>) => void;
  deleteRun: (id: string) => void;

  // UI state
  modal: 'connect' | 'configure' | 'enable' | null;
  setModal: (modal: 'connect' | 'configure' | 'enable' | null) => void;

  // Pipeline
  watching: boolean;
  setWatching: (watching: boolean) => void;
}

export const useConsoleStore = create<ConsoleState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        connection: null,
        connectionId: null,
        activeProfile: null,
        profiles: [],
        runs: [],
        activeRunId: null,
        modal: null,
        watching: false,

        // Actions
        setConnection: (config) => set({ connection: config }),
        setConnectionId: (id) => set({ connectionId: id }),
        
        setActiveProfile: (path) => set({ activeProfile: path }),
        setProfiles: (profiles) => set({ profiles }),
        
        setRuns: (runs) => set({ runs }),
        setActiveRunId: (id) => set({ activeRunId: id }),
        addRun: (run) => set((state) => ({ runs: [run, ...state.runs] })),
        updateRun: (id, updates) => set((state) => ({
          runs: state.runs.map(r => r.id === id ? { ...r, ...updates } : r)
        })),
        deleteRun: (id) => set((state) => ({
          runs: state.runs.filter(r => r.id !== id),
          activeRunId: state.activeRunId === id ? null : state.activeRunId
        })),
        
        setModal: (modal) => set({ modal }),
        setWatching: (watching) => set({ watching })
      }),
      {
        name: 'memstream-console',
        partialize: (state) => ({
          // Only persist these keys
          connectionId: state.connectionId,
          activeProfile: state.activeProfile,
          activeRunId: state.activeRunId
        })
      }
    )
  )
);

// Selectors (for performance)
export const useConnection = () => useConsoleStore((s) => s.connection);
export const useActiveRun = () => {
  const runs = useConsoleStore((s) => s.runs);
  const activeId = useConsoleStore((s) => s.activeRunId);
  return runs.find(r => r.id === activeId);
};
```

**Step 3: Use in components** (15min per component)
```typescript
// Before (console-app.tsx)
const [runs, setRuns] = useState<MemstreamRun[]>([]);
const [activeRunId, setActiveRunId] = useState<string | null>(null);

// After (any component)
import { useConsoleStore } from '@/stores/console-store';

function RunsList() {
  const runs = useConsoleStore((s) => s.runs);
  const setActiveRunId = useConsoleStore((s) => s.setActiveRunId);
  
  return (
    <ul>
      {runs.map(run => (
        <li key={run.id} onClick={() => setActiveRunId(run.id)}>
          {run.profile_path}
        </li>
      ))}
    </ul>
  );
}
```

**Step 4: Devtools** (5min)
```typescript
// Install Redux DevTools browser extension
// State changes will appear in DevTools
// Time-travel debugging!
```

**Benefits**:
- Single source of truth
- No prop drilling
- DevTools for debugging
- Persistence built-in
- Selectors for performance

---

### Guide C: Adding Type-Safe Database Queries with Drizzle

**Why Drizzle**: Type-safe SQL without the ORM overhead

**Step 1: Install** (2min)
```bash
cd packages/engine
npm install drizzle-orm
npm install -D drizzle-kit
```

**Step 2: Define schemas** (1h)
```typescript
// packages/engine/src/db/schema.ts
import { pgTable, uuid, text, timestamp, index, boolean, pgSchema } from 'drizzle-orm/pg-core';

// Memstream schema
export const memstreamSchema = pgSchema('memstream');

export const memstreamRuns = pgTable('memstream_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status', { 
    enum: ['queued', 'running', 'succeeded', 'failed'] 
  }).notNull(),
  profilePath: text('profile_path').notNull(),
  tables: text('tables').notNull(),
  bucket: text('bucket'),
  region: text('region'),
  prefix: text('prefix'),
  stackName: text('stack_name'),
  shopUrl: text('shop_url'),
  jobId: text('job_id'),
  appDatabaseLabel: text('app_database_label'),
  connectionId: uuid('connection_id'),
  log: text('log').array().notNull().default([]),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at')
}, (table) => ({
  createdIdx: index('memstream_runs_created_idx').on(table.createdAt.desc())
}));

export const memstreamConnections = pgTable('memstream_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('default'),
  databaseUrlCiphertext: text('database_url_ciphertext').notNull(),
  databaseLabel: text('database_label'),
  bucket: text('bucket'),
  region: text('region'),
  prefix: text('prefix'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  activeIdx: index('memstream_connections_active_idx').on(table.isActive)
}));

// Export types
export type MemstreamRun = typeof memstreamRuns.$inferSelect;
export type NewMemstreamRun = typeof memstreamRuns.$inferInsert;
```

**Step 3: Create client** (15min)
```typescript
// packages/engine/src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pools = new Map<string, Pool>();

export function getDb(connectionString: string) {
  if (!pools.has(connectionString)) {
    const pool = new Pool({ connectionString });
    pools.set(connectionString, pool);
  }
  return drizzle(pools.get(connectionString)!, { schema });
}
```

**Step 4: Use in queries** (30min to refactor each function)
```typescript
// Before (runs.ts)
export async function listRuns(): Promise<MemstreamRun[]> {
  const client = await pg.connect();
  try {
    const result = await client.query(
      'SELECT * FROM memstream_runs ORDER BY created_at DESC LIMIT 50'
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// After (runs.ts)
import { desc, eq } from 'drizzle-orm';
import { getDb } from './db/client.js';
import { memstreamRuns } from './db/schema.js';

export async function listRuns(): Promise<MemstreamRun[]> {
  const db = getDb(memstreamDatabaseUrl());
  return db
    .select()
    .from(memstreamRuns)
    .orderBy(desc(memstreamRuns.createdAt))
    .limit(50);
}

// Type-safe! IDE autocomplete! Refactoring support!
```

**Step 5: Migrations** (30min)
```bash
# Generate migration from schema
npx drizzle-kit generate:pg

# Creates: drizzle/0000_initial.sql

# Apply migration
npx drizzle-kit push:pg
```

**Benefits**:
- Full type safety
- IDE autocomplete
- Refactoring safety (rename a column, TypeScript catches all uses)
- Migration generation
- No SQL strings
- Still just SQL under the hood (no ORM magic)

---

### Guide D: Migrating to AWS CDK

**Step-by-step CloudFormation → CDK migration**

**Step 1: Install CDK** (5min)
```bash
npm install -D aws-cdk-lib constructs
npm install -D @types/node

# Initialize CDK app
mkdir infra-cdk
cd infra-cdk
npx cdk init app --language=typescript
```

**Step 2: Create base stack** (1h)
```typescript
// infra-cdk/lib/memstream-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MemstreamStackProps extends cdk.StackProps {
  cdcBucket: string;
  cdcPrefix: string;
  databaseUrl: string;
  memstreamDatabaseUrl: string;
  memstreamSecretsKey: string;
  instanceType?: ec2.InstanceType;
  shopCidr?: string;
}

export class MemstreamStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly publicDns: string;
  public readonly shopUrl: string;

  constructor(scope: Construct, id: string, props: MemstreamStackProps) {
    super(scope, id, props);

    // Reference existing bucket
    const bucket = s3.Bucket.fromBucketName(this, 'CdcBucket', props.cdcBucket);

    // IAM Role
    const role = this.createInstanceRole(bucket, props.cdcPrefix);

    // Security Group
    const sg = this.createSecurityGroup(props.shopCidr || '0.0.0.0/0');

    // EC2 Instance
    this.instance = this.createInstance(role, sg, props);

    // Outputs
    this.publicDns = this.instance.instancePublicDnsName;
    this.shopUrl = `http://${this.publicDns}:3000/shop`;

    new cdk.CfnOutput(this, 'ShopUrl', {
      value: this.shopUrl,
      description: 'Memstream console + shop URL'
    });
  }

  private createInstanceRole(bucket: s3.IBucket, prefix: string): iam.Role {
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
      ]
    });

    // S3 permissions
    bucket.grantRead(role, `${prefix}*`);
    bucket.grantWrite(role, `${prefix}*`);
    bucket.grantRead(role, 'deploy/*');

    // Bedrock permissions
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*']
    }));

    // CloudFormation permissions (for Lambda deployment)
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks'
      ],
      resources: ['*']
    }));

    return role;
  }

  private createSecurityGroup(shopCidr: string): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'MemstreamSG', {
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true }),
      description: 'Memstream console/shop',
      allowAllOutbound: true
    });

    sg.addIngressRule(
      ec2.Peer.ipv4(shopCidr),
      ec2.Port.tcp(3000),
      'Console + shop'
    );

    return sg;
  }

  private createInstance(
    role: iam.Role,
    sg: ec2.SecurityGroup,
    props: MemstreamStackProps
  ): ec2.Instance {
    const userData = this.createUserData(props);

    return new ec2.Instance(this, 'MemstreamInstance', {
      instanceType: props.instanceType || ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      vpc: ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true }),
      role,
      securityGroup: sg,
      userData
    });
  }

  private createUserData(props: MemstreamStackProps): ec2.UserData {
    const userData = ec2.UserData.forLinux();
    
    userData.addCommands(
      'set -euxo pipefail',
      'exec > >(tee /var/log/memstream-userdata.log) 2>&1',
      '',
      '# Install dependencies',
      'dnf install -y tar gzip awscli',
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'dnf install -y nodejs',
      '',
      '# Download and extract',
      'install -d -m 0755 /opt/memstream',
      `aws s3 cp s3://${props.cdcBucket}/deploy/memstream-prebuilt.tgz /tmp/memstream.tgz`,
      'tar -xzf /tmp/memstream.tgz -C /opt/memstream',
      '',
      '# Create .env',
      'cat > /opt/memstream/.env <<EOF',
      `DATABASE_URL=${props.databaseUrl}`,
      `MEMSTREAM_DATABASE_URL=${props.memstreamDatabaseUrl}`,
      `MEMSTREAM_SECRETS_KEY=${props.memstreamSecretsKey}`,
      `CDC_S3_BUCKET=${props.cdcBucket}`,
      `CDC_S3_PREFIX=${props.cdcPrefix}`,
      `AWS_REGION=${this.region}`,
      'NODE_ENV=production',
      'EOF',
      'chmod 600 /opt/memstream/.env',
      '',
      '# Create systemd services',
      '# ... (same as YAML version)',
      '',
      'systemctl enable --now memstream-shop.service',
      'systemctl enable --now memstream-watch.service'
    );

    return userData;
  }
}
```

**Step 3: Create app entry point** (15min)
```typescript
// infra-cdk/bin/memstream.ts
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MemstreamStack } from '../lib/memstream-stack';

const app = new cdk.App();

new MemstreamStack(app, 'MemstreamDemo', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || 'us-east-1'
  },
  cdcBucket: process.env.CDC_S3_BUCKET!,
  cdcPrefix: process.env.CDC_S3_PREFIX || 'cdc/',
  databaseUrl: process.env.DATABASE_URL!,
  memstreamDatabaseUrl: process.env.MEMSTREAM_DATABASE_URL!,
  memstreamSecretsKey: process.env.MEMSTREAM_SECRETS_KEY!
});
```

**Step 4: Deploy** (10min)
```bash
# Bootstrap CDK (first time only)
cd infra-cdk
npx cdk bootstrap

# Synth (generate CloudFormation)
npx cdk synth

# Deploy
npx cdk deploy

# Verify outputs
npx cdk deploy --outputs-file outputs.json
cat outputs.json
```

**Step 5: Update scripts** (15min)
```bash
# Update Makefile
deploy-aws:
	cd infra-cdk && npx cdk deploy --require-approval never

destroy-aws:
	cd infra-cdk && npx cdk destroy --force
```

**Step 6: Remove old YAML** (5min)
```bash
# After CDK deployment verified
rm infra/ec2.yaml
rm infra/lambda.yaml
```

**Benefits**:
- Type-safe infrastructure
- IDE autocomplete
- Reusable constructs
- Better testing
- Gradual migration (can deploy both side-by-side initially)

---

## Conclusion

This architecture review document captures:
- ✅ All critical issues identified
- ✅ Prioritized action plan
- ✅ Step-by-step implementation guides
- ✅ Code examples for each fix
- ✅ Estimated effort for each task

**Recommended starting point**: ~~Phase 1, Task 1.1~~ — pragmatic criticals + Track A/B landed; see status table. Remaining: Zustand console rewrite, KMS for AES key, broader observability.

**Expected timeline**:
- **Week 1-2**: Critical fixes (maintainability) — ✅ mostly done
- **Week 3-4**: Production hardening (reliability) — ✅ pool / health / shutdown done
- **Week 5-8**: Architecture evolution (scalability) — in progress / backlog

Save this document and reference specific sections as you implement each fix. Update the checklist as you complete tasks. Canonical progress: [`TARGET_ARCHITECTURE.md`](./TARGET_ARCHITECTURE.md).

Good luck with the refactoring! 🚀
