/**
 * Reads Google Sheets comments (Drive-level) on the forecast spreadsheet, so the
 * worker can surface the user's in-sheet comments. Requires the drive.readonly
 * OAuth scope (re-authorize after adding it). Optional INSPECT_TAB filters nothing
 * here — comments span the whole file. Payload ignored.
 */

import { worker, googleAuth } from "../worker.js";

worker.webhook("readComments", {
  title: "Read Sheet Comments",
  description: "Lists Google Sheets comments on the forecast spreadsheet (needs drive.readonly scope).",
  execute: async () => {
    const sheetId = process.env.FORECAST_SHEET_ID!;
    const token = await googleAuth.accessToken();
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}/comments` +
      `?fields=${encodeURIComponent("comments(content,quotedFileContent/value,anchor,resolved,author/displayName,replies(content,author/displayName))")}&pageSize=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) {
      console.log(`[comments] status=${res.status} — ${(await res.text()).slice(0, 300)}`);
      return;
    }
    const body = (await res.json()) as {
      comments?: { content?: string; quotedFileContent?: { value?: string }; anchor?: string; resolved?: boolean; author?: { displayName?: string }; replies?: { content?: string }[] }[];
    };
    console.log(`[comments] count=${body.comments?.length ?? 0}`);
    for (const c of body.comments ?? []) {
      const quoted = c.quotedFileContent?.value ? ` on "${c.quotedFileContent.value}"` : "";
      const replies = (c.replies ?? []).map((r) => ` ↳ ${r.content}`).join("");
      console.log(`[comment]${c.resolved ? " (resolved)" : ""}${quoted} anchor=${c.anchor ?? ""}: ${c.content}${replies}`);
    }
  },
});
