/**
 * Pure forecast math: spread each Deal Revenue Schedule *segment* across the
 * calendar months of its active window and produce a tidy fact table.
 *
 * Method (calendar-day proration): a segment accrues `weeklyRevenue` per week
 * over [start, end) (end exclusive). Revenue landing in a given month =
 * weeklyRevenue × (days of the window that fall in that month ÷ 7). This is
 * uniform across all billing bases because everything is normalised to a weekly
 * rate upstream (Weekly Revenue on the schedule item).
 *
 * Two figures per row:
 *   committed = the monthly $ when the deal is Won (stage probability = 1), else 0
 *   weighted  = the monthly $ × stage probability (0..1)
 */

export type Segment = {
  dealId: string;
  dealTitle: string;
  dealUrl: string;
  clientAccount: string;
  clientPartner: string;
  stage: string;
  contractType: string;
  deliveryPhase: string; // joined multi-select, e.g. "Discover, Deploy"
  billingBasis: string;
  weeklyRevenue: number;
  /** ISO YYYY-MM-DD, inclusive. */
  start: string | null;
  /** ISO YYYY-MM-DD, exclusive. */
  end: string | null;
  /** Stage probability 0..1. */
  stageProbability: number;
};

export type FactRow = {
  month: string; // "YYYY-MM"
  dealTitle: string;
  clientAccount: string;
  clientPartner: string;
  stage: string;
  deliveryPhase: string;
  billingBasis: string;
  committed: number;
  weighted: number;
};

/** Inclusive month bounds for the fact table (keeps output finite for open-ended segments). */
export const MIN_MONTH = "2026-01";
export const MAX_MONTH = "2028-12";

const MS_PER_DAY = 86_400_000;

/** Parse "YYYY-MM-DD" (or a longer ISO string) to a UTC day-timestamp, or null. */
function parseISO(d: string | null): number | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

/** Days of overlap between [aStart, aEnd) and [bStart, bEnd), in whole days (>= 0). */
function overlapDays(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end <= start ? 0 : Math.round((end - start) / MS_PER_DAY);
}

/**
 * Spread one segment into month → { committed, weighted } contributions,
 * clamped to [MIN_MONTH, MAX_MONTH]. Returns [] when it can't be prorated
 * (missing/!+ve rate, missing dates, or end <= start).
 */
export function spreadSegment(seg: Segment): { month: string; amount: number; committed: number; weighted: number }[] {
  const start = parseISO(seg.start);
  const end = parseISO(seg.end);
  if (start == null || end == null || end <= start || !(seg.weeklyRevenue > 0)) return [];

  const prob = Number.isFinite(seg.stageProbability) ? Math.max(0, Math.min(1, seg.stageProbability)) : 0;
  const isWon = prob >= 0.999;
  const clampLo = parseISO(`${MIN_MONTH}-01`)!;
  // Exclusive upper bound = first day of the month AFTER MAX_MONTH.
  const [maxY, maxM] = MAX_MONTH.split("-").map(Number);
  const clampHi = Date.UTC(maxY!, maxM!, 1); // month is 1-based here → first of next month

  const winStart = Math.max(start, clampLo);
  const winEnd = Math.min(end, clampHi);
  if (winEnd <= winStart) return [];

  const out: { month: string; amount: number; committed: number; weighted: number }[] = [];
  let y = new Date(winStart).getUTCFullYear();
  let mo = new Date(winStart).getUTCMonth();
  // Walk months until we pass winEnd.
  while (true) {
    const monthStart = Date.UTC(y, mo, 1);
    if (monthStart >= winEnd) break;
    const monthEnd = Date.UTC(y, mo + 1, 1); // exclusive
    const days = overlapDays(winStart, winEnd, monthStart, monthEnd);
    if (days > 0) {
      const amount = seg.weeklyRevenue * (days / 7); // raw (unweighted) revenue
      out.push({ month: monthKey(y, mo), amount, committed: isWon ? amount : 0, weighted: amount * prob });
    }
    mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
  }
  return out;
}

/** "YYYY-MM" → "YYYY.Q#" (e.g. "2026-08" → "2026.Q3"). */
export function monthToQuarter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}.Q${Math.floor((m! - 1) / 3) + 1}`;
}

/** N consecutive month keys starting at a base "YYYY-MM" (default: current UTC month). */
export function monthsFrom(count: number, base?: string): string[] {
  const now = new Date();
  let y = base ? Number(base.slice(0, 4)) : now.getUTCFullYear();
  let m = base ? Number(base.slice(5, 7)) - 1 : now.getUTCMonth();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(monthKey(y, m));
    if (++m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

/** All quarter keys from MIN_MONTH..MAX_MONTH inclusive, e.g. ["2026.Q1", … "2028.Q4"]. */
export function quartersRange(): string[] {
  const out: string[] = [];
  const [minY] = MIN_MONTH.split("-").map(Number);
  const [maxY] = MAX_MONTH.split("-").map(Number);
  for (let y = minY!; y <= maxY!; y++) for (let q = 1; q <= 4; q++) out.push(`${y}.Q${q}`);
  return out;
}

/** Build the full fact table (one row per segment × month with a non-zero contribution). */
export function computeFacts(segments: Segment[]): FactRow[] {
  const rows: FactRow[] = [];
  for (const seg of segments) {
    for (const c of spreadSegment(seg)) {
      // Skip rows that contribute nothing to either figure.
      if (c.committed === 0 && c.weighted === 0) continue;
      rows.push({
        month: c.month,
        dealTitle: seg.dealTitle,
        clientAccount: seg.clientAccount,
        clientPartner: seg.clientPartner,
        stage: seg.stage,
        deliveryPhase: seg.deliveryPhase,
        billingBasis: seg.billingBasis,
        committed: Math.round(c.committed * 100) / 100,
        weighted: Math.round(c.weighted * 100) / 100,
      });
    }
  }
  rows.sort((a, b) => a.month.localeCompare(b.month) || a.dealTitle.localeCompare(b.dealTitle));
  return rows;
}

/** Column order for the fact-table sheet. */
export const FACT_HEADERS = [
  "Month",
  "Deal",
  "Client Account",
  "Client Partner",
  "Stage",
  "Delivery Phase",
  "Billing Basis",
  "Committed $",
  "Weighted $",
] as const;

/** Turn fact rows into the 2D grid (header + data) for the sheet. */
export function factsToGrid(rows: FactRow[]): (string | number)[][] {
  const grid: (string | number)[][] = [FACT_HEADERS.slice()];
  for (const r of rows) {
    grid.push([
      r.month,
      r.dealTitle,
      r.clientAccount,
      r.clientPartner,
      r.stage,
      r.deliveryPhase,
      r.billingBasis,
      r.committed,
      r.weighted,
    ]);
  }
  return grid;
}
