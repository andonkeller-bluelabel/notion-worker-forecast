/**
 * Pipeline-vs-target coverage math for a set of quarters (a "window").
 *
 * Model (coverage by confidence): committed (100%) revenue landing in the window
 * counts fully toward the window's revenue target; the remainder is the GAP that
 * open-stage pipeline must cover. Per open stage p, its weighted $ covers
 * `weighted/gap` of the gap, and it would need `gap/p` of gross pipeline to close
 * the gap on its own. 0% deals can't contribute and are dropped.
 */

import type { DealAgg } from "./render.js";
import { monthToQuarter } from "./forecast.js";

export type StageCoverage = { pct: number; weighted: number; coverageOfGap: number; needGross: number };
export type WindowStats = {
  label: string;
  range: string;
  target: number;
  committed: number;
  committedPct: number;
  openWeighted: number;
  openWeightedPct: number;
  coveredPct: number;
  gap: number;
  gapCoveredPct: number; // open weighted ÷ gap
  stages: StageCoverage[];
};

/** Sum a deal's in-window revenue (raw or weighted) — months whose quarter is in the set. */
function inWindow(d: DealAgg, quarters: Set<string>, weighted: boolean): number {
  const src = weighted ? d.byMonthW : d.byMonth;
  let s = 0;
  for (const [m, v] of src) if (quarters.has(monthToQuarter(m))) s += v;
  return s;
}

export function computeWindow(deals: DealAgg[], targets: Map<string, number>, quarters: string[], label: string): WindowStats {
  const qset = new Set(quarters);
  const target = quarters.reduce((s, q) => s + (targets.get(q) ?? 0), 0);

  const byStage = new Map<number, number>(); // pct → weighted $
  let committed = 0;
  for (const d of deals) {
    const pct = Math.round(d.probability * 100);
    const w = inWindow(d, qset, true);
    if (pct >= 100) committed += w;
    else byStage.set(pct, (byStage.get(pct) ?? 0) + w);
  }

  const gap = Math.max(0, target - committed);
  const openWeighted = [...byStage.values()].reduce((s, v) => s + v, 0);
  const stages: StageCoverage[] = [...byStage.entries()]
    .filter(([pct]) => pct > 0) // 0% can't cover the gap
    .sort((a, b) => b[0] - a[0])
    .map(([pct, weighted]) => ({
      pct,
      weighted,
      coverageOfGap: gap > 0 ? weighted / gap : 0,
      needGross: gap > 0 ? gap / (pct / 100) : 0,
    }));

  const range = quarters.length ? `${quarters[0]}–${quarters[quarters.length - 1]}` : "";
  return {
    label,
    range,
    target,
    committed,
    committedPct: target > 0 ? committed / target : 0,
    openWeighted,
    openWeightedPct: target > 0 ? openWeighted / target : 0,
    coveredPct: target > 0 ? (committed + openWeighted) / target : 0,
    gap,
    gapCoveredPct: gap > 0 ? openWeighted / gap : 0,
    stages,
  };
}
