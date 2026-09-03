/**
 * Minimal Google Sheets API v4 client — enough to (re)write a fact-table tab:
 * ensure the tab exists, clear it, and write a 2D value grid. Auth is a bearer
 * token from the shared googleAuth capability.
 */

import { SheetsApiError, kindFromStatus } from "./errors.js";
import { withRetries } from "./retry.js";
import { sheetsPacer } from "../worker.js";

/** A 2D value grid (row-major). Cells may be strings or numbers. */
export type ValueGrid = (string | number)[][];

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

/** Send a Sheets API request as JSON, with pacing, timeout, retry, and error normalization. */
async function sheetsRequestJson<T>(
  token: string,
  url: string,
  endpoint: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  return withRetries(async () => {
    // Best-effort rate limiting: the pacer's state isn't present in every
    // execution context (e.g. webhook handlers), where wait() throws.
    try {
      await sheetsPacer.wait();
    } catch {
      /* pacer unavailable in this context — proceed unthrottled */
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new SheetsApiError({
        kind: "network",
        message: `Network error calling Sheets API: ${err instanceof Error ? err.message : String(err)}`,
        endpoint,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body?.error?.message ? ` — ${body.error.message}` : "";
      } catch {
        /* non-JSON error body */
      }
      throw new SheetsApiError({
        kind: kindFromStatus(res.status),
        message: `Sheets API returned ${res.status}${detail}`,
        status: res.status,
        retryAfterMs: retryAfterMs(res),
        endpoint,
      });
    }

    return (await res.json()) as T;
  });
}

/** The set of tab titles in a spreadsheet. */
export async function getSheetTitles(token: string, spreadsheetId: string): Promise<Set<string>> {
  const meta = await getSheetMeta(token, spreadsheetId);
  return new Set(meta.map((m) => m.title));
}

/** Tab title → numeric sheetId (needed to target pivots / grid ranges). */
export async function getSheetMeta(token: string, spreadsheetId: string): Promise<{ title: string; sheetId: number }[]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?fields=sheets.properties(sheetId,title)`;
  const json = await sheetsRequestJson<{ sheets?: { properties?: { sheetId?: number; title?: string } }[] }>(
    token,
    url,
    "spreadsheets.get",
  );
  const out: { title: string; sheetId: number }[] = [];
  for (const s of json.sheets ?? []) {
    if (s.properties?.title && typeof s.properties.sheetId === "number") {
      out.push({ title: s.properties.title, sheetId: s.properties.sheetId });
    }
  }
  return out;
}

/** Run a spreadsheets.batchUpdate with arbitrary requests; returns the raw reply. */
export async function batchUpdate(
  token: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<{ replies?: unknown[] }> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  return sheetsRequestJson(token, url, "spreadsheets.batchUpdate", { method: "POST", body: { requests } });
}

/** Create a tab if it doesn't already exist. */
export async function ensureTab(token: string, spreadsheetId: string, title: string): Promise<void> {
  const titles = await getSheetTitles(token, spreadsheetId);
  if (titles.has(title)) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  await sheetsRequestJson(token, url, "spreadsheets.batchUpdate", {
    method: "POST",
    body: { requests: [{ addSheet: { properties: { title } } }] },
  });
}

/** Clear all values in an A1 range (e.g. a whole tab: "Forecast Facts"). */
export async function clearValues(token: string, spreadsheetId: string, a1Range: string): Promise<void> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(a1Range)}:clear`;
  await sheetsRequestJson(token, url, "values.clear", { method: "POST", body: {} });
}

/**
 * Write a 2D grid starting at `a1Anchor` (e.g. "Forecast Facts!A1") with
 * valueInputOption=RAW, so numbers stay numbers and strings stay literal.
 */
export async function writeValues(
  token: string,
  spreadsheetId: string,
  a1Anchor: string,
  values: ValueGrid,
): Promise<void> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(a1Anchor)}?valueInputOption=RAW`;
  await sheetsRequestJson(token, url, "values.update", { method: "PUT", body: { values } });
}

/** Convenience: ensure the tab exists, clear it, and write the grid at A1. */
export async function replaceTab(
  token: string,
  spreadsheetId: string,
  tab: string,
  values: ValueGrid,
): Promise<void> {
  await ensureTab(token, spreadsheetId, tab);
  await clearValues(token, spreadsheetId, tab);
  await writeValues(token, spreadsheetId, `${tab}!A1`, values);
}
