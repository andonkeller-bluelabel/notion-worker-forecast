/**
 * Helpers for pulling plain values out of Notion page-property objects, in both
 * the webhook delivery shape and the shape returned by `pages.retrieve`.
 */

/** Pull a plain string out of a Notion property object (url / rich_text / title / number / formula / rollup). */
export function notionPropertyToString(prop: unknown): string | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  const richish = (arr: unknown): string | null =>
    Array.isArray(arr) && arr.length > 0 && typeof (arr[0] as Record<string, unknown>)?.plain_text === "string"
      ? ((arr[0] as Record<string, unknown>).plain_text as string)
      : null;
  if (p.type === "url") return typeof p.url === "string" ? p.url : null;
  if (p.type === "rich_text") return richish(p.rich_text);
  if (p.type === "title") return richish(p.title);
  if (p.type === "number") return p.number != null ? String(p.number) : null;
  if (p.type === "formula") {
    const f = p.formula as Record<string, unknown> | undefined;
    if (f?.type === "string" && typeof f.string === "string") return f.string;
    if (f?.type === "number" && f.number != null) return String(f.number);
  }
  if (p.type === "rollup") {
    const roll = p.rollup as Record<string, unknown> | undefined;
    if (roll) {
      // An "array" rollup (e.g. a rolled-up url from a related page) holds
      // property-value-like items — resolve the first non-empty one recursively.
      if (Array.isArray(roll.array)) {
        for (const item of roll.array) {
          const v = notionPropertyToString(item);
          if (v) return v;
        }
      }
      if (roll.type === "url" && typeof roll.url === "string") return roll.url;
      if (roll.type === "number" && roll.number != null) return String(roll.number);
    }
    return null;
  }
  // Fallback: a bare string value keyed under the property.
  if (typeof p.url === "string") return p.url;
  return null;
}

/**
 * Pull an ISO date string ("YYYY-MM-DD") out of a Notion date-ish property:
 * a `date` property, a `formula` that returns a date, or a `rollup` whose items
 * resolve to a date. Returns the start date, or null. Written to survive the
 * "Start Date" property becoming a rollup later.
 */
export function notionPropertyToDate(prop: unknown): string | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  const startOf = (d: unknown): string | null => {
    const dd = d as Record<string, unknown> | undefined;
    return dd && typeof dd.start === "string" ? dd.start : null;
  };
  if (p.type === "date") return startOf(p.date);
  if (p.type === "formula") {
    const f = p.formula as Record<string, unknown> | undefined;
    if (f?.type === "date") return startOf(f.date);
  }
  if (p.type === "rollup") {
    const roll = p.rollup as Record<string, unknown> | undefined;
    if (roll) {
      if (roll.type === "date") return startOf(roll.date);
      if (Array.isArray(roll.array)) {
        for (const item of roll.array) {
          const v = notionPropertyToDate(item);
          if (v) return v;
        }
      }
    }
  }
  return null;
}

/**
 * Pull the user IDs out of a Notion people/person property (or a rollup whose
 * items are people). Returns the ids in order; the ids are always present even
 * when Notion omits the user's name/email (the API inconsistency we work around
 * by resolving each id via users.retrieve).
 */
export function notionPropertyToUserIds(prop: unknown): string[] {
  if (!prop || typeof prop !== "object") return [];
  const p = prop as Record<string, unknown>;
  const idsFrom = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .map((u) => (u && typeof u === "object" ? (u as Record<string, unknown>).id : undefined))
          .filter((id): id is string => typeof id === "string")
      : [];
  if (p.type === "people") return idsFrom(p.people);
  if (p.type === "rollup") {
    const roll = p.rollup as Record<string, unknown> | undefined;
    if (roll && Array.isArray(roll.array)) {
      return roll.array.flatMap((item) => notionPropertyToUserIds(item));
    }
  }
  return [];
}

/**
 * Return the first non-empty string value among the named properties, in order.
 * Used to prefer an override property over a fallback (e.g. "DPPT" then "Deal DPPT").
 */
export function firstNonEmptyProperty(
  props: Record<string, unknown> | undefined,
  names: string[],
): string | null {
  if (!props) return null;
  for (const name of names) {
    if (name in props) {
      const v = notionPropertyToString(props[name]);
      if (v) return v;
    }
  }
  return null;
}

/**
 * Given a webhook delivery body, return the Notion page id and the named
 * property value. Notion nests the clicked row under `data` for button/
 * automation "Send webhook" actions.
 */
export function extractPageContext(
  body: Record<string, unknown>,
  propertyName: string,
): { pageId: string | null; propertyValue: string | null } {
  const page = (body.data as Record<string, unknown> | undefined) ?? body;
  const pageId = typeof page?.id === "string" ? page.id : null;
  const props = page?.properties as Record<string, unknown> | undefined;
  let propertyValue: string | null = null;
  if (props && propertyName in props) {
    propertyValue = notionPropertyToString(props[propertyName]);
  }
  return { pageId, propertyValue };
}
