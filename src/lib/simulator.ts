/**
 * Gap-closing simulator data: turn historical won deals into per-client "revenue arcs"
 * (monthly committed $ from the client's landing) that the browser tool can drop onto a
 * close date to project pipeline coverage. Also the current per-quarter baseline.
 *
 * Arcs use an UNCLAMPED monthly spread (the forecast's spreadSegment clips to 2026-2028;
 * a client that landed in 2024-25 needs its full ramp), and are keyed by client account,
 * aggregating all of that account's won deals into one land-and-expand curve.
 */

import type { Segment } from "./forecast.js";
import type { DealAgg } from "./render.js";
import { monthToQuarter } from "./forecast.js";

const MS_PER_DAY = 86_400_000;
function parseISO(d: string | null): number | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function overlapDays(aS: number, aE: number, bS: number, bE: number): number {
  const s = Math.max(aS, bS), e = Math.min(aE, bE);
  return e <= s ? 0 : Math.round((e - s) / MS_PER_DAY);
}

/** Spread one won segment into calendar month → committed $, with NO forecast-window clamp. */
function spreadUnclamped(seg: Segment): { month: string; amount: number }[] {
  const start = parseISO(seg.start);
  let end = parseISO(seg.end);
  const isFixed = !(seg.weeklyRevenue > 0);
  const rate = Number.isFinite(seg.rate) ? seg.rate : 0;
  if (start == null) return [];
  if (isFixed) {
    if (!(rate > 0)) return [];
    if (end == null || end <= start) end = start + MS_PER_DAY;
  } else if (end == null || end <= start) return [];
  const totalDays = Math.max(1, Math.round((end - start) / MS_PER_DAY));
  const out: { month: string; amount: number }[] = [];
  let y = new Date(start).getUTCFullYear();
  let mo = new Date(start).getUTCMonth();
  while (true) {
    const mStart = Date.UTC(y, mo, 1);
    if (mStart >= end) break;
    const mEnd = Date.UTC(y, mo + 1, 1);
    const days = overlapDays(start, end, mStart, mEnd);
    if (days > 0) out.push({ month: `${y}-${String(mo + 1).padStart(2, "0")}`, amount: isFixed ? rate * (days / totalDays) : seg.weeklyRevenue * (days / 7) });
    if (++mo > 11) { mo = 0; y += 1; }
  }
  return out;
}

export type Template = {
  name: string;
  arc: number[]; // committed $ per month from the client's first month, index 0 = landing month
  total: number;
  deals: number;
  cycleWeeks: number | null; // landing deal's first-stage → Won, from Deal Stage Changes
  firstStart: string; // ISO month the client's revenue began
  landedWon: string | null; // ISO month the client's first deal was won (true "new logo" date)
};

const isWon = (s: Segment) => s.stageProbability >= 0.999;
/** Deals below this BL number predate the new-logo window (old clients re-entered as forecasts). */
const NEW_LOGO_BL_FLOOR = 360;

/** Build one revenue arc per NEW-LOGO client account (first work in the last `windowMonths`). */
export function buildTemplates(
  segments: Segment[],
  cycles: Map<string, { first: string; won: string | null }>,
  now: Date = new Date(),
  windowMonths = 24,
  maxArc = 36,
): Template[] {
  const byAcct = new Map<string, Segment[]>();
  for (const s of segments) {
    if (!isWon(s) || !s.clientAccount || !s.start) continue;
    (byAcct.get(s.clientAccount) ?? byAcct.set(s.clientAccount, []).get(s.clientAccount)!).push(s);
  }
  const cut = new Date(now);
  cut.setUTCMonth(cut.getUTCMonth() - windowMonths);
  const cutISO = cut.toISOString().slice(0, 10);

  const out: Template[] = [];
  for (const [name, segs] of byAcct) {
    const dealIds = [...new Set(segs.map((s) => s.dealId).filter(Boolean))];
    const firstStart = segs.map((s) => s.start!).sort()[0]!;
    if (firstStart < cutISO) continue; // client's first (retained) revenue predates the window
    // Old clients whose only in-window rows are re-entered forecasts still slip through the date test,
    // because their pre-2025 revenue isn't retained. The BL number (sequential deal id) is a reliable
    // chronological proxy — exclude accounts whose earliest deal is below the new-logo floor.
    const minBL = Math.min(...segs.map((s) => { const m = /BL(\d+)/.exec(s.dealTitle); return m ? Number(m[1]) : Infinity; }));
    if (minBL < NEW_LOGO_BL_FLOOR) continue;
    // Landing deal's sales cycle (earliest Won date in the stage history → its first stage). Only a
    // fraction of deals are reliably timed, so this is best-effort; null where unknown.
    let firstWon: string | null = null;
    let cycleWeeks: number | null = null;
    for (const id of dealIds) {
      const c = cycles.get(id);
      if (c?.won && (!firstWon || c.won < firstWon)) {
        firstWon = c.won;
        const w = Math.round((Date.parse(c.won) - Date.parse(c.first)) / (7 * MS_PER_DAY));
        cycleWeeks = w > 0 ? w : null; // 0 = bulk-imported (no real gap) → treat as unknown
      }
    }

    const [fy, fm] = firstStart.slice(0, 7).split("-").map(Number);
    const arc: number[] = [];
    for (const s of segs)
      for (const c of spreadUnclamped(s)) {
        const [y, mo] = c.month.split("-").map(Number);
        const off = (y! - fy!) * 12 + (mo! - fm!);
        if (off >= 0 && off < maxArc) arc[off] = (arc[off] ?? 0) + c.amount;
      }
    for (let i = 0; i < arc.length; i++) if (arc[i] == null) arc[i] = 0;
    if (arc.length === 0) continue;
    out.push({
      name,
      arc: arc.map((v) => Math.round(v)),
      total: Math.round(arc.reduce((a, b) => a + b, 0)),
      deals: dealIds.length,
      cycleWeeks,
      firstStart: firstStart.slice(0, 7),
      landedWon: firstWon ? firstWon.slice(0, 7) : null,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

export type BaselineQuarter = { q: string; weighted: number; target: number };

/** Current probability-weighted pipeline per quarter + target (the simulator's starting point). */
export function buildBaseline(deals: DealAgg[], targets: Map<string, number>, quarters: string[]): BaselineQuarter[] {
  return quarters.map((q) => {
    let weighted = 0;
    for (const d of deals) for (const [m, v] of d.byMonthW) if (monthToQuarter(m) === q) weighted += v;
    return { q, weighted: Math.round(weighted), target: Math.round(targets.get(q) ?? 0) };
  });
}
