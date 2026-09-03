# Forecast → Sheet Worker

A [Notion Worker](https://developers.notion.com) (forked from `notion-worker-dppt`) that
builds a **monthly revenue forecast** and writes it into the **Forecast Dashboard** Google
Sheet as a tidy fact table, so native Sheet **pivot tables** produce every view. Replaces
the twice-weekly make.com scenario.

## What it does

1. **Reads** the **Deal Revenue Schedules** Notion DB (`37bf6504…`) — every attribute we
   need is a scalar / plain-text / direct-formula field, so one paged query suffices.
2. **Spreads** each non-archived segment across the calendar months of its
   `[Start, Computed End)` window by **calendar-day proration**
   (`Weekly Revenue × days-in-month ÷ 7`). Two figures per row:
   - **Committed $** — the monthly $ when the deal is Won (Stage Probability = 100%), else 0
   - **Weighted $** — the monthly $ × **Stage Probability**
3. **Writes** a tidy fact table to the `Forecast Facts` tab (clear + rewrite):
   `Month | Deal | Client Account | Client Partner | Stage | Delivery Phase | Billing Basis | Committed $ | Weighted $`
4. Posts a run summary / errors to **#forecast-ops**.

Pivots over `Forecast Facts` give the four views (by **Stage**, **Client Account**,
**Delivery Phase**, **company total**), months as columns, Committed vs Weighted, over any
horizon (this-month+12 and +24 are column ranges).

Bounds: months clamp to `MIN_MONTH`…`MAX_MONTH` (2026-01…2028-12) in `src/lib/forecast.ts`.

## Layout

```
src/
  worker.ts                 Worker instance, Google OAuth (read/write Sheets), pacer
  index.ts                  Registers the webhook
  lib/
    forecast.ts             Calendar-day proration → fact rows (+ forecast.test.ts)
    notionForecast.ts       Read Deal Revenue Schedules → Segment[]
    sheets.ts               ensureTab / clearValues / writeValues / replaceTab
    slack.ts                #forecast-ops notifier (bot token)
    notionProps.ts, dates.ts, retry.ts, errors.ts   (shared helpers)
  webhooks/
    rebuildForecast.ts      Full rebuild (button / scheduled). Payload ignored.
```

## Setup (one-time)

1. `nvm use` (Node 22), `npm install`, `ntn login`, `ntn workers deploy`.
2. **Google OAuth** — reuse the DPPT worker's OAuth client (same Notion redirect URL):
   `ntn workers env set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`, `ntn workers deploy`,
   then `ntn workers oauth start googleAuth`. The experimental sheet must be readable/
   writable by that Google account (Andon owns it).
3. **Notion** — `ntn workers env set NOTION_API_TOKEN=ntn_…` (the DPPT Parser integration),
   and **connect that integration to the Deal Revenue Schedules DB**.
4. **Slack** — `ntn workers env set SLACK_BOT_TOKEN=xoxb-… SLACK_FORECAST_OPS_CHANNEL=C0BUQ3GAGBX`
   (BlueLabel Bot already in #forecast-ops).
5. **Sheet** — `ntn workers env set FORECAST_SHEET_ID=11B2nldq0THoy_NYhBa7ZAFeb8YWKwn2l_0Rtd0toGyY`
   (the **experimental** copy — never the original `16LrGoX…`).
6. Add a **Rebuild Forecast** button (Send webhook → the `rebuildForecast` URL) and, for
   the schedule, ping that URL ~2×/week.

## Dev

```bash
npm run typecheck
npm run test:forecast
npm run dev
```

## Open / next

- **Scheduling** mechanism (worker schedule vs external cron hitting the webhook).
- **Pivot tables** built once over `Forecast Facts` for the four views + horizons.
- **Reconciliation**: compare monthly→quarterly roll-ups to the current `2026.Qx` totals.
- Effective Probability (vs Stage Probability) as a future weighting option.
