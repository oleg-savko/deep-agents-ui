"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppRenderer, isUIResource } from "@mcp-ui/client";
import type { ToolCall } from "@/app/types/types";

/**
 * Extract the UI HTML shell from `artifact.content_blocks` (MCP Apps tools
 * wrapped via `wrap_mcp_apps_tool` preserve the resource block losslessly
 * with `{uri, mimeType, text|blob}`).
 */
function extractShellHtml(artifact: unknown): string | null {
  const blocks =
    artifact && typeof artifact === "object" ? (artifact as any).content_blocks : undefined;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks as unknown[]) {
    const b = block as any;
    if (!((b?.type === "resource" && b.resource) || isUIResource(b))) continue;
    const r = b.resource;
    const mime = String(r?.mimeType ?? "");
    if (!/html/i.test(mime)) continue;
    if (typeof r?.text === "string" && r.text) return r.text;
    if (typeof r?.blob === "string" && r.blob) {
      try {
        return atob(r.blob);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Parse tool.result string as JSON for `toolResult.structuredContent`. */
function extractStructuredContent(result: unknown): Record<string, unknown> | null {
  if (typeof result !== "string" || !result.trim()) return null;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

interface ChartAppRendererProps {
  toolCall: ToolCall;
  className?: string;
  height?: number;
}

/**
 * Renders an MCP Apps UI resource (drawio diagram, clickhouse chart, …) via
 * `@mcp-ui/client`'s `AppRenderer`. Pulls the HTML shell from the tool
 * artifact, connects a live MCP `Client` to the originating server (URL in
 * the artifact) so standard MCP methods forward natively, and hands the guest
 * the real container size via `hostContext.containerDimensions`.
 */
export const ChartAppRenderer = React.memo<ChartAppRendererProps>(
  ({ toolCall, className, height = 560 }) => {
    const [err, setErr] = useState<string | null>(null);
    const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    // Live container width → `hostContext.containerDimensions.width`. Without
    // it, viewers like drawio render at a small natural size.
    useEffect(() => {
      const el = containerRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) setContainerWidth(Math.round(w));
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // AppFrame hard-codes the guest iframe as `height: 600px` and re-applies
    // pixel width/height on every size-changed notification — overriding any
    // 100% we set. We also need `allowfullscreen` / `allow="fullscreen"` for
    // the Fullscreen API. Patch on insertion *and* re-assert 100% whenever
    // the iframe's style attribute mutates.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const styleObservers = new WeakMap<HTMLIFrameElement, MutationObserver>();
      const enforceSize = (iframe: HTMLIFrameElement) => {
        if (iframe.style.width !== "100%") iframe.style.width = "100%";
        if (iframe.style.height !== "100%") iframe.style.height = "100%";
      };
      const patch = (iframe: HTMLIFrameElement) => {
        if (!iframe.hasAttribute("allowfullscreen")) iframe.setAttribute("allowfullscreen", "true");
        const allow = iframe.getAttribute("allow") ?? "";
        if (!/fullscreen/.test(allow)) {
          iframe.setAttribute("allow", allow ? `${allow}; fullscreen` : "fullscreen");
        }
        iframe.style.display = "block";
        enforceSize(iframe);
        if (!styleObservers.has(iframe)) {
          const styleObs = new MutationObserver(() => enforceSize(iframe));
          styleObs.observe(iframe, { attributes: true, attributeFilter: ["style"] });
          styleObservers.set(iframe, styleObs);
        }
      };
      container.querySelectorAll("iframe").forEach(patch);
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (node instanceof HTMLIFrameElement) patch(node);
            else if (node instanceof HTMLElement) node.querySelectorAll("iframe").forEach(patch);
          });
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        container.querySelectorAll("iframe").forEach((f) => {
          styleObservers.get(f)?.disconnect();
        });
      };
    }, []);

    // AppBridge pre-registers a no-op default handler for `ui/request-display-mode`
    // that just echoes `hostContext.displayMode`, so `onFallbackRequest` never sees
    // it. Eavesdrop on the raw postMessage to actually perform fullscreen — running
    // in the message listener preserves the user-gesture activation.
    useEffect(() => {
      const listener = (e: MessageEvent) => {
        const container = containerRef.current;
        const iframe = container?.querySelector("iframe");
        if (!iframe || e.source !== iframe.contentWindow) return;
        const data = e.data as { jsonrpc?: string; method?: string; params?: { mode?: string } };
        if (data?.jsonrpc !== "2.0" || data.method !== "ui/request-display-mode") return;
        if (data.params?.mode === "fullscreen") {
          container!.requestFullscreen?.().catch(() => {});
        } else if (data.params?.mode === "inline" && document.fullscreenElement === container) {
          document.exitFullscreen?.().catch(() => {});
        }
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }, []);

    const handleOpenLink = useCallback(async ({ url }: { url: string }) => {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return {};
    }, []);


    // Grow-only: guests like drawio re-report a small natural height on
    // scroll/visibility changes; honoring the shrink permanently collapses the
    // iframe.
    const handleSizeChanged = useCallback(
      (params: { width?: number; height?: number }) => {
        if (typeof params?.height !== "number" || params.height <= 0) return;
        const requested = Math.min(params.height, 2000);
        setMeasuredHeight((prev) => {
          const current = prev ?? height;
          return requested > current ? requested : current;
        });
      },
      [height]
    );

    const html = useMemo(
      () => extractShellHtml((toolCall as any).artifact),
      [toolCall]
    );

    const toolResult = useMemo(() => {
      const artifact = (toolCall as any).artifact;
      const artifactObj = artifact && typeof artifact === "object" ? (artifact as any) : {};
      const content = Array.isArray(artifactObj.content_blocks)
        ? (artifactObj.content_blocks as unknown[])
        : [];
      const structuredContent =
        (artifactObj.structured_content as Record<string, unknown> | undefined) ??
        extractStructuredContent((toolCall as any).result) ??
        undefined;
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

    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
      "idle"
    );

    // Drawio-MCP's viewer exposes its rendered drawio XML on a top-level
    // `currentXml` var (same source as the viewer's "Copy to Clipboard"
    // button). It's the raw `<mxGraphModel>` — we wrap it in an `<mxfile>`
    // envelope so it opens as a valid `.drawio` document. Same-origin iframe
    // access is allowed via the sandbox's `allow-same-origin`.
    const handleSaveToFiles = useCallback(async () => {
      const iframes = containerRef.current?.querySelectorAll("iframe") ?? [];
      let graphModelXml: string | null = null;
      for (const iframe of iframes) {
        let xml: unknown;
        try {
          xml = (iframe.contentWindow as any)?.currentXml;
        } catch {
          continue;
        }
        if (typeof xml === "string" && xml.includes("<mxGraphModel")) {
          graphModelXml = xml;
          break;
        }
      }
      const mermaid =
        typeof (toolInput as any)?.mermaid === "string"
          ? ((toolInput as any).mermaid as string)
          : null;
      let name: string | null = null;
      let content: string | null = null;
      if (graphModelXml) {
        name = `diagrams/diagram-${toolCall.id}.drawio`;
        content = graphModelXml.includes("<mxfile")
          ? graphModelXml
          : `<mxfile host="app.diagrams.net" agent="deep-research" version="22.0.0" type="device">\n  <diagram name="Page-1" id="diagram">\n    ${graphModelXml}\n  </diagram>\n</mxfile>\n`;
      } else if (mermaid) {
        name = `diagrams/diagram-${toolCall.id}.mmd`;
        content = mermaid;
      }
      if (!name || !content) {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2000);
        return;
      }
      setSaveStatus("saving");
      try {
        await new Promise<void>((resolve, reject) => {
          window.dispatchEvent(
            new CustomEvent("mcp-ui-save-file", {
              detail: { name, content, resolve, reject },
            })
          );
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    }, [toolInput, toolCall.id]);

    const canSave = toolCall.name === "create_diagram";

    const hostContext = useMemo(
      () => ({
        displayMode: "inline" as const,
        availableDisplayModes: ["inline", "fullscreen"] as ("inline" | "fullscreen" | "pip")[],
        containerDimensions: {
          height: measuredHeight ?? height,
          ...(containerWidth ? { width: containerWidth } : {}),
        },
      }),
      [measuredHeight, height, containerWidth]
    );

    const sandboxUrl = useMemo(
      () =>
        typeof window !== "undefined"
          ? new URL("/sandbox_proxy.html", window.location.origin)
          : undefined,
      []
    );

    if (!html || !sandboxUrl) return null;

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ height: measuredHeight ?? height, position: "relative" }}
      >
        {canSave && (
          <button
            type="button"
            onClick={handleSaveToFiles}
            disabled={saveStatus === "saving"}
            title="Save diagram to Files"
            className="absolute right-2 top-2 z-10 rounded border border-border bg-background/90 px-2 py-1 text-xs shadow-sm hover:bg-background disabled:opacity-60"
          >
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
              ? "Saved ✓"
              : saveStatus === "error"
              ? "Save failed"
              : "Save to Files"}
          </button>
        )}
        {err ? (
          <div className="p-2 text-xs text-destructive">Chart error: {err}</div>
        ) : (
          <AppRenderer
            sandbox={{ url: sandboxUrl }}
            toolName={toolCall.name}
            html={html}
            toolInput={toolInput}
            toolResult={toolResult}
            hostContext={hostContext}
            onOpenLink={handleOpenLink}
            onSizeChanged={handleSizeChanged}
            onError={(e) => setErr(e.message)}
          />
        )}
      </div>
    );
  }
);

ChartAppRenderer.displayName = "ChartAppRenderer";
