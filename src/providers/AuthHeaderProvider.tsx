"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CHAT_IS_READY, SET_TOKEN } from "@/app/consts/postsTypes";

export type AuthHeaderContextValue = {
  /** Forwarded `Authorization` value (e.g. `Bearer …`), or null if absent. */
  authorization: string | null;
  /** True after the `/api/auth/header` request has finished (success or error). */
  ready: boolean;
};

const AuthHeaderContext = createContext<AuthHeaderContextValue | null>(null);
const MANAGEMENT_ORIGIN = "*";

export function AuthHeaderProvider({ children }: { children: ReactNode }) {
  const [authorization, setAuthorization] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const isInIframe = window.self !== window.top;

    if (isInIframe) {
      window.parent.postMessage({ type: CHAT_IS_READY }, MANAGEMENT_ORIGIN);

      setReady(true);

      const handleManagementResponse = (event: MessageEvent) => {
        if (event.data?.type !== SET_TOKEN) return;

        const token = event.data.token;
        if (!token || typeof token !== "string") return;

        setAuthorization(
          token.startsWith("Bearer ") ? token : `Bearer ${token}`
        );
      };

      window.addEventListener("message", handleManagementResponse);

      return () => {
        window.removeEventListener("message", handleManagementResponse);
      };
    }

    let cancelled = false;
    fetch("/api/auth/header", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Auth header fetch failed: ${r.status}`);
        }
        return r.json() as Promise<{ authorization: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setAuthorization(data.authorization ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthorization(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ authorization, ready }),
    [authorization, ready]
  );

  return (
    <AuthHeaderContext.Provider value={value}>
      {children}
    </AuthHeaderContext.Provider>
  );
}

export function useAuthHeader(): AuthHeaderContextValue {
  const ctx = useContext(AuthHeaderContext);
  if (!ctx) {
    throw new Error("useAuthHeader must be used within an AuthHeaderProvider");
  }
  return ctx;
}
