// Pure helpers (no network) so they can be tested offline.
export const norm = (s) => String(s || "").toLowerCase().replace(/[★*]/g, "").replace(/\b(at|the|of|by|community|homes?)\b/g, "").replace(/[^a-z0-9]/g, "");

export function extractJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
  if (!m) throw new Error("no JSON in model reply");
  return JSON.parse(m[1]);
}

const COUNTY = ["oakland", "macomb", "wayne", "washtenaw", "livingston", "genesee", "lapeer", "st. clair", "monroe"];
export function cleanCommunity(c) {
  const out = {
    name: String(c.name || "").trim(),
    loc: String(c.loc || "").trim(),
    price: String(c.price || "").trim(),
    sqft: String(c.sqft || "Var.").trim(),
    type: String(c.type || "Single-Family").trim(),
    status: String(c.status || "Active").trim(),
    note: String(c.note || "").trim(),
    url: /^https:\/\//.test(c.url || "") ? c.url : undefined,
    priceMin: Number.isFinite(+c.priceMin) && +c.priceMin >= 100000 ? +c.priceMin : null,
    priceMax: Number.isFinite(+c.priceMax) && +c.priceMax >= 100000 ? +c.priceMax : null,
  };
  const co = String(c.county || "").toLowerCase();
  out.county = COUNTY.find((x) => co.includes(x)) || "unknown";
  if (!out.name) return null;
  return out;
}

// Merge freshly-found communities for one builder into the existing list.
// Returns {communities, added[], changed[], removed[], flagged[]}
export function mergeBuilder(existing, found, today) {
  const byKey = new Map(existing.map((c) => [norm(c.name), c]));
  const seen = new Set();
  const added = [], changed = [], removed = [], flagged = [];

  for (const raw of found) {
    const f = cleanCommunity(raw);
    if (!f) continue;
    const key = norm(f.name);
    seen.add(key);
    const cur = byKey.get(key);
    if (!cur) {
      const nc = { ...f, lat: null, lng: null, verified: true, coordsVerified: false, firstSeen: today, lastChecked: today, missCount: 0 };
      existing.push(nc);
      byKey.set(key, nc);
      added.push(nc.name);
      continue;
    }
    const diffs = [];
    for (const k of ["price", "status", "priceMin", "priceMax", "sqft", "type"]) {
      if (f[k] != null && f[k] !== "" && f[k] !== cur[k] && !(k === "sqft" && f[k] === "Var.")) {
        diffs.push(`${k}: ${cur[k]} → ${f[k]}`);
        cur[k] = f[k];
      }
    }
    if (f.url && f.url !== cur.url) { cur.url = f.url; diffs.push("url"); }
    if (f.note && !cur.note) cur.note = f.note;
    if (cur.county === "unknown" && f.county !== "unknown") cur.county = f.county;
    if (diffs.length) changed.push(`${cur.name} (${diffs.join("; ")})`);
    cur.verified = true;
    cur.lastChecked = today;
    cur.missCount = 0;
    delete cur.removed;
  }

  for (const c of existing) {
    if (seen.has(norm(c.name)) || c.removed) continue;
    c.missCount = (c.missCount || 0) + 1;
    if (c.missCount >= 2) { c.removed = true; removed.push(c.name); }
    else flagged.push(c.name);
  }
  return { added, changed, removed, flagged };
}

// Safety guard: refuse a result that looks like a failed scrape.
export function looksBroken(existingCount, foundCount) {
  if (foundCount === 0) return true;
  return existingCount >= 4 && foundCount < existingCount * 0.5;
}
