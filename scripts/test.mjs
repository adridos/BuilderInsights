import assert from "node:assert";
import { mergeBuilder, looksBroken, extractJson } from "./lib.mjs";
const ex = [
  { name: "Alpha", price: "From $500,000", priceMin: 500000, status: "Active", county: "oakland", missCount: 0 },
  { name: "Beta ★", price: "From $400,000", priceMin: 400000, status: "Active", county: "macomb", missCount: 0 },
  { name: "Gone", price: "x", status: "Active", county: "macomb", missCount: 1 },
];
const r = mergeBuilder(ex, [
  { name: "Alpha", price: "From $525,000", priceMin: 525000, status: "Active", county: "Oakland Co." },
  { name: "Beta", price: "From $400,000", priceMin: 400000, status: "Coming Soon", url: "https://x.com/b" },
  { name: "Delta", price: "From $300,000", priceMin: 300000, county: "macomb", url: "http://bad" },
  { name: "" },
], "2026-12-01");
assert.deepEqual(r.added, ["Delta"]);
assert.equal(r.changed.length, 2);
assert.deepEqual(r.removed, ["Gone"]);
assert.equal(ex.find((c) => c.name === "Alpha").priceMin, 525000);
assert.equal(ex.find((c) => c.name === "Delta").url, undefined);
assert(looksBroken(10, 3) && looksBroken(5, 0) && !looksBroken(10, 9) && !looksBroken(2, 1));
assert.deepEqual(extractJson('hi ```json\n{"a":1}\n```'), { a: 1 });
console.log("all tests passed");
