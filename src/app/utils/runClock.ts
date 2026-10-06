const KEY = (threadId: string) => `run-started:${threadId}`;
const STREAM_KEY = (threadId: string) => `lg:stream:${threadId}`;
const ACTIVITY_KEY = (threadId: string) => `activity-since:${threadId}`;

/** Offset already present: `Z` or `±hh:mm`. Naive ISO from LangGraph is UTC. */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

export interface RunStart {
  at: number;
  runId: string | null;
}

/**
 * Parse a run `created_at`. Naive datetimes are treated as UTC so a missing
 * offset does not add the local zone (e.g. +2h) to the elapsed clock.
 * Future timestamps and unparseable values are rejected.
 */
export function parseRunCreatedAt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withZone = HAS_OFFSET.test(trimmed) ? trimmed : `${trimmed}Z`;
  const parsed = Date.parse(withZone);
  if (!Number.isFinite(parsed) || parsed > Date.now()) return null;
  return parsed;
}

function isRunStart(value: unknown): value is RunStart {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.at === "number" &&
    Number.isFinite(rec.at) &&
    rec.at > 0 &&
    (rec.runId === null || typeof rec.runId === "string")
  );
}

export function readRunStart(threadId: string): RunStart | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY(threadId));
  if (raw == null) return null;
  // Bare timestamps are not bound to a run. They are the drifting clock.
  if (/^\d+$/.test(raw)) {
    localStorage.removeItem(KEY(threadId));
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRunStart(parsed)) return parsed;
  } catch {
    /* drop */
  }
  localStorage.removeItem(KEY(threadId));
  return null;
}

export function writeRunStart(
  threadId: string,
  at: number,
  runId: string | null
): void {
  if (typeof window === "undefined") return;
  const stored: RunStart = { at, runId };
  localStorage.setItem(KEY(threadId), JSON.stringify(stored));
}

/** Attach a run id without moving the original start timestamp. */
export function attachRunId(threadId: string, runId: string): void {
  const current = readRunStart(threadId);
  if (!current || current.runId === runId) return;
  writeRunStart(threadId, current.at, runId);
}

export function clearRunStart(threadId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY(threadId));
  try {
    sessionStorage.removeItem(ACTIVITY_KEY(threadId));
  } catch {
    /* ignore */
  }
}

/** Run id the SDK stored for `reconnectOnMount` (`sessionStorage`). */
export function readStreamRunId(threadId: string): string | null {
  if (typeof window === "undefined") return null;
  const id = sessionStorage.getItem(STREAM_KEY(threadId));
  return id ? id : null;
}
