/**
 * Resilience helpers shared by the Sheets-writing webhooks:
 *
 *   • withSheetsAuthRetry — a transient Sheets 401 (a momentary token blip, as seen when a
 *     teammate triggered a render mid-refresh) refreshes the token and retries the whole
 *     operation once. Renders/snapshots are idempotent, so a full replay is safe.
 *
 *   • acquire/releaseRenderLock — a best-effort, self-expiring cross-invocation lock stored in a
 *     cell of a hidden "_forecast_lock" tab, so two people clicking Render seconds apart don't
 *     render on top of each other. Not a perfect mutex — the read-then-write window is ~1s — but
 *     it collapses the common double-click / two-user overlap, and a crashed render's lock expires
 *     after LOCK_TTL_MS so it can never deadlock.
 */

import { SheetsApiError } from "./errors.js";
import { getSheetMeta, getValuesUnformatted, writeValues, batchUpdate } from "./sheets.js";

const LOCK_TAB = "_forecast_lock";
const LOCK_CELL = `${LOCK_TAB}!A1`;
/** A render takes ~15s; 90s covers a slow one, after which a stale lock is ignored (auto-expires). */
const LOCK_TTL_MS = 90_000;

/** Run fn(token); if a Sheets call fails auth (401), wait briefly, get a fresh token, and retry once. */
export async function withSheetsAuthRetry<T>(getToken: () => Promise<string>, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getToken());
  } catch (err) {
    if (err instanceof SheetsApiError && err.kind === "auth") {
      console.warn("[forecast] Sheets 401 — refreshing token and retrying once");
      await new Promise((r) => setTimeout(r, 1500));
      return await fn(await getToken()); // fresh token, one retry
    }
    throw err;
  }
}

/** Ensure the hidden single-cell lock tab exists; return its sheetId. */
async function ensureLockTab(token: string, sheetId: string): Promise<number> {
  const meta = await getSheetMeta(token, sheetId);
  const found = meta.find((m) => m.title === LOCK_TAB);
  if (found) return found.sheetId;
  const resp = (await batchUpdate(token, sheetId, [
    { addSheet: { properties: { title: LOCK_TAB, hidden: true, gridProperties: { rowCount: 1, columnCount: 1 } } } },
  ])) as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
  return resp.replies?.[0]?.addSheet?.properties?.sheetId ?? -1;
}

/**
 * Try to take the render lock. Returns true if acquired — the caller should render, then call
 * releaseRenderLock in a finally. Returns false if another render started within LOCK_TTL_MS, in
 * which case the caller should skip (that other render produces the same output).
 */
export async function acquireRenderLock(token: string, sheetId: string): Promise<boolean> {
  await ensureLockTab(token, sheetId);
  const cur = await getValuesUnformatted(token, sheetId, LOCK_CELL);
  const ts = Number(cur?.[0]?.[0] ?? 0);
  if (Number.isFinite(ts) && ts > 0 && Date.now() - ts < LOCK_TTL_MS) return false; // another render in flight
  await writeValues(token, sheetId, LOCK_CELL, [[Date.now()]], "RAW");
  return true;
}

/** Release the render lock (best-effort; a failure is harmless — the TTL is the backstop). */
export async function releaseRenderLock(token: string, sheetId: string): Promise<void> {
  try {
    await writeValues(token, sheetId, LOCK_CELL, [[""]], "RAW");
  } catch {
    /* ignore — the lock self-expires via LOCK_TTL_MS */
  }
}
