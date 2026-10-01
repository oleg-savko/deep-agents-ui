"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

const ACTIVITY_TIMER_THRESHOLD_MS = 30_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const sec = seconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${sec}`;
  }

  return `${minutes}:${sec}`;
}

const activityKey = (threadId: string) => `activity-since:${threadId}`;

interface StoredActivity {
  label: string;
  at: number;
  runStartedAt: number;
  runId: string | null;
}

function readActivity(
  threadId: string,
  label: string,
  runStartedAt: number,
  runId: string | null
): number | null {
  try {
    const raw = sessionStorage.getItem(activityKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredActivity;
    if (
      parsed.label !== label ||
      parsed.runStartedAt !== runStartedAt ||
      !Number.isFinite(parsed.at)
    ) {
      return null;
    }
    if (parsed.runId === runId) return parsed.at;
    // Run id arrives a moment after this step's clock was stored.
    // Legacy entries have no `runId` field and must not be reused.
    if ("runId" in parsed && parsed.runId == null && runId != null) {
      return parsed.at;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeActivity(threadId: string, stored: StoredActivity): void {
  try {
    sessionStorage.setItem(activityKey(threadId), JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

interface RunStatusBarProps {
  runStartedAt: number | null;
  runId: string | null;
  activity: string | null;
  threadId: string | null;
}

export function RunStatusBar({
  runStartedAt,
  runId,
  activity,
  threadId,
}: RunStatusBarProps) {
  const [, setTick] = useState(0);
  const [activitySince, setActivitySince] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);

    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activity || runStartedAt == null) {
      setActivitySince(null);
      return;
    }
    if (!threadId) {
      setActivitySince(Date.now());
      return;
    }
    const stored = readActivity(threadId, activity, runStartedAt, runId);
    if (stored != null) {
      setActivitySince(stored);
      writeActivity(threadId, {
        label: activity,
        at: stored,
        runStartedAt,
        runId,
      });
      return;
    }
    const at = Date.now();
    writeActivity(threadId, { label: activity, at, runStartedAt, runId });
    setActivitySince(at);
  }, [activity, threadId, runStartedAt, runId]);

  const now = Date.now();
  const elapsed = runStartedAt != null ? now - runStartedAt : 0;
  const activityElapsed = activitySince != null ? now - activitySince : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 px-[18px] pt-2 text-xs font-medium text-primary"
    >
      <LoaderCircle className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
      <span className="min-w-0">
        <span className="block truncate">
          Agent is working
          {runStartedAt != null ? ` — ${formatElapsed(elapsed)}` : ""}
          {activity ? ` · ${activity}` : ""}
          {activity && activityElapsed >= ACTIVITY_TIMER_THRESHOLD_MS
            ? ` (${formatElapsed(activityElapsed)})`
            : ""}
        </span>
      </span>
    </div>
  );
}
