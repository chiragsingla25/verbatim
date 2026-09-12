-- v1.5 model fallback (specs/2026-09-12-verbatim-v1.5-model-fallback.md).
--
-- Which MODEL_REGISTRY id actually answered a turn — always the free model until the
-- fallback chain fires. Default 'free' covers every row written before this migration and
-- any insert that predates a client sending a value (shouldn't happen post-deploy, but the
-- column is NOT NULL so a default is required regardless).

alter table public.query_log
  add column if not exists model_used text not null default 'free';
