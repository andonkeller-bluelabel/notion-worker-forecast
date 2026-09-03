/**
 * Shared Worker instance, Google OAuth capability, and pacer.
 *
 * Forked from notion-worker-dppt. This worker reads the Deal Revenue Schedules
 * Notion DB (via the Notion client provided in each capability's context) and
 * WRITES a monthly-revenue fact table into the Forecast Dashboard Google Sheet.
 *
 * Every other file imports `worker`, `googleAuth`, and `sheetsPacer` from here.
 */

import { Worker } from "@notionhq/workers";

export const worker = new Worker();

/**
 * Google Sheets is read/written with a user-managed OAuth 2.0 app. Authorize
 * once as yourself; the runtime stores/refreshes the token.
 *
 * Setup (see README.md):
 *   1. `ntn workers deploy`                    (registers the worker)
 *   2. `ntn workers oauth show-redirect-url`    (callback URL)
 *   3. Google Cloud → Credentials → OAuth client (Web app) with that redirect;
 *      enable the Google Sheets API.
 *   4. `ntn workers env set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`
 *   5. `ntn workers deploy` again
 *   6. `ntn workers oauth start googleAuth`     (one-time authorization)
 *
 * Scope is read/write on Sheets (the worker clears + writes the fact-table tab).
 */
export const googleAuth = worker.oauth("googleAuth", {
  name: "google-sheets-oauth",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  scope: "https://www.googleapis.com/auth/spreadsheets",
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  authorizationParams: { access_type: "offline", prompt: "consent" },
});

/** Conservative shared budget for Sheets writes (a rebuild does a clear + one write). */
export const sheetsPacer = worker.pacer("googleSheets", {
  allowedRequests: 5,
  intervalMs: 1000,
});
