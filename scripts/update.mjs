// Weekly/monthly refresh of data/builders.json using Claude + web search.
// Usage: ANTHROPIC_API_KEY=... node scripts/update.mjs [--dry] [--only "Toll Brothers"] [--no-discover]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson, mergeBuilder, looksBroken, norm, cleanCommunity } from "./lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data/builders.json");
const REPORT = path.join(ROOT, "update-report.md");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const NO_DISCOVER = args.includes("--no-discover");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const KEY = process.env.ANTHROPIC_API_KEY;
const TODAY = new Date().toISOString().slice(0, 10);
const COLORS = ["#8e44ad", "#16a085", "#d35400", "#2c3e50", "#c0392b", "#27ae60", "#2980b9", "#f39c12"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!KEY) { console.error("ANTHROPIC_API_KEY is not set"); process.exit(1); }

async function claude(prompt, maxUses = 8) {
  const messages = [{ role: "user", content: prompt }];
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses, user_location: { type: "approximate", city: "Detroit", region: "Michigan", country: "US" } }];
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, tools, messages }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    if (j.stop_reason === "pause_turn") { // server paused a long search turn: resend unchanged
      messages.push({ role: "assistant", content: j.content });
      continue;
    }
    return j.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  throw new Error("too many pause_turn continuations");
}

const SCHEMA = `Each community object: {"name","loc":"City/Twp, XYZ Co.","county":"oakland|macomb|wayne|washtenaw|livingston|genesee|lapeer|other","price":"From $X" or "$X–$Y","priceMin":number,"priceMax":number|null,"sqft":"1,800–2,400" or "Var.","type":"Single-Family|Townhome|Condo|Ranch|Active Adult","status":"Active|Coming Soon|Final Opportunities|Sold Out","note":"short","url":"direct https link to that community's page on the builder's site"}`;

async function scrapeBuilder(b) {
  const known = b.communities.map((c) => c.name).join(", ");
  const text = await claude(
    `List EVERY community that the home builder "${b.name}" currently shows on its official website for Southeast Michigan (Oakland, Macomb, Wayne, Washtenaw, Livingston, Genesee, Lapeer, St. Clair counties), including Coming Soon ones. Official site: ${b.url || "search for it"}. If the builder site is JavaScript-rendered, use newhomesource.com or homes.com builder pages as a backup.
Already known: ${known}. Include those if still listed AND any new ones. Only report facts you actually saw; do not guess prices or URLs (leave priceMin null if not seen).
Reply with ONLY a \`\`\`json block containing {"communities":[...]}. ${SCHEMA}`, 10);
  return extractJson(text).communities || [];
}

async function discover(known) {
  const text = await claude(
    `Find home builders actively selling NEW CONSTRUCTION communities in Macomb or Oakland County, Michigan right now (2026) that are NOT in this list: ${known.join(", ")}. Check newhomesource.com, zillow new construction, builder association listings, and local news. Return up to 5 builders that have a real website and at least one active community.
Reply with ONLY a \`\`\`json block: {"builders":[{"name","type":"short description","category":"national|local","url":"builder home page https","priceDisplay":"$X–$Y","homeTypes":"..","notes":"..","communities":[...]}]}. ${SCHEMA}`, 12);
  return extractJson(text).builders || [];
}

let lastGeo = 0;
async function geocode(c) {
  const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await sleep(wait);
  lastGeo = Date.now();
  const q = encodeURIComponent(`${c.name}, ${c.loc.replace(/Twp/, "Township")}, Michigan`);
  const q2 = encodeURIComponent(`${c.loc.replace(/Twp/, "Township")}, Michigan`);
  for (const [query, exact] of [[q, true], [q2, false]]) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${query}`, { headers: { "User-Agent": "builder-intel-dashboard/1.0" } });
      const j = await r.json();
      if (j[0]) { c.lat = +(+j[0].lat).toFixed(4); c.lng = +(+j[0].lon).toFixed(4); c.coordsVerified = exact && j[0].class !== "boundary"; return; }
    } catch {}
    await sleep(1100); lastGeo = Date.now();
  }
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const report = [`# Builder data update – ${TODAY}\n`];
const problems = [];
let anyChange = false;

for (const b of data.builders) {
  if (ONLY && b.name !== ONLY) continue;
  try {
    const found = await scrapeBuilder(b);
    const live = b.communities.filter((c) => !c.removed);
    if (looksBroken(live.length, found.length)) {
      problems.push(`**${b.name}**: scrape returned ${found.length} vs ${live.length} existing – skipped (looks like a failed read).`);
      continue;
    }
    const r = mergeBuilder(b.communities, found, TODAY);
    for (const c of b.communities) if (c.lat == null) await geocode(c);
    if (r.added.length || r.changed.length || r.removed.length || r.flagged.length) {
      anyChange = true;
      report.push(`## ${b.name}`);
      if (r.added.length) report.push(`- 🆕 New: ${r.added.join(", ")}`);
      if (r.changed.length) report.push(...r.changed.map((x) => `- ✏️ ${x}`));
      if (r.flagged.length) report.push(`- ⚠️ Not found this run (will be removed if missing next time): ${r.flagged.join(", ")}`);
      if (r.removed.length) report.push(`- 🗑️ Removed (missing twice): ${r.removed.join(", ")}`);
    }
    const lv = b.communities.filter((c) => !c.removed);
    const mins = lv.map((c) => c.priceMin).filter(Boolean);
    if (mins.length) { b.priceMin = Math.min(...mins); b.priceMax = Math.max(...lv.map((c) => c.priceMax || c.priceMin).filter(Boolean)); }
    b.counties = [...new Set(lv.flatMap((c) => c.county.split("/")).filter((x) => x && x !== "unknown" && x !== "other"))];
    console.log(`${b.name}: ${lv.length} communities`);
  } catch (e) {
    problems.push(`**${b.name}**: ${e.message}`);
  }
}

if (!ONLY && !NO_DISCOVER) {
  try {
    const have = new Set(data.builders.map((b) => norm(b.name)));
    const found = await discover(data.builders.map((b) => b.name));
    for (const nb of found) {
      if (!nb.name || have.has(norm(nb.name))) continue;
      const comms = [];
      const tmp = [];
      mergeBuilder(tmp, nb.communities || [], TODAY);
      for (const c of tmp) { await geocode(c); comms.push(c); }
      if (!comms.length) continue;
      const mins = comms.map((c) => c.priceMin).filter(Boolean);
      data.builders.push({
        name: nb.name, type: nb.type || "", category: nb.category === "national" ? "national" : "local",
        url: /^https:\/\//.test(nb.url || "") ? nb.url : undefined, color: COLORS[data.builders.length % COLORS.length],
        priceMin: mins.length ? Math.min(...mins) : 0, priceMax: mins.length ? Math.max(...comms.map((c) => c.priceMax || c.priceMin || 0)) : 0,
        priceDisplay: nb.priceDisplay || "See site", homeTypes: nb.homeTypes || "", notes: (nb.notes || "") + " (auto-discovered – review)",
        highlights: [], counties: [...new Set(comms.map((c) => c.county).filter((x) => x !== "unknown" && x !== "other"))], communities: comms,
      });
      anyChange = true;
      report.push(`## 🆕 New builder: ${nb.name}\n- ${comms.length} communities found – please review before merging`);
    }
  } catch (e) { problems.push(`Discovery: ${e.message}`); }
}

if (problems.length) report.push(`\n## Needs attention\n` + problems.map((p) => `- ${p}`).join("\n"));
if (!anyChange) report.push("No changes found this run.");

data.lastUpdated = TODAY;
data.baseline = data.baseline || "2026-11-05";
if (!DRY) fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
fs.writeFileSync(REPORT, report.join("\n") + "\n");
console.log(report.join("\n"));
