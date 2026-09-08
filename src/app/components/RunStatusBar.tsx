"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LoaderCircle } from "lucide-react";

const ACTIVITY_TIMER_THRESHOLD_MS = 30_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface RunStatusBarProps {
  runStartedAtRef: MutableRefObject<number | null>;
  activity: string | null;
}

export function RunStatusBar({ runStartedAtRef, activity }: RunStatusBarProps) {
  const [, setTick] = useState(0);
  const [activitySince, setActivitySince] = useState<number | null>(null);
  const prevActivityRef = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);

    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (activity === prevActivityRef.current) return;
    prevActivityRef.current = activity;
    setActivitySince(activity ? performance.now() : null);
  }, [activity]);

  const now = performance.now();
  const startedAt = runStartedAtRef.current;
  const elapsed = startedAt != null ? now - startedAt : 0;
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
          {startedAt != null ? ` — ${formatElapsed(elapsed)}` : ""}
          {activity ? ` · ${activity}` : ""}
          {activity && activityElapsed >= ACTIVITY_TIMER_THRESHOLD_MS
            ? ` (${formatElapsed(activityElapsed)})`
            : ""}
        </span>
      </span>
    </div>
  );
}
