import { describe, expect, it } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import type { ToolCall } from "@/app/types/types";
import { buildTurnUiContext, resolveUiToolCalls } from "@/app/utils/uiApps";

function tool(id: string, html = true): ToolCall {
  return {
    id,
    name: "ask_user_form",
    args: {},
    status: "completed",
    artifact: html
      ? {
          content_blocks: [
            { type: "resource", resource: { mimeType: "text/html" } },
          ],
        }
      : { content_blocks: [{ type: "text" }] },
  };
}

function message(type: Message["type"], content: Message["content"]): Message {
  return {
    type,
    content,
    id: `${type}-${String(content).slice(0, 8)}`,
  } as Message;
}

describe("resolveUiToolCalls", () => {
  it("keeps only tool calls that produced an HTML resource", () => {
    const ui = tool("ui");
    const plain = tool("plain", false);
    expect(resolveUiToolCalls([ui, plain]).map((t) => t.id)).toEqual(["ui"]);
  });

  it("falls back to the turn's tool calls when this message has none", () => {
    const ui = tool("ui");
    expect(
      resolveUiToolCalls([tool("plain", false)], [ui]).map((t) => t.id)
    ).toEqual(["ui"]);
    expect(resolveUiToolCalls([tool("plain", false)])).toEqual([]);
    expect(resolveUiToolCalls([])).toEqual([]);
  });

  it("ignores artifacts that are not HTML resource blocks", () => {
    const broken: ToolCall = {
      id: "x",
      name: "n",
      args: {},
      status: "completed",
      artifact: { content_blocks: "nope" },
    };
    const empty: ToolCall = {
      id: "y",
      name: "n",
      args: {},
      status: "completed",
    };
    expect(resolveUiToolCalls([broken, empty])).toEqual([]);
  });
});

describe("buildTurnUiContext", () => {
  it("renders each ask form once, keeping the later placeholder in the turn", () => {
    const form = tool("form-1");
    const { turnToolCallsByIndex, hiddenAppIdsByIndex } = buildTurnUiContext([
      { message: message("human", "go"), toolCalls: [] },
      {
        message: message("ai", "calling [[app]]"),
        toolCalls: [form],
      },
      {
        message: message("ai", "answer [[app]]"),
        toolCalls: [],
      },
      { message: message("human", "next"), toolCalls: [] },
      {
        message: message("ai", "again [[app]]"),
        toolCalls: [tool("form-2")],
      },
    ]);

    expect(turnToolCallsByIndex[2].map((t) => t.id)).toEqual(["form-1"]);
    expect([...hiddenAppIdsByIndex[1]]).toEqual(["form-1"]);
    expect([...hiddenAppIdsByIndex[2]]).toEqual([]);
    expect([...hiddenAppIdsByIndex[0]]).toEqual([]);
    expect([...hiddenAppIdsByIndex[4]]).toEqual([]);
    expect(turnToolCallsByIndex[4]).toEqual([]);
  });
});
