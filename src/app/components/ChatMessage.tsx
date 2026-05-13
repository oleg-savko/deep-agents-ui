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

// Single placeholder kind. Any MCP-UI tool is detected by the presence of an
// HTML resource block in the tool's artifact — no per-kind hardcoding.
const APP_PLACEHOLDER_RE = /\[\[app(?::(\d+))?\]\]/g;

/**
 * Marker prefix iframe-driven MCP-app forms (e.g. jira_required_fields_ui)
 * include on user messages they auto-post via `app.sendMessage`. The LLM
 * still sees the full content; the chat UI collapses these into a one-line
 * stub unless "internal LLM steps" (debugMode) is enabled.
 */
const INTERNAL_USER_MESSAGE_MARKER = "<!--mcp:internal-->";

function isInternalUserMessage(content: string): boolean {
  return content.trimStart().startsWith(INTERNAL_USER_MESSAGE_MARKER);
}

function stripInternalMarker(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(INTERNAL_USER_MESSAGE_MARKER)) return content;
  return trimmed.slice(INTERNAL_USER_MESSAGE_MARKER.length).trimStart();
}

/**
 * App-UI placeholder format (from `AppPlaceholdersMiddleware`):
 *   [[app]]      → 1st MCP UI from this answer
 *   [[app:N]]    → Nth MCP UI (1-indexed)
 *
 * Resolution is positional over `uiToolCalls`: every tool call whose
 * artifact contains an HTML resource block, in tool-call order.
 */
function renderAppPlaceholders(markdown: string, uiToolCalls: ToolCall[]) {
  const parts: Array<
    | { kind: "md"; value: string }
    | { kind: "app"; index: number; raw: string }
  > = [];
  let lastIndex = 0;
  APP_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = APP_PLACEHOLDER_RE.exec(markdown)) !== null) {
    if (m.index > lastIndex) parts.push({ kind: "md", value: markdown.slice(lastIndex, m.index) });
    const n = m[1] ? Number(m[1]) : 1;
    parts.push({
      kind: "app",
      index: Number.isFinite(n) && n > 0 ? n - 1 : 0,
      raw: m[0],
    });
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
        const toolCall = uiToolCalls[p.index];
        if (!toolCall) {
          return <MarkdownContent key={`md-missing-${i}`} content={p.raw} />;
        }
        return (
          <ChartAppRenderer
            key={`app-${toolCall.id}-${i}`}
            toolCall={toolCall}
            className="my-3 w-full overflow-hidden rounded-md border border-border bg-background"
          />
        );
      })}
    </>
  );
}

/**
 * Returns true if the tool call's artifact contains an HTML resource block —
 * i.e. it produced an MCP-UI iframe. This is the single source of truth for
 * "is this a UI tool call", replacing per-name (chart/diagram/form) checks.
 */
function hasUIArtifact(tc: ToolCall): boolean {
  const artifact = (tc as unknown as { artifact?: unknown }).artifact;
  const blocks =
    artifact && typeof artifact === "object"
      ? (artifact as { content_blocks?: unknown }).content_blocks
      : undefined;
  if (!Array.isArray(blocks)) return false;
  for (const b of blocks as unknown[]) {
    const block = b as { type?: string; resource?: { mimeType?: string } };
    if (block?.type !== "resource" || !block.resource) continue;
    if (/html/i.test(String(block.resource.mimeType ?? ""))) return true;
  }
  return false;
}

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  /**
   * Tool calls that ran earlier in this *turn* (since the last human message),
   * used to resolve `[[app]]` placeholders in text-only AI messages that don't
   * carry their own tool calls. Scoping to the turn (not the whole thread)
   * ensures `[[app]]` picks the freshly-invoked UI tool, not the first one in
   * conversation history.
   */
  turnToolCalls?: ToolCall[];
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
  totalTokenUsage?: { input: number; output: number; total: number };
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    turnToolCalls,
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
    totalTokenUsage,
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

    const hasAppPlaceholders =
      isAIMessage &&
      typeof aiMarkdownForDisplay === "string" &&
      aiMarkdownForDisplay.includes("[[app");

    // For final-answer messages whose own `toolCalls` is empty, the
    // UI-producing tool calls live on earlier messages of the *same turn*;
    // fall back to `turnToolCalls` (scoped to this human→agent exchange so
    // `[[app]]` picks the freshly invoked UI tool, not the first UI tool of
    // the entire conversation).
    // Detection is artifact-based (HTML resource block) — no per-tool-name
    // hardcoding, so any new MCP UI tool registered with `_meta.ui.resourceUri`
    // gets resolved automatically.
    const uiToolCalls = useMemo(() => {
      if (!hasAppPlaceholders) return [];
      const source =
        toolCalls.some(hasUIArtifact) || !turnToolCalls?.length
          ? toolCalls
          : turnToolCalls;
      return source.filter(hasUIArtifact);
    }, [hasAppPlaceholders, toolCalls, turnToolCalls]);

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
                    isInternalUserMessage(messageContent) && !debugMode ? (
                      <p className="m-0 whitespace-pre-wrap break-words text-xs italic leading-relaxed text-muted-foreground">
                        ↳ Internal payload hidden (toggle &quot;internal LLM steps&quot; to view)
                      </p>
                    ) : (
                      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {stripInternalMarker(messageContent)}
                      </p>
                    )
                  ) : null
                ) : hasContent ? (
                  hasAppPlaceholders ? (
                    renderAppPlaceholders(aiMarkdownForDisplay, uiToolCalls)
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
          {isAIMessage && !isLoading && message.id && (() => {
            const msgUsage = (message as any).usage_metadata as
              | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
              | undefined;
            const formatTok = (n: number) =>
              n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
            const hasFooter =
              hasContent ||
              responseDurationMs != null ||
              (debugMode && !!msgUsage) ||
              (debugMode && !!totalTokenUsage);
            if (!hasFooter) return null;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {hasContent && isLastMessage && <FeedbackButtons traceId={message.id} />}
                {responseDurationMs != null && (
                  <span
                    className="text-muted-foreground text-xs tabular-nums"
                    title="Time from your request until this reply finished (measured in the browser)"
                  >
                    {formatAgentResponseDuration(responseDurationMs)}
                  </span>
                )}
                {debugMode && msgUsage && (msgUsage.input_tokens ?? 0) + (msgUsage.output_tokens ?? 0) > 0 && (
                  <span className="text-muted-foreground text-xs tabular-nums" title="Token usage for this message (input / output)">
                    ↑{formatTok(msgUsage.input_tokens ?? 0)} ↓{formatTok(msgUsage.output_tokens ?? 0)}
                  </span>
                )}
                {debugMode && totalTokenUsage && (
                  <span className="text-muted-foreground text-xs tabular-nums font-medium" title="Total token usage for this response">
                    Total: ↑{formatTok(totalTokenUsage.input)} ↓{formatTok(totalTokenUsage.output)}
                  </span>
                )}
              </div>
            );
          })()}
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
                      {(() => {
                        const run = subAgentRunsByTaskId?.[subAgent.id];
                        const durationMs =
                          run?.startedAt !== undefined && run?.endedAt !== undefined
                            ? run.endedAt - run.startedAt
                            : undefined;
                        return (
                          <SubAgentIndicator
                            subAgent={subAgent}
                            onClick={() => toggleSubAgent(subAgent.id)}
                            isExpanded={isSubAgentExpanded(subAgent.id)}
                            durationMs={durationMs}
                            tokenUsage={run?.tokenUsage}
                          />
                        );
                      })()}
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
