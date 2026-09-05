/**
 * Current2-style outline views written into the Forecast sheet:
 *   • By Client — group by Client Partner → Client, deals beneath (blue client rows).
 *   • By Stage  — group by probability %, deals sorted by Client Partner then title.
 * Both: collapsible native row groups, a Deal hyperlink, accounting `$ -` zeros,
 * period columns (quarters or months). Cells show RAW (unweighted) revenue.
 */

import { batchUpdate, getSheetStructure, writeValues, clearValues } from "./sheets.js";
import { spreadSegment, type Segment } from "./forecast.js";
import { CASCADE_STAGES } from "./coverage.js";

export type DealAgg = {
  dealId: string;
  dealTitle: string;
  dealUrl: string;
  clientPartner: string;
  client: string;
  contractType: string;
  probability: number; // 0..1
  byMonth: Map<string, number>; // raw $ per "YYYY-MM"
  byMonthW: Map<string, number>; // probability-weighted $ per "YYYY-MM"
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
        byMonthW: new Map(),
      };
      byDeal.set(key, d);
    }
    for (const c of spreadSegment(s)) {
      d.byMonth.set(c.month, (d.byMonth.get(c.month) ?? 0) + c.amount);
      d.byMonthW.set(c.month, (d.byMonthW.get(c.month) ?? 0) + c.weighted);
    }
  }
  return [...byDeal.values()].filter((d) => [...d.byMonth.values()].some((v) => v > 0));
}

function dealByPeriod(
  d: DealAgg,
  periods: string[],
  periodOf: (m: string) => string,
  weighted = false,
): Map<string, number> {
  const src = weighted ? d.byMonthW : d.byMonth;
  const out = new Map<string, number>(periods.map((p) => [p, 0]));
  for (const [month, amt] of src) {
    const p = periodOf(month);
    if (out.has(p)) out.set(p, out.get(p)! + amt);
  }
  return out;
}

const HYPERLINK = (url: string, label: string) => (url ? `=HYPERLINK("${url}",${JSON.stringify(label)})` : label);

/** 0-based column index → A1 letter (0→A, 4→E, 26→AA). */
function colA1(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

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

/** A render target identified by stable sheetId; title is only for the values API and follows renames. */
export type Target = { sheetId: number; title: string };

async function writeOutline(
  token: string,
  spreadsheetId: string,
  target: Target,
  grid: (string | number)[][],
  opts: {
    width: number;
    frozenCols: number;
    firstPeriodCol: number;
    percentCol?: number;
    blackRows: number[];
    coloredRows: ColoredRow[];
    groups: { start: number; end: number }[];
    attrWidths: number[]; // pixel width per attribute column (0..firstPeriodCol-1)
    periodWidth: number; // pixel width for every period column
    headerRowIndex?: number; // 0-based grid row of the header (default 0); rows above it are summary/top rows
    greyRows?: { start: number; end: number }; // rows whose Contract-Format col gets grey text (default: all data rows)
  },
): Promise<void> {
  const { sheetId, title } = target;
  const hr = opts.headerRowIndex ?? 0;
  await clearValues(token, spreadsheetId, title);
  // Whole grid USER_ENTERED (Deal =HYPERLINK renders, numbers stay numbers), then the header row RAW
  // so "2026-09"/"2026.Q1" stay literal text (USER_ENTERED parses "2026.09" to a number).
  await writeValues(token, spreadsheetId, `${title}!A1`, grid, "USER_ENTERED");
  await writeValues(token, spreadsheetId, `${title}!A${hr + 1}`, [grid[hr]!], "RAW");

  const struct = (await getSheetStructure(token, spreadsheetId)) as {
    sheets?: { properties?: { title?: string; sheetId?: number }; rowGroups?: { range?: unknown }[]; conditionalFormats?: unknown[] }[];
  };
  const sheet = (struct.sheets ?? []).find((s) => s.properties?.sheetId === sheetId)!;

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
      properties: { sheetId, gridProperties: { frozenRowCount: hr + 1, frozenColumnCount: opts.frozenCols } },
      fields: "gridProperties(frozenRowCount,frozenColumnCount)",
    },
  });
  // Accounting on every period cell (header row is text, unaffected) — covers top/summary rows too.
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: grid.length, startColumnIndex: opts.firstPeriodCol, endColumnIndex: opts.width },
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
  reqs.push(setBg(sheetId, hr, opts.width, GRAY)); // header
  for (const r of opts.blackRows) reqs.push(setBg(sheetId, r, opts.width, BLACK, WHITE));
  for (const c of opts.coloredRows) reqs.push(setBg(sheetId, c.row, opts.width, c.bg));
  // Grey text on the Contract Format column (last attribute col) for deal rows only.
  const grey = opts.greyRows ?? { start: hr + 1, end: grid.length };
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: grey.start, endRowIndex: grey.end, startColumnIndex: opts.firstPeriodCol - 1, endColumnIndex: opts.firstPeriodCol },
      cell: { userEnteredFormat: { textFormat: { foregroundColor: GREY_TEXT } } },
      fields: "userEnteredFormat.textFormat.foregroundColor",
    },
  });
  for (const g of opts.groups) reqs.push({ addDimensionGroup: { range: { sheetId, dimension: "ROWS", startIndex: g.start, endIndex: g.end } } });
  // Column widths (baked from the hand-tuned tabs): attribute cols individually, period cols uniform.
  opts.attrWidths.forEach((px, i) =>
    reqs.push({
      updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" },
    }),
  );
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: opts.firstPeriodCol, endIndex: opts.width },
      properties: { pixelSize: opts.periodWidth },
      fields: "pixelSize",
    },
  });
  // Conditional format: muted grey text on $0 deal cells (blank group-row cells aren't numbers, so untouched).
  reqs.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: hr + 1, endRowIndex: grid.length, startColumnIndex: opts.firstPeriodCol, endColumnIndex: opts.width }],
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
  target: Target,
  deals: DealAgg[],
  periods: string[],
  periodOf: (m: string) => string,
  widths: { attr: number[]; period: number },
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
  await writeOutline(token, spreadsheetId, target, grid, {
    width,
    frozenCols: 3,
    firstPeriodCol: ATTR.length,
    percentCol: 0,
    blackRows: partnerRows,
    coloredRows: clientRows.map((r) => ({ row: r, bg: BLUE })),
    groups,
    attrWidths: widths.attr,
    periodWidth: widths.period,
  });
}

/**
 * "By Stage": Client Partner | Client | Deal | Contract Format | <periods>. Groups: probability % (desc).
 * When `cascadeTargets` is given (quarterly view), also writes top rows (Weighted Value, Target) and a
 * per-quarter Summary cascade (Current2 style: Total at Prob / Weighted Total / gaps by stage).
 */
export async function renderProbabilityView(
  token: string,
  spreadsheetId: string,
  target: Target,
  deals: DealAgg[],
  periods: string[],
  periodOf: (m: string) => string,
  widths: { attr: number[]; period: number },
  cascadeTargets?: Map<string, number>,
): Promise<void> {
  const ATTR = ["Client Partner", "Client", "Deal", "Contract Format"];
  const width = ATTR.length + periods.length;
  const P0 = ATTR.length; // first period column index
  const labelCol = ATTR.length - 1; // Contract Format column — top/summary labels live here
  const blank = () => Array(width).fill("") as (string | number)[];
  const showSummary = !!cascadeTargets;
  const col = (i: number) => colA1(P0 + i);
  const TARGET_ROW = 2; // when showSummary, Target lives on sheet row 2

  // Group deals by probability %; deal section shows the present stages high → low.
  const byProb = new Map<number, DealAgg[]>();
  for (const d of deals) {
    const pct = Math.round(d.probability * 100);
    let arr = byProb.get(pct);
    if (!arr) byProb.set(pct, (arr = []));
    arr.push(d);
  }
  const dealStages = [...byProb.keys()].sort((a, b) => b - a);

  // --- Pass 1: 1-based sheet-row positions, so the Summary formulas can reference deal ranges. ---
  const headerRow = (showSummary ? 3 : 0) + 1; // rows 1-2 = Weighted Value/Target, 3 = blank
  let cur = headerRow + 1;
  const dealPos = new Map<number, { start: number; end: number }>();
  for (const s of dealStages) {
    cur += 1; // stage header row
    const start = cur;
    cur += byProb.get(s)!.length;
    dealPos.set(s, { start, end: cur - 1 });
  }
  const sumPos = new Map<number, { gap: number; total: number; wt: number; wgap: number }>();
  if (showSummary) {
    cur += 2; // blank + "Summary" title
    for (const s of CASCADE_STAGES) {
      sumPos.set(s, { gap: cur, total: cur + 1, wt: cur + 2, wgap: cur + 3 });
      cur += 4;
    }
  }

  // --- Pass 2: build the grid. Calculated cells are formulas referencing the rows above. ---
  const grid: (string | number)[][] = [];
  const coloredRows: ColoredRow[] = [];
  const groups: { start: number; end: number }[] = [];

  if (showSummary) {
    const finalWt = sumPos.get(CASCADE_STAGES[CASCADE_STAGES.length - 1]!)!.wt; // 0% cumulative = total weighted
    const wv = blank();
    wv[labelCol] = "Weighted Value";
    periods.forEach((_q, i) => (wv[P0 + i] = `=${col(i)}${finalWt}`));
    grid.push(wv);
    const tg = blank();
    tg[labelCol] = "Target"; // an input value, not a calculation
    periods.forEach((q, i) => {
      const t = cascadeTargets!.get(q);
      tg[P0 + i] = t != null ? Math.round(t) : "";
    });
    grid.push(tg);
    grid.push(blank());
  }
  const headerRowIndex = grid.length;
  grid.push([...ATTR, ...periods]);

  // Deal section: stage groups (probability desc), deals sorted by partner then title. Cells are raw $ values.
  const dealStart = grid.length;
  for (const s of dealStages) {
    grid.push([`'${s}%`, ...Array(width - 1).fill("")]); // leading ' forces text
    coloredRows.push({ row: grid.length - 1, bg: STAGE_COLORS[s] ?? GREEN });
    const contentStart = grid.length;
    for (const d of byProb.get(s)!.sort((x, y) => x.clientPartner.localeCompare(y.clientPartner) || x.dealTitle.localeCompare(y.dealTitle))) {
      const bp = dealByPeriod(d, periods, periodOf);
      grid.push([d.clientPartner, d.client, HYPERLINK(d.dealUrl, d.dealTitle), d.contractType, ...periods.map((pp) => Math.round(bp.get(pp) ?? 0))]);
    }
    if (grid.length > contentStart) groups.push({ start: contentStart, end: grid.length });
  }
  const dealEnd = grid.length;

  // Summary cascade: formulas so the math is auditable in-sheet (mirrors Current2).
  if (showSummary) {
    grid.push(blank());
    const title = blank();
    title[labelCol] = "Summary";
    grid.push(title);
    coloredRows.push({ row: grid.length - 1, bg: GRAY });
    CASCADE_STAGES.forEach((s, si) => {
      const sr = sumPos.get(s)!;
      const prev = si > 0 ? sumPos.get(CASCADE_STAGES[si - 1]!)! : null;
      const dp = dealPos.get(s);
      const hasT = (i: number) => cascadeTargets!.get(periods[i]!) != null;

      const gapRow = blank();
      gapRow[labelCol - 1] = `'${s}%`;
      gapRow[labelCol] = "Gap to Target"; // incoming gap (100% = its own committed − target)
      periods.forEach((_q, i) => (gapRow[P0 + i] = hasT(i) ? `=${col(i)}${(si === 0 ? sr : prev!).wgap}` : ""));
      grid.push(gapRow);
      coloredRows.push({ row: grid.length - 1, bg: STAGE_COLORS[s] ?? GREEN });

      const totRow = blank();
      totRow[labelCol] = "Total at Prob"; // this stage's gross
      periods.forEach((_q, i) => (totRow[P0 + i] = dp ? `=SUM(${col(i)}${dp.start}:${col(i)}${dp.end})` : 0));
      grid.push(totRow);

      const wtRow = blank();
      wtRow[labelCol] = "Weighted Total"; // cumulative: this stage weighted + all higher stages
      periods.forEach((_q, i) => {
        const c = col(i);
        wtRow[P0 + i] = si === 0 ? `=${c}${sr.total}` : `=(${c}${sr.total}*${s / 100})+${c}${prev!.wt}`;
      });
      grid.push(wtRow);

      const wgRow = blank();
      wgRow[labelCol] = "Weighted Gap to Target"; // cumulative weighted − target
      periods.forEach((_q, i) => (wgRow[P0 + i] = hasT(i) ? `=${col(i)}${sr.wt}-${col(i)}$${TARGET_ROW}` : ""));
      grid.push(wgRow);
    });
  }

  await writeOutline(token, spreadsheetId, target, grid, {
    width,
    frozenCols: 4,
    firstPeriodCol: P0,
    blackRows: [],
    coloredRows,
    groups,
    attrWidths: widths.attr,
    periodWidth: widths.period,
    headerRowIndex,
    greyRows: { start: dealStart, end: dealEnd },
  });
}

/**
 * "Weighted Pipeline": Probability | Deal | Contract Format | <periods>.
 * Client → Deals only (no Client Partner tier), clients alphabetical, cells show
 * probability-WEIGHTED revenue, and a grand-total row sums each period at the bottom.
 */
export async function renderWeightedPipeline(
  token: string,
  spreadsheetId: string,
  target: Target,
  deals: DealAgg[],
  periods: string[],
  periodOf: (m: string) => string,
  widths: { attr: number[]; period: number },
): Promise<void> {
  const ATTR = ["Probability", "Deal", "Contract Format"];
  const width = ATTR.length + periods.length;
  const blanks = () => Array(width - 1).fill("");
  const grid: (string | number)[][] = [[...ATTR, ...periods]];
  const clientRows: number[] = [];
  const groups: { start: number; end: number }[] = [];
  const totals = new Map<string, number>(periods.map((p) => [p, 0]));

  const byClient = new Map<string, DealAgg[]>();
  for (const d of deals) {
    const c = d.client || "(no client)";
    if (!byClient.has(c)) byClient.set(c, []);
    byClient.get(c)!.push(d);
  }
  for (const c of [...byClient.keys()].sort((a, b) => a.localeCompare(b))) {
    grid.push([c, ...blanks()]);
    clientRows.push(grid.length - 1);
    const contentStart = grid.length;
    for (const d of byClient.get(c)!.sort((x, y) => y.probability - x.probability || x.dealTitle.localeCompare(y.dealTitle))) {
      const bp = dealByPeriod(d, periods, periodOf, true); // weighted
      grid.push([d.probability, HYPERLINK(d.dealUrl, d.dealTitle), d.contractType, ...periods.map((pp) => Math.round(bp.get(pp) ?? 0))]);
      for (const pp of periods) totals.set(pp, (totals.get(pp) ?? 0) + (bp.get(pp) ?? 0));
    }
    if (grid.length > contentStart) groups.push({ start: contentStart, end: grid.length });
  }
  // Grand-total row (black bar) at the bottom.
  grid.push(["Total", "", "", ...periods.map((pp) => Math.round(totals.get(pp) ?? 0))]);
  const totalRow = grid.length - 1;

  await writeOutline(token, spreadsheetId, target, grid, {
    width,
    frozenCols: 3,
    firstPeriodCol: ATTR.length,
    percentCol: 0,
    blackRows: [totalRow],
    coloredRows: clientRows.map((r) => ({ row: r, bg: BLUE })),
    groups,
    attrWidths: widths.attr,
    periodWidth: widths.period,
  });
}
