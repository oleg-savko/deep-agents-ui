"use client";

import React from "react";
import { WifiOff, ServerCrash, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConnectivityBannerProps {
  /** "offline" = network unreachable (VPN); "unhealthy" = reachable but /health failed. */
  mode: "offline" | "unhealthy";
  /** True while a health re-check is in flight. */
  checking: boolean;
  onRetry: () => void;
}

/**
 * Persistent banner shown when the agent's health check fails. Points the user
 * at the likely cause — a dropped VPN vs. a degraded server — rather than a raw
 * error.
 */
export function ConnectivityBanner({
  mode,
  checking,
  onRetry,
}: ConnectivityBannerProps) {
  const Icon = mode === "offline" ? WifiOff : ServerCrash;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-6 py-2.5 text-sm text-destructive"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <p className="flex-1">
        {mode === "offline" ? (
          <>
            <span className="font-medium">Can&apos;t reach the agent.</span>{" "}
            <span className="text-destructive/90">
              Check that your VPN is connected and you&apos;re on the corporate
              network, then retry.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">The agent is unhealthy.</span>{" "}
            <span className="text-destructive/90">
              The server is reachable but its health check failed — it may be
              starting up or a dependency is down. Try again shortly.
            </span>
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={checking}
        className="shrink-0 border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10"
      >
        <RefreshCw
          className={`mr-2 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
        />
        {checking ? "Checking…" : "Retry"}
      </Button>
    </div>
  );
}
