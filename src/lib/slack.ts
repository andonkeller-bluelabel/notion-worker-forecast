/**
 * Minimal Slack notifier — posts run summaries / errors to #forecast-ops via a
 * bot token (chat:write). Best-effort: logs and returns false on failure, never
 * throws. Configured via SLACK_BOT_TOKEN + SLACK_FORECAST_OPS_CHANNEL.
 */

/** #forecast-ops channel (id or name). */
export const FORECAST_OPS_CHANNEL = process.env.SLACK_FORECAST_OPS_CHANNEL || "#forecast-ops";

/** Post a message to a Slack channel (by id or name) via chat.postMessage. */
export async function postToChannel(channel: string, text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(`[forecast] SLACK_BOT_TOKEN not set — skipping Slack message to ${channel}: ${text}`);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, text, unfurl_links: false }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!body.ok) {
        console.error(`[forecast] chat.postMessage to ${channel} failed: ${body.error ?? res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error(`[forecast] failed to post Slack message to ${channel}:`, err);
    return false;
  }
}

/** Post to #forecast-ops. */
export async function postForecastOps(text: string): Promise<void> {
  await postToChannel(FORECAST_OPS_CHANNEL, text);
}
