/**
 * TEMPORARY — computes and dumps the gap-simulator data (client revenue-arc templates
 * + current per-quarter baseline) as JSON, to seed the simulator prototype. Delete after use.
 */

import { worker } from "../worker.js";
import { readSegments, readTargets, readStageCycles } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { buildTemplates, buildBaseline } from "../lib/simulator.js";
import { quartersRange } from "../lib/forecast.js";

worker.webhook("notionPeek", {
  title: "Sim Data Dump (temp)",
  description: "Dumps simulator templates + baseline. Temporary.",
  execute: async (_events, { notion }) => {
    const wonSegs = await readSegments(notion, { includeArchived: true });
    let cycles = new Map<string, { first: string; won: string | null }>();
    try { cycles = await readStageCycles(notion); } catch (e) { console.log(`[sim] stage cycles unavailable (share the Deal Stage Changes DB): ${e instanceof Error ? e.message : e}`); }
    const templates = buildTemplates(wonSegs, cycles);
    const active = aggregateDeals(await readSegments(notion));
    const targets = await readTargets(notion);
    const baseline = buildBaseline(active, targets, quartersRange());
    console.log(`[sim] templates=${templates.length} · stageCycles=${cycles.size}`);
    templates.forEach((t) => console.log(`[sim]   ${t.name} · $${t.total.toLocaleString()} · ${t.deals} deals · cycle=${t.cycleWeeks ?? "?"}w · landed ${t.landedWon ?? "?"} · arc[${t.arc.length}]`));
    console.log(`[sim] TEMPLATES=${JSON.stringify(templates)}`);
    console.log(`[sim] BASELINE=${JSON.stringify(baseline)}`);
  },
});
