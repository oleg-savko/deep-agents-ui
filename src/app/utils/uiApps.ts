import type { Message } from "@langchain/langgraph-sdk";
import type { ToolCall } from "@/app/types/types";
import { extractStringFromMessageContent } from "@/app/utils/utils";

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

export interface TurnMessage {
  message: Message;
  toolCalls: ToolCall[];
}

/**
 * Per-message turn tool calls and the UI apps that must stay hidden because a
 * later message in the same turn already rendered them. One iframe per tool
 * call: when both the tool message and the final answer carry `[[app]]`, the
 * later one wins.
 */
export function buildTurnUiContext(messages: TurnMessage[]): {
  turnToolCallsByIndex: ToolCall[][];
  hiddenAppIdsByIndex: Set<string>[];
} {
  const turnToolCallsByIndex: ToolCall[][] = [];
  let currentTurn: ToolCall[] = [];
  for (const m of messages) {
    if (m.message.type === "human") {
      currentTurn = [];
      turnToolCallsByIndex.push([]);
      continue;
    }
    turnToolCallsByIndex.push(currentTurn);
    if (m.toolCalls.length > 0) {
      currentTurn = [...currentTurn, ...m.toolCalls];
    }
  }

  const hiddenAppIdsByIndex: Set<string>[] = new Array(messages.length);
  const claimed = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.message.type === "human") {
      claimed.clear();
      hiddenAppIdsByIndex[i] = new Set();
      continue;
    }
    const text = extractStringFromMessageContent(m.message);
    const refs = text.includes("[[app")
      ? resolveUiToolCalls(m.toolCalls, turnToolCallsByIndex[i])
      : [];
    hiddenAppIdsByIndex[i] = new Set(
      refs.filter((tc) => claimed.has(tc.id)).map((tc) => tc.id)
    );
    refs.forEach((tc) => claimed.add(tc.id));
  }

  return { turnToolCallsByIndex, hiddenAppIdsByIndex };
}
