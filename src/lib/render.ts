/**
 * Current2-style outline views written into the Forecast sheet:
 *   • By Client   — group by Client Partner → Client, deals beneath.
 *   • By Stage    — group by probability %, deals sorted by Client Partner then title.
 * Both: collapsible native row groups, a Deal hyperlink, accounting `$ -` zeros,
 * period columns (quarters or months). Cells show RAW (unweighted) revenue.
 */

import { batchUpdate, getSheetStructure, writeValues, ensureTab, clearValues } from "./sheets.js";
import { spreadSegment, type Segment } from "./forecast.js";

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
    for (const c of spreadSegment(s)) d.byMonth.set(c.month, (d.byMonth.get(c.month) ?? 0) + c.amount);
  }
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

const HYPERLINK = (url: string, label: string) => (url ? `=HYPERLINK("${url}",${JSON.stringify(label)})` : label);

const GREEN = { red: 0.85, green: 0.92, blue: 0.83 };
const GRAY = { red: 0.94, green: 0.94, blue: 0.94 };
const BLACK = { red: 0, green: 0, blue: 0 };
const WHITE = { red: 1, green: 1, blue: 1 };
const ACCOUNTING = '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)';

/** Background only (keeps the baseline text: size 10, not bold). */
function setBg(sheetId: number, row: number, cols: number, bg: unknown) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: cols },
      cell: { userEnteredFormat: { backgroundColor: bg } },
      fields: "userEnteredFormat.backgroundColor",
    },
  };
}

/** Background + white text (for the black partner rows); size 10, not bold. */
function setBgWhite(sheetId: number, row: number, cols: number, bg: unknown) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: cols },
      cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: false, fontSize: 10, foregroundColor: WHITE } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  };
}

/** Shared: write a grid (USER_ENTERED) + reset stale format/groups + apply outline formatting. */
async function writeOutline(
  token: string,
  spreadsheetId: string,
  tab: string,
  grid: (string | number)[][],
  opts: {
    width: number;
    frozenCols: number;
    firstPeriodCol: number;
    percentCol?: number;
    blackRows: number[];
    greenRows: number[];
    groups: { start: number; end: number }[];
  },
): Promise<void> {
  await ensureTab(token, spreadsheetId, tab);
  await clearValues(token, spreadsheetId, tab);
  await writeValues(token, spreadsheetId, `${tab}!A1`, grid, "USER_ENTERED");

  const struct = (await getSheetStructure(token, spreadsheetId)) as {
    sheets?: { properties?: { title?: string; sheetId?: number }; rowGroups?: { range?: unknown }[] }[];
  };
  const sheet = (struct.sheets ?? []).find((s) => s.properties?.title === tab)!;
  const sheetId = sheet.properties!.sheetId!;

  const reqs: unknown[] = [];
  // 1. Clear any stale row groups (data drift shifts their ranges).
  for (const g of sheet.rowGroups ?? []) {
    if (g.range) reqs.push({ deleteDimensionGroup: { range: g.range } });
  }
  // 2. Reset the WHOLE sheet to a clean baseline: white bg, black text, size 10,
  //    not bold, no number format. fields="userEnteredFormat" clears everything else.
  reqs.push({
    repeatCell: {
      range: { sheetId },
      cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false, fontSize: 10, foregroundColor: BLACK } } },
      fields: "userEnteredFormat",
    },
  });
  // 3. Frozen header + label columns.
  reqs.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: opts.frozenCols } },
      fields: "gridProperties(frozenRowCount,frozenColumnCount)",
    },
  });
  // 4. Number formats.
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: opts.firstPeriodCol, endColumnIndex: opts.width },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: ACCOUNTING } } },
      fields: "userEnteredFormat.numberFormat",
    },
  });
  if (opts.percentCol != null) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: opts.percentCol, endColumnIndex: opts.percentCol + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0%" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  // 5. Row backgrounds (no bold anywhere).
  reqs.push(setBg(sheetId, 0, opts.width, GRAY)); // header
  for (const r of opts.blackRows) reqs.push(setBgWhite(sheetId, r, opts.width, BLACK));
  for (const r of opts.greenRows) reqs.push(setBg(sheetId, r, opts.width, GREEN));
  // 6. Fresh native row groups.
  for (const g of opts.groups) {
    reqs.push({ addDimensionGroup: { range: { sheetId, dimension: "ROWS", startIndex: g.start, endIndex: g.end } } });
  }
  await batchUpdate(token, spreadsheetId, reqs);
}

/**
 * "By Client": columns Probability | Deal | Contract Format | <periods>.
 * Collapsible group per Client Partner; black partner rows, green client rows.
 * Clients alphabetical within partner; deals by probability desc then title.
 */
export async function renderPartnerClientView(
  token: string,
  spreadsheetId: string,
  tab: string,
  deals: DealAgg[],
  periods: string[],
  periodOf: (m: string) => string,
): Promise<void> {
  const ATTR = ["Probability", "Deal", "Contract Format"];
  const width = ATTR.length + periods.length;
  const blanks = () => Array(width - 1).fill("");
  const grid: (string | number)[][] = [[...ATTR, ...periods]];
  const partnerRows: number[] = [];
  const clientRows: number[] = [];
  const groups: { start: number; end: number }[] = [];

  const byPartner = new Map<string, Map<string, DealAgg[]>>();
  for (const d of deals) {
    const p = d.clientPartner || "(no partner)";
    const c = d.client || "(no client)";
    if (!byPartner.has(p)) byPartner.set(p, new Map());
    const cm = byPartner.get(p)!;
    if (!cm.has(c)) cm.set(c, []);
    cm.get(c)!.push(d);
  }
  for (const p of [...byPartner.keys()].sort((a, b) => a.localeCompare(b))) {
    grid.push([p, ...blanks()]);
    partnerRows.push(grid.length - 1);
    const contentStart = grid.length;
    for (const c of [...byPartner.get(p)!.keys()].sort((a, b) => a.localeCompare(b))) {
      grid.push([c, ...blanks()]);
      clientRows.push(grid.length - 1);
      for (const d of byPartner.get(p)!.get(c)!.sort((x, y) => y.probability - x.probability || x.dealTitle.localeCompare(y.dealTitle))) {
        const bp = dealByPeriod(d, periods, periodOf);
        grid.push([d.probability, HYPERLINK(d.dealUrl, d.dealTitle), d.contractType, ...periods.map((pp) => Math.round(bp.get(pp) ?? 0))]);
      }
    }
    if (grid.length > contentStart) groups.push({ start: contentStart, end: grid.length });
  }
  await writeOutline(token, spreadsheetId, tab, grid, {
    width,
    frozenCols: 3,
    firstPeriodCol: ATTR.length,
    percentCol: 0,
    blackRows: partnerRows,
    greenRows: clientRows,
    groups,
  });
}

/**
 * "By Stage": columns Client Partner | Client | Deal | Contract Format | <periods>.
 * Collapsible group per probability % (desc). Deals within sorted by Client
 * Partner then Deal title. Group header shows "NN% | <stage(s)>".
 */
export async function renderProbabilityView(
  token: string,
  spreadsheetId: string,
  tab: string,
  deals: DealAgg[],
  periods: string[],
  periodOf: (m: string) => string,
): Promise<void> {
  const ATTR = ["Client Partner", "Client", "Deal", "Contract Format"];
  const width = ATTR.length + periods.length;
  const grid: (string | number)[][] = [[...ATTR, ...periods]];
  const greenRows: number[] = [];
  const groups: { start: number; end: number }[] = [];

  const byProb = new Map<number, DealAgg[]>();
  for (const d of deals) {
    if (!byProb.has(d.probability)) byProb.set(d.probability, []);
    byProb.get(d.probability)!.push(d);
  }
  for (const prob of [...byProb.keys()].sort((a, b) => b - a)) {
    const list = byProb.get(prob)!.sort((x, y) => x.clientPartner.localeCompare(y.clientPartner) || x.dealTitle.localeCompare(y.dealTitle));
    const stages = [...new Set(list.map((d) => d.stage).filter(Boolean))].join(" / ");
    grid.push([`${Math.round(prob * 100)}%${stages ? ` | ${stages}` : ""}`, ...Array(width - 1).fill("")]);
    greenRows.push(grid.length - 1);
    const contentStart = grid.length;
    for (const d of list) {
      const bp = dealByPeriod(d, periods, periodOf);
      grid.push([d.clientPartner, d.client, HYPERLINK(d.dealUrl, d.dealTitle), d.contractType, ...periods.map((pp) => Math.round(bp.get(pp) ?? 0))]);
    }
    if (grid.length > contentStart) groups.push({ start: contentStart, end: grid.length });
  }
  await writeOutline(token, spreadsheetId, tab, grid, {
    width,
    frozenCols: 4,
    firstPeriodCol: ATTR.length,
    blackRows: [],
    greenRows,
    groups,
  });
}
