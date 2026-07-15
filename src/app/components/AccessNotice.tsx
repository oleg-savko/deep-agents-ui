"use client";

import React from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AccessInfo {
  authenticated: boolean;
  userGroups: string[];
  email: string | null;
  name: string | null;
  totalAssistants: number;
  visibleAssistants: number;
}

interface AccessNoticeProps {
  access: AccessInfo;
  /** Optional handler to reopen the deployment settings dialog. */
  onOpenSettings?: () => void;
}

/**
 * Full-screen notice shown when the caller can see no assistants. Explains the
 * likely cause (missing Keycloak `ai-groups` role) and how to get access.
 */
export function AccessNotice({ access, onOpenSettings }: AccessNoticeProps) {
  const account = access.email ?? access.name ?? "your account";
  // A non-empty config with zero visible assistants means the caller's groups
  // did not match any assistant's allowlist — a role problem, not a config gap.
  const roleProblem = access.authenticated && access.totalAssistants > 0;

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold">No assistants available</h1>

        {roleProblem ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {account} doesn&apos;t have access to any assistant. You need an
              appropriate AI access role in Keycloak.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Ask your administrator to add your account to an{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                ai-group
              </code>{" "}
              role.
            </p>
            <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Account:</span>{" "}
                {account}
              </div>
              <div className="mt-1">
                <span className="font-medium text-foreground">
                  Your current groups:
                </span>{" "}
                {access.userGroups.length > 0
                  ? access.userGroups.join(", ")
                  : "none"}
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {access.authenticated
              ? "No assistants are configured for this deployment. Contact your administrator."
              : "You are not signed in, so no assistants are available. Sign in with your Keycloak account to continue."}
          </p>
        )}

        {onOpenSettings && (
          <Button
            variant="outline"
            size="sm"
            className="mt-6"
            onClick={onOpenSettings}
          >
            Open Settings
          </Button>
        )}
      </div>
    </div>
  );
}
