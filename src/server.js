require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const searchRouter = require("./routes/search");
const healthRouter = require("./routes/health");
const cacheRouter = require("./routes/cache");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const isVercel = !!process.env.VERCEL;

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "HEAD", "OPTIONS", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Accept"]
  })
);

if (!isVercel) {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use(express.json({ limit: "32kb" }));

app.use(
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Terlalu banyak request, coba lagi nanti" }
  })
);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "capcut-finder-api",
    version: "1.2.0",
    endpoints: {
      health: "GET /health",
      search: "GET /api/search?q=KEYWORD&size=10",
      searchRaw: "GET /api/search/raw?q=KEYWORD&size=10",
      cacheStats: "GET /api/cache/stats",
      cacheByTemplate: "GET /api/cache/by-template/:id",
      cacheCleanup: "POST /api/cache/cleanup"
    }
  });
});

app.use("/health", healthRouter);
app.use("/api/search", searchRouter);
app.use("/api/cache", cacheRouter);

// On Vercel, paths may arrive as /api/... already; also mount without prefix
app.use("/search", searchRouter);
app.use("/cache", cacheRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`CapCut API listening on :${PORT}`);
    console.log(`  GET /health`);
    console.log(`  GET /api/search?q=wo+ai+ni&size=10`);
    console.log(`  GET /api/cache/stats`);
  });
}

module.exports = app;
