const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

let client = null;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" }
    });
  }
  return client;
}

function getTtlSec() {
  const n = parseInt(process.env.CACHE_TTL_SECONDS, 10);
  return Number.isFinite(n) && n > 0 ? n : 21600;
}

function normalizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function makeCacheKey(q, size) {
  const norm = normalizeQuery(q);
  const raw = `${norm}|${size}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

async function readCache(q, size) {
  const sb = getSupabase();
  if (!sb) return null;

  const key = makeCacheKey(q, size);
  const staleWindow = parseInt(process.env.CACHE_STALE_SECONDS, 10) || 3600;

  const { data, error } = await sb
    .from("search_cache")
    .select("cache_key, templates, mode, hit_count, expires_at, fetched_at")
    .eq("cache_key", key)
    .maybeSingle();

  if (error) {
    console.warn("[cache read]", error.message);
    return null;
  }
  if (!data || !Array.isArray(data.templates) || data.templates.length === 0) {
    return null;
  }

  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();
  const fresh = now < expiresAt;
  const withinStale = now < expiresAt + staleWindow * 1000;
  if (!fresh && !withinStale) return null;

  bumpHit(key).catch(() => {});

  const templates = data.templates.map((t) => ({
    ...t,
    source: t.source === "mock" ? "mock" : "cache"
  }));

  return {
    templates,
    stale: !fresh,
    meta: {
      cache_key: key,
      mode: data.mode,
      hit_count: (data.hit_count || 0) + 1,
      expires_at: data.expires_at,
      fetched_at: data.fetched_at
    }
  };
}

async function bumpHit(cacheKey) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("bump_search_cache_hit", { p_key: cacheKey });
  if (error) {
    await sb
      .from("search_cache")
      .update({ updated_at: new Date().toISOString() })
      .eq("cache_key", cacheKey);
  }
}

/** GIN: templates @> [{"id":"..."}] */
async function findByTemplateId(templateId) {
  const sb = getSupabase();
  if (!sb || !templateId) return [];

  const { data, error } = await sb.rpc("find_caches_by_template_id", {
    p_id: String(templateId)
  });

  if (error) {
    const { data: rows, error: e2 } = await sb
      .from("search_cache")
      .select("cache_key, query_norm, size, hit_count, expires_at, mode")
      .filter("templates", "cs", JSON.stringify([{ id: String(templateId) }]))
      .limit(20);
    if (e2) {
      console.warn("[findByTemplateId]", e2.message);
      return [];
    }
    return rows || [];
  }
  return data || [];
}

async function writeCache(q, size, templates, mode = "proxy") {
  const sb = getSupabase();
  if (!sb || !templates?.length) return;

  const key = makeCacheKey(q, size);
  const norm = normalizeQuery(q);
  const ttl = getTtlSec();
  const now = new Date();
  const expires = new Date(now.getTime() + ttl * 1000);

  const slim = templates.map((t) => ({
    id: t.id,
    title: t.title,
    author: t.author,
    tags: t.tags,
    cover: t.cover,
    duration: t.duration,
    clips: t.clips,
    ratio: t.ratio,
    used: t.used,
    likes: t.likes,
    comments: t.comments,
    video: t.video,
    url: t.url,
    source: t.source || mode
  }));

  const { error } = await sb.from("search_cache").upsert(
    {
      cache_key: key,
      query_norm: norm,
      size,
      templates: slim,
      mode,
      expires_at: expires.toISOString(),
      fetched_at: now.toISOString(),
      updated_at: now.toISOString()
    },
    { onConflict: "cache_key" }
  );

  if (error) {
    console.warn("[cache write]", error.message);
    return;
  }

  upsertCatalog(slim).catch((e) => console.warn("[catalog]", e.message));
}

async function upsertCatalog(templates) {
  const sb = getSupabase();
  if (!sb) return;

  const now = new Date().toISOString();
  const rows = templates.map((t) => ({
    id: t.id,
    title: t.title,
    author: t.author,
    tags: t.tags,
    cover: t.cover,
    duration: String(t.duration ?? "—"),
    clips: t.clips,
    ratio: t.ratio,
    used_count: t.used || 0,
    likes: t.likes || 0,
    comments: t.comments || 0,
    video_url: t.video,
    template_url: t.url,
    source: t.source || "api",
    meta: {
      used: t.used || 0,
      likes: t.likes || 0,
      comments: t.comments || 0
    },
    last_seen_at: now
  }));

  const { error } = await sb.from("capcut_templates").upsert(rows, {
    onConflict: "id"
  });
  if (error) throw error;
}

async function logSearch(q, count, mode, opts = {}) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("search_logs").insert({
      query: normalizeQuery(q),
      result_count: count,
      mode,
      cache_hit: !!opts.cacheHit,
      latency_ms: opts.latencyMs ?? null
    });
  } catch {
    /* ignore */
  }
}

async function cacheStats() {
  const sb = getSupabase();
  if (!sb) return { configured: false };

  const { data, error } = await sb.rpc("search_cache_stats");
  if (!error && data) {
    return { configured: true, ...data };
  }

  const now = new Date().toISOString();
  const [total, fresh, top] = await Promise.all([
    sb.from("search_cache").select("*", { count: "exact", head: true }),
    sb
      .from("search_cache")
      .select("*", { count: "exact", head: true })
      .gt("expires_at", now),
    sb
      .from("search_cache")
      .select("query_norm, size, hit_count, expires_at, mode")
      .order("hit_count", { ascending: false })
      .limit(5)
  ]);

  return {
    configured: true,
    total_keys: total.count ?? 0,
    fresh_keys: fresh.count ?? 0,
    top_queries: top.data || []
  };
}

async function cleanupExpired() {
  const sb = getSupabase();
  if (!sb) return { deleted: 0 };
  const { data, error } = await sb.rpc("cleanup_expired_search_cache");
  if (error) {
    const { error: e2, count } = await sb
      .from("search_cache")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());
    if (e2) throw e2;
    return { deleted: count || 0 };
  }
  return { deleted: data || 0 };
}

module.exports = {
  getSupabase,
  makeCacheKey,
  normalizeQuery,
  getTtlSec,
  readCache,
  writeCache,
  findByTemplateId,
  logSearch,
  cacheStats,
  cleanupExpired
};
