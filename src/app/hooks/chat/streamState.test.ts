import { describe, expect, it } from "vitest";
import type { TodoItem } from "@/app/types/types";
import {
  extractStatePatch,
  isMainAgentNamespace,
  lastAiMessageId,
  pickFiles,
  pickTodos,
} from "@/app/hooks/chat/streamState";

function todo(status: TodoItem["status"], id: string = status): TodoItem {
  return { id, content: id, status };
}

describe("isMainAgentNamespace", () => {
  it("treats a missing or empty namespace as the root graph", () => {
    expect(isMainAgentNamespace(undefined)).toBe(true);
    expect(isMainAgentNamespace([])).toBe(true);
    expect(isMainAgentNamespace(["tools:1"])).toBe(false);
  });
});

describe("pickTodos", () => {
  it("prefers whichever snapshot has more progress", () => {
    const streamed = [todo("pending"), todo("in_progress")];
    const polled = [todo("completed")];
    expect(pickTodos(streamed, polled)).toBe(polled);
    expect(pickTodos(polled, streamed)).toBe(polled);
  });

  it("keeps the streamed list when progress is tied or the poll is empty", () => {
    const streamed = [todo("completed", "a")];
    const polled = [todo("completed", "b")];
    expect(pickTodos(streamed, polled)).toBe(streamed);
    expect(pickTodos(streamed, [])).toBe(streamed);
    expect(pickTodos(undefined, undefined)).toEqual([]);
  });

  it("falls back to the poll when the stream has no todos", () => {
    const polled = [todo("pending")];
    expect(pickTodos([], polled)).toBe(polled);
    expect(pickTodos(undefined, polled)).toBe(polled);
  });
});

describe("pickFiles", () => {
  it("prefers the map with more keys and the stream on a tie", () => {
    const streamed = { a: "1" };
    const polled = { a: "1", b: "2" };
    expect(pickFiles(streamed, polled)).toBe(polled);
    expect(pickFiles(polled, streamed)).toBe(polled);
    expect(pickFiles({ a: "1" }, { b: "2" })).toEqual({ a: "1" });
    expect(pickFiles(undefined, undefined)).toEqual({});
  });
});

describe("extractStatePatch", () => {
  it("merges todos and files and ignores non-objects", () => {
    expect(
      extractStatePatch({
        skip: null,
        also: "nope",
        tools: { todos: [todo("completed")] },
        filesNode: { files: { "a.txt": "hi" } },
      })
    ).toEqual({
      todos: [todo("completed")],
      files: { "a.txt": "hi" },
    });
    expect(extractStatePatch(null)).toEqual({});
    expect(extractStatePatch({ node: { files: null, todos: "x" } })).toEqual(
      {}
    );
  });
});

describe("lastAiMessageId", () => {
  it("returns the last AI message that has an id", () => {
    expect(lastAiMessageId(undefined)).toBeUndefined();
    expect(
      lastAiMessageId([
        { type: "human", id: "h" },
        { type: "ai", id: "a1" },
        { type: "ai" },
        { type: "tool", id: "t" },
      ])
    ).toBe("a1");
  });
});
