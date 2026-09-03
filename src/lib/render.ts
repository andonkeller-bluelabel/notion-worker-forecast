/**
 * Current2-style outline views written into the Forecast sheet:
 *   • By Client — group by Client Partner → Client, deals beneath (blue client rows).
 *   • By Stage  — group by probability %, deals sorted by Client Partner then title.
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

function dealByPeriod(d: DealAgg, periods: string[], periodOf: (m: string) => string): Map<string, number> {
  const out = new Map<string, number>(periods.map((p) => [p, 0]));
  for (const [month, amt] of d.byMonth) {
    const p = periodOf(month);
    if (out.has(p)) out.set(p, out.get(p)! + amt);
  }
  return out;
}

const HYPERLINK = (url: string, label: string) => (url ? `=HYPERLINK("${url}",${JSON.stringify(label)})` : label);

const BLUE = { red: 0.8117647, green: 0.8862745, blue: 0.9529412 };
const GREEN = { red: 0.85, green: 0.92, blue: 0.83 };
const GRAY = { red: 0.94, green: 0.94, blue: 0.94 };
const BLACK = { red: 0, green: 0, blue: 0 };
const WHITE = { red: 1, green: 1, blue: 1 };
const GREY_TEXT = { red: 0.6, green: 0.6, blue: 0.6 };
const ZERO_GREY = { red: 0.85098039, green: 0.85098039, blue: 0.85098039 }; // #d9d9d9 — muted text for $0 deal cells
const ACCOUNTING = '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)';

/** Per-probability header colors for the By Stage views (Google "light 3" palette). */
const LIGHT_GREEN = { red: 0.84705883, green: 0.91764706, blue: 0.827451 };
const LIGHT_BLUE = { red: 0.8117647, green: 0.8862745, blue: 0.9529412 };
const LIGHT_PURPLE = { red: 0.8509804, green: 0.8235294, blue: 0.9137255 };
const LIGHT_MAGENTA = { red: 0.91764706, green: 0.81960785, blue: 0.8627451 };
const STAGE_COLORS: Record<number, unknown> = {
  100: LIGHT_GREEN,
  80: LIGHT_GREEN,
  60: LIGHT_BLUE,
  40: LIGHT_PURPLE,
  20: LIGHT_PURPLE,
  0: LIGHT_MAGENTA,
};

type ColoredRow = { row: number; bg: unknown };

function setBg(sheetId: number, row: number, cols: number, bg: unknown, fg?: unknown) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: cols },
      cell: { userEnteredFormat: { backgroundColor: bg, ...(fg ? { textFormat: { bold: false, fontSize: 10, foregroundColor: fg } } : {}) } },
      fields: fg ? "userEnteredFormat(backgroundColor,textFormat)" : "userEnteredFormat.backgroundColor",
    },
  };
}

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
    coloredRows: ColoredRow[];
    groups: { start: number; end: number }[];
  },
): Promise<void> {
  await ensureTab(token, spreadsheetId, tab);
  await clearValues(token, spreadsheetId, tab);
  // Header row RAW (so "2026-09" / "2026.Q1" stay literal text, not parsed to dates/numbers);
  // data rows USER_ENTERED so the Deal =HYPERLINK renders.
  await writeValues(token, spreadsheetId, `${tab}!A1`, [grid[0]!], "RAW");
  if (grid.length > 1) await writeValues(token, spreadsheetId, `${tab}!A2`, grid.slice(1), "USER_ENTERED");

  const struct = (await getSheetStructure(token, spreadsheetId)) as {
    sheets?: { properties?: { title?: string; sheetId?: number }; rowGroups?: { range?: unknown }[]; conditionalFormats?: unknown[] }[];
  };
  const sheet = (struct.sheets ?? []).find((s) => s.properties?.title === tab)!;
  const sheetId = sheet.properties!.sheetId!;

  const reqs: unknown[] = [];
  for (const g of sheet.rowGroups ?? []) if (g.range) reqs.push({ deleteDimensionGroup: { range: g.range } });
  // Drop existing conditional-format rules (high→low index) so we can re-add ours idempotently.
  const cfCount = sheet.conditionalFormats?.length ?? 0;
  for (let i = cfCount - 1; i >= 0; i--) reqs.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  // Reset the whole sheet to a clean baseline (white bg, black text, size 10, not bold, no number fmt).
  reqs.push({
    repeatCell: {
      range: { sheetId },
      cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false, fontSize: 10, foregroundColor: BLACK } } },
      fields: "userEnteredFormat",
    },
  });
  reqs.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: opts.frozenCols } },
      fields: "gridProperties(frozenRowCount,frozenColumnCount)",
    },
  });
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
  reqs.push(setBg(sheetId, 0, opts.width, GRAY)); // header
  for (const r of opts.blackRows) reqs.push(setBg(sheetId, r, opts.width, BLACK, WHITE));
  for (const c of opts.coloredRows) reqs.push(setBg(sheetId, c.row, opts.width, c.bg));
  // Grey text on the Contract Format column (last attribute col), data rows only.
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: opts.firstPeriodCol - 1, endColumnIndex: opts.firstPeriodCol },
      cell: { userEnteredFormat: { textFormat: { foregroundColor: GREY_TEXT } } },
      fields: "userEnteredFormat.textFormat.foregroundColor",
    },
  });
  for (const g of opts.groups) reqs.push({ addDimensionGroup: { range: { sheetId, dimension: "ROWS", startIndex: g.start, endIndex: g.end } } });
  // Conditional format: muted grey text on $0 deal cells (blank group-row cells aren't numbers, so untouched).
  reqs.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: grid.length, startColumnIndex: opts.firstPeriodCol, endColumnIndex: opts.width }],
        booleanRule: { condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: "0" }] }, format: { textFormat: { foregroundColor: ZERO_GREY } } },
      },
    },
  });
  await batchUpdate(token, spreadsheetId, reqs);
}

/** "By Client": Probability | Deal | Contract Format | <periods>. Groups: Client Partner → Client. */
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
    coloredRows: clientRows.map((r) => ({ row: r, bg: BLUE })),
    groups,
  });
}

/** "By Stage": Client Partner | Client | Deal | Contract Format | <periods>. Groups: probability % (desc). */
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
  const coloredRows: ColoredRow[] = [];
  const groups: { start: number; end: number }[] = [];

  const byProb = new Map<number, DealAgg[]>();
  for (const d of deals) {
    if (!byProb.has(d.probability)) byProb.set(d.probability, []);
    byProb.get(d.probability)!.push(d);
  }
  for (const prob of [...byProb.keys()].sort((a, b) => b - a)) {
    const pct = Math.round(prob * 100);
    // Leading apostrophe forces text so "100%" isn't parsed to the number 1.
    grid.push([`'${pct}%`, ...Array(width - 1).fill("")]);
    coloredRows.push({ row: grid.length - 1, bg: STAGE_COLORS[pct] ?? GREEN });
    const contentStart = grid.length;
    for (const d of byProb.get(prob)!.sort((x, y) => x.clientPartner.localeCompare(y.clientPartner) || x.dealTitle.localeCompare(y.dealTitle))) {
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
    coloredRows,
    groups,
  });
}
