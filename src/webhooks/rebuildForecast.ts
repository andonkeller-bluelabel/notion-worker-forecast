/**
 * rebuildForecast webhook — rebuilds the monthly revenue fact table.
 *
 * Trigger: a Notion "Rebuild Forecast" button (Send webhook) and/or a scheduled
 * ping. The payload is ignored — this always does a full rebuild across all
 * non-archived Deal Revenue Schedule segments.
 *
 * Flow: read segments (Notion) → calendar-day monthly spread (committed +
 * weighted) → clear + write the "Forecast Facts" tab of the experimental sheet.
 * A run summary and any error go to #forecast-ops.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments } from "../lib/notionForecast.js";
import { computeFacts, factsToGrid, MIN_MONTH, MAX_MONTH } from "../lib/forecast.js";
import { replaceTab } from "../lib/sheets.js";
import { postForecastOps } from "../lib/slack.js";
import type { Client } from "@notionhq/client";

/** Tab in the Forecast Dashboard sheet that holds the tidy fact table. */
const FACTS_TAB = "Forecast Facts";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function rebuild(notion: Client): Promise<{ segments: number; rows: number; committed: number; weighted: number }> {
  const sheetId = process.env.FORECAST_SHEET_ID;
  if (!sheetId) throw new Error("FORECAST_SHEET_ID not set");

  const segments = await readSegments(notion);
  const facts = computeFacts(segments);
  const grid = factsToGrid(facts);

  const token = await googleAuth.accessToken();
  await replaceTab(token, sheetId, FACTS_TAB, grid);

  const committed = facts.reduce((s, r) => s + r.committed, 0);
  const weighted = facts.reduce((s, r) => s + r.weighted, 0);
  return { segments: segments.length, rows: facts.length, committed, weighted };
}

worker.webhook("rebuildForecast", {
  title: "Rebuild Forecast",
  description:
    "Rebuilds the monthly revenue fact table: reads Deal Revenue Schedules, spreads each segment across " +
    "calendar months (committed + weighted), and writes the 'Forecast Facts' tab of the Forecast Dashboard sheet.",
  execute: async (events, { notion }) => {
    for (const event of events) {
      if (process.env.FORECAST_DEBUG === "true") {
        console.log(`[forecast] DEBUG delivery ${event.deliveryId} method=${event.method}`);
      }
      try {
        const r = await rebuild(notion);
        const msg =
          `:bar_chart: *Forecast rebuilt* — ${r.rows} monthly rows from ${r.segments} segments ` +
          `(${MIN_MONTH}…${MAX_MONTH}). Committed ${money(r.committed)}, Weighted ${money(r.weighted)}.`;
        console.log(`[forecast] ${msg}`);
        await postForecastOps(msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] rebuild failed:", err);
        await postForecastOps(`:x: *Forecast rebuild failed*: ${m}`);
      }
    }
  },
});
