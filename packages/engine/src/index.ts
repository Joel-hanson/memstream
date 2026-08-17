/** @memstream/engine — TypeScript memory fabric. */

export {
  RUN_STATUS,
  JOB_STEP_STATUS,
  WORKER_COMPUTE,
  EVENT_SOURCE,
  EMBEDDER_KIND,
  STORE_KIND,
  INFRA_TEMPLATE,
  isTerminalRunStatus,
  isActiveRunStatus,
  type RunStatus,
  type JobStepStatusValue,
  type WorkerComputeKind,
  type EventSourceKind,
  type EmbedderKind,
  type StoreKind,
  type InfraTemplateKindValue,
} from "./constants.js";
export {
  changedColumns,
  type ChangeEvent,
  type JsonObject,
  type JsonValue,
  type MemoryChunk,
} from "./models.js";
export {
  loadProfile,
  parseProfileYaml,
  profileIdFromRef,
  profilePathForId,
  ProfileError,
  type ChangefeedConfig,
  type DiscoveryConfig,
  type EmbeddingConfig,
  type InsightsConfig,
  type Profile,
  type Rule,
  type WhenClause,
} from "./profile.js";
export {
  ensureProfilesSeeded,
  listProfileVersions,
  listStoredProfiles,
  resolveProfile,
  resolveProfileDraft,
  restoreProfileVersion,
  saveStoredProfile,
  PROFILE_VERSION_KEEP,
  type ProfileVersionInfo,
  type StoredProfileInfo,
} from "./profile-store.js";
export { matchRules } from "./rules.js";
export { renderChunk } from "./template.js";
export type { Embedder, EventSource, MemoryStore } from "./ports.js";
export {
  FakeEmbedder,
  FakeEventSource,
  InMemoryMemoryStore,
} from "./fakes.js";
export {
  ProcessedState,
  DbProcessedState,
  buildKeyState,
  cdcScopeId,
  type KeyState,
  type CdcScopeOptions,
} from "./state.js";
export { normalizeSourceTs } from "./timestamps.js";
export {
  parseCdcPayload,
  parseCdcRecord,
  tableFromKey,
} from "./cdc-parse.js";
export { FilesystemEventSource } from "./source-filesystem.js";
export { S3EventSource, type S3ListClient } from "./source-s3.js";
export { BedrockEmbedder, type BedrockInvokeClient } from "./embed-bedrock.js";
export {
  CockroachMemoryStore,
  formatVector,
  normalizeConninfo,
  parseVector,
  extractSslRootCert,
  setSslRootCert,
  stripSslRootCert,
  ensureVerifyFullSsl,
  sanitizeDatabaseUrlForStorage,
  resolveSslRootCertPath,
  type ConnectFn,
  type SqlClient,
} from "./store-cockroach.js";
export { Indexer, type RunResult } from "./pipeline.js";
export { runPollLoop } from "./loop.js";
export {
  buildEmbedder,
  buildEventSource,
  buildStore,
  loadEventsJsonl,
} from "./factory.js";
export {
  chunkToHit,
  searchMemories,
  type MemoryHit,
} from "./search.js";
export {
  interestingColumns,
  narrativeColumns,
  watchableColumns,
  proposeProfileDict,
  proposeProfileYaml,
  fetchPublicTables,
} from "./discover.js";
export {
  buildS3Uri,
  cancelActiveChangefeedJobs,
  cancelChangefeed,
  createChangefeed,
  isSafeSqlIdent,
  parseChangefeedTables,
  resolveAwsKeys,
  resolveCdcSinkAuth,
  type CancelChangefeedResult,
  type ChangefeedResult,
} from "./changefeed.js";
export {
  applySchema,
  buildPipelineStatus,
  cdcProcessedStats,
  changefeedMetrics,
  clearS3CdcPrefix,
  listProfiles,
  listRecentChunks,
  loadProfileDraft,
  memoryMetrics,
  profileTables,
  proposeFromDatabase,
  repoRoot,
  runEnablePipeline,
  saveProfileYaml,
  s3CdcSnapshot,
  splitSqlStatements,
  stackOutputs,
  teardownAndDeleteRun,
  type S3CdcSnapshot,
  type TeardownResult,
} from "./console-actions.js";
export {
  buildCloudDatabaseUrl,
  getCloudConnectionString,
  injectSqlPassword,
  listCloudClusters,
  listCloudDatabases,
  listCloudSqlUsers,
  type CloudCluster,
  type CloudSqlUser,
} from "./cockroach-cloud.js";
export {
  computeLagSeconds,
  derivePipelineHealth,
  isCdcRecent,
  isWorkerCaughtUp,
  CDC_RECENT_SECONDS,
  MEMORY_LAG_WARN_SECONDS,
  type CheckStatus,
  type DerivePipelineHealthInput,
  type HealthLevel,
  type PipelineHealth,
} from "./pipeline-health.js";
export {
  resolveClusterUrl,
  setupDatabases,
  withDatabaseName,
  type SetupDbOptions,
  type SetupDbResult,
} from "./setup-db.js";
export {
  appDatabaseLabel,
  createRun,
  ensureMemstreamSchema,
  finishRun,
  getLatestRun,
  getRun,
  getRunByJobId,
  deleteRun,
  listRuns,
  jobSnapshotFromRun,
  memstreamDatabaseUrl,
  updateRunProgress,
  type CreateRunInput,
  type MemstreamRun,
  type MemstreamRunStatus,
  type MemstreamRunStep,
} from "./runs.js";
export {
  DEMO_CONNECTION_NAME,
  activateConnection,
  deriveApplicationUrlFromPlatformUrl,
  ensureDemoConnection,
  getActiveConnection,
  getConnection,
  getConnectionByName,
  listConnections,
  resolveAppDatabaseUrl,
  resolveDemoApplicationDatabaseUrl,
  upsertConnection,
  type EnsureDemoConnectionInput,
  type MemstreamConnection,
  type MemstreamWorkspace,
  type UpsertConnectionInput,
} from "./connections.js";
export {
  createOrg,
  createOrgInvite,
  getOrg,
  isInviteCode,
  isOrgId,
  listOrgs,
  redeemOrgInvite,
  type MemstreamOrg,
  type MemstreamOrgInvite,
} from "./orgs.js";
export {
  authLoginRequired,
  countOperators,
  ensureDemoOperator,
  hashPassword,
  verifyOperatorPassword,
  verifyPassword,
  type MemstreamOperator,
} from "./operators.js";
export {
  decryptSecret,
  encryptSecret,
  memstreamSecretsKey,
} from "./secrets.js";
export {
  infraTemplatePath,
  type InfraTemplateKind,
} from "./infra-templates.js";
export {
  deleteAwsStack,
  deployAwsStack,
  describeStackOutputs,
  type DeleteAwsStackOptions,
  type DeployAwsOptions,
} from "./deploy-aws.js";
export {
  upsertDeployConfigSecret,
  getDeployConfigSecret,
  applyDeployConfigSecretFromEnv,
  deployConfigSecretName,
  type DeployConfigSecret,
} from "./deploy-secrets.js";
export {
  deployLambdaStack,
  deleteLambdaStack,
  ensureS3LambdaNotification,
  type DeployLambdaOptions,
} from "./deploy-lambda.js";
export {
  indexCdcPayload,
  processCdcS3Object,
  shouldSkipCdcKey,
  type ProcessCdcResult,
} from "./process-cdc.js";
export {
  cloudWorkerStackName,
  isPrebuiltRuntime,
  resolveWorkerCompute,
  workerComputeLabel,
  type WorkerCompute,
} from "./worker-compute.js";
export { handler as lambdaHandler } from "./lambda-handler.js";
export {
  buildEnableSteps,
  PIPELINE_LABELS,
  PRODUCT,
  RESOURCES,
  resourceById,
  stepStatusCopy,
  type ResourceCopy,
  type ResourceId,
  type StepStatusCopy,
} from "./naming.js";
export {
  getJobStore,
  bindJobToRun,
  type Job,
  type JobStep,
  type JobStepStatus,
  type PersistJobProgress,
} from "./jobs.js";
export {
  PlatformState,
  getPlatformState,
  type JobSnapshot,
  type CdcKeysOptions,
} from "./state-manager.js";
export {
  createShutdownController,
  type ShutdownController,
} from "./shutdown.js";
export {
  resilientBedrock,
  resilientS3,
  withResilience,
} from "./resilience.js";
export { withClient, withClientObjects, closePools } from "./db.js";
export {
  CockroachShop,
  emitCdcFile,
  getShop,
  InMemoryShop,
  listCdcFiles,
  ShopError,
  type PlaceOrderInput,
  type OpenTicketInput,
  type AddCaseNoteInput,
  type SetUserRoleInput,
  type Shop,
  type ShopActionResult,
} from "./shop.js";
export {
  DEMO_HISTORY_SEEDS,
  formatCaseNoteChunk,
  saveMemoryTexts,
  seedDemoHistoryMemory,
  type DemoHistorySeed,
} from "./demo-history.js";
