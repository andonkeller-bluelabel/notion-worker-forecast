/**
 * TEMPORARY inspector — dumps the structure of a tab (row groups, frozen panes,
 * merges) and its first columns of formatted values, so we can replicate a
 * hand-adjusted layout exactly. Delete after use.
 */

import { worker, googleAuth } from "../worker.js";
import { getSheetStructure, getValues, getCellFormat, getRangeValueFormats } from "../lib/sheets.js";

const TAB = process.env.INSPECT_TAB || "By Client — Quarterly";

worker.webhook("inspectSheet", {
  title: "Inspect Sheet (temp)",
  description: "Logs row groups / frozen / merges and the first columns of a tab. Temporary.",
  execute: async () => {
    const sheetId = process.env.FORECAST_SHEET_ID!;
    const token = await googleAuth.accessToken();
    const struct = (await getSheetStructure(token, sheetId)) as {
      sheets?: { properties?: { title?: string; sheetId?: number; gridProperties?: unknown }; rowGroups?: unknown; merges?: unknown }[];
    };
    console.log(`[inspect] ALL TABS=${JSON.stringify((struct.sheets ?? []).map((x) => x.properties?.title))}`);
    const s = (struct.sheets ?? []).find((x) => x.properties?.title === TAB);
    console.log(`[inspect] TAB="${TAB}"`);
    console.log(`[inspect] gridProperties=${JSON.stringify(s?.properties?.gridProperties)}`);
    console.log(`[inspect] rowGroups=${JSON.stringify(s?.rowGroups)}`);
    console.log(`[inspect] merges=${JSON.stringify(s?.merges)}`);
    // First 4 columns of values (labels + probability/deal/contract), up to row 70.
    const vals = await getValues(token, sheetId, `${TAB}!A1:D70`);
    console.log(`[inspect] valuesA1D70=${JSON.stringify(vals)}`);
    // Full header row across many columns to see the column order.
    const header = await getValues(token, sheetId, `${TAB}!1:1`);
    console.log(`[inspect] header=${JSON.stringify(header[0])}`);
    // Contract Format cell format (to match the grey the user applied). C = By Client, D = By Stage.
    // Column A label + background for each row (to capture per-group colors).
    const colA = await getRangeValueFormats(token, sheetId, `${TAB}!A1:A80`);
    for (const r of colA) {
      if (r.value && Object.keys(r.bg as object).length) console.log(`[inspect] rowA "${r.value}" bg=${JSON.stringify(r.bg)}`);
    }
  },
});
