/**
 * renderForecastViews webhook — writes the Current2-style outline views, addressed by
 * stable sheetId (VIEW_TABS) so they follow the user's tab renames instead of being recreated:
 *   • Client View / Client Monthly       (group: Client Partner → Client; raw $)
 *   • Pipeline View / Pipeline Monthly    (group: probability %; raw $)
 *   • Weighted Pipeline / … | Monthly     (group: Client only, alpha; weighted $ + total row)
 * Collapsible native row groups, deal hyperlinks, accounting `$ -`, hand-tuned column widths.
 * Also deletes the superseded duplicate/pivot tabs. Payload ignored.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { aggregateDeals, renderPartnerClientView, renderProbabilityView, renderWeightedPipeline, type Target } from "../lib/render.js";
import { quartersRange, monthsFrom, monthToQuarter } from "../lib/forecast.js";
import { deleteTabs, deleteTabsById, getSheetMeta, ensureTab } from "../lib/sheets.js";
import { postForecastOps } from "../lib/slack.js";

/** Stable sheetIds of the six view tabs. We render by ID so renames never recreate them. */
const VIEW_TABS = {
  clientView: 1834696165,
  pipelineView: 385847462,
  clientMonthly: 175268818,
  pipelineMonthly: 1048787530,
  weighted: 1415553020,
  weightedMonthly: 519992960,
} as const;

/** Old By Client / Pipeline duplicate tabs (recreated before we switched to ID targeting). Delete by ID. */
const ORPHAN_TAB_IDS = [1761354226, 1091496648, 423840615, 1127543954];

/** Hand-tuned column widths (px), read from the user's tabs. attr = per attribute column, period = uniform. */
const CLIENT_W = { attr: [82, 400, 160], period: 86 };
const CLIENT_MONTHLY_W = { attr: [82, 400, 160], period: 87 };
const PIPELINE_W = { attr: [100, 134, 400, 160], period: 92 };
const PIPELINE_MONTHLY_W = { attr: [100, 174, 400, 160], period: 91 };
const WEIGHTED_W = { attr: [82, 400, 160], period: 86 }; // Client-View layout
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
      try {
        if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");
        const token = await googleAuth.accessToken();
        const deals = aggregateDeals(await readSegments(notion));

        const quarters = quartersRange();
        // Monthly headers use the "2026.09" dot form (matching the "2026.Qx" quarters);
        // monthLabel converts a byMonth key ("2026-09") to the same, so lookups still match.
        const monthLabel = (m: string) => m.replace("-", ".");
        const months = monthsFrom(13).map(monthLabel); // this month + 12

        // Resolve each view's current title from its stable id (follows renames); recreate only if deleted.
        const byId = new Map((await getSheetMeta(token, sheetId)).map((m) => [m.sheetId, m.title]));
        const target = async (id: number, canonical: string): Promise<Target> => {
          const title = byId.get(id);
          return title ? { sheetId: id, title } : { sheetId: await ensureTab(token, sheetId, canonical), title: canonical };
        };

        await renderPartnerClientView(token, sheetId, await target(VIEW_TABS.clientView, "Client View"), deals, quarters, monthToQuarter, CLIENT_W);
        await renderPartnerClientView(token, sheetId, await target(VIEW_TABS.clientMonthly, "Client Monthly"), deals, months, monthLabel, CLIENT_MONTHLY_W);
        await renderProbabilityView(token, sheetId, await target(VIEW_TABS.pipelineView, "Pipeline View"), deals, quarters, monthToQuarter, PIPELINE_W);
        await renderProbabilityView(token, sheetId, await target(VIEW_TABS.pipelineMonthly, "Pipeline Monthly"), deals, months, monthLabel, PIPELINE_MONTHLY_W);
        await renderWeightedPipeline(token, sheetId, await target(VIEW_TABS.weighted, "Weighted Pipeline"), deals, quarters, monthToQuarter, WEIGHTED_W);
        await renderWeightedPipeline(token, sheetId, await target(VIEW_TABS.weightedMonthly, "Weighted Pipeline | Monthly"), deals, months, monthLabel, WEIGHTED_MONTHLY_W);
        await deleteTabsById(token, sheetId, ORPHAN_TAB_IDS);
        await deleteTabs(token, sheetId, OBSOLETE_TABS);

        const msg = `:page_facing_up: *Forecast views rendered* — ${deals.length} deals → Client View (Q+M), Pipeline View (Q+M), Weighted Pipeline (Q+M).`;
        console.log(`[forecast] ${msg}`);
        await postForecastOps(msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] render failed:", err);
        await postForecastOps(`:x: *Forecast view render failed*: ${m}`);
      }
    }
  },
});
