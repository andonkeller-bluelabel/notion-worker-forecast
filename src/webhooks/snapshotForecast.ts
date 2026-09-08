/**
 * snapshotForecast webhook — captures a durable weekly snapshot of the pipeline
 * into the append-only "Snapshots" tab. One row per deal (see lib/snapshot.ts).
 * Idempotent per week: re-running within the same week replaces that week's rows
 * (keyed by the week's Monday) instead of duplicating. Errors → #forecast-ops.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { SNAPSHOT_HEADERS, buildSnapshotRows, weekKey } from "../lib/snapshot.js";
import { ensureTab, getValuesUnformatted, clearValues, writeValues } from "../lib/sheets.js";
import { withSheetsAuthRetry } from "../lib/renderGuard.js";
import { postForecastOps } from "../lib/slack.js";

const SNAPSHOT_TAB = "Snapshots";

worker.webhook("snapshotForecast", {
  title: "Snapshot Forecast",
  description:
    "Appends a weekly deal-level snapshot of the pipeline to the Snapshots tab (idempotent per week, keyed by the " +
    "week's Monday). Enables week-over-week analysis. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      const sheetId = process.env.FORECAST_SHEET_ID;
      try {
        if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");
        const deals = aggregateDeals(await readSegments(notion));
        const key = weekKey(new Date());
        const fresh = buildSnapshotRows(deals, key);

        // On a transient Sheets 401 (token blip), refresh the token and replay once (idempotent per week).
        const weeks = await withSheetsAuthRetry(
          () => googleAuth.accessToken(),
          async (token) => {
            await ensureTab(token, sheetId, SNAPSHOT_TAB);
            // Read existing data rows (unformatted so numbers survive the rewrite), keep every
            // week except this one, then rewrite header + kept + fresh — an idempotent append.
            const existing = await getValuesUnformatted(token, sheetId, `${SNAPSHOT_TAB}!A2:U100000`);
            const kept = existing.filter((r) => r.length > 0 && String(r[0]) !== key);
            const grid = [SNAPSHOT_HEADERS, ...kept, ...fresh];

            await clearValues(token, sheetId, SNAPSHOT_TAB);
            await writeValues(token, sheetId, `${SNAPSHOT_TAB}!A1`, grid, "RAW");
            return new Set(grid.slice(1).map((r) => String(r[0]))).size;
          },
        );

        const msg = `:camera_with_flash: *Snapshot saved* — ${fresh.length} deals for week ${key} (${weeks} week${weeks === 1 ? "" : "s"} stored).`;
        console.log(`[forecast] ${msg}`);
        await postForecastOps(msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] snapshot failed:", err);
        await postForecastOps(`:x: *Snapshot failed*: ${m}`);
      }
    }
  },
});
