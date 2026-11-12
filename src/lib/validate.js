const RULES = {
  minLen: 2,
  maxLen: 80,
  pattern: /^[\w\s#\-\.'.\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+$/u,
  sizes: [6, 10, 16, 20, 30, 50]
};

function normalizeQuery(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function validateSearch(query, sizeRaw) {
  const q = normalizeQuery(query);
  const errors = [];

  if (!q) errors.push("query (q) wajib diisi");
  else {
    if (q.length < RULES.minLen) errors.push(`q minimal ${RULES.minLen} karakter`);
    if (q.length > RULES.maxLen) errors.push(`q maksimal ${RULES.maxLen} karakter`);
    if (!RULES.pattern.test(q)) {
      errors.push("q hanya huruf, angka, spasi, # - _ . '");
    }
    if (/[<>{}[\]\\`]/.test(q) || /javascript\s*:/i.test(q) || /https?:\/\//i.test(q)) {
      errors.push("q mengandung karakter/pola terlarang");
    }
  }

  let size = parseInt(sizeRaw, 10);
  if (Number.isNaN(size)) size = 10;
  if (!RULES.sizes.includes(size)) size = 10;

  return {
    ok: errors.length === 0,
    query: q,
    size,
    errors
  };
}

module.exports = { validateSearch, normalizeQuery, RULES };
