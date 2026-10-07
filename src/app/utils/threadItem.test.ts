import { describe, expect, it } from "vitest";
import type { Thread } from "@langchain/langgraph-sdk";
import { buildThreadSearchParams, toThreadItem } from "@/app/utils/threadItem";

const UUID = "11111111-1111-4111-8111-111111111111";

function thread(over: Partial<Thread> = {}): Thread {
  return {
    thread_id: "abcdef12-rest",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T03:04:05.000Z",
    status: "idle",
    metadata: {},
    values: {},
    ...over,
  } as Thread;
}

describe("buildThreadSearchParams", () => {
  it("filters by graph name only for the agent scope", () => {
    expect(
      buildThreadSearchParams({
        pageIndex: 2,
        pageSize: 20,
        status: "busy",
        scope: "agent",
        assistantId: "ba_agent",
      })
    ).toEqual({
      limit: 20,
      offset: 40,
      sortBy: "updated_at",
      sortOrder: "desc",
      status: "busy",
      metadata: { graph_id: "ba_agent" },
    });

    expect(
      buildThreadSearchParams({
        pageIndex: 0,
        pageSize: 20,
        scope: "all",
        assistantId: "ba_agent",
      }).metadata
    ).toBeUndefined();

    expect(
      buildThreadSearchParams({
        pageIndex: 0,
        pageSize: 20,
        scope: "agent",
        assistantId: "",
      }).metadata
    ).toBeUndefined();
  });
});

describe("toThreadItem", () => {
  it("prefers thread_name and still takes the description from the first AI message", () => {
    const item = toThreadItem(
      thread({
        metadata: { thread_name: "  Weekly  ", graph_id: "ba_agent" },
        values: {
          messages: [
            { type: "human", content: "ignored because of the name" },
            { type: "ai", content: "a".repeat(120) },
          ],
        },
      })
    );
    expect(item.title).toBe("Weekly");
    expect(item.description).toBe("a".repeat(100));
    expect(item.assistantId).toBe("ba_agent");
    expect(item.updatedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  it("truncates the first human message at 50 characters", () => {
    const exact = toThreadItem(
      thread({
        values: { messages: [{ type: "human", content: "a".repeat(50) }] },
      })
    );
    expect(exact.title).toBe("a".repeat(50));

    const long = toThreadItem(
      thread({
        values: {
          messages: [
            {
              type: "human",
              content: [{ text: "b".repeat(51) }],
            },
          ],
        },
      })
    );
    expect(long.title).toBe(`${"b".repeat(50)}...`);
  });

  it("falls back when values.messages is missing and ignores UUID graph ids", () => {
    const item = toThreadItem(
      thread({
        thread_id: "abcdef12-rest",
        metadata: { graph_id: UUID },
        values: {},
      })
    );
    expect(item.title).toBe("Thread abcdef12");
    expect(item.assistantId).toBeNull();
    expect(item.description).toBe("");
  });

  it("keeps a metadata title when message parsing throws", () => {
    const item = toThreadItem(
      thread({
        metadata: { thread_name: "kept" },
        values: { messages: null },
      })
    );
    expect(item.title).toBe("kept");
  });

  it("stays untitled when there is no name and no messages", () => {
    expect(toThreadItem(thread({ values: { messages: [] } })).title).toBe(
      "Untitled Thread"
    );
  });
});
