/**
 * Push HTML reports into Notion embeds that the user can freely drag around.
 *
 * Notion constraints (verified against API version 2026-03-11):
 *   • An embed block can be CREATED backed by a file_upload, but NOT updated to a
 *     new one (block PATCH rejects `embed.file_upload`), and uploads are immutable.
 *   • append-children has no positional `after` — new blocks land at the parent's END.
 * So "update" = upload a new file, make a new embed, drop the old one. Done naively
 * (recreate as a page child) the embed jumps to the page bottom every refresh, undoing
 * any manual placement.
 *
 * Fix: keep each report's embed inside its own **synced-block container**. We locate a
 * report by the filename in its embed URL (wherever it now lives), then swap the embed
 * by appending the fresh one to that CONTAINER and deleting the old inner embed. The
 * container is never moved or recreated, so it stays exactly where the user dragged it.
 * First run (or a bare legacy embed) creates the container at the page end — drag it once.
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

type Block = { id: string; type: string; has_children?: boolean; embed?: { url?: string } };
const embedChild = (fileUploadId: string) => ({ type: "embed", embed: { type: "file_upload", file_upload: { id: fileUploadId } } });

async function listChildren(token: string, blockId: string): Promise<Block[]> {
  const out: Block[] = [];
  let cursor: string | undefined;
  do {
    const url = `${NOTION}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: headers(token, false) });
    if (!r.ok) throw new Error(`list children ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { results?: Block[]; has_more?: boolean; next_cursor?: string | null };
    out.push(...(j.results ?? []));
    cursor = j.has_more ? (j.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function appendChild(token: string, parentId: string, child: unknown): Promise<string> {
  const r = await fetch(`${NOTION}/blocks/${parentId}/children`, { method: "PATCH", headers: headers(token), body: JSON.stringify({ children: [child] }) });
  if (!r.ok) throw new Error(`append child ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { results?: { id?: string }[] }).results?.[0]?.id ?? "";
}

async function deleteBlock(token: string, id: string): Promise<boolean> {
  const r = await fetch(`${NOTION}/blocks/${id}`, { method: "DELETE", headers: headers(token, false) });
  return r.ok;
}

type FoundEmbed = { embedId: string; parentId: string; parentIsPage: boolean; filename: string };

/** Walk the page's block tree (bounded depth) and collect every embed whose URL names one of `filenames`. */
async function findReportEmbeds(token: string, pageId: string, filenames: string[]): Promise<FoundEmbed[]> {
  const out: FoundEmbed[] = [];
  async function walk(parentId: string, depth: number): Promise<void> {
    if (depth > 3) return;
    for (const b of await listChildren(token, parentId)) {
      if (b.type === "embed") {
        const url = b.embed?.url ?? "";
        const filename = filenames.find((f) => url.includes(f));
        if (filename) out.push({ embedId: b.id, parentId, parentIsPage: parentId === pageId, filename });
      } else if (b.has_children) {
        await walk(b.id, depth + 1);
      }
    }
  }
  await walk(pageId, 0);
  return out;
}

/** Create a synced-block container (the embed inside) at the page end; return the container id. */
async function createContainer(token: string, pageId: string, fileUploadId: string): Promise<string> {
  return appendChild(token, pageId, { type: "synced_block", synced_block: { synced_from: null, children: [embedChild(fileUploadId)] } });
}

export type Report = { filename: string; fileUploadId: string };
export type SyncResult = { updated: string[]; created: string[]; migrated: string[]; deletedDupes: number };

/**
 * Idempotently point each report's embed at fresh HTML, preserving where the user put it:
 *   • in a container already  → swap the embed inside that container (container stays put)
 *   • bare top-level embed    → wrap in a new container at page end, drop the old (migrate)
 *   • absent                  → create a new container at page end (drag it into place once)
 * Extra embeds for the same report (e.g. a stale duplicate) are deleted.
 */
export async function syncReportEmbeds(token: string, pageId: string, reports: Report[]): Promise<SyncResult> {
  const res: SyncResult = { updated: [], created: [], migrated: [], deletedDupes: 0 };
  const found = await findReportEmbeds(token, pageId, reports.map((r) => r.filename));

  for (const rep of reports) {
    // Prefer an embed already inside a container; treat the rest as duplicates to remove.
    const matches = found.filter((f) => f.filename === rep.filename).sort((a, b) => Number(a.parentIsPage) - Number(b.parentIsPage));
    const primary = matches[0];
    for (const dupe of matches.slice(1)) if (await deleteBlock(token, dupe.embedId)) res.deletedDupes += 1;

    if (primary && !primary.parentIsPage) {
      await appendChild(token, primary.parentId, embedChild(rep.fileUploadId)); // add fresh inside the container…
      await deleteBlock(token, primary.embedId); // …then remove the stale one
      res.updated.push(rep.filename);
    } else {
      await createContainer(token, pageId, rep.fileUploadId);
      if (primary) { await deleteBlock(token, primary.embedId); res.migrated.push(rep.filename); }
      else res.created.push(rep.filename);
    }
  }
  return res;
}
