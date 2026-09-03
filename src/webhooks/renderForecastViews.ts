/**
 * renderForecastViews webhook — writes the three Current2-style formatted views:
 *   • "By Stage — Quarterly"  (2026.Q1 … 2028.Q4)
 *   • "By Stage — Monthly"    (this month + 12)
 *   • "By Client — Quarterly"
 * Deal-level rows grouped by stage/client, Probability column, raw revenue per
 * period, per-group subtotals + grand total. Payload ignored (full rebuild).
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { aggregateDeals, renderView } from "../lib/render.js";
import { quartersRange, monthsFrom, monthToQuarter } from "../lib/forecast.js";
import { postForecastOps } from "../lib/slack.js";

worker.webhook("renderForecastViews", {
  title: "Render Forecast Views",
  description:
    "Writes the three Current2-style formatted views (By Stage — Quarterly, By Stage — Monthly, By Client — " +
    "Quarterly): deal rows grouped by stage/client with a Probability column, raw revenue per period, subtotals + grand total.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      const sheetId = process.env.FORECAST_SHEET_ID;
      try {
        if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");
        const token = await googleAuth.accessToken();
        const deals = aggregateDeals(await readSegments(notion));

        const quarters = quartersRange();
        const months = monthsFrom(13); // this month + 12
        const identity = (m: string) => m;

        await renderView(token, sheetId, "By Stage — Quarterly", deals, quarters, "stage", monthToQuarter);
        await renderView(token, sheetId, "By Stage — Monthly", deals, months, "stage", identity);
        await renderView(token, sheetId, "By Client — Quarterly", deals, quarters, "client", monthToQuarter);

        const msg = `:page_facing_up: *Forecast views rendered* — ${deals.length} deals → By Stage (Q + M) and By Client (Q).`;
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
