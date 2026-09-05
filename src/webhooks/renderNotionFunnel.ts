/**
 * renderNotionFunnel webhook — the worker's own end-to-end push of the Weighted
 * Pipeline Funnel into Notion: read live segments → weighted-by-stage → build HTML
 * → upload as a Notion file → repoint the funnel embed block on the reporting page.
 * Idempotent: updates the same block in place; re-appends only if that block is gone.
 * Errors → #forecast-ops. Payload ignored.
 */

import { worker } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { renderFunnelHtml, type StageRow } from "../lib/funnelHtml.js";
import { uploadHtml, replaceFunnelEmbed } from "../lib/notionEmbed.js";
import { postForecastOps } from "../lib/slack.js";

/** Experimental Reporting page + the block the funnel embed sits right after (the manual dashboard embed). */
const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const ANCHOR_BLOCK_ID = "e977e4a1-01a6-46d2-a4ac-a1deae2ffba3";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

worker.webhook("renderNotionFunnel", {
  title: "Render Notion Funnel",
  description:
    "Builds the Weighted Pipeline Funnel from live Deal Revenue Schedules and pushes it into the embed block on " +
    "the Experimental Reporting page. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      try {
        const token = process.env.NOTION_API_TOKEN;
        if (!token) throw new Error("NOTION_API_TOKEN not set");

        const deals = aggregateDeals(await readSegments(notion));
        const byStage = new Map<number, StageRow>();
        for (const d of deals) {
          const pct = Math.round(d.probability * 100);
          const raw = [...d.byMonth.values()].reduce((s, v) => s + v, 0);
          const weighted = [...d.byMonthW.values()].reduce((s, v) => s + v, 0);
          const row = byStage.get(pct) ?? { pct, n: 0, raw: 0, weighted: 0 };
          row.n += 1;
          row.raw += raw;
          row.weighted += weighted;
          byStage.set(pct, row);
        }
        const stages = [...byStage.values()];
        const totalWeighted = stages.reduce((s, r) => s + r.weighted, 0);
        const totalRaw = stages.reduce((s, r) => s + r.raw, 0);

        const asOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
        const html = renderFunnelHtml(stages, { asOf });

        const fileId = await uploadHtml(token, html, "weighted_funnel.html");
        const r = await replaceFunnelEmbed(token, PAGE_ID, ANCHOR_BLOCK_ID, fileId);

        const msg = `:bar_chart: *Notion funnel updated* — ${deals.length} deals, weighted ${money(totalWeighted)} of ${money(totalRaw)} gross.`;
        console.log(`[forecast] ${msg} (block=${r.blockId} deletedOld=${r.deletedOld} usedAnchor=${r.usedAnchor})`);
        await postForecastOps(msg + (r.usedAnchor ? "" : " :warning: anchor missing — appended at page end; check layout."));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] notion funnel failed:", err);
        await postForecastOps(`:x: *Notion funnel push failed*: ${m}`);
      }
    }
  },
});
