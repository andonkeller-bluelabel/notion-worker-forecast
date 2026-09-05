/**
 * TEMPORARY — dumps the raw REST JSON of the Experimental Reporting page's child
 * blocks (esp. the two HTML embeds) so we can learn how Notion represents an
 * "embed of an uploaded HTML file" and replicate it from the worker. Delete after use.
 */

import { worker } from "../worker.js";

const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const NOTION_VERSION = "2022-06-28";

worker.webhook("notionPeek", {
  title: "Notion Peek (temp)",
  description: "Logs the raw block JSON of the reporting page. Temporary.",
  execute: async () => {
    const token = process.env.NOTION_API_TOKEN!;
    const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children?page_size=50`, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    });
    const body = (await res.json()) as { results?: unknown[] };
    console.log(`[peek] status=${res.status} count=${body.results?.length}`);
    for (const b of body.results ?? []) {
      const blk = b as { id?: string; type?: string };
      console.log(`[peek] block type=${blk.type} id=${blk.id}`);
      if (blk.type === "embed" || blk.type === "file") console.log(`[peek]   json=${JSON.stringify(b)}`);
    }
  },
});
