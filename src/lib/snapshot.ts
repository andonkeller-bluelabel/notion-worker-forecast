/**
 * Durable weekly pipeline snapshots: one tidy row per deal per week, written to
 * an append-only "Snapshots" sheet tab. Captures each deal's forecast state
 * (probability, gross/weighted totals, gross per quarter) so week-over-week
 * movement — stage changes, added/removed deals, value drift, coverage shifts —
 * can be reconstructed later. Machine-written, single fixed schema.
 */

import type { DealAgg } from "./render.js";
import { quartersRange, monthToQuarter } from "./forecast.js";

const QUARTERS = quartersRange(); // 2026.Q1 … 2028.Q4

export const SNAPSHOT_HEADERS: string[] = [
  "snapshot_date",
  "deal_id",
  "deal_title",
  "client",
  "client_partner",
  "probability",
  "contract_type",
  "gross_total",
  "weighted_total",
  ...QUARTERS,
];

/**
 * The snapshot's identity: the calendar date in America/New_York as "YYYY-MM-DD".
 * Keying on the actual run date (not the week's Monday) makes snapshot_date the real
 * day it was taken (e.g. a Tuesday), keeps re-runs on the same day idempotent, and lets
 * a second weekly cadence (e.g. a Friday) coexist without overwriting the first.
 */
export function snapshotDate(d: Date = new Date()): string {
  // en-CA renders YYYY-MM-DD; the ET time zone ensures a 2 PM ET run lands on that ET day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/** One row per deal: attributes + gross/weighted totals + gross per quarter. */
export function buildSnapshotRows(deals: DealAgg[], snapshotDate: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const d of deals) {
    const perQ = new Map<string, number>(QUARTERS.map((q) => [q, 0]));
    let grossTotal = 0;
    for (const [m, v] of d.byMonth) {
      grossTotal += v;
      const q = monthToQuarter(m);
      if (perQ.has(q)) perQ.set(q, perQ.get(q)! + v);
    }
    let weightedTotal = 0;
    for (const v of d.byMonthW.values()) weightedTotal += v;
    rows.push([
      snapshotDate,
      d.dealId,
      d.dealTitle,
      d.client,
      d.clientPartner,
      d.probability,
      d.contractType,
      Math.round(grossTotal),
      Math.round(weightedTotal),
      ...QUARTERS.map((q) => Math.round(perQ.get(q)!)),
    ]);
  }
  return rows;
}
