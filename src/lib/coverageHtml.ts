/**
 * Renders the "Pipeline vs Target" coverage HTML uploaded to the Notion embed.
 * One panel per window: a committed+weighted coverage meter against the target,
 * and per open-stage rows filling to the % of the gap each stage covers, labeled
 * with the gross pipeline it would take to close the gap alone. Self-contained CSS.
 */

import type { WindowStats } from "./coverage.js";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function stageColor(p: number): string {
  if (p >= 80) return "#5bb974";
  if (p >= 60) return "#4285f4";
  if (p >= 40) return "#7e57c2";
  return "#9575cd";
}

function panel(w: WindowStats): string {
  const cCommit = Math.max(0, Math.min(100, w.committedPct * 100));
  const cOpen = Math.max(0, Math.min(100 - cCommit, w.openWeightedPct * 100));
  const rows = w.stages
    .map((s) => {
      const c = stageColor(s.pct);
      const fill = Math.min(100, s.coverageOfGap * 100).toFixed(1);
      return `        <div class="row"><span class="s"><span class="dot" style="background:${c}"></span>${s.pct}%</span>
          <div class="rbar"><div class="f" style="width:${fill}%;background:${c}"></div></div>
          <div class="rmeta"><span class="w">${money(s.weighted)}</span> <span class="n">&middot; ${pct(s.coverageOfGap)}</span><div class="n">need ${money(s.needGross)}</div></div></div>`;
    })
    .join("\n");
  return `    <div class="panel">
      <div class="ph"><span class="t">${esc(w.label)}</span><span class="q">${esc(w.range)}</span></div>
      <div class="cov">
        <div class="covnum">${pct(w.coveredPct)}<small> covered &nbsp;&middot;&nbsp; ${money(w.target)} target</small></div>
        <div class="meter"><div class="seg c" style="width:${cCommit.toFixed(1)}%"></div><div class="seg o" style="width:${cOpen.toFixed(1)}%"></div></div>
        <div class="mlabels"><span>Committed ${pct(w.committedPct)} &middot; +Weighted ${pct(w.openWeightedPct)}</span><span>Gap ${money(w.gap)}</span></div>
      </div>
      <div class="rows">
        <div class="rt">Open pipeline &mdash; covers ${pct(w.gapCoveredPct)} of the ${money(w.gap)} gap</div>
${rows}
      </div>
    </div>`;
}

export function renderCoverageHtml(windows: WindowStats[], meta: { asOf: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline vs Target</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#ececec;--track:#eef0f3;--g:#34a853;--b:#4285f4;--gap:#e6e8ec}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:900px;margin:0 auto;padding:26px 26px 20px}
  h1{font-size:19px;font-weight:650;margin:0;letter-spacing:-.01em}
  .sub{font-size:12.5px;color:var(--muted);margin:3px 0 18px}
  .panels{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  @media (max-width:720px){.panels{grid-template-columns:1fr}}
  .panel{border:1px solid var(--line);border-radius:10px;padding:16px 16px 14px}
  .ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .ph .t{font-size:14px;font-weight:640}
  .ph .q{font-size:11px;color:var(--muted)}
  .cov{margin:12px 0 4px}
  .covnum{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1}
  .covnum small{font-size:12px;font-weight:500;color:var(--muted);letter-spacing:0}
  .meter{position:relative;height:20px;border-radius:5px;background:var(--gap);overflow:hidden;margin:9px 0 6px;display:flex}
  .seg{height:100%}
  .seg.c{background:var(--g)} .seg.o{background:var(--b)}
  .mlabels{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
  .rows{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
  .rt{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px}
  .row{display:grid;grid-template-columns:44px 1fr 128px;align-items:center;gap:10px;margin-bottom:7px}
  .row .s{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;flex:none}
  .rbar{position:relative;height:16px;background:var(--track);border-radius:4px;overflow:hidden}
  .rbar .f{position:absolute;inset:0 auto 0 0;height:100%;border-radius:4px}
  .rmeta{text-align:right;font-size:11px;line-height:1.25}
  .rmeta .w{font-weight:640;color:var(--ink);font-size:12px}
  .rmeta .n{color:var(--muted)}
  .foot{margin-top:16px;padding-top:11px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .key{display:inline-block;width:20px;height:8px;border-radius:3px;vertical-align:middle;margin:0 4px 0 10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Pipeline vs Target</h1>
  <div class="sub">Coverage of quarterly revenue goals by deal stage &middot; as of ${esc(meta.asOf)}</div>
  <div class="panels">
${windows.map(panel).join("\n")}
  </div>
  <div class="foot">
    <div><span class="key" style="background:var(--g)"></span>Committed (100%)<span class="key" style="background:var(--b)"></span>Weighted open pipeline<span class="key" style="background:var(--gap)"></span>Uncovered gap</div>
    <div>Targets: Revenue Targets DB &middot; Pipeline: Deal Revenue Schedules</div>
  </div>
</div>
</body>
</html>`;
}
