const { Router } = require("express");
const { getSupabase, cacheStats, getTtlSec } = require("../lib/supabase");

const router = Router();

router.get("/", async (_req, res) => {
  const sb = getSupabase();
  let db = "not_configured";
  let cache = null;

  if (sb) {
    try {
      const { error } = await sb.from("search_cache").select("cache_key").limit(1);
      db = error ? `error: ${error.message}` : "ok";
      if (!error) {
        try {
          cache = await cacheStats();
        } catch {
          cache = null;
        }
      }
    } catch (e) {
      db = `error: ${e.message}`;
    }
  }

  res.json({
    ok: true,
    service: "capcut-finder-api",
    version: "1.1.0",
    db,
    cache_ttl_sec: getTtlSec(),
    cache,
    uptime: process.uptime(),
    time: new Date().toISOString()
  });
});

module.exports = router;
