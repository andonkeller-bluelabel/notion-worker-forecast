/**
 * Date helpers for turning the DPPT's Excel/Sheets serial dates into the
 * strings the Notion tables display.
 *
 * Google Sheets (like Excel) stores dates as a serial day count where day 1 is
 * 1900-01-01, using the historical 1900-leap-year bug. The standard conversion
 * that reproduces Sheets' displayed dates is to anchor at 1899-12-30 UTC:
 *   date = 1899-12-30 + serial days
 */

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30); // 1899-12-30
const MS_PER_DAY = 86_400_000;

/** Convert a Sheets serial number to a UTC Date. */
export function excelSerialToDate(serial: number): Date {
  return new Date(SERIAL_EPOCH_MS + Math.round(serial) * MS_PER_DAY);
}

/** Format a serial date as `M/D/YY` (e.g. 5/4/26), matching the DPPT template. */
export function formatMDY(serial: number): string {
  const d = excelSerialToDate(serial);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${m}/${day}/${yy}`;
}

/**
 * Count business days (Mon–Fri) between two serial dates, inclusive of both
 * ends. A 14-calendar-day sprint (two full weeks) yields 10 business days,
 * which the DPPT template renders as "10d".
 */
export function businessDaysInclusive(startSerial: number, endSerial: number): number {
  const start = Math.round(startSerial);
  const end = Math.round(endSerial);
  if (end < start) return 0;
  let count = 0;
  for (let s = start; s <= end; s++) {
    // getUTCDay: 0 = Sunday, 6 = Saturday.
    const dow = excelSerialToDate(s).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Business-day duration formatted as e.g. "10d". */
export function formatDuration(startSerial: number, endSerial: number): string {
  return `${businessDaysInclusive(startSerial, endSerial)}d`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format a Date as "July 9, 2026" (UTC), for the "Populated …" callout. */
export function formatLongDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Parse an ISO date string ("YYYY-MM-DD…") into {y, m, d} by components (no timezone math). */
function isoParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** ISO date → "MM/DD/YY" (e.g. 2026-05-04 → "05/04/26"), for the Tasks!AQ15 cell. */
export function isoToMMDDYY(iso: string): string | null {
  const p = isoParts(iso);
  if (!p) return null;
  return `${pad2(p.m)}/${pad2(p.d)}/${String(p.y).slice(-2)}`;
}

/** ISO date → "M/D" (e.g. 2026-05-04 → "5/4"), for the Slack message. */
export function isoToMD(iso: string): string | null {
  const p = isoParts(iso);
  if (!p) return null;
  return `${p.m}/${p.d}`;
}
