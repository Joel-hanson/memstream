/** @memstream/engine — TypeScript memory fabric. */

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
  listStoredProfiles,
  resolveProfile,
  resolveProfileDraft,
  saveStoredProfile,
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
  proposeProfileDict,
  proposeProfileYaml,
  fetchPublicTables,
} from "./discover.js";
export {
  buildS3Uri,
  cancelChangefeed,
  createChangefeed,
  isSafeSqlIdent,
  parseChangefeedTables,
  resolveAwsKeys,
  type CancelChangefeedResult,
  type ChangefeedResult,
} from "./changefeed.js";
export {
  applySchema,
  buildPipelineStatus,
  changefeedMetrics,
  consoleDir,
  listProfiles,
  listRecentChunks,
  loadProfileDraft,
  memoryMetrics,
  profileTables,
  proposeFromDatabase,
  readSessionEnv,
  repoRoot,
  runEnablePipeline,
  saveProfileYaml,
  s3ObjectCount,
  sessionEnvPath,
  splitSqlStatements,
  stackOutputs,
  teardownAndDeleteRun,
  writeSessionEnv,
  type TeardownResult,
} from "./console-actions.js";
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
  memstreamDatabaseUrl,
  updateRunLog,
  type CreateRunInput,
  type MemstreamRun,
  type MemstreamRunStatus,
} from "./runs.js";
export {
  getActiveConnection,
  getConnection,
  listConnections,
  resolveAppDatabaseUrl,
  upsertConnection,
  type MemstreamConnection,
  type UpsertConnectionInput,
} from "./connections.js";
export {
  decryptSecret,
  encryptSecret,
  memstreamSecretsKey,
} from "./secrets.js";
export {
  deleteAwsStack,
  deployAwsStack,
  describeStackOutputs,
  type DeleteAwsStackOptions,
  type DeployAwsOptions,
} from "./deploy-aws.js";
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
  resourceLabel,
  stepStatusCopy,
  type ResourceCopy,
  type ResourceId,
  type StepStatusCopy,
} from "./naming.js";
export {
  getJobStore,
  JobStore,
  type Job,
  type JobStep,
  type JobStepStatus,
} from "./jobs.js";
export {
  CockroachShop,
  emitCdcFile,
  getMemoryShop,
  getShop,
  InMemoryShop,
  listCdcFiles,
  ShopError,
  type PlaceOrderInput,
  type OpenTicketInput,
  type SetUserRoleInput,
  type Shop,
  type ShopActionResult,
} from "./shop.js";
