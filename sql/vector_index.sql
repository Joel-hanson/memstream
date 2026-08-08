-- Optional fallback only.
-- Use when application.sql fails creating VECTOR INDEX with:
--   unimplemented: vector index build not supported with the legacy schema changer
-- Run this file alone (one paste) after agent_memory_chunks exists.

SET CLUSTER SETTING feature.vector_index.enabled = true;
SET use_declarative_schema_changer = on;

CREATE VECTOR INDEX IF NOT EXISTS agent_memory_chunks_embedding_idx
  ON agent_memory_chunks (embedding vector_cosine_ops);
