/**
 * Renders the Current2-style formatted views: deal-level rows grouped by stage
 * (or client), with a Probability column and one column per quarter/month, plus
 * a subtotal per group and a grand total. Cells show RAW (unweighted) revenue.
 *
 * Values are written USER_ENTERED (so the Deal cell can be a =HYPERLINK), then
 * formatting is applied via batchUpdate (frozen header/labels, currency/percent
 * number formats, bold headers, green group rows).
 */

import { batchUpdate, getSheetMeta, writeValues, ensureTab, clearValues } from "./sheets.js";
import { spreadSegment, monthToQuarter, type Segment } from "./forecast.js";

export type DealAgg = {
  dealId: string;
  dealTitle: string;
  dealUrl: string;
  clientPartner: string;
  client: string;
  stage: string;
  contractType: string;
  probability: number; // 0..1
  byMonth: Map<string, number>; // raw $ per "YYYY-MM"
};

/** Group segments into deal-level aggregates with raw monthly revenue. */
export function aggregateDeals(segments: Segment[]): DealAgg[] {
  const byDeal = new Map<string, DealAgg>();
  for (const s of segments) {
    const key = s.dealId || s.dealTitle;
    if (!key) continue;
    let d = byDeal.get(key);
    if (!d) {
      d = {
        dealId: s.dealId,
        dealTitle: s.dealTitle,
        dealUrl: s.dealUrl,
        clientPartner: s.clientPartner,
        client: s.clientAccount,
        stage: s.stage,
        contractType: s.contractType,
        probability: s.stageProbability,
        byMonth: new Map(),
      };
      byDeal.set(key, d);
    }
    for (const c of spreadSegment(s)) {
      d.byMonth.set(c.month, (d.byMonth.get(c.month) ?? 0) + c.amount);
    }
  }
  // Drop deals with no revenue in-range.
  return [...byDeal.values()].filter((d) => [...d.byMonth.values()].some((v) => v > 0));
}

/** Sum a deal's monthly revenue into the given periods (quarters or months). */
function dealByPeriod(d: DealAgg, periods: string[], periodOf: (m: string) => string): Map<string, number> {
  const out = new Map<string, number>(periods.map((p) => [p, 0]));
  for (const [month, amt] of d.byMonth) {
    const p = periodOf(month);
    if (out.has(p)) out.set(p, out.get(p)! + amt);
  }
  return out;
}

const HYPERLINK = (url: string, label: string) =>
  url ? `=HYPERLINK("${url}",${JSON.stringify(label)})` : label;

export type GroupBy = "stage" | "client";

type ViewMeta = {
  headerRow: number;
  groupHeaderRows: number[];
  totalRows: number[]; // subtotals + grand total (bold)
  firstPeriodCol: number; // 0-based
  periodCount: number;
  rowCount: number;
};

/**
 * Build the 2D grid + formatting metadata for one view.
 * Columns: Probability | Client Partner | Client | Deal | Contract Format | <periods…>
 */
export function buildViewGrid(
  deals: DealAgg[],
  periods: string[],
  groupBy: GroupBy,
  periodOf: (m: string) => string,
): { grid: (string | number)[][]; meta: ViewMeta } {
  const ATTR = ["Probability", "Client Partner", "Client", "Deal", "Contract Format"];
  const firstPeriodCol = ATTR.length;
  const grid: (string | number)[][] = [[...ATTR, ...periods]];
  const groupHeaderRows: number[] = [];
  const totalRows: number[] = [];

  // Group + order.
  const groups = new Map<string, DealAgg[]>();
  for (const d of deals) {
    const key = groupBy === "stage" ? d.stage || "(no stage)" : d.client || "(no client)";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  const groupProb = (list: DealAgg[]) => Math.max(...list.map((d) => d.probability), 0);
  const orderedGroups = [...groups.entries()].sort((a, b) =>
    groupBy === "stage"
      ? groupProb(b[1]) - groupProb(a[1]) || a[0].localeCompare(b[0]) // stages: high prob first
      : a[0].localeCompare(b[0]),
  );

  const zeros = () => periods.map(() => 0);
  const grand = zeros();

  for (const [groupKey, list] of orderedGroups) {
    // Deals within a group.
    list.sort((a, b) =>
      groupBy === "client"
        ? b.probability - a.probability || a.dealTitle.localeCompare(b.dealTitle) // client view: deals by stage order
        : a.client.localeCompare(b.client) || a.dealTitle.localeCompare(b.dealTitle),
    );
    // Group header row.
    const gp = groupProb(list);
    const label = groupBy === "stage" ? `${Math.round(gp * 100)}% | ${groupKey}` : groupKey;
    grid.push([label, "", "", "", "", ...zeros().map(() => "")]);
    groupHeaderRows.push(grid.length - 1);

    const subtotal = zeros();
    for (const d of list) {
      const bp = dealByPeriod(d, periods, periodOf);
      const cells = periods.map((p, i) => {
        const v = bp.get(p) ?? 0;
        subtotal[i]! += v;
        grand[i]! += v;
        return Math.round(v);
      });
      grid.push([d.probability, d.clientPartner, d.client, HYPERLINK(d.dealUrl, d.dealTitle), d.contractType, ...cells]);
    }
    // Subtotal row.
    grid.push(["", "", "", `Subtotal — ${groupKey}`, "", ...subtotal.map((v) => Math.round(v))]);
    totalRows.push(grid.length - 1);
  }
  // Grand total.
  grid.push(["", "", "", "Grand Total", "", ...grand.map((v) => Math.round(v))]);
  totalRows.push(grid.length - 1);

  return {
    grid,
    meta: {
      headerRow: 0,
      groupHeaderRows,
      totalRows,
      firstPeriodCol,
      periodCount: periods.length,
      rowCount: grid.length,
    },
  };
}

// ---- formatting helpers (batchUpdate requests) ----
const GREEN = { red: 0.85, green: 0.92, blue: 0.83 };
const GRAY = { red: 0.94, green: 0.94, blue: 0.94 };
const ACCOUNTING = '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)';

function rowFormat(sheetId: number, row: number, cols: number, bg: unknown, bold: boolean) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: cols },
      cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  };
}

/** Write one view into a tab: values + formatting. Idempotent (clears the tab first). */
export async function renderView(
  token: string,
  spreadsheetId: string,
  tab: string,
  deals: DealAgg[],
  periods: string[],
  groupBy: GroupBy,
  periodOf: (m: string) => string,
): Promise<void> {
  const { grid, meta } = buildViewGrid(deals, periods, groupBy, periodOf);
  await ensureTab(token, spreadsheetId, tab);
  await clearValues(token, spreadsheetId, tab);
  // USER_ENTERED so =HYPERLINK renders; writeValues uses RAW, so use a dedicated call.
  await writeValuesUserEntered(token, spreadsheetId, `${tab}!A1`, grid);

  const sheetId = (await getSheetMeta(token, spreadsheetId)).find((m) => m.title === tab)!.sheetId;
  const totalCols = meta.firstPeriodCol + meta.periodCount;
  const reqs: unknown[] = [
    // Freeze header row + the 5 label columns.
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: meta.firstPeriodCol } },
        fields: "gridProperties(frozenRowCount,frozenColumnCount)",
      },
    },
    // Header row.
    rowFormat(sheetId, meta.headerRow, totalCols, GRAY, true),
    // Probability column → percent.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0%" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // Period columns → accounting currency.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: meta.firstPeriodCol, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: ACCOUNTING } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  ];
  for (const r of meta.groupHeaderRows) reqs.push(rowFormat(sheetId, r, totalCols, GREEN, true));
  for (const r of meta.totalRows) reqs.push(rowFormat(sheetId, r, totalCols, GRAY, true));
  await batchUpdate(token, spreadsheetId, reqs);
}

/** values.update with USER_ENTERED (mirrors sheets.writeValues but interprets formulas). */
async function writeValuesUserEntered(
  token: string,
  spreadsheetId: string,
  a1Anchor: string,
  values: (string | number)[][],
): Promise<void> {
  await writeValues(token, spreadsheetId, a1Anchor, values, "USER_ENTERED");
}
