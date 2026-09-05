/**
 * Builds the self-contained "Weighted Pipeline Funnel" HTML that gets uploaded to
 * Notion and rendered in an embed block. No external assets (Notion sandboxes the
 * iframe): all CSS is inline. One lane per probability stage — bar length = gross $,
 * filled portion = probability-weighted $ — plus KPI headline and a legend.
 */

export type StageRow = { pct: number; n: number; raw: number; weighted: number };

/** $5.49M / $101K / $0 — matches the sheet's rounding feel. */
function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** Google "stage" hues by probability (matches the sheet's per-stage palette family). */
function stageColor(pct: number): string {
  if (pct >= 100) return "#34a853";
  if (pct >= 80) return "#5bb974";
  if (pct >= 60) return "#4285f4";
  if (pct >= 40) return "#7e57c2";
  if (pct >= 20) return "#9575cd";
  return "#d81b60";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderFunnelHtml(stages: StageRow[], meta: { asOf: string }): string {
  const rows = [...stages].sort((a, b) => b.pct - a.pct);
  const maxRaw = Math.max(1, ...rows.map((r) => r.raw));
  const totalRaw = rows.reduce((s, r) => s + r.raw, 0);
  const totalWeighted = rows.reduce((s, r) => s + r.weighted, 0);
  const totalDeals = rows.reduce((s, r) => s + r.n, 0);

  const lanes = rows
    .map((r) => {
      const c = stageColor(r.pct);
      const rawW = ((r.raw / maxRaw) * 100).toFixed(2);
      const wtW = ((r.weighted / maxRaw) * 100).toFixed(2);
      return `    <div class="lane">
      <div class="stage"><span class="dot" style="background:${c}"></span>${r.pct}%</div>
      <div class="bar"><div class="raw" style="width:${rawW}%;background:${c}"></div><div class="wt" style="width:${wtW}%;background:${c}"></div></div>
      <div class="amt"><div class="w">${money(r.weighted)}</div><div class="r">${money(r.raw)} &middot; ${r.n} deal${r.n === 1 ? "" : "s"}</div></div>
    </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weighted Pipeline Funnel</title>
<style>
  :root{--bg:#fff;--ink:#1a1a1a;--muted:#6b7280;--line:#ececec;--track:#f4f5f7;--g:#34a853;--b:#4285f4}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:860px;margin:0 auto;padding:28px 26px 22px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}
  h1{font-size:19px;font-weight:650;margin:0;letter-spacing:-.01em}
  .sub{font-size:12.5px;color:var(--muted);margin-top:3px}
  .kpis{display:flex;gap:26px;text-align:right}
  .kpi .n{font-size:20px;font-weight:680;letter-spacing:-.02em;line-height:1}
  .kpi .l{font-size:11px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
  .kpi .n.accent{color:var(--g)}
  .funnel{display:flex;flex-direction:column;gap:9px;margin-top:6px}
  .lane{display:grid;grid-template-columns:96px 1fr 132px;align-items:center;gap:14px}
  .stage{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .bar{position:relative;height:26px;background:var(--track);border-radius:6px;overflow:hidden}
  .raw{position:absolute;inset:0 auto 0 0;height:100%;border-radius:6px;opacity:.28}
  .wt{position:absolute;inset:0 auto 0 0;height:100%;border-radius:6px}
  .amt{text-align:right}
  .amt .w{font-size:14.5px;font-weight:660;letter-spacing:-.01em}
  .amt .r{font-size:11px;color:var(--muted);margin-top:1px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;padding-top:12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);flex-wrap:wrap}
  .swatch{display:inline-block;width:22px;height:9px;border-radius:3px;vertical-align:middle;margin:0 5px 0 10px}
  .swatch.light{opacity:.28}
  @media (max-width:560px){.lane{grid-template-columns:78px 1fr 104px;gap:9px}.kpis{gap:16px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>Weighted Pipeline Funnel</h1>
      <div class="sub">Probability-weighted revenue by deal stage &middot; as of ${esc(meta.asOf)}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n accent">${money(totalWeighted)}</div><div class="l">Weighted</div></div>
      <div class="kpi"><div class="n">${money(totalRaw)}</div><div class="l">Gross</div></div>
      <div class="kpi"><div class="n">${totalDeals}</div><div class="l">Deals</div></div>
    </div>
  </div>

  <div class="funnel">
${lanes}
  </div>

  <div class="foot">
    <div>Bar length = gross&nbsp;$ <span class="swatch light" style="background:var(--b)"></span>, filled = probability-weighted&nbsp;$ <span class="swatch" style="background:var(--b)"></span></div>
    <div>Source: Deal Revenue Schedules</div>
  </div>
</div>
</body>
</html>`;
}
