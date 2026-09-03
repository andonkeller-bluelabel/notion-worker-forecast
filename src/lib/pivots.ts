/**
 * Builds the four pivot-table views over the `Forecast Facts` tab, one per tab.
 * Each pivot has Month as columns and both Committed $ and Weighted $ as summed
 * values, so a single set of pivots covers every horizon (filter the Month
 * columns) and the committed-vs-weighted comparison.
 *
 * Source column offsets in `Forecast Facts` (see forecast.ts FACT_HEADERS):
 *   0 Month | 1 Deal | 2 Client Account | 3 Client Partner | 4 Stage |
 *   5 Delivery Phase | 6 Billing Basis | 7 Committed $ | 8 Weighted $
 */

import { batchUpdate, getSheetMeta } from "./sheets.js";

export const FACTS_TAB = "Forecast Facts";

/** Pivot tabs and their row groupings (by source column offset). */
const PIVOTS: { tab: string; rows: { sourceColumnOffset: number; showTotals: boolean }[] }[] = [
  { tab: "By Stage", rows: [{ sourceColumnOffset: 4, showTotals: true }] },
  {
    // Account → Stage → Deal, so an account's deals are grouped in stage order.
    tab: "By Client Account",
    rows: [
      { sourceColumnOffset: 2, showTotals: true },
      { sourceColumnOffset: 4, showTotals: false },
      { sourceColumnOffset: 1, showTotals: false },
    ],
  },
  { tab: "By Delivery Phase", rows: [{ sourceColumnOffset: 5, showTotals: true }] },
  { tab: "Company Total", rows: [] },
];

function pivotTable(factsSheetId: number, rows: { sourceColumnOffset: number; showTotals: boolean }[]) {
  return {
    source: { sheetId: factsSheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 9 },
    rows: rows.map((r) => ({ ...r, sortOrder: "ASCENDING" })),
    columns: [{ sourceColumnOffset: 0, showTotals: true, sortOrder: "ASCENDING" }],
    values: [
      { summarizeFunction: "SUM", sourceColumnOffset: 7, name: "Committed $" },
      { summarizeFunction: "SUM", sourceColumnOffset: 8, name: "Weighted $" },
    ],
    valueLayout: "HORIZONTAL",
  };
}

/** Create/refresh the four pivot tabs. Idempotent: adds missing tabs, then (re)writes each pivot at A1. */
export async function setupPivots(token: string, spreadsheetId: string): Promise<string[]> {
  let meta = await getSheetMeta(token, spreadsheetId);
  const factsId = meta.find((m) => m.title === FACTS_TAB)?.sheetId;
  if (factsId == null) {
    throw new Error(`"${FACTS_TAB}" tab not found — run rebuildForecast first.`);
  }

  // Ensure each pivot tab exists (create missing), then re-read ids.
  const have = new Set(meta.map((m) => m.title));
  const addRequests = PIVOTS.filter((p) => !have.has(p.tab)).map((p) => ({ addSheet: { properties: { title: p.tab } } }));
  if (addRequests.length > 0) {
    await batchUpdate(token, spreadsheetId, addRequests);
    meta = await getSheetMeta(token, spreadsheetId);
  }
  const idByTitle = new Map(meta.map((m) => [m.title, m.sheetId]));

  // Write the pivotTable into A1 of each pivot tab.
  const requests = PIVOTS.map((p) => ({
    updateCells: {
      rows: [{ values: [{ pivotTable: pivotTable(factsId, p.rows) }] }],
      fields: "pivotTable",
      start: { sheetId: idByTitle.get(p.tab), rowIndex: 0, columnIndex: 0 },
    },
  }));
  await batchUpdate(token, spreadsheetId, requests);
  return PIVOTS.map((p) => p.tab);
}
