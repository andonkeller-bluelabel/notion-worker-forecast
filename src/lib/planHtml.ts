/**
 * Renders the "Forecast vs Plan" report (artifact replica) uploaded to a Notion
 * embed: per quarter a stacked WEIGHTED bar — Signed (100%) + Continuation + Net-new —
 * with a horizontal TARGET marker, over a wash on the out-year, plus a table
 * (Target / Signed / Continuation / Net-new / Weighted total / Gap / % of plan).
 * Self-contained: inline CSS + inline SVG, native <title> hover tooltips.
 */

import type { PlanRow } from "./planVsPipeline.js";

const SIGNED = "#34a853"; // green
const CONT = "#4285f4"; // blue
const NEWB = "#f9ab00"; // amber
const TARGET = "#1a1a1a";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Quarters in a different calendar year than the first get a "future" wash. */
function outYearStart(rows: PlanRow[]): number {
  if (!rows.length) return rows.length;
  const y0 = rows[0]!.q.slice(0, 4);
  const i = rows.findIndex((r) => r.q.slice(0, 4) !== y0);
  return i < 0 ? rows.length : i;
}

function chartSvg(rows: PlanRow[]): string {
  const W = 1040, H = 340, PL = 58, PR = 16, PT = 22, PB = 42;
  const pw = W - PL - PR, ph = H - PT - PB;
  const band = pw / Math.max(1, rows.length);
  const bw = Math.min(54, band * 0.5);
  const rawMax = Math.max(1, ...rows.map((r) => Math.max(r.target, r.signed + r.contW + r.newW)));
  const YMAX = Math.ceil(rawMax / 5e5) * 5e5; // round up to $0.5M
  const y = (v: number) => PT + ph - (v / YMAX) * ph;

  const parts: string[] = [];
  // out-year wash
  const ows = outYearStart(rows);
  if (ows < rows.length) parts.push(`<rect x="${(PL + band * ows).toFixed(1)}" y="${PT}" width="${(band * (rows.length - ows)).toFixed(1)}" height="${ph}" fill="#d93025" fill-opacity=".05"/>`);
  // gridlines + y labels
  const step = YMAX / 4;
  for (let t = 0; t <= YMAX + 1; t += step) {
    parts.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${t === 0 ? "#9aa0a6" : "#ececec"}" stroke-width="${t === 0 ? 1.4 : 1}"/>`);
    parts.push(`<text x="${PL - 9}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" fill="#9aa0a6" font-size="10.5" font-family="monospace">${t === 0 ? "0" : "$" + (t / 1e6).toFixed(1) + "M"}</text>`);
  }
  // bars
  rows.forEach((r, i) => {
    const cx = PL + band * i + band / 2, x = cx - bw / 2;
    let acc = 0;
    const segs: [string, number, string][] = [[SIGNED, r.signed, "Signed"], [CONT, r.contW, "Continuation"], [NEWB, r.newW, "Net-new"]];
    for (const [col, val, name] of segs) {
      if (val <= 0) continue;
      const h = (val / YMAX) * ph;
      parts.push(`<rect x="${x.toFixed(1)}" y="${y(acc + val).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, h).toFixed(1)}" fill="${col}"><title>${r.q} — ${name}: ${money(val)}</title></rect>`);
      acc += val;
    }
    // target marker
    parts.push(`<line x1="${(x - 6).toFixed(1)}" x2="${(x + bw + 6).toFixed(1)}" y1="${y(r.target).toFixed(1)}" y2="${y(r.target).toFixed(1)}" stroke="${TARGET}" stroke-width="2"><title>${r.q} target: ${money(r.target)}</title></line>`);
    // x label + % of plan
    const tot = r.signed + r.contW + r.newW;
    parts.push(`<text x="${cx.toFixed(1)}" y="${(H - PB + 15).toFixed(1)}" text-anchor="middle" fill="#5f6368" font-size="10.5" font-family="monospace">${esc(r.q)}</text>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(H - PB + 29).toFixed(1)}" text-anchor="middle" fill="#9aa0a6" font-size="10">${pct(tot / (r.target || 1))}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Weighted forecast vs target by quarter">${parts.join("")}</svg>`;
}

function table(rows: PlanRow[]): string {
  const body = rows
    .map((r) => {
      const tot = r.signed + r.contW + r.newW;
      const gap = r.target - tot;
      return `<tr><td>${esc(r.q)}</td><td class="n">${money(r.target)}</td><td class="n">${money(r.signed)}</td><td class="n">${money(r.contW)}</td><td class="n">${money(r.newW)}</td><td class="n b">${money(tot)}</td><td class="n ${gap > 0 ? "neg" : "pos"}">${money(-gap)}</td><td class="n">${pct(tot / (r.target || 1))}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Quarter</th><th class="n">Target</th><th class="n">Signed</th><th class="n">Continuation</th><th class="n">Net-new</th><th class="n">Weighted</th><th class="n">Gap</th><th class="n">% plan</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function renderPlanHtml(rows: PlanRow[], meta: { asOf: string }): string {
  const range = rows.length ? `${rows[0]!.q}–${rows[rows.length - 1]!.q}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast vs Plan</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#ececec}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1060px;margin:0 auto;padding:26px 24px 20px}
  h1{font-size:19px;font-weight:650;margin:0;letter-spacing:-.01em}
  .sub{font-size:12.5px;color:var(--muted);margin:3px 0 16px}
  .legend{display:flex;gap:16px;font-size:11.5px;color:var(--muted);margin:0 0 8px}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:-1px;margin-right:5px}
  .legend .line{width:14px;height:0;border-top:2px solid var(--ink);border-radius:0}
  .chart{overflow-x:auto}
  .chart svg{max-width:100%;height:auto}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
  th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
  th{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  td.b{font-weight:650}
  td.neg{color:#d93025} td.pos{color:#188038}
  .tbl{overflow-x:auto}
  .foot{margin-top:14px;padding-top:11px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
</style>
</head>
<body>
<div class="wrap">
  <h1>Forecast vs Plan</h1>
  <div class="sub">Weighted forecast against target, by quarter &middot; ${esc(range)} &middot; as of ${esc(meta.asOf)}</div>
  <div class="legend">
    <span><i style="background:${SIGNED}"></i>Signed (100%)</span>
    <span><i style="background:${CONT}"></i>Continuation, weighted</span>
    <span><i style="background:${NEWB}"></i>Net-new, weighted</span>
    <span><i class="line"></i>Target</span>
  </div>
  <div class="chart">${chartSvg(rows)}</div>
  <div class="tbl">${table(rows)}</div>
  <div class="foot">
    <div>Signed = won deals. Continuation = pipeline on accounts that already have a win. Net-new = pipeline on new accounts.</div>
    <div>Targets: Revenue Targets DB &middot; Pipeline: Deal Revenue Schedules</div>
  </div>
</div>
</body>
</html>`;
}
