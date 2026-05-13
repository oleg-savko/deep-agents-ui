"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SubAgent } from "@/app/types/types";

interface SubAgentIndicatorProps {
  subAgent: SubAgent;
  onClick: () => void;
  isExpanded?: boolean;
  durationMs?: number;
  tokenUsage?: { input: number; output: number; total: number };
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return "< 1s";
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export const SubAgentIndicator = React.memo<SubAgentIndicatorProps>(
  ({ subAgent, onClick, isExpanded = true, durationMs, tokenUsage }) => {
    return (
      <div className="w-fit max-w-[70vw] overflow-hidden rounded-lg border-none bg-card shadow-none outline-none">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          className="flex w-full items-center justify-between gap-2 border-none px-4 py-2 text-left shadow-none outline-none transition-colors duration-200"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[15px] font-bold leading-[140%] tracking-[-0.6px] text-[#3F3F46]">
                {subAgent.subAgentName}
              </span>
              {durationMs !== undefined && (
                <span className="font-sans text-xs font-normal text-[#70707B]">
                  {formatDuration(durationMs)}
                </span>
              )}
              {tokenUsage !== undefined && (
                <span className="font-sans text-xs font-normal text-[#70707B]">
                  ↑{formatTokens(tokenUsage.input)} ↓{formatTokens(tokenUsage.output)}
                </span>
              )}
            </div>
            {isExpanded ? (
              <ChevronUp
                size={14}
                className="shrink-0 text-[#70707B]"
              />
            ) : (
              <ChevronDown
                size={14}
                className="shrink-0 text-[#70707B]"
              />
            )}
          </div>
        </Button>
      </div>
    );
  }
);

SubAgentIndicator.displayName = "SubAgentIndicator";
