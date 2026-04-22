"use client";

import React, { useMemo, useState } from "react";
import { AppRenderer, isUIResource } from "@mcp-ui/client";
import type { ToolCall } from "@/app/types/types";

function looksLikeHtml(s: string): boolean {
  const t = s.trimStart().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

/**
 * Extracts a full HTML document from an MCP tool result's content blocks.
 *
 * Handles two shapes:
 *   1. Native MCP: a `{type: "resource", resource: {mimeType: "text/html", text}}` block.
 *   2. LangChain-flattened: the MCP adapter converts `EmbeddedResource(TextResourceContents)`
 *      into a plain `{type: "text", text: "<!doctype html>..."}` block, so we also scan
 *      text blocks for anything that looks like an HTML document.
 */
function extractShellHtml(resultContent: unknown): string | null {
  if (!Array.isArray(resultContent)) return null;
  for (const block of resultContent) {
    if (isUIResource(block)) {
      const r = (block as any).resource;
      if (!r) continue;
      const mime = String(r.mimeType ?? "");
      if (mime && !mime.startsWith("text/html")) continue;
      if (typeof r.text === "string" && r.text) return r.text;
      if (typeof r.blob === "string" && r.blob) {
        try {
          return atob(r.blob);
        } catch {
          // ignore
        }
      }
    }
    const b = block as any;
    if (b && b.type === "text" && typeof b.text === "string" && looksLikeHtml(b.text)) {
      return b.text;
    }
  }
  return null;
}

/**
 * Parses a tool result's text block as JSON and returns `structuredContent`.
 * Returns null if parsing fails or no chartPayload is present.
 */
function extractStructuredContent(result: unknown): Record<string, unknown> | null {
  if (typeof result !== "string" || !result.trim()) return null;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return null;
}

interface ChartAppRendererProps {
  toolCall: ToolCall;
  className?: string;
  height?: number;
}

/**
 * Renders an MCP Apps-style chart for a `show_clickhouse_query_chart` tool call
 * using @mcp-ui/client's AppRenderer. The tool result must include the shell
 * HTML as a UI resource block and chart data in structured content.
 */
export const ChartAppRenderer = React.memo<ChartAppRendererProps>(
  ({ toolCall, className, height = 460 }) => {
    const [err, setErr] = useState<string | null>(null);

    const html = useMemo(
      () => extractShellHtml((toolCall as any).resultContent),
      [toolCall]
    );

    const toolResult = useMemo(() => {
      const content = Array.isArray((toolCall as any).resultContent)
        ? ((toolCall as any).resultContent as unknown[])
        : [];
      const structuredContent =
        extractStructuredContent((toolCall as any).result) ?? undefined;
      return { content, structuredContent } as any;
    }, [toolCall]);

    const toolInput = useMemo(() => {
      const args = (toolCall as any).args;
      if (typeof args === "string") {
        try {
          return JSON.parse(args);
        } catch {
          return {};
        }
      }
      return args && typeof args === "object" ? args : {};
    }, [toolCall]);

    const sandboxUrl = useMemo(
      () =>
        typeof window !== "undefined"
          ? new URL("/sandbox_proxy.html", window.location.origin)
          : undefined,
      []
    );

    if (!html) return null;
    if (!sandboxUrl) return null;

    return (
      <div
        className={className}
        style={{ height }}
      >
        {err ? (
          <div className="p-2 text-xs text-destructive">Chart error: {err}</div>
        ) : (
          <AppRenderer
            sandbox={{ url: sandboxUrl }}
            toolName={toolCall.name}
            html={html}
            toolInput={toolInput}
            toolResult={toolResult}
            onError={(e) => setErr(e.message)}
          />
        )}
      </div>
    );
  }
);

ChartAppRenderer.displayName = "ChartAppRenderer";
