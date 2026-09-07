"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const STALL_THRESHOLD_MS = 90_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatIdle(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 120) {
    return `${totalSeconds}s`;
  }

  return `${Math.floor(totalSeconds / 60)} min`;
}

interface RunStatusBarProps {
  runStartedAtRef: MutableRefObject<number | null>;
  lastEventAtRef: MutableRefObject<number | null>;
  activity: string | null;
}

export function RunStatusBar({
  runStartedAtRef,
  lastEventAtRef,
  activity,
}: RunStatusBarProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);

    return () => window.clearInterval(id);
  }, []);

  const now = performance.now();
  const startedAt = runStartedAtRef.current;
  const lastEventAt = lastEventAtRef.current;
  const elapsed = startedAt != null ? now - startedAt : 0;
  const idle = lastEventAt != null ? now - lastEventAt : 0;
  const stalled = lastEventAt != null && idle >= STALL_THRESHOLD_MS;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 px-[18px] pt-2 text-xs font-medium",
        stalled ? "text-warning" : "text-primary"
      )}
    >
      {stalled ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
      ) : (
        <LoaderCircle className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
      )}
      <span className="min-w-0">
        {stalled ? (
          <>
            No updates for {formatIdle(idle)} — the agent may be on a long tool
            call. You can press Stop and try again.
          </>
        ) : (
          <span className="block truncate">
            Agent is working
            {startedAt != null ? ` — ${formatElapsed(elapsed)}` : ""}
            {activity ? ` · ${activity}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}
