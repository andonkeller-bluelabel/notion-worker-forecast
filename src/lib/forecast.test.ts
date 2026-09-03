/**
 * Assertions for the calendar-day proration. Run with `npm run test:forecast`.
 */

import assert from "node:assert/strict";
import { spreadSegment, computeFacts, factsToGrid, FACT_HEADERS, type Segment } from "./forecast.js";

const base: Omit<Segment, "start" | "end" | "weeklyRevenue" | "stageProbability"> = {
  dealTitle: "Acme",
  clientAccount: "Acme Co",
  clientPartner: "Ryan",
  stage: "Won",
  deliveryPhase: "Deploy",
  billingBasis: "Per Week",
};

// Full month, won (prob 1): 700/wk × (30 days ÷ 7) = 3000.
const june = spreadSegment({ ...base, start: "2026-06-01", end: "2026-07-01", weeklyRevenue: 700, stageProbability: 1 });
assert.equal(june.length, 1);
assert.equal(june[0]!.month, "2026-06");
assert.equal(Math.round(june[0]!.committed), 3000, "full-month committed");
assert.equal(Math.round(june[0]!.weighted), 3000, "won → weighted = committed");

// Not won (prob 0.5): committed 0, weighted halved.
const pipeline = spreadSegment({ ...base, stage: "Negotiating", start: "2026-06-01", end: "2026-07-01", weeklyRevenue: 700, stageProbability: 0.5 });
assert.equal(pipeline[0]!.committed, 0, "un-won → committed 0");
assert.equal(Math.round(pipeline[0]!.weighted), 1500, "weighted = amount × 0.5");

// Partial month: 16 days in June → 700 × 16/7 = 1600.
const partial = spreadSegment({ ...base, start: "2026-06-15", end: "2026-07-01", weeklyRevenue: 700, stageProbability: 1 });
assert.equal(Math.round(partial[0]!.committed), 1600, "partial-month proration");

// Cross-month split sums to the whole and spans two months.
const cross = spreadSegment({ ...base, start: "2026-06-20", end: "2026-07-10", weeklyRevenue: 700, stageProbability: 1 });
assert.deepEqual(cross.map((c) => c.month), ["2026-06", "2026-07"]);
const total = cross.reduce((s, c) => s + c.committed, 0);
assert.equal(Math.round(total), Math.round(700 * (20 / 7)), "cross-month total = 20 days of revenue");

// Clamp: a segment past MAX_MONTH is truncated (nothing in 2029).
const beyond = spreadSegment({ ...base, start: "2028-12-01", end: "2029-03-01", weeklyRevenue: 700, stageProbability: 1 });
assert.ok(beyond.every((c) => c.month <= "2028-12"), "clamped to MAX_MONTH");
assert.ok(beyond.some((c) => c.month === "2028-12"), "includes final allowed month");

// Skips: no end, zero rate, end<=start.
assert.equal(spreadSegment({ ...base, start: "2026-06-01", end: null, weeklyRevenue: 700, stageProbability: 1 }).length, 0);
assert.equal(spreadSegment({ ...base, start: "2026-06-01", end: "2026-07-01", weeklyRevenue: 0, stageProbability: 1 }).length, 0);
assert.equal(spreadSegment({ ...base, start: "2026-07-01", end: "2026-06-01", weeklyRevenue: 700, stageProbability: 1 }).length, 0);

// computeFacts + grid shape.
const facts = computeFacts([
  { ...base, start: "2026-06-01", end: "2026-07-01", weeklyRevenue: 700, stageProbability: 1 },
  { ...base, dealTitle: "Beta", stage: "Negotiating", start: "2026-06-01", end: "2026-07-01", weeklyRevenue: 350, stageProbability: 0.25 },
]);
assert.equal(facts.length, 2);
const grid = factsToGrid(facts);
assert.deepEqual(grid[0], FACT_HEADERS.slice());
assert.equal(grid.length, 1 + 2, "header + 2 rows");
assert.equal(grid[1]!.length, FACT_HEADERS.length, "row width matches headers");

console.log("✓ all forecast.test assertions passed");
