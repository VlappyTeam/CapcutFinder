-- ============================================================
-- CapCut Finder API — Optimized Supabase schema
-- JSONB indexes (GIN) + expression indexes + helpers
-- Aman di-run ulang (IF NOT EXISTS / OR REPLACE)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- 1) Search result cache: 1 baris = 1 query(+size)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_cache (
  cache_key     TEXT PRIMARY KEY,
  query_norm    TEXT NOT NULL,
  size          INT  NOT NULL DEFAULT 10,
  templates     JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode          TEXT NOT NULL DEFAULT 'proxy',
  hit_count     BIGINT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_cache_expires
  ON search_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_search_cache_query
  ON search_cache (query_norm);

CREATE INDEX IF NOT EXISTS idx_search_cache_hits
  ON search_cache (hit_count DESC);

CREATE INDEX IF NOT EXISTS idx_search_cache_query_expires
  ON search_cache (query_norm, expires_at DESC);

-- Partial: hanya row yang masih fresh
CREATE INDEX IF NOT EXISTS idx_search_cache_fresh
  ON search_cache (cache_key)
  WHERE expires_at > NOW();

-- GIN jsonb_path_ops: containment @> (lebih kecil & cepat untuk @>)
CREATE INDEX IF NOT EXISTS idx_search_cache_templates_gin
  ON search_cache
  USING GIN (templates jsonb_path_ops);

-- GIN jsonb_ops: ? ?| ?& key-exists
CREATE INDEX IF NOT EXISTS idx_search_cache_templates_gin_ops
  ON search_cache
  USING GIN (templates);

-- Expression: panjang array
CREATE INDEX IF NOT EXISTS idx_search_cache_templates_len
  ON search_cache ((jsonb_array_length(templates)));

-- ------------------------------------------------------------
-- 2) Search logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_logs (
  id            BIGSERIAL PRIMARY KEY,
  query         TEXT NOT NULL,
  result_count  INT DEFAULT 0,
  mode          TEXT DEFAULT 'proxy',
  cache_hit     BOOLEAN DEFAULT FALSE,
  latency_ms    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_created
  ON search_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_logs_query
  ON search_logs (query);

CREATE INDEX IF NOT EXISTS idx_search_logs_mode_created
  ON search_logs (mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_logs_cache_hits
  ON search_logs (created_at DESC)
  WHERE cache_hit = TRUE;

-- ------------------------------------------------------------
-- 3) Katalog template individual
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capcut_templates (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  author        TEXT DEFAULT 'Creator',
  tags          TEXT DEFAULT '#capcut #fyp',
  cover         TEXT,
  duration      TEXT DEFAULT '—',
  clips         TEXT DEFAULT '—',
  ratio         TEXT DEFAULT '9:16',
  used_count    BIGINT DEFAULT 0,
  likes         BIGINT DEFAULT 0,
  comments      INT DEFAULT 0,
  video_url     TEXT,
  template_url  TEXT,
  source        TEXT DEFAULT 'api',
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capcut_templates_seen
  ON capcut_templates (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_capcut_templates_used
  ON capcut_templates (used_count DESC);

CREATE INDEX IF NOT EXISTS idx_capcut_templates_author
  ON capcut_templates (author);

CREATE INDEX IF NOT EXISTS idx_capcut_templates_title_trgm
  ON capcut_templates
  USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_capcut_templates_meta_gin
  ON capcut_templates
  USING GIN (meta jsonb_path_ops);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE capcut_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read search_cache" ON search_cache;
CREATE POLICY "public read search_cache"
  ON search_cache FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read templates" ON capcut_templates;
CREATE POLICY "public read templates"
  ON capcut_templates FOR SELECT TO anon, authenticated USING (true);

-- ------------------------------------------------------------
-- RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_search_cache_hit(p_key TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE search_cache
  SET hit_count = hit_count + 1,
      updated_at = NOW()
  WHERE cache_key = p_key;
$$;

-- Containment pakai GIN path_ops
CREATE OR REPLACE FUNCTION find_caches_by_template_id(p_id TEXT)
RETURNS SETOF search_cache
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT *
  FROM search_cache
  WHERE templates @> jsonb_build_array(jsonb_build_object('id', p_id));
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_search_cache()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM search_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  DELETE FROM search_logs WHERE created_at < NOW() - INTERVAL '30 days';
  RETURN deleted;
END;
$$;

CREATE OR REPLACE FUNCTION search_cache_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'total_keys', (SELECT COUNT(*) FROM search_cache),
    'fresh_keys', (SELECT COUNT(*) FROM search_cache WHERE expires_at > NOW()),
    'stale_keys', (SELECT COUNT(*) FROM search_cache WHERE expires_at <= NOW()),
    'total_hits', (SELECT COALESCE(SUM(hit_count), 0) FROM search_cache),
    'avg_templates', (
      SELECT COALESCE(ROUND(AVG(jsonb_array_length(templates))::numeric, 1), 0)
      FROM search_cache
    ),
    'top_queries', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT query_norm, size, hit_count, mode, expires_at
        FROM search_cache
        ORDER BY hit_count DESC
        LIMIT 5
      ) t
    )
  );
$$;
