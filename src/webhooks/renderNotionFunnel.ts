/**
 * renderNotionFunnel webhook — the worker's push of the "Pipeline vs Target"
 * coverage report into Notion: read live segments + the Revenue Targets DB →
 * compute coverage for two windows (near = current + next quarter, full = through
 * the last quarter with a target) → build HTML → replace the funnel embed on the
 * Experimental Reporting page. Idempotent. Errors → #forecast-ops. Payload ignored.
 */

import { worker } from "../worker.js";
import { readSegments, readTargets } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { monthToQuarter } from "../lib/forecast.js";
import { computeWindow } from "../lib/coverage.js";
import { renderCoverageHtml } from "../lib/coverageHtml.js";
import { uploadHtml, replaceFunnelEmbed } from "../lib/notionEmbed.js";
import { postForecastOps } from "../lib/slack.js";

/** Experimental Reporting page + the block the funnel embed sits right after (the manual dashboard embed). */
const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const ANCHOR_BLOCK_ID = "e977e4a1-01a6-46d2-a4ac-a1deae2ffba3";

const pct = (x: number) => `${Math.round(x * 100)}%`;

worker.webhook("renderNotionFunnel", {
  title: "Render Notion Funnel",
  description:
    "Builds the Pipeline vs Target coverage report from live Deal Revenue Schedules + the Revenue Targets DB and " +
    "pushes it into the embed block on the Experimental Reporting page. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      try {
        const token = process.env.NOTION_API_TOKEN;
        if (!token) throw new Error("NOTION_API_TOKEN not set");

        const [deals, targets] = [aggregateDeals(await readSegments(notion)), await readTargets(notion)];

        // Windows: full = target quarters from the current quarter forward; near = first two of those.
        const now = new Date();
        const curQuarter = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
        const full = [...targets.keys()].sort().filter((q) => q >= curQuarter);
        if (full.length === 0) throw new Error("no current/future quarters in Revenue Targets DB");
        const near = full.slice(0, 2);

        const nearW = computeWindow(deals, targets, near, near.length > 1 ? "Next 2 quarters" : "This quarter");
        const fullW = computeWindow(deals, targets, full, `Through ${full[full.length - 1]}`);

        const asOf = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
        const html = renderCoverageHtml([nearW, fullW], { asOf });

        const fileId = await uploadHtml(token, html, "pipeline_vs_target.html");
        const r = await replaceFunnelEmbed(token, PAGE_ID, ANCHOR_BLOCK_ID, fileId);

        const msg = `:dart: *Pipeline vs Target updated* — near ${pct(nearW.coveredPct)} covered (gap ${(fullW.gap / 1e6).toFixed(1)}M full-window).`;
        console.log(`[forecast] ${msg} (block=${r.blockId} deletedOld=${r.deletedOld} usedAnchor=${r.usedAnchor})`);
        await postForecastOps(msg + (r.usedAnchor ? "" : " :warning: anchor missing — appended at page end; check layout."));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] notion coverage failed:", err);
        await postForecastOps(`:x: *Pipeline vs Target push failed*: ${m}`);
      }
    }
  },
});
