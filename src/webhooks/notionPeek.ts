/**
 * TEMPORARY — dumps the reporting page's block tree (containers + the embed inside
 * each, with its filename) so we can confirm the report embeds now live in draggable
 * synced-block containers and that refreshes swap the inner embed without moving the
 * container. Delete after use.
 */

import { worker } from "../worker.js";

const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const VERSION = "2026-03-11";
const H = (token: string) => ({ Authorization: `Bearer ${token}`, "Notion-Version": VERSION });

type Block = { id: string; type: string; has_children?: boolean; embed?: { url?: string } };
const fileOf = (b: Block) => (b.embed?.url?.match(/\/([^/?]+\.html)\?/)?.[1]) ?? "";

async function kids(token: string, id: string): Promise<Block[]> {
  const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, { headers: H(token) });
  return ((await r.json()) as { results?: Block[] }).results ?? [];
}

worker.webhook("notionPeek", {
  title: "Notion Peek (temp)",
  description: "Dumps the reporting page block tree. Temporary.",
  execute: async () => {
    const token = process.env.NOTION_API_TOKEN!;
    const top = await kids(token, PAGE_ID);
    console.log(`[peek] page children=${top.length}`);
    for (const b of top) {
      const label = b.type === "embed" ? `embed ${fileOf(b)}` : b.type;
      console.log(`[peek] • ${label} id=${b.id}`);
      if (b.type !== "embed" && b.has_children) {
        for (const c of await kids(token, b.id)) {
          console.log(`[peek]     └ ${c.type === "embed" ? `embed ${fileOf(c)}` : c.type} id=${c.id}`);
        }
      }
    }
  },
});
