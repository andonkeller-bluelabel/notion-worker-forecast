/**
 * renderForecastViews webhook — writes the four Current2-style outline views:
 *   • By Client / By Client | Monthly   (group: Client Partner → Client)
 *   • Pipeline  / Pipeline | Monthly     (group: probability %, deals by partner+title)
 * Collapsible native row groups, deal hyperlinks, accounting `$ -`, raw revenue.
 * Also removes the superseded raw-pivot / (AI) preview tabs. Payload ignored.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { aggregateDeals, renderPartnerClientView, renderProbabilityView } from "../lib/render.js";
import { quartersRange, monthsFrom, monthToQuarter } from "../lib/forecast.js";
import { deleteTabs } from "../lib/sheets.js";
import { postForecastOps } from "../lib/slack.js";

/** Tabs from earlier iterations that these views replace. */
const OBSOLETE_TABS = ["By Client — Quarterly (AI)", "By Stage", "By Client Account", "By Delivery Phase", "Company Total"];

worker.webhook("renderForecastViews", {
  title: "Render Forecast Views",
  description:
    "Writes the four outline views — By Client (+ Monthly) and Pipeline (+ Monthly) — into the " +
    "Forecast Dashboard sheet. Deal-level rows, collapsible groups, raw revenue per period. Errors → #forecast-ops.",
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

        await renderPartnerClientView(token, sheetId, "By Client", deals, quarters, monthToQuarter);
        await renderPartnerClientView(token, sheetId, "By Client | Monthly", deals, months, monthLabel);
        await renderProbabilityView(token, sheetId, "Pipeline", deals, quarters, monthToQuarter);
        await renderProbabilityView(token, sheetId, "Pipeline | Monthly", deals, months, monthLabel);
        await deleteTabs(token, sheetId, OBSOLETE_TABS);

        const msg = `:page_facing_up: *Forecast views rendered* — ${deals.length} deals → By Client (Q+M), Pipeline (Q+M).`;
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
