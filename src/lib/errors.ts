/**
 * Normalized error shape for anything that can go wrong when calling the
 * Google Sheets API. Nothing else in this worker should throw a bare Error or
 * leak a raw fetch Response — every failure gets wrapped in this so the caller
 * (the webhook's execute()) can decide: retry, log, or fail loudly.
 */

export type SheetsErrorKind =
  | "auth" // 401 - missing/expired/invalid token
  | "forbidden" // 403 - token valid, insufficient permissions / API not enabled
  | "not_found" // 404 - spreadsheet or tab not found
  | "validation" // 400 - bad range / request
  | "rate_limited" // 429
  | "server" // 5xx
  | "network" // fetch threw: DNS, timeout, connection reset, etc.
  | "unexpected"; // anything that doesn't fit the above

export class SheetsApiError extends Error {
  readonly kind: SheetsErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  /** Present on 429/503 responses when the server sends a Retry-After header. */
  readonly retryAfterMs: number | null;
  readonly endpoint: string;

  constructor(params: {
    kind: SheetsErrorKind;
    message: string;
    status?: number | null;
    retryAfterMs?: number | null;
    endpoint: string;
  }) {
    super(params.message);
    this.name = "SheetsApiError";
    this.kind = params.kind;
    this.status = params.status ?? null;
    this.retryAfterMs = params.retryAfterMs ?? null;
    this.endpoint = params.endpoint;
    this.retryable = params.kind === "rate_limited" || params.kind === "server" || params.kind === "network";
  }
}

/** Thrown for problems caught before ever calling the network (e.g. a URL with no spreadsheet id). */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** Map an HTTP status to a SheetsErrorKind. */
export function kindFromStatus(status: number): SheetsErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unexpected";
}
