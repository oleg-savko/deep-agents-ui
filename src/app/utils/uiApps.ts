import type { ToolCall } from "@/app/types/types";

/**
 * True when the tool call's artifact contains an HTML resource block — i.e. it
 * produced an MCP-UI iframe. Single source of truth for "is this a UI tool
 * call", replacing per-name (chart/diagram/form) checks.
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

/** UI tool calls a message's `[[app]]` placeholders resolve to. */
export function resolveUiToolCalls(
  toolCalls: ToolCall[],
  turnToolCalls?: ToolCall[]
): ToolCall[] {
  const source =
    toolCalls.some(hasUIArtifact) || !turnToolCalls?.length
      ? toolCalls
      : turnToolCalls;
  return source.filter(hasUIArtifact);
}
