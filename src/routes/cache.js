const { Router } = require("express");
const {
  cacheStats,
  cleanupExpired,
  getSupabase,
  findByTemplateId
} = require("../lib/supabase");

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const stats = await cacheStats();
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GIN containment: templates @> [{"id":"..."}] */
router.get("/by-template/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id || id.length > 64) {
      return res.status(400).json({ ok: false, error: "invalid template id" });
    }
    const rows = await findByTemplateId(id);
    res.json({
      ok: true,
      template_id: id,
      count: rows.length,
      caches: rows.map((r) => ({
        cache_key: r.cache_key,
        query_norm: r.query_norm,
        size: r.size,
        hit_count: r.hit_count,
        mode: r.mode,
        expires_at: r.expires_at
      }))
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/cleanup", async (_req, res) => {
  try {
    const result = await cleanupExpired();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete("/:key", async (req, res) => {
  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ ok: false, error: "Supabase not configured" });
  }
  const key = String(req.params.key || "").slice(0, 64);
  if (!key) {
    return res.status(400).json({ ok: false, error: "key required" });
  }
  const { error, count } = await sb
    .from("search_cache")
    .delete({ count: "exact" })
    .eq("cache_key", key);
  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  res.json({ ok: true, deleted: count || 0 });
});

module.exports = router;
