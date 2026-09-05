/**
 * Push HTML into a Notion embed on a page via the integration token.
 *
 * Notion quirk: an `embed` block can be CREATED backed by a file_upload
 * (`embed.file_upload`), but it canNOT be UPDATED to a new file_upload (block
 * PATCH only accepts `embed.url`). And uploads are immutable. So each refresh =
 * upload a new file, delete the old funnel embed, and insert a fresh one at the
 * same spot (right after a stable anchor block). No cross-run state needed.
 */

const NOTION = "https://api.notion.com/v1";
const VERSION = "2026-03-11";

function headers(token: string, json = true): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, ...(json ? { "Content-Type": "application/json" } : {}) };
}

/** Upload an HTML string to Notion; returns the file_upload id (status "uploaded"). */
export async function uploadHtml(token: string, html: string, filename: string): Promise<string> {
  const create = await fetch(`${NOTION}/file_uploads`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ filename, content_type: "text/html" }),
  });
  if (!create.ok) throw new Error(`file_uploads create ${create.status}: ${await create.text()}`);
  const { id, upload_url } = (await create.json()) as { id: string; upload_url: string };

  const form = new FormData();
  form.append("file", new Blob([html], { type: "text/html" }), filename);
  const send = await fetch(upload_url, { method: "POST", headers: headers(token, false), body: form });
  if (!send.ok) throw new Error(`file_uploads send ${send.status}: ${await send.text()}`);
  const sent = (await send.json()) as { status?: string };
  if (sent.status !== "uploaded") throw new Error(`file upload status=${sent.status}`);
  return id;
}

export type ReplaceResult = { blockId: string; deletedOld: number; usedAnchor: boolean };

/**
 * Replace the funnel embed: delete every embed positioned AFTER `anchorId` (the
 * previous funnel[s]) and append a fresh file-backed embed at the page end — which,
 * with the funnel as the last block, keeps it right after the anchor. The API
 * version doesn't support positional `after`, so we rely on append-at-end order.
 * If the anchor is missing we still append, but delete nothing (usedAnchor=false).
 */
export async function replaceFunnelEmbed(token: string, pageId: string, anchorId: string, fileUploadId: string): Promise<ReplaceResult> {
  const list = await fetch(`${NOTION}/blocks/${pageId}/children?page_size=100`, { headers: headers(token, false) });
  if (!list.ok) throw new Error(`list children ${list.status}: ${await list.text()}`);
  const blocks = ((await list.json()) as { results?: { id: string; type: string }[] }).results ?? [];

  const ai = blocks.findIndex((b) => b.id === anchorId);
  let deletedOld = 0;
  if (ai >= 0) {
    for (const b of blocks.slice(ai + 1)) {
      if (b.type !== "embed") continue;
      const del = await fetch(`${NOTION}/blocks/${b.id}`, { method: "DELETE", headers: headers(token, false) });
      if (del.ok) deletedOld += 1;
    }
  }

  const body = { children: [{ type: "embed", embed: { type: "file_upload", file_upload: { id: fileUploadId } } }] };
  const res = await fetch(`${NOTION}/blocks/${pageId}/children`, { method: "PATCH", headers: headers(token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`insert embed ${res.status}: ${await res.text()}`);
  const newId = ((await res.json()) as { results?: { id?: string }[] }).results?.[0]?.id ?? "";
  return { blockId: newId, deletedOld, usedAnchor: ai >= 0 };
}
