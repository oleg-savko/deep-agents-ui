"use client";

import React, { useMemo, useState, useCallback } from "react";
import { RotateCcw, FileIcon } from "lucide-react";
import { SubAgentIndicator } from "@/app/components/SubAgentIndicator";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ChartAppRenderer } from "@/app/components/ChartAppRenderer";
import type { SubAgent, SubAgentRun, SubAgentStatus, ToolCall } from "@/app/types/types";
import { Interrupt, Message } from "@langchain/langgraph-sdk";
import {
  extractSubAgentContent,
  extractFileAttachmentsFromMessageContent,
  extractImagesFromMessageContent,
  extractStringFromMessageContent,
  extractUserTextFromMessageContent,
  getInterruptTitle,
  stripUndisplayableMarkdownImages,
} from "@/app/utils/utils";
import { cn } from "@/lib/utils";
import { FeedbackButtons } from "@/app/components/FeedbackButtons";

function formatAgentResponseDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem.toFixed(0)}s`;
}

const CHART_PLACEHOLDER_RE = /\[\[chart(?::(\d+))?\]\]/g;

/**
 * Chart placeholder format (from chart_placeholders_middleware.py):
 *   [[chart]]   → 1st chart
 *   [[chart:N]] → Nth chart (1-indexed)
 *
 * Resolution is positional over the provided list of chart tool calls: the
 * agent's own tool-call history determines the mapping.
 */
function renderChartPlaceholders(markdown: string, chartToolCalls: ToolCall[]) {
  const parts: Array<{ kind: "md"; value: string } | { kind: "chart"; index: number }> = [];
  let lastIndex = 0;
  CHART_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHART_PLACEHOLDER_RE.exec(markdown)) !== null) {
    if (m.index > lastIndex) parts.push({ kind: "md", value: markdown.slice(lastIndex, m.index) });
    const n = m[1] ? Number(m[1]) : 1;
    parts.push({ kind: "chart", index: Number.isFinite(n) && n > 0 ? n - 1 : 0 });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < markdown.length) parts.push({ kind: "md", value: markdown.slice(lastIndex) });

  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "md") {
          if (!p.value.trim()) return <React.Fragment key={`md-${i}`} />;
          return <MarkdownContent key={`md-${i}`} content={p.value} />;
        }
        const toolCall = chartToolCalls[p.index];
        if (!toolCall) {
          const token = `[[chart${p.index > 0 ? `:${p.index + 1}` : ""}]]`;
          return <MarkdownContent key={`md-missing-${i}`} content={token} />;
        }
        return (
          <ChartAppRenderer
            key={`chart-${toolCall.id}-${i}`}
            toolCall={toolCall}
            className="my-3 w-full overflow-hidden rounded-md border border-border bg-background"
          />
        );
      })}
    </>
  );
}

/** Returns true if the tool call's args declare a chart render intent. */
function hasChartIntent(tc: ToolCall): boolean {
  const args: any = typeof tc.args === "string" ? (() => { try { return JSON.parse(tc.args as any); } catch { return {}; } })() : tc.args;
  const render = args?.render;
  const kind = typeof render === "string" ? render : render?.type;
  return kind === "bar" || kind === "line" || kind === "pie";
}

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  /** All tool calls from the thread, for resolving [[chart]] placeholders in final-answer messages. */
  allToolCalls?: ToolCall[];
  subAgentRunsByTaskId?: Record<string, SubAgentRun>;
  onRestartFromAIMessage: (message: Message) => void;
  onRestartFromSubTask: (toolCallId: string) => void;
  debugMode?: boolean;
  isLastMessage?: boolean;
  isLoading?: boolean;
  interrupt?: Interrupt;
  ui?: any[];
  stream?: any;
  responseDurationMs?: number;
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    allToolCalls,
    subAgentRunsByTaskId,
    onRestartFromAIMessage,
    onRestartFromSubTask,
    debugMode,
    isLastMessage,
    isLoading,
    interrupt,
    ui,
    stream,
    responseDurationMs,
  }) => {
    const isUser = message.type === "human";
    const isAIMessage = message.type === "ai";
    const messageContent = isUser
      ? extractUserTextFromMessageContent(message)
      : extractStringFromMessageContent(message);
    const hasContent = messageContent && messageContent.trim() !== "";
    const hasToolCalls = toolCalls.length > 0;

    const imageBlocks = useMemo(() => extractImagesFromMessageContent(message), [message]);
    const toolResultImageUrls = useMemo(
      () => toolCalls.flatMap((tc) => (tc.resultImages ?? []).map((img) => img.url)),
      [toolCalls]
    );
    const displayImageUrls = useMemo(
      () => [...imageBlocks.map((b) => b.url), ...toolResultImageUrls],
      [imageBlocks, toolResultImageUrls]
    );
    const aiMarkdownForDisplay = useMemo(
      () => (isAIMessage ? stripUndisplayableMarkdownImages(messageContent) : messageContent),
      [isAIMessage, messageContent]
    );
    const fileAttachments = useMemo(
      () => extractFileAttachmentsFromMessageContent(message),
      [message]
    );
    const hasAttachments = displayImageUrls.length > 0 || fileAttachments.length > 0;

    const nestedToolCallIds = useMemo(() => {
      const set = new Set<string>();
      if (!subAgentRunsByTaskId) return set;
      for (const run of Object.values(subAgentRunsByTaskId)) {
        for (const tc of run.toolCalls) set.add(tc.id);
      }
      return set;
    }, [subAgentRunsByTaskId]);

    const subAgents = useMemo(() => {
      const toSubAgentStatus = (s: ToolCall["status"]): SubAgentStatus => {
        if (s === "completed") return "completed";
        if (s === "error") return "error";
        if (s === "interrupted") return "interrupted";
        return "active";
      };
      return toolCalls
        .filter((tc) => tc.name === "task" && tc.args["subagent_type"])
        .map(
          (tc): SubAgent => ({
            id: tc.id,
            name: tc.name,
            subAgentName: String(tc.args["subagent_type"] || ""),
            input: tc.args,
            output: tc.result ? { result: tc.result } : undefined,
            status: toSubAgentStatus(tc.status),
          })
        );
    }, [toolCalls]);

    const [expandedSubAgents, setExpandedSubAgents] = useState<Record<string, boolean>>({});
    const isSubAgentExpanded = useCallback(
      (id: string) => expandedSubAgents[id] ?? true,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: prev[id] === undefined ? false : !prev[id],
      }));
    }, []);

    const interruptTitle = interrupt ? getInterruptTitle(interrupt) : "";

    const hasChartPlaceholders =
      isAIMessage &&
      typeof aiMarkdownForDisplay === "string" &&
      aiMarkdownForDisplay.includes("[[chart");

    // For final-answer messages whose toolCalls are empty, the chart tool
    // calls live on earlier messages; pull from `allToolCalls` in that case.
    const chartToolCalls = useMemo(() => {
      if (!hasChartPlaceholders) return [];
      const source =
        toolCalls.some(hasChartIntent) || !allToolCalls?.length ? toolCalls : allToolCalls;
      return source.filter(hasChartIntent);
    }, [hasChartPlaceholders, toolCalls, allToolCalls]);

    return (
      <div
        className={cn(
          "flex w-full max-w-full overflow-x-hidden",
          isUser && "flex-row-reverse"
        )}
      >
        <div className={cn("min-w-0 max-w-full", isUser ? "max-w-[70%]" : "w-full")}>
          {(hasContent || hasAttachments || debugMode) && (
            <div className={cn("relative flex items-end gap-0")}>
              <div
                className={cn(
                  "mt-4 overflow-hidden break-words text-sm font-normal leading-[150%]",
                  isUser
                    ? "rounded-xl rounded-br-none border border-border px-3 py-2 text-foreground"
                    : "text-primary"
                )}
                style={
                  isUser
                    ? { backgroundColor: "var(--color-user-message-bg)" }
                    : undefined
                }
              >
                {hasAttachments && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {displayImageUrls.map((url, idx) => (
                      <a
                        key={`${url.slice(0, 48)}-${idx}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={url}
                          alt={`Attachment ${idx + 1}`}
                          className="max-h-48 max-w-full rounded-md border border-border object-contain"
                        />
                      </a>
                    ))}
                    {fileAttachments.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1 text-xs"
                      >
                        <FileIcon size={12} className="flex-shrink-0 text-muted-foreground" />
                        <span className="max-w-[200px] truncate font-medium">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isUser ? (
                  hasContent ? (
                    <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {messageContent}
                    </p>
                  ) : null
                ) : hasContent ? (
                  hasChartPlaceholders ? (
                    renderChartPlaceholders(aiMarkdownForDisplay, chartToolCalls)
                  ) : (
                    <MarkdownContent content={aiMarkdownForDisplay} />
                  )
                ) : null}
              </div>
              {debugMode && isAIMessage && !(isLastMessage && isLoading) && (
                <button
                  onClick={() => onRestartFromAIMessage(message)}
                  className="absolute bottom-1 right-1 -scale-x-100 rounded-full bg-black/10 p-1 transition-colors duration-200 hover:bg-black/20"
                >
                  <RotateCcw className="h-3 w-3 text-gray-600" />
                </button>
              )}
            </div>
          )}
          {isAIMessage && !isLoading && message.id && (hasContent || responseDurationMs != null) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {hasContent && <FeedbackButtons traceId={message.id} />}
              {responseDurationMs != null && (
                <span
                  className="text-muted-foreground text-xs tabular-nums"
                  title="Time from your request until this reply finished (measured in the browser)"
                >
                  {formatAgentResponseDuration(responseDurationMs)}
                </span>
              )}
            </div>
          )}
          {hasToolCalls && debugMode && (
            <div className="mt-4 flex w-full flex-col">
              {toolCalls.map((toolCall, idx, arr) => {
                if (toolCall.name === "task") return null;
                if (nestedToolCallIds.has(toolCall.id)) return null;
                const uiComponent = ui?.find((u) => u.metadata?.tool_call_id === toolCall.id);
                const isInterrupted =
                  idx === arr.length - 1 &&
                  toolCall.name === interruptTitle &&
                  isLastMessage;
                return (
                  <ToolCallBox
                    key={toolCall.id}
                    toolCall={toolCall}
                    uiComponent={uiComponent}
                    stream={stream}
                    isInterrupted={isInterrupted}
                  />
                );
              })}
            </div>
          )}
          {!isUser && subAgents.length > 0 && debugMode && (
            <div className="flex w-fit max-w-full flex-col gap-4">
              {subAgents.map((subAgent) => (
                <div key={subAgent.id} className="flex w-full flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <div className="w-[calc(100%-100px)]">
                      <SubAgentIndicator
                        subAgent={subAgent}
                        onClick={() => toggleSubAgent(subAgent.id)}
                        isExpanded={isSubAgentExpanded(subAgent.id)}
                      />
                    </div>
                    <div className="relative h-full min-h-[40px] w-[72px] flex-shrink-0">
                      {debugMode && subAgent.status === "completed" && (
                        <button
                          onClick={() => onRestartFromSubTask(subAgent.id)}
                          className="absolute bottom-1 right-1 -scale-x-100 rounded-full bg-black/10 p-1 transition-colors duration-200 hover:bg-black/20"
                        >
                          <RotateCcw className="h-3 w-3 text-gray-600" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isSubAgentExpanded(subAgent.id) && (
                    <div className="w-full max-w-full">
                      <div className="bg-surface border-border-light rounded-md border p-4">
                        <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                          Input
                        </h4>
                        <div className="mb-4">
                          <MarkdownContent content={extractSubAgentContent(subAgent.input)} />
                        </div>

                        {(() => {
                          const run = subAgentRunsByTaskId?.[subAgent.id];
                          if (!run) return null;
                          const timeline = [
                            ...run.progress.map((p) => ({
                              type: "progress" as const,
                              key: p.messageId ?? `${subAgent.id}-${p.order}`,
                              order: p.order,
                              text: p.text,
                            })),
                            ...run.toolCalls.map((tc) => ({
                              type: "tool" as const,
                              key: tc.id,
                              order: tc.order ?? Number.MAX_SAFE_INTEGER,
                              toolCall: tc,
                            })),
                          ].sort((a, b) => a.order - b.order);
                          if (timeline.length === 0) return null;

                          return (
                            <div className="mb-4">
                              <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                                Timeline
                              </h4>
                              <div className="max-h-80 overflow-y-auto rounded-sm border border-border bg-muted/20 p-2">
                                <div className="flex flex-col gap-2">
                                  {timeline.map((item) => {
                                    if (item.type === "progress") {
                                      return (
                                        <div
                                          key={item.key}
                                          className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground"
                                        >
                                          {item.text}
                                        </div>
                                      );
                                    }
                                    const uiComponent = ui?.find(
                                      (u) => u.metadata?.tool_call_id === item.toolCall.id
                                    );
                                    return (
                                      <ToolCallBox
                                        key={item.key}
                                        toolCall={item.toolCall}
                                        uiComponent={uiComponent}
                                        stream={stream}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {subAgent.output && (
                          <>
                            <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                              Output
                            </h4>
                            <MarkdownContent content={extractSubAgentContent(subAgent.output)} />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";
