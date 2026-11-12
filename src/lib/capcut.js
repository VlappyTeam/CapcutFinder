/**
 * CapCut template search proxy
 * Endpoint default: https://www.capcut.com/api/v1/template/search
 */

const DEFAULT_URL =
  process.env.CAPCUT_SEARCH_URL ||
  "https://www.capcut.com/api/v1/template/search";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

/** Normalize satu item CapCut → shape stabil */
function normalizeItem(t) {
  if (!t || typeof t !== "object") return null;

  const id = String(
    pick(t, ["id", "template_id", "web_id", "webId", "templateId"]) || ""
  ).trim();
  if (!id) return null;

  const authorObj = t.author || t.creator || t.user || {};
  const author =
    pick(authorObj, ["name", "nickname", "unique_id"]) ||
    pick(t, ["author_name", "authorName", "creator_name"]) ||
    (typeof t.author === "string" ? t.author : null) ||
    "Creator";

  const cover = String(
    pick(t, [
      "cover",
      "cover_url",
      "coverUrl",
      "thumbnail",
      "poster",
      "cover_image"
    ]) ||
      pick(t.cover_info || {}, ["url", "cover_url"]) ||
      ""
  );

  const video = String(
    pick(t, [
      "preview_video",
      "video_url",
      "video",
      "previewVideoUrl",
      "videoUrl",
      "play_url"
    ]) ||
      pick(t.video_info || {}, ["url", "play_url"]) ||
      ""
  );

  const used = Number(
    pick(t, [
      "usage_amount",
      "use_count",
      "used",
      "usageAmount",
      "useCount",
      "usage"
    ]) || 0
  );
  const likes = Number(
    pick(t, ["like_count", "likes", "likeCount", "digg_count"]) || 0
  );
  const comments = Number(
    pick(t, ["comment_count", "comments", "commentCount"]) || 0
  );

  let duration = pick(t, ["duration", "video_duration"]);
  if (typeof duration === "number") {
    // kadang microseconds
    if (duration > 10000) duration = (duration / 1e6).toFixed(1);
    else duration = duration.toFixed(1);
  } else if (duration != null) {
    duration = String(duration);
  } else {
    duration = "—";
  }

  const fragments = pick(t, ["fragment_count", "clip_count", "clips"]);
  const clips =
    typeof fragments === "number"
      ? `${fragments} klip`
      : fragments
        ? String(fragments)
        : "—";

  return {
    id,
    title: String(pick(t, ["title", "name", "template_name"]) || "Untitled").slice(
      0,
      160
    ),
    author: String(author).slice(0, 80),
    tags: String(
      pick(t, ["tags", "topics", "hashtag", "short_title"]) || "#capcut #fyp"
    ).slice(0, 200),
    cover,
    duration,
    clips,
    ratio: String(pick(t, ["ratio", "aspect_ratio"]) || "9:16"),
    used: Number.isFinite(used) ? used : 0,
    likes: Number.isFinite(likes) ? likes : 0,
    comments: Number.isFinite(comments) ? comments : 0,
    video,
    url:
      String(pick(t, ["url", "templateUrl", "template_url", "share_url"]) || "") ||
      `https://www.capcut.com/template-detail/${id}`,
    source: "capcut"
  };
}

/**
 * Extract array templates dari berbagai bentuk response CapCut
 */
function extractList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.templates)) return data.templates;
  if (Array.isArray(data.template_list)) return data.template_list;
  if (Array.isArray(data.list)) return data.list;
  if (data.data) {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.data.templates)) return data.data.templates;
    if (Array.isArray(data.data.template_list)) return data.data.template_list;
    if (Array.isArray(data.data.list)) return data.data.list;
  }
  return [];
}

/**
 * Proxy search ke CapCut
 * @returns {{ templates: object[], raw: any, status: number }}
 */
async function searchCapCut(keyword, size = 10) {
  const base = DEFAULT_URL;
  const url = new URL(base);
  url.searchParams.set("keyword", keyword);
  // beberapa endpoint pakai size, beberapa count
  url.searchParams.set("size", String(size));
  url.searchParams.set("count", String(size));
  url.searchParams.set("cursor", "0");
  url.searchParams.set("from", "web");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      Referer: "https://www.capcut.com/",
      Origin: "https://www.capcut.com"
    },
    signal: AbortSignal.timeout(12000)
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`CapCut response bukan JSON (HTTP ${res.status})`);
    err.status = res.status;
    err.body = text.slice(0, 300);
    throw err;
  }

  if (!res.ok) {
    const err = new Error(
      json?.message || json?.errmsg || `CapCut HTTP ${res.status}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }

  const rawList = extractList(json);
  const templates = rawList
    .map(normalizeItem)
    .filter(Boolean)
    .slice(0, size);

  return {
    templates,
    raw: json,
    status: res.status,
    upstreamUrl: url.toString()
  };
}

/** Mock deterministik kalau upstream gagal total */
function mockTemplates(q, size) {
  const authors = [
    "ISS [RFS]",
    "Bayot Toy[SN]",
    "CHINA TIMUR",
    "jedannn",
    "TrendMaker",
    "ViralLab"
  ];
  const seed = Array.from(q).reduce((a, c) => a + c.charCodeAt(0), 0);
  const list = [];
  for (let i = 0; i < size; i++) {
    const id = String(
      7400000000000000000n + BigInt((seed * 997 + i * 131) % 1e12)
    );
    list.push({
      id,
      title: i % 2 === 0 ? `Trend jj ${q}` : `CHINA TIMUR · ${q.toUpperCase()}`,
      author: authors[i % authors.length],
      tags: "#trend #capcut #fyp",
      cover: `https://picsum.photos/seed/${encodeURIComponent(q + i)}/360/640`,
      duration: (15 + ((seed + i) % 80) / 10).toFixed(1),
      clips: "3 klip",
      ratio: "9:16",
      used: 80000 + ((seed * (i + 3)) % 250000),
      likes: 12000 + ((seed * (i + 7)) % 60000),
      comments: 10 + ((seed + i * 13) % 90),
      video: "https://www.w3schools.com/html/mov_bbb.mp4",
      url: `https://www.capcut.com/template-detail/${id}`,
      source: "mock"
    });
  }
  return list;
}

module.exports = {
  searchCapCut,
  normalizeItem,
  extractList,
  mockTemplates
};
