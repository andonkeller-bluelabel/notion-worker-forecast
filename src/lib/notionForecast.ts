/**
 * Reads the "Deal Revenue Schedules" Notion DB and maps each non-archived row
 * into a forecast `Segment`. Every field we need is exposed on the schedule item
 * as a scalar / plain-text / direct-formula property, so a single paged query
 * suffices and we avoid the flaky rollup-people API shape.
 */

import type { Client } from "@notionhq/client";
import { notionPropertyToDate, notionPropertyToString } from "./notionProps.js";
import type { Segment } from "./forecast.js";

/** Deal Revenue Schedules data source (collection) id. */
export const DEAL_REVENUE_SCHEDULES_DS = "37bf6504-1608-4bf0-af10-c6e5123cc618";

type Props = Record<string, unknown>;

/** Read a numeric value from number / formula-number / rollup-number properties. */
function numberOf(prop: unknown): number {
  if (!prop || typeof prop !== "object") return 0;
  const p = prop as Record<string, unknown>;
  if (p.type === "number" && typeof p.number === "number") return p.number;
  if (p.type === "formula") {
    const f = p.formula as Record<string, unknown> | undefined;
    if (f?.type === "number" && typeof f.number === "number") return f.number;
  }
  if (p.type === "rollup") {
    const r = p.rollup as Record<string, unknown> | undefined;
    if (r?.type === "number" && typeof r.number === "number") return r.number;
    if (Array.isArray(r?.array)) {
      for (const item of r!.array as unknown[]) {
        const n = numberOf(item);
        if (n) return n;
      }
    }
  }
  return 0;
}

/** Select name from select / rollup-of-select (e.g. Deal Stage) properties. */
function selectName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if (p.type === "select") return (p.select as { name?: string } | null)?.name ?? "";
  if (p.type === "status") return (p.status as { name?: string } | null)?.name ?? "";
  if (p.type === "rollup") {
    const r = p.rollup as Record<string, unknown> | undefined;
    if (Array.isArray(r?.array)) {
      for (const item of r!.array as unknown[]) {
        const s = selectName(item);
        if (s) return s;
        const t = notionPropertyToString(item);
        if (t) return t;
      }
    }
  }
  return "";
}

/** Joined multi-select names, e.g. "Discover, Deploy". */
function multiSelectNames(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if (p.type === "multi_select" && Array.isArray(p.multi_select)) {
    return (p.multi_select as { name?: string }[]).map((o) => o.name ?? "").filter(Boolean).join(", ");
  }
  return "";
}

const P = {
  deal: "Deal",
  dealTitle: "Deal Title",
  clientAccount: "Client Account (Plain Text)",
  clientPartner: "Client Partner (Plain Text)",
  stage: "Deal Stage",
  contractType: "Deal Contract Type",
  deliveryPhase: "Delivery Phase",
  billingBasis: "Billing Basis",
  weeklyRevenue: "Weekly Revenue",
  start: "Start Date",
  end: "Computed End Date (Exclusive)",
  stageProbability: "Deal Stage Percent (Filter)",
  archived: "Archived",
} as const;

/** First related page id from a relation property. */
function relationId(prop: unknown): string {
  const p = prop as { type?: string; relation?: { id?: string }[] } | undefined;
  return p?.type === "relation" && p.relation?.[0]?.id ? p.relation[0].id : "";
}

function toSegment(props: Props): Segment {
  const dealId = relationId(props[P.deal]);
  return {
    dealId,
    dealTitle: notionPropertyToString(props[P.dealTitle]) ?? "",
    dealUrl: dealId ? `https://www.notion.so/${dealId.replace(/-/g, "")}` : "",
    clientAccount: notionPropertyToString(props[P.clientAccount]) ?? "",
    clientPartner: notionPropertyToString(props[P.clientPartner]) ?? "",
    stage: selectName(props[P.stage]),
    contractType: selectName(props[P.contractType]),
    deliveryPhase: multiSelectNames(props[P.deliveryPhase]),
    billingBasis: selectName(props[P.billingBasis]),
    weeklyRevenue: numberOf(props[P.weeklyRevenue]),
    start: notionPropertyToDate(props[P.start]),
    end: notionPropertyToDate(props[P.end]),
    stageProbability: numberOf(props[P.stageProbability]),
  };
}

/** Query every non-archived Deal Revenue Schedule row → Segment[]. */
export async function readSegments(notion: Client): Promise<Segment[]> {
  const out: Segment[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.dataSources.query({
      data_source_id: DEAL_REVENUE_SCHEDULES_DS,
      filter: { property: P.archived, checkbox: { equals: false } },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = (page as { properties?: Props }).properties;
      if (props) out.push(toSegment(props));
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}
