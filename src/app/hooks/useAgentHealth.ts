"use client";

import { useCallback, useEffect, useState } from "react";

export type AgentHealth = "checking" | "online" | "offline" | "unhealthy";

/** Aegra (the Agent Protocol server) exposes GET /health → 200 with
 * `{"status":"healthy",...}` and `access-control-allow-origin: *`, so it can be
 * read cross-origin. (Note: the LangGraph-platform `/ok` route does NOT exist
 * on Aegra — it 404s.) */
const HEALTH_PATH = "/health";
const PROBE_TIMEOUT_MS = 8000;
const POLL_ONLINE_MS = 30000;
const POLL_DOWN_MS = 10000;

/**
 * Real health check of the agent deployment.
 *
 * - `online`   — `GET /health` returned 2xx.
 * - `unhealthy`— a response came back but not 2xx (server up, dependency down /
 *   still starting). Distinct because it is *not* a VPN problem.
 * - `offline`  — the request failed at the network level (DNS / connection
 *   refused / timeout), which is what a dropped VPN looks like.
 *
 * Re-probes on a timer and when the browser regains connectivity.
 */
export function useAgentHealth(deploymentUrl: string | undefined): {
  status: AgentHealth;
  revalidating: boolean;
  lastCheckedAt: number | null;
  retry: () => void;
} {
  const [status, setStatus] = useState<AgentHealth>("checking");
  const [revalidating, setRevalidating] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!deploymentUrl) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    // The verdict is sticky across re-probes (no flip back to "checking"), so
    // the banner never flickers while polling; a separate `revalidating` flag
    // drives the retry spinner instead.
    setRevalidating(true);

    const base = deploymentUrl.replace(/\/+$/, "");

    fetch(`${base}${HEALTH_PATH}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!cancelled) setStatus(res.ok ? "online" : "unhealthy");
      })
      .catch(() => {
        if (!cancelled) setStatus("offline");
      })
      .finally(() => {
        if (!cancelled) {
          setLastCheckedAt(Date.now());
          setRevalidating(false);
        }
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [deploymentUrl, nonce]);

  // Poll so a mid-session drop (or recovery) is detected without a user action;
  // faster while down so the banner clears promptly once things recover.
  useEffect(() => {
    if (!deploymentUrl) return;
    const down = status === "offline" || status === "unhealthy";
    const id = setInterval(retry, down ? POLL_DOWN_MS : POLL_ONLINE_MS);
    return () => clearInterval(id);
  }, [status, deploymentUrl, retry]);

  useEffect(() => {
    const onOnline = () => retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retry]);

  return { status, revalidating, lastCheckedAt, retry };
}
