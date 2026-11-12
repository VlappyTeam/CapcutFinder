const { Router } = require("express");
const { validateSearch } = require("../lib/validate");
const { searchCapCut, mockTemplates } = require("../lib/capcut");
const {
  readCache,
  writeCache,
  logSearch
} = require("../lib/supabase");

const router = Router();

/**
 * GET /api/search?q=wo+ai+ni&size=10
 *
 * Query:
 *   q | keyword
 *   size | count
 *   fallback   — default true
 *   raw        — include upstream raw
 *   nocache    — skip read cache
 *   refresh    — force upstream + overwrite cache
 */
router.get("/", async (req, res) => {
  const t0 = Date.now();
  const qRaw = req.query.q ?? req.query.keyword ?? "";
  const sizeRaw = req.query.size ?? req.query.count ?? 10;
  const allowFallback =
    req.query.fallback === undefined ||
    req.query.fallback === "1" ||
    req.query.fallback === "true";
  const wantRaw = req.query.raw === "1" || req.query.raw === "true";
  const noCache = req.query.nocache === "1" || req.query.nocache === "true";
  const forceRefresh =
    req.query.refresh === "1" || req.query.refresh === "true";

  const v = validateSearch(qRaw, sizeRaw);
  if (!v.ok) {
    return res.status(400).json({
      ok: false,
      error: v.errors[0],
      errors: v.errors
    });
  }

  let mode = "proxy";
  let templates = null;
  let upstream = null;
  let errorDetail = null;
  let cacheMeta = null;
  let cacheHit = false;
  let revalidate = false;

  // 1) Cache (kecuali nocache / refresh)
  if (!noCache && !forceRefresh) {
    try {
      const hit = await readCache(v.query, v.size);
      if (hit?.templates?.length) {
        templates = hit.templates;
        cacheMeta = hit.meta;
        cacheHit = true;
        mode = "cache";
        // stale-while-revalidate: kirim cache, refresh background
        if (hit.stale) {
          revalidate = true;
          mode = "cache-stale";
        }
      }
    } catch (e) {
      console.warn("[cache read]", e.message);
    }
  }

  // 2) Upstream bila miss / force refresh
  //    (stale: response tetap dari cache; refresh async di bawah)
  if (!templates || forceRefresh) {
    try {
      upstream = await searchCapCut(v.query, v.size);
      templates = upstream.templates;
      mode = "proxy";
      cacheHit = false;

      if (templates.length) {
        // write non-blocking
        writeCache(v.query, v.size, templates, "proxy").catch((e) =>
          console.warn("[cache write]", e.message)
        );
      }
    } catch (e) {
      errorDetail = { message: e.message, status: e.status || null };
      console.warn("[capcut proxy]", e.message);
    }
  } else if (revalidate) {
    // background revalidate — jangan await
    searchCapCut(v.query, v.size)
      .then((up) => {
        if (up.templates?.length) {
          return writeCache(v.query, v.size, up.templates, "proxy");
        }
      })
      .catch((e) => console.warn("[swr revalidate]", e.message));
  }

  // 3) Fallback mock
  if ((!templates || templates.length === 0) && allowFallback) {
    templates = mockTemplates(v.query, v.size);
    mode = errorDetail ? "mock-fallback" : "mock";
    writeCache(v.query, v.size, templates, "mock").catch(() => {});
  }

  const latencyMs = Date.now() - t0;

  if (!templates || templates.length === 0) {
    logSearch(v.query, 0, "empty", { cacheHit: false, latencyMs }).catch(
      () => {}
    );
    return res.status(502).json({
      ok: false,
      error: "CapCut upstream gagal dan fallback dimatikan",
      upstream: errorDetail,
      query: v.query,
      latency_ms: latencyMs
    });
  }

  logSearch(v.query, templates.length, mode, {
    cacheHit,
    latencyMs
  }).catch(() => {});

  // Cache headers untuk CDN / browser
  if (cacheHit && !forceRefresh) {
    const ttl = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 21600;
    res.setHeader(
      "Cache-Control",
      revalidate
        ? "public, max-age=30, stale-while-revalidate=60"
        : `public, max-age=${Math.min(300, ttl)}, stale-while-revalidate=60`
    );
    res.setHeader("X-Cache", revalidate ? "STALE" : "HIT");
  } else {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Cache", "MISS");
  }

  const body = {
    ok: true,
    query: v.query,
    size: v.size,
    mode,
    count: templates.length,
    cache: {
      hit: cacheHit,
      stale: !!revalidate,
      key: cacheMeta?.cache_key || null,
      hits: cacheMeta?.hit_count || null,
      expires_at: cacheMeta?.expires_at || null
    },
    latency_ms: latencyMs,
    templates
  };

  if (wantRaw && upstream?.raw) body.raw = upstream.raw;
  if (errorDetail && String(mode).startsWith("mock")) {
    body.upstream_error = errorDetail;
  }

  return res.json(body);
});

/** GET /api/search/raw — proxy murni tanpa cache normalize layer */
router.get("/raw", async (req, res) => {
  const qRaw = req.query.q ?? req.query.keyword ?? "";
  const sizeRaw = req.query.size ?? req.query.count ?? 10;
  const v = validateSearch(qRaw, sizeRaw);
  if (!v.ok) {
    return res.status(400).json({ ok: false, error: v.errors[0] });
  }

  try {
    const result = await searchCapCut(v.query, v.size);
    res.setHeader("X-Upstream-Status", String(result.status));
    res.setHeader("X-Cache", "BYPASS");
    const payload =
      result.raw?.data?.templates ||
      result.raw?.data ||
      result.raw ||
      result.templates;
    return res.json(payload);
  } catch (e) {
    return res.status(e.status || 502).json({
      ok: false,
      error: e.message,
      body: e.body || null
    });
  }
});

module.exports = router;
