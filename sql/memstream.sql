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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX memstream_connections_active_idx (is_active)
);

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
  connection_id UUID,
  log STRING[] NOT NULL DEFAULT ARRAY[],
  error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  INDEX memstream_runs_created_idx (created_at DESC)
);

-- Safe for clusters created before connection_id existed
ALTER TABLE memstream_runs ADD COLUMN IF NOT EXISTS connection_id UUID;

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
