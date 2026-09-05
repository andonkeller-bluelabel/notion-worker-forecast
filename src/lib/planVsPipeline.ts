/**
 * Plan-vs-pipeline math: per quarter, split the (prorated) forecast into
 *   • Signed      — 100%/won deals (weighted == raw)
 *   • Continuation — sub-100% deals on an account that ALREADY has a won deal
 *                    (existing client generating more), weighted + unweighted
 *   • Net-new     — sub-100% deals on an account with NO won deal yet
 *                    (their first win would be net-new business), weighted + unweighted
 * against the quarter's revenue target. Restricted to quarters that have a target.
 */

import { spreadSegment, monthToQuarter, type Segment } from "./forecast.js";

export type PlanRow = {
  q: string;
  target: number;
  signed: number; // weighted (== raw) of 100% deals
  contW: number; // continuation, weighted
  newW: number; // net-new, weighted
  contU: number; // continuation, unweighted (gross)
  newU: number; // net-new, unweighted (gross)
};

const isWon = (s: Segment) => s.stageProbability >= 0.999;

export function computePlanRows(segments: Segment[], targets: Map<string, number>): PlanRow[] {
  // Accounts that already hold a closed-won deal.
  const wonAccounts = new Set<string>();
  for (const s of segments) if (isWon(s) && s.clientAccount) wonAccounts.add(s.clientAccount);

  const rows = new Map<string, PlanRow>();
  for (const [q, target] of targets) rows.set(q, { q, target, signed: 0, contW: 0, newW: 0, contU: 0, newU: 0 });

  for (const s of segments) {
    const signed = isWon(s);
    const continuation = !signed && wonAccounts.has(s.clientAccount);
    for (const c of spreadSegment(s)) {
      const r = rows.get(monthToQuarter(c.month));
      if (!r) continue; // outside the target window
      if (signed) r.signed += c.weighted;
      else if (continuation) {
        r.contW += c.weighted;
        r.contU += c.amount;
      } else {
        r.newW += c.weighted;
        r.newU += c.amount;
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.q.localeCompare(b.q));
}
