/**
 * renderNotionFunnel webhook — pushes TWO reports into the Experimental Reporting
 * page as separate embeds (after the manual dashboard embed):
 *   • Forecast vs Plan    — per-quarter Signed/Continuation/Net-new weighted vs target
 *   • Pipeline vs Target  — coverage of near/full windows + per-stage gross pipeline needed
 * Reads live Deal Revenue Schedules + the Revenue Targets DB, builds both HTMLs,
 * uploads them, and replaces the managed embed region idempotently. Errors → #forecast-ops.
 */

import { worker } from "../worker.js";
import { readSegments, readTargets } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { monthToQuarter } from "../lib/forecast.js";
import { computeWindow } from "../lib/coverage.js";
import { renderCoverageHtml } from "../lib/coverageHtml.js";
import { computePlanRows } from "../lib/planVsPipeline.js";
import { renderPlanHtml } from "../lib/planHtml.js";
import { uploadHtml, replaceReportEmbeds } from "../lib/notionEmbed.js";
import { postForecastOps } from "../lib/slack.js";

/** Experimental Reporting page + the block the report embeds sit right after (the manual dashboard embed). */
const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const ANCHOR_BLOCK_ID = "e977e4a1-01a6-46d2-a4ac-a1deae2ffba3";

const pct = (x: number) => `${Math.round(x * 100)}%`;

worker.webhook("renderNotionFunnel", {
  title: "Render Notion Reports",
  description:
    "Builds Forecast vs Plan and Pipeline vs Target from live Deal Revenue Schedules + the Revenue Targets DB and " +
    "pushes them as two embeds on the Experimental Reporting page. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      try {
        const token = process.env.NOTION_API_TOKEN;
        if (!token) throw new Error("NOTION_API_TOKEN not set");

        const segments = await readSegments(notion);
        const deals = aggregateDeals(segments);
        const targets = await readTargets(notion);
        const asOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

        // (B) Forecast vs Plan — all target quarters.
        const planRows = computePlanRows(segments, targets);
        const htmlB = renderPlanHtml(planRows, { asOf });

        // (A) Pipeline vs Target — coverage windows from the current quarter forward.
        const now = new Date();
        const curQuarter = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
        const full = [...targets.keys()].sort().filter((q) => q >= curQuarter);
        if (full.length === 0) throw new Error("no current/future quarters in Revenue Targets DB");
        const near = full.slice(0, 2);
        const nearW = computeWindow(deals, targets, near, near.length > 1 ? "Next 2 quarters" : "This quarter");
        const fullW = computeWindow(deals, targets, full, `Through ${full[full.length - 1]}`);
        const htmlA = renderCoverageHtml([nearW, fullW], { asOf });

        const [idB, idA] = [await uploadHtml(token, htmlB, "forecast_vs_plan.html"), await uploadHtml(token, htmlA, "pipeline_vs_target.html")];
        const r = await replaceReportEmbeds(token, PAGE_ID, ANCHOR_BLOCK_ID, [idB, idA]);

        const msg = `:bar_chart: *Notion reports updated* — Forecast vs Plan + Pipeline vs Target · near ${pct(nearW.coveredPct)} covered, gap ${(fullW.gap / 1e6).toFixed(1)}M.`;
        console.log(`[forecast] ${msg} (blocks=${r.blockIds.join(",")} deletedOld=${r.deletedOld} usedAnchor=${r.usedAnchor})`);
        await postForecastOps(msg + (r.usedAnchor ? "" : " :warning: anchor missing — appended at page end; check layout."));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] notion reports failed:", err);
        await postForecastOps(`:x: *Notion reports push failed*: ${m}`);
      }
    }
  },
});
