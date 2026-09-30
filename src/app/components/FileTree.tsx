"use client";

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildFileTree,
  collapsedLabel,
  collectDirPaths,
  filterFileTree,
  initialExpandedPaths,
  type FileTreeNode,
} from "@/app/utils/fileTree";

const CODE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "json",
  "yml",
  "yaml",
  "sh",
  "bash",
  "sql",
  "xml",
  "html",
  "css",
  "scss",
  "toml",
]);

const SHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

function fileIcon(name: string) {
  const ext = name.includes(".")
    ? name.split(".").pop()?.toLowerCase() ?? ""
    : "";
  if (SHEET_EXTENSIONS.has(ext)) return FileSpreadsheet;
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  return FileText;
}

function formatModified(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  return format(date, "MM/dd");
}

function FileTreeRow({
  node,
  depth,
  expanded,
  forceOpen,
  onToggle,
  onOpen,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  forceOpen: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const isDir = node.type === "dir";
  const open = isDir && (forceOpen || expanded.has(node.path));
  const Icon = isDir ? (open ? FolderOpen : Folder) : fileIcon(node.name);
  const label = isDir ? node.displayName : node.name;

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm hover:bg-[var(--color-file-button-hover)]"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.path}
      >
        {isDir ? (
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon
          size={14}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {isDir ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {node.fileCount}
          </span>
        ) : (
          node.modifiedAt && (
            <span className="shrink-0 pl-2 text-xs text-muted-foreground">
              {formatModified(node.modifiedAt)}
            </span>
          )
        )}
      </button>
      {isDir &&
        open &&
        node.children.map((child) => (
          <FileTreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            forceOpen={forceOpen}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

export function FileTree({
  files,
  onOpen,
}: {
  files: Record<string, unknown>;
  onOpen: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const fileKey = useMemo(() => Object.keys(files).sort().join("\0"), [files]);
  const [query, setQuery] = useState("");
  // Keyed by the path set so a content-only files update doesn't collapse
  // folders the user opened. A new path resets to the default expansion.
  const [expandedFor, setExpandedFor] = useState<{
    key: string;
    paths: Set<string>;
  }>(() => ({
    key: fileKey,
    paths: new Set(initialExpandedPaths(tree.nodes)),
  }));
  if (expandedFor?.key !== fileKey) {
    setExpandedFor({
      key: fileKey,
      paths: new Set(initialExpandedPaths(tree.nodes)),
    });
  }
  const expanded =
    expandedFor?.key === fileKey ? expandedFor.paths : new Set<string>();

  const forceOpen = query.trim().length > 0;
  const visibleNodes = useMemo(
    () => filterFileTree(tree.nodes, query),
    [tree.nodes, query]
  );
  const hasDirs = useMemo(
    () => tree.nodes.some((node) => node.type === "dir"),
    [tree.nodes]
  );

  const copyRoot = async () => {
    if (!tree.rootPrefix) return;
    try {
      await navigator.clipboard.writeText(tree.rootPrefix);
      toast.success("Copied path");
    } catch {
      toast.error("Couldn't copy path");
    }
  };

  return (
    <div className="mb-2">
      <div className="mb-2 flex items-center gap-1.5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files"
          className="h-8"
          aria-label="Filter files"
        />
        {hasDirs && (
          <>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Expand all"
              onClick={() =>
                setExpandedFor({
                  key: fileKey,
                  paths: new Set(collectDirPaths(tree.nodes)),
                })
              }
            >
              <ChevronsUpDown size={14} />
            </button>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Collapse all"
              onClick={() => setExpandedFor({ key: fileKey, paths: new Set() })}
            >
              <ChevronsDownUp size={14} />
            </button>
          </>
        )}
      </div>

      {tree.rootPrefix && (
        <div className="group mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate">
                {collapsedLabel(tree.rootPrefix)}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-md break-all"
            >
              {tree.rootPrefix}
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Copy path"
            onClick={copyRoot}
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {visibleNodes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          No matching files
        </p>
      ) : (
        visibleNodes.map((node) => (
          <FileTreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            forceOpen={forceOpen}
            onToggle={(path) =>
              setExpandedFor((prev) => {
                const next = new Set(
                  prev?.key === fileKey ? prev.paths : expanded
                );
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return { key: fileKey, paths: next };
              })
            }
            onOpen={onOpen}
          />
        ))
      )}
    </div>
  );
}
