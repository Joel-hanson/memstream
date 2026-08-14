-- Memstream platform DB
-- Source of truth for platform schema. Apply with:
--
--   make setup-db
--
-- Application live-memory tables (agent_memory_chunks) are NOT here —
-- Memstream Enable applies sql/application.sql on the Connect DB.
--
--   CREATE DATABASE IF NOT EXISTS memstream

CREATE TABLE IF NOT EXISTS memstream_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL DEFAULT 'default',
  -- AES-256-GCM: iv (12) || tag (16) || ciphertext
  database_url_ciphertext BYTES NOT NULL,
  database_label STRING,
  bucket STRING,
  region STRING,
  prefix STRING,
  is_active BOOL NOT NULL DEFAULT true,
  -- SaaS org (nullable until auth); connection id is the workspace id
  org_id STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX memstream_connections_active_idx (is_active)
);

-- Safe for clusters created before org_id existed
ALTER TABLE memstream_connections ADD COLUMN IF NOT EXISTS org_id STRING;

CREATE TABLE IF NOT EXISTS memstream_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status STRING NOT NULL,
  profile_path STRING NOT NULL,
  tables STRING NOT NULL,
  bucket STRING,
  region STRING,
  prefix STRING,
  stack_name STRING,
  shop_url STRING,
  job_id STRING,
  app_database_label STRING,
  -- Workspace id (= memstream_connections.id)
  connection_id UUID,
  log STRING[] NOT NULL DEFAULT ARRAY[],
  -- JSON array of enable JobStep objects (durable progress)
  steps_json STRING,
  error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  INDEX memstream_runs_created_idx (created_at DESC),
  INDEX memstream_runs_job_idx (job_id)
);

-- Safe for clusters created before connection_id / steps_json existed
ALTER TABLE memstream_runs ADD COLUMN IF NOT EXISTS connection_id UUID;
ALTER TABLE memstream_runs ADD COLUMN IF NOT EXISTS steps_json STRING;

CREATE TABLE IF NOT EXISTS memstream_cdc_keys (
  scope_id STRING NOT NULL,
  object_key STRING NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, object_key)
);

-- Memory profiles (YAML). Seeded from profiles/*.yaml; console saves here so
-- EC2/Lambda do not depend on the local filesystem for rules.
CREATE TABLE IF NOT EXISTS memstream_profiles (
  id STRING PRIMARY KEY,
  yaml STRING NOT NULL,
  application STRING NOT NULL DEFAULT '',
  source STRING NOT NULL DEFAULT 'builtin', -- builtin | user
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prior YAML for each profile save (restore / audit). Current row stays in memstream_profiles.
CREATE TABLE IF NOT EXISTS memstream_profile_versions (
  profile_id STRING NOT NULL,
  version INT NOT NULL,
  yaml STRING NOT NULL,
  application STRING NOT NULL DEFAULT '',
  source STRING NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, version),
  INDEX memstream_profile_versions_created_idx (profile_id, created_at DESC)
);

-- Thin SaaS orgs (no full auth yet). Workspaces (= connections) optionally belong to an org.
CREATE TABLE IF NOT EXISTS memstream_orgs (
  id STRING PRIMARY KEY,
  name STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shareable invite codes to join an org (single-use until redeemed or expired).
CREATE TABLE IF NOT EXISTS memstream_org_invites (
  code STRING PRIMARY KEY,
  org_id STRING NOT NULL,
  label STRING,
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX memstream_org_invites_org_idx (org_id)
);

-- Console operators (demo login). Password stored as scrypt$saltHex$hashHex.
CREATE TABLE IF NOT EXISTS memstream_operators (
  username STRING PRIMARY KEY,
  password_hash STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
