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

/** Read a range's FORMATTED values (what the cells display). */
export async function getValues(token: string, spreadsheetId: string, a1Range: string): Promise<string[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(a1Range)}?valueRenderOption=FORMATTED_VALUE`;
  const json = await sheetsRequestJson<{ values?: string[][] }>(token, url, "values.get");
  return json.values ?? [];
}

/** Read [value, backgroundColor] for each cell in a single-column range. */
export async function getRangeValueFormats(
  token: string,
  spreadsheetId: string,
  a1Range: string,
): Promise<{ value: string; bg: unknown }[]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?ranges=${encodeURIComponent(a1Range)}` +
    `&fields=${encodeURIComponent("sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)")}`;
  const json = (await sheetsRequestJson(token, url, "spreadsheets.get.rangeVF")) as {
    sheets?: { data?: { rowData?: { values?: { formattedValue?: string; effectiveFormat?: { backgroundColor?: unknown } }[] }[] }[] }[];
  };
  const rows = json.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rows.map((r) => ({ value: r.values?.[0]?.formattedValue ?? "", bg: r.values?.[0]?.effectiveFormat?.backgroundColor ?? {} }));
}

/** Read the effective text/background format of a single cell (for matching colors). */
export async function getCellFormat(token: string, spreadsheetId: string, a1Range: string): Promise<unknown> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?ranges=${encodeURIComponent(a1Range)}` +
    `&fields=${encodeURIComponent("sheets.data.rowData.values.effectiveFormat(textFormat,backgroundColor)")}`;
  return sheetsRequestJson(token, url, "spreadsheets.get.cellFormat");
}

/** Read each column's pixel width for a tab (columnMetadata over A..P). */
export async function getColumnWidths(token: string, spreadsheetId: string, tab: string): Promise<number[]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?ranges=${encodeURIComponent(`${tab}!A1:P1`)}` +
    `&fields=${encodeURIComponent("sheets(data(columnMetadata(pixelSize)))")}`;
  const json = (await sheetsRequestJson(token, url, "spreadsheets.get.colWidths")) as {
    sheets?: { data?: { columnMetadata?: { pixelSize?: number }[] }[] }[];
  };
  return (json.sheets?.[0]?.data?.[0]?.columnMetadata ?? []).map((c) => c.pixelSize ?? 0);
}

/** Get a tab's structural facts: gridProperties (frozen/size), rowGroups, merges, conditional formats. */
export async function getSheetStructure(token: string, spreadsheetId: string): Promise<unknown> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?fields=${encodeURIComponent("sheets(properties(sheetId,title,gridProperties),rowGroups,merges,conditionalFormats)")}`;
  return sheetsRequestJson(token, url, "spreadsheets.get.structure");
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

/** Create a tab if it doesn't already exist; returns its sheetId either way. */
export async function ensureTab(token: string, spreadsheetId: string, title: string): Promise<number> {
  const meta = await getSheetMeta(token, spreadsheetId);
  const found = meta.find((m) => m.title === title);
  if (found) return found.sheetId;
  const resp = (await batchUpdate(token, spreadsheetId, [{ addSheet: { properties: { title } } }])) as {
    replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
  };
  return resp.replies?.[0]?.addSheet?.properties?.sheetId ?? -1;
}

/** Delete any of the given tabs by stable sheetId that still exist (safe across renames). */
export async function deleteTabsById(token: string, spreadsheetId: string, sheetIds: number[]): Promise<void> {
  const meta = await getSheetMeta(token, spreadsheetId);
  const present = new Set(meta.map((m) => m.sheetId));
  const ids = sheetIds.filter((id) => present.has(id));
  if (ids.length === 0) return;
  await batchUpdate(
    token,
    spreadsheetId,
    ids.map((sheetId) => ({ deleteSheet: { sheetId } })),
  );
}

/** Delete any of the named tabs that exist (best-effort cleanup). */
export async function deleteTabs(token: string, spreadsheetId: string, titles: string[]): Promise<void> {
  const meta = await getSheetMeta(token, spreadsheetId);
  const ids = meta.filter((m) => titles.includes(m.title)).map((m) => m.sheetId);
  if (ids.length === 0) return;
  await batchUpdate(
    token,
    spreadsheetId,
    ids.map((sheetId) => ({ deleteSheet: { sheetId } })),
  );
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
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW",
): Promise<void> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(a1Anchor)}?valueInputOption=${valueInputOption}`;
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
