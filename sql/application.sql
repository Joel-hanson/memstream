-- Application DB (Connect URL) — applied by Memstream Enable on the connected app DB.
-- Not applied by make setup-db (that only migrates the Memstream platform DB).
--
-- Includes demo shop tables + agent_memory_chunks (VECTOR) for live memory.
-- If VECTOR INDEX fails, Enable retries with sql/vector_index.sql settings.

SET CLUSTER SETTING feature.vector_index.enabled = true;

-- Demo app tables -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id STRING PRIMARY KEY,
  name STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id STRING PRIMARY KEY,
  customer_id STRING NOT NULL REFERENCES customers (id),
  status STRING NOT NULL,
  note STRING NULL,
  sku STRING NULL,
  quantity INT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing clusters created before sku/quantity existed
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku STRING NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INT NULL;

CREATE TABLE IF NOT EXISTS stock (
  sku STRING PRIMARY KEY,
  warehouse_id STRING NOT NULL,
  quantity INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id STRING PRIMARY KEY,
  order_id STRING NULL REFERENCES orders (id),
  status STRING NOT NULL,
  body STRING NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- saas-security profile
CREATE TABLE IF NOT EXISTS users (
  id STRING PRIMARY KEY,
  org_id STRING NOT NULL,
  email STRING NOT NULL,
  role STRING NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Live memory (embeddings stay on the application DB) -----------------------

CREATE TABLE IF NOT EXISTS agent_memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application STRING NOT NULL,
  -- Memstream connection that produced this chunk (scopes multi-app DBs)
  connection_id UUID,
  table_name STRING NOT NULL,
  rule_name STRING NOT NULL,
  tags STRING[] NOT NULL DEFAULT ARRAY[],
  body STRING NOT NULL,
  embedding VECTOR(1024),
  source_ts TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX agent_memory_chunks_app_idx (application, created_at DESC),
  INDEX agent_memory_chunks_connection_idx (connection_id, created_at DESC)
);

-- Safe for clusters created before connection_id existed
ALTER TABLE agent_memory_chunks ADD COLUMN IF NOT EXISTS connection_id UUID;
CREATE INDEX IF NOT EXISTS agent_memory_chunks_connection_idx
  ON agent_memory_chunks (connection_id, created_at DESC);

-- Vector index (separate statement — Enable retries with declarative changer if needed)
CREATE VECTOR INDEX IF NOT EXISTS agent_memory_chunks_embedding_idx
  ON agent_memory_chunks (embedding vector_cosine_ops);

-- Demo seed (idempotent) ----------------------------------------------------

INSERT INTO customers (id, name) VALUES
  ('c1', 'Alex'),
  ('c2', 'Sam')
ON CONFLICT (id) DO NOTHING;

UPDATE customers SET name = 'Alex' WHERE id = 'c1' AND name IN ('Acme', 'c1');
UPDATE customers SET name = 'Sam' WHERE id = 'c2' AND name IN ('Globex', 'c2');

INSERT INTO orders (id, customer_id, status, sku, quantity) VALUES
  ('100', 'c1', 'pending', 'SKU-12', 1),
  ('101', 'c2', 'pending', 'SKU-99', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock (sku, warehouse_id, quantity) VALUES
  ('SKU-12', 'east', 40),
  ('SKU-99', 'west', 10)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO users (id, org_id, email, role) VALUES
  ('u1', 'org-acme', 'admin@acme.test', 'member'),
  ('u2', 'org-acme', 'boss@acme.test', 'owner')
ON CONFLICT (id) DO NOTHING;
