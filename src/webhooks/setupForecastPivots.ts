/**
 * setupForecastPivots webhook — one-time / idempotent setup of the four pivot
 * views (By Stage, By Client Account, By Delivery Phase, Company Total) over the
 * `Forecast Facts` tab. Pivots auto-update as the fact table is rebuilt, so this
 * only needs running when the pivots don't exist yet (or their shape changes).
 */

import { worker, googleAuth } from "../worker.js";
import { setupPivots } from "../lib/pivots.js";
import { postForecastOps } from "../lib/slack.js";

worker.webhook("setupForecastPivots", {
  title: "Setup Forecast Pivots",
  description:
    "Creates/refreshes the four pivot tabs (By Stage, By Client Account, By Delivery Phase, Company Total) over " +
    "the Forecast Facts tab. Idempotent; run once (or after changing the fact-table columns).",
  execute: async (events) => {
    for (const _event of events) {
      const sheetId = process.env.FORECAST_SHEET_ID;
      try {
        if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");
        const token = await googleAuth.accessToken();
        const tabs = await setupPivots(token, sheetId);
        const msg = `:heavy_check_mark: *Forecast pivots ready* — ${tabs.map((t) => `\`${t}\``).join(", ")}.`;
        console.log(`[forecast] ${msg}`);
        await postForecastOps(msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] pivot setup failed:", err);
        await postForecastOps(`:x: *Forecast pivot setup failed*: ${m}`);
      }
    }
  },
});
