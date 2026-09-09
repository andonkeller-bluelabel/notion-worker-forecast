/**
 * renderForecastViews webhook — writes the Current2-style outline views, addressed by
 * stable sheetId (VIEW_TABS) so they follow the user's tab renames instead of being recreated:
 *   • Client Partner    (quarterly; group: Client Partner → Client; raw $ + annotation cols)
 *   • Pipeline          (quarterly; group: probability %; raw $ + Stats block)
 *   • Weighted Monthly  (monthly; group: Client only, alpha; weighted $ + total row)
 * Collapsible native row groups, deal hyperlinks, accounting `$ -`, hand-tuned column widths.
 * Also deletes the superseded duplicate/pivot and retired monthly tabs. Payload ignored.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments, readTargets, readOpenPlaceholderDeals } from "../lib/notionForecast.js";
import { aggregateDeals, renderPartnerClientView, renderProbabilityView, renderWeightedPipeline, ACTIONS_COL, LAST_WEEK_COL, REVENUE_COL, type Target } from "../lib/render.js";
import { quartersRange, monthsFrom, monthToQuarter } from "../lib/forecast.js";
import { deleteTabs, deleteTabsById, getSheetMeta, ensureTab } from "../lib/sheets.js";
import { withSheetsAuthRetry, acquireRenderLock, releaseRenderLock } from "../lib/renderGuard.js";
import { postForecastOps } from "../lib/slack.js";

/** Stable sheetIds of the three view tabs we keep. We render by ID so renames never recreate them. */
const VIEW_TABS = {
  clientView: 1834696165, // "Client Partner" (quarterly)
  pipelineView: 385847462, // "Pipeline" (quarterly)
  weightedMonthly: 519992960, // "Weighted Monthly"
} as const;

/** Old duplicate/pivot tabs plus the retired monthly/quarterly views the user dropped. Delete by ID. */
const ORPHAN_TAB_IDS = [
  1761354226, 1091496648, 423840615, 1127543954, // pre-ID-targeting duplicates
  175268818, 1048787530, 1415553020, // retired: Client Monthly, Pipeline Monthly, Weighted Pipeline
];

/** Hand-tuned column widths (px), read from the user's tabs. attr = per attribute column, period = uniform. */
const CLIENT_W = { attr: [82, 400, 160], period: 86 };
const PIPELINE_W = { attr: [100, 134, 400, 160], period: 92 };
const WEIGHTED_MONTHLY_W = { attr: [82, 400, 160], period: 87 };

/** Tabs from earlier iterations that these views replace. */
const OBSOLETE_TABS = ["By Client — Quarterly (AI)", "By Stage", "By Client Account", "By Delivery Phase", "Company Total"];

worker.webhook("renderForecastViews", {
  title: "Render Forecast Views",
  description:
    "Writes the outline views — Client View, Pipeline View, and Weighted Pipeline (each + Monthly) — into the " +
    "Forecast Dashboard sheet, addressed by stable tab id. Deal-level rows, collapsible groups. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      const sheetId = process.env.FORECAST_SHEET_ID;
      // Weekly rollover (triggered via {"rollover":true} payload): shift Actions to Grow → Last Week's Actions.
      const rollover = (_event as { body?: Record<string, unknown> }).body?.rollover === true;
      let dealCount = 0;
      let openCount = 0;
      let skipped = false;
      try {
        if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");
        // On a transient Sheets 401 (token blip), refresh the token and replay the whole render once.
        await withSheetsAuthRetry(
          () => googleAuth.accessToken(),
          async (token) => {
            // Concurrency guard: if a teammate's render is already in flight, skip — theirs writes
            // the same output, so rendering on top of it only risks interleaved writes.
            if (!(await acquireRenderLock(token, sheetId))) {
              skipped = true;
              return;
            }
            try {
              await renderAll(token, sheetId, notion, rollover);
            } finally {
              await releaseRenderLock(token, sheetId);
            }
          },
        );
        if (skipped) {
          console.log("[forecast] render skipped — another render is already in flight");
          continue;
        }
        const msg = `:page_facing_up: *Forecast views rendered* — ${dealCount} deals${openCount ? ` (+${openCount} open, unscheduled)` : ""} → Client Partner, Pipeline, Weighted Monthly.${rollover ? " (weekly actions rolled over)" : ""}`;
        console.log(`[forecast] ${msg}`);
        await postForecastOps(msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] render failed:", err);
        await postForecastOps(`:x: *Forecast view render failed*: ${m}`);
      }

      // The render itself, factored out so the auth-retry wrapper can replay it with a fresh token.
      async function renderAll(token: string, sheetId: string, notion: Parameters<typeof readSegments>[0], rollover: boolean): Promise<void> {
        const deals = aggregateDeals(await readSegments(notion));
        dealCount = deals.length;
        // Open-stage deals with no revenue schedule yet — shown at $0 in the Pipeline and Client Partner
        // views so early pipeline is visible before it's scheduled. Kept out of Weighted Monthly.
        const have = new Set(deals.map((d) => d.dealId));
        const placeholders = (await readOpenPlaceholderDeals(notion)).filter((d) => !have.has(d.dealId));
        openCount = placeholders.length;
        const dealsWithOpen = [...deals, ...placeholders];
        const targets = await readTargets(notion);

        const quarters = quartersRange();
        // Client View: free-text annotation columns (preserved by deal) + only the current quarter and next 3 visible.
        const now = new Date();
        const curQ = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
        const ci = quarters.indexOf(curQ);
        const clientExtras = {
          annotationCols: [ACTIONS_COL, LAST_WEEK_COL, REVENUE_COL],
          annotationWidths: [248, 248, 248],
          visiblePeriods: ci >= 0 ? quarters.slice(ci, ci + 4) : quarters.slice(0, 4),
        };
        // Monthly headers use the "2026.09" dot form (matching the "2026.Qx" quarters);
        // monthLabel converts a byMonth key ("2026-09") to the same, so lookups still match.
        const monthLabel = (m: string) => m.replace("-", ".");
        const months = monthsFrom(18).map(monthLabel); // this month + next 17 = 18-month rolling window

        // Resolve each view's current title from its stable id (follows renames); recreate only if deleted.
        const byId = new Map((await getSheetMeta(token, sheetId)).map((m) => [m.sheetId, m.title]));
        const target = async (id: number, canonical: string): Promise<Target> => {
          const title = byId.get(id);
          return title ? { sheetId: id, title } : { sheetId: await ensureTab(token, sheetId, canonical), title: canonical };
        };

        await renderPartnerClientView(token, sheetId, await target(VIEW_TABS.clientView, "Client Partner"), dealsWithOpen, quarters, monthToQuarter, CLIENT_W, clientExtras, rollover);
        await renderProbabilityView(token, sheetId, await target(VIEW_TABS.pipelineView, "Pipeline"), dealsWithOpen, quarters, monthToQuarter, PIPELINE_W, targets, clientExtras.visiblePeriods);
        await renderWeightedPipeline(token, sheetId, await target(VIEW_TABS.weightedMonthly, "Weighted Monthly"), deals, months, monthLabel, WEIGHTED_MONTHLY_W);
        await deleteTabsById(token, sheetId, ORPHAN_TAB_IDS);
        await deleteTabs(token, sheetId, OBSOLETE_TABS);
      }
    }
  },
});
