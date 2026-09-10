/**
 * Coverage glidepath from the append-only Snapshots tab: for a given quarter, how its
 * weighted coverage and closed % evolved as it approached quarter-end, indexed by weeks
 * remaining. One point per weekly snapshot. Weighted-per-quarter is reconstructed as
 * gross_q × probability (probability is uniform per deal), so only the snapshot's stored
 * gross-per-quarter + probability are needed.
 */

export type GlidePoint = { wte: number; cov: number; closed: number; date: string };
export type GlideSeries = { quarter: string; target: number; points: GlidePoint[] };

/** Last calendar day (UTC) of a "YYYY.Q#" quarter. */
function quarterEnd(q: string): Date | null {
  const m = /(\d{4})\.Q([1-4])/.exec(q);
  if (!m) return null;
  const endMonth0 = [2, 5, 8, 11][Number(m[2]) - 1]!;
  return new Date(Date.UTC(Number(m[1]), endMonth0 + 1, 0));
}
const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param rows        Snapshot DATA rows (no header): [snapshot_date, deal_id, …, probability(5), …, <quarter cols>].
 * @param targets     quarter → target dollars.
 * @param quarters    the full quarter order (quartersRange), to map a quarter to its snapshot column.
 * @param forQuarters which quarters to build a series for (e.g. current + next).
 */
export function computeGlidepath(
  rows: (string | number)[][],
  targets: Map<string, number>,
  quarters: string[],
  forQuarters: string[],
): GlideSeries[] {
  const FIRST_Q_COL = 9; // snapshot layout: cols 0-8 are attrs/totals, quarters start at 9
  const qcol = new Map(quarters.map((q, i) => [q, FIRST_Q_COL + i]));
  const byWeek = new Map<string, (string | number)[][]>();
  for (const r of rows) {
    if (!r || r[0] == null || r[0] === "") continue;
    const k = String(r[0]);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(r);
  }
  const weeks = [...byWeek.keys()].sort();

  const out: GlideSeries[] = [];
  for (const q of forQuarters) {
    const target = targets.get(q) ?? 0;
    const col = qcol.get(q);
    const end = quarterEnd(q);
    if (!target || col == null || !end) continue;
    const points: GlidePoint[] = [];
    for (const wk of weeks) {
      const wd = new Date(`${wk}T00:00:00Z`);
      if (Number.isNaN(wd.getTime()) || wd > end) continue;
      let weighted = 0;
      let committed = 0;
      let populated = false;
      for (const r of byWeek.get(wk)!) {
        const g = col < r.length ? num(r[col]) : 0;
        const p = num(r[5]);
        if (g) populated = true;
        weighted += g * p;
        if (p >= 0.999) committed += g;
      }
      if (!populated) continue; // quarter not captured in this (early) snapshot
      const wte = Math.round(((end.getTime() - wd.getTime()) / (7 * 864e5)) * 10) / 10;
      points.push({ wte, cov: weighted / target, closed: committed / target, date: wk.slice(5) });
    }
    out.push({ quarter: q, target, points });
  }
  return out;
}
