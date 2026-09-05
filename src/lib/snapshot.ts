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

/** Monday (UTC) of the week containing `d`, as "YYYY-MM-DD" — the idempotency key for a weekly snapshot. */
export function weekKey(d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay(); // 0 Sun … 6 Sat
  dt.setUTCDate(dt.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return dt.toISOString().slice(0, 10);
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
