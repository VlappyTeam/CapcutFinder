# CapCut Finder API v1.2

Express proxy CapCut template search + **Supabase JSONB cache (GIN)**.  
Siap **Vercel** / Railway / local. **Tidak ada HTML.**

---

## Deploy Vercel (cepat)

```bash
cd capcut-api
npm install
npx vercel login
npx vercel
```

### Environment Variables (Vercel → Settings → Env)

| Name | Required | Contoh |
|------|----------|--------|
| `SUPABASE_URL` | opsional | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | opsional | `eyJ...` |
| `CACHE_TTL_SECONDS` | no | `21600` |
| `CACHE_STALE_SECONDS` | no | `3600` |
| `CAPCUT_SEARCH_URL` | no | default CapCut search URL |
| `RATE_LIMIT_MAX` | no | `60` |

Setelah deploy:

```
https://YOUR-APP.vercel.app/health
https://YOUR-APP.vercel.app/api/search?q=wo%20ai%20ni&size=10
https://YOUR-APP.vercel.app/api/cache/stats
```

---

## Supabase (wajib untuk cache)

1. SQL Editor → paste **`sql/schema.sql`** → Run  
2. Isi `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` di Vercel  
3. Redeploy

Schema sudah include:
- tabel `search_cache` (1 row / query, JSONB)
- GIN `jsonb_path_ops` + `jsonb_ops`
- RPC `bump_search_cache_hit`, `search_cache_stats`, `find_caches_by_template_id`, `cleanup_expired_search_cache`

---

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

---

## Endpoints

| Method | Path | Ket |
|--------|------|-----|
| GET | `/health` | status + cache stats |
| GET | `/api/search?q=&size=` | proxy + cache + SWR |
| GET | `/api/search/raw?q=` | proxy murni CapCut |
| GET | `/api/cache/stats` | statistik cache |
| GET | `/api/cache/by-template/:id` | GIN containment by template id |
| POST | `/api/cache/cleanup` | hapus expired |
| DELETE | `/api/cache/:key` | hapus 1 key |

### Query `/api/search`

- `q` / `keyword` — wajib  
- `size` / `count` — 6|10|16|20|30|50  
- `fallback=true` — mock jika upstream gagal  
- `refresh=true` — force upstream  
- `nocache=true` — skip baca cache  
- `raw=true` — sertakan raw CapCut  

Response include `mode`, `cache`, `latency_ms`, `templates[]`.

---

## Fitur fixed

- Validasi input ketat  
- Proxy CapCut + normalize field  
- Cache 1-row JSONB + TTL + stale-while-revalidate  
- Index GIN JSONB  
- Rate limit + CORS + helmet  
- Vercel serverless (`api/index.js` + `vercel.json`)  
- Fallback mock jika CapCut diblok  

---

## Struktur

```
capcut-api/
├── api/index.js          # Vercel entry
├── src/server.js
├── src/routes/{search,health,cache}.js
├── src/lib/{capcut,validate,supabase}.js
├── sql/schema.sql
├── vercel.json
├── package.json
└── .env.example
```
