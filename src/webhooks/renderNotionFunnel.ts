/**
 * renderNotionFunnel webhook — pushes TWO reports into the Experimental Reporting
 * page as separate embeds (after the manual dashboard embed):
 *   • Forecast vs Plan    — per-quarter Signed/Continuation/Net-new weighted vs target
 *   • Pipeline vs Target  — coverage of near/full windows + per-stage gross pipeline needed
 * Reads live Deal Revenue Schedules + the Revenue Targets DB, builds both HTMLs,
 * uploads them, and replaces the managed embed region idempotently. Errors → #forecast-ops.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments, readTargets, readStageCycles } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { monthToQuarter, quartersRange } from "../lib/forecast.js";
import { computeWindow } from "../lib/coverage.js";
import { computeGlidepath, type GlideSeries } from "../lib/glidepath.js";
import { buildTemplates, buildBaseline } from "../lib/simulator.js";
import { renderCoverageHtml } from "../lib/coverageHtml.js";
import { computePlanRows } from "../lib/planVsPipeline.js";
import { renderPlanHtml } from "../lib/planHtml.js";
import { renderSimulatorHtml } from "../lib/simulatorHtml.js";
import { getValuesUnformatted } from "../lib/sheets.js";
import { uploadHtml, syncReportEmbeds } from "../lib/notionEmbed.js";
import { postForecastOps } from "../lib/slack.js";

/** Experimental Reporting page. Each report's embed lives in its own draggable container (matched by filename). */
const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const PLAN_FILE = "forecast_vs_plan.html";
const COVERAGE_FILE = "pipeline_vs_target.html";
const SIMULATOR_FILE = "gap_simulator.html";

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
        const now = new Date();
        const asOf = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
        const curQuarter = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);

        // Coverage glidepath for the current + next quarter (drives the expandable KPI charts).
        // Read from the append-only Snapshots tab; resilient — if unavailable, the KPI cards just
        // won't expand and the rest of the report still renders.
        let glide: GlideSeries[] = [];
        try {
          const sheetId = process.env.FORECAST_SHEET_ID;
          if (sheetId) {
            const quarters = quartersRange();
            const ci = quarters.indexOf(curQuarter);
            const forQ = ci >= 0 ? quarters.slice(ci, ci + 2) : [];
            const snapRows = await getValuesUnformatted(await googleAuth.accessToken(), sheetId, "Snapshots!A2:U100000");
            glide = computeGlidepath(snapRows, targets, quarters, forQ);
          }
        } catch (e) {
          console.warn("[forecast] glidepath unavailable:", e instanceof Error ? e.message : e);
        }

        // (B) Forecast vs Plan — all target quarters + coverage KPI cards (with glidepath) on top.
        const planRows = computePlanRows(segments, targets);
        const htmlB = renderPlanHtml(planRows, { asOf, nowQuarter: curQuarter }, glide);

        // (A) Pipeline vs Target — coverage windows from the current quarter forward.
        const full = [...targets.keys()].sort().filter((q) => q >= curQuarter);
        if (full.length === 0) throw new Error("no current/future quarters in Revenue Targets DB");
        const near = full.slice(0, 2);
        const nearW = computeWindow(deals, targets, near, near.length > 1 ? "Next 2 quarters" : "This quarter");
        const fullW = computeWindow(deals, targets, full, `Through ${full[full.length - 1]}`);
        const htmlA = renderCoverageHtml([nearW, fullW], { asOf });

        // Swap each report's embed inside its own draggable container (matched by filename), so manual placement survives.
        const idB = await uploadHtml(token, htmlB, PLAN_FILE);
        const idA = await uploadHtml(token, htmlA, COVERAGE_FILE);

        // (C) Gap-closing simulator — client revenue-arc templates + coverage baseline, driven in-browser.
        // Resilient: if the arc/cycle read fails, the other two reports still publish.
        let idSim: string | null = null;
        try {
          const wonSegs = await readSegments(notion, { includeArchived: true });
          let cycles = new Map<string, { first: string; won: string | null }>();
          try { cycles = await readStageCycles(notion); } catch (e) { console.warn("[forecast] stage cycles unavailable:", e instanceof Error ? e.message : e); }
          const htmlC = renderSimulatorHtml(buildTemplates(wonSegs, cycles), buildBaseline(deals, targets, quartersRange()), { asOf, curQuarter, today: now.toISOString().slice(0, 10) });
          idSim = await uploadHtml(token, htmlC, SIMULATOR_FILE);
        } catch (e) {
          console.warn("[forecast] simulator unavailable:", e instanceof Error ? e.message : e);
        }

        const reports = [
          { filename: PLAN_FILE, fileUploadId: idB },
          { filename: COVERAGE_FILE, fileUploadId: idA },
        ];
        if (idSim) reports.push({ filename: SIMULATOR_FILE, fileUploadId: idSim });
        const r = await syncReportEmbeds(token, PAGE_ID, reports);

        const msg = `:bar_chart: *Notion reports updated* — Forecast vs Plan + Pipeline vs Target · near ${pct(nearW.coveredPct)} covered, gap ${(fullW.gap / 1e6).toFixed(1)}M.`;
        const fresh = [...r.created, ...r.migrated];
        console.log(`[forecast] ${msg} (updated=[${r.updated}] created=[${r.created}] migrated=[${r.migrated}] dupes=${r.deletedDupes})`);
        await postForecastOps(msg + (fresh.length ? ` :information_source: new report card(s) added at the page end — drag into place once; future refreshes stay put.` : ""));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] notion reports failed:", err);
        await postForecastOps(`:x: *Notion reports push failed*: ${m}`);
      }
    }
  },
});
