import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Thread } from "@langchain/langgraph-sdk";
import {
  __resetThreadOwnerCache,
  graphFromMeta,
  isAssistantUuid,
  resolveThreadGraph,
} from "@/app/utils/threadOwner";

const UUID = "11111111-1111-4111-8111-111111111111";

function client(over: {
  runs?: { assistant_id: string }[];
  graphId?: string | null;
  getError?: boolean;
}) {
  const get = vi.fn();
  if (over.getError) get.mockRejectedValue(new Error("nope"));
  else get.mockResolvedValue({ graph_id: over.graphId });
  return {
    runs: { list: vi.fn().mockResolvedValue(over.runs ?? []) },
    assistants: { get },
  } as unknown as Client & {
    runs: { list: ReturnType<typeof vi.fn> };
    assistants: { get: ReturnType<typeof vi.fn> };
  };
}

function thread(
  id: string,
  metadata: Thread["metadata"] = {}
): Pick<Thread, "thread_id" | "metadata"> {
  return { thread_id: id, metadata };
}

beforeEach(() => {
  __resetThreadOwnerCache();
  localStorage.clear();
});

describe("isAssistantUuid / graphFromMeta", () => {
  it("rejects UUIDs as graph names", () => {
    expect(isAssistantUuid(UUID)).toBe(true);
    expect(isAssistantUuid("ba_agent")).toBe(false);
    expect(graphFromMeta({ graph_id: "chat" })).toBe("chat");
    expect(graphFromMeta({ graph_id: UUID })).toBeNull();
    expect(graphFromMeta({ graph_id: "" })).toBeNull();
    expect(graphFromMeta(undefined)).toBeNull();
    expect(graphFromMeta({ graph_id: 1 })).toBeNull();
  });
});

describe("resolveThreadGraph", () => {
  it("prefers metadata and does not hit the server", async () => {
    const c = client({});
    await expect(
      resolveThreadGraph(c, thread("t1", { graph_id: "chat" }))
    ).resolves.toBe("chat");
    expect(c.runs.list).not.toHaveBeenCalled();
  });

  it("reads localStorage, then serves the memory cache", async () => {
    localStorage.setItem("thread-graph:t1", "ba_agent");
    const c = client({});
    await expect(resolveThreadGraph(c, thread("t1"))).resolves.toBe("ba_agent");
    localStorage.clear();
    await expect(resolveThreadGraph(c, thread("t1"))).resolves.toBe("ba_agent");
    expect(c.runs.list).not.toHaveBeenCalled();
  });

  it("ignores a UUID stored in localStorage and resolves via the latest run", async () => {
    localStorage.setItem("thread-graph:t1", UUID);
    const c = client({
      runs: [{ assistant_id: UUID }],
      graphId: "chat",
    });
    await expect(resolveThreadGraph(c, thread("t1"))).resolves.toBe("chat");
    expect(localStorage.getItem("thread-graph:t1")).toBe("chat");
    expect(c.assistants.get).toHaveBeenCalledWith(UUID);
  });

  it("returns a non-uuid assistant id from the run without fetching the assistant", async () => {
    const c = client({ runs: [{ assistant_id: "chat" }] });
    await expect(resolveThreadGraph(c, thread("t1"))).resolves.toBe("chat");
    expect(c.assistants.get).not.toHaveBeenCalled();
  });

  it("never returns a UUID graph id", async () => {
    const c = client({
      runs: [{ assistant_id: UUID }],
      graphId: UUID,
    });
    await expect(resolveThreadGraph(c, thread("t1"))).resolves.toBeNull();
    expect(localStorage.getItem("thread-graph:t1")).toBeNull();
  });

  it("returns null when the thread has no runs or the assistant lookup fails", async () => {
    const empty = client({ runs: [] });
    await expect(resolveThreadGraph(empty, thread("t1"))).resolves.toBeNull();

    __resetThreadOwnerCache();
    const failing = client({
      runs: [{ assistant_id: UUID }],
      getError: true,
    });
    await expect(resolveThreadGraph(failing, thread("t2"))).resolves.toBeNull();
  });

  it("dedupes parallel assistant lookups", async () => {
    let resolveGet: (value: { graph_id: string }) => void = () => {};
    const get = vi.fn(
      () =>
        new Promise<{ graph_id: string }>((resolve) => {
          resolveGet = resolve;
        })
    );
    const c = {
      runs: {
        list: vi.fn().mockResolvedValue([{ assistant_id: UUID }]),
      },
      assistants: { get },
    } as unknown as Client;

    const first = resolveThreadGraph(c, thread("t1"));
    const second = resolveThreadGraph(c, thread("t2"));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    resolveGet({ graph_id: "chat" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      "chat",
      "chat",
    ]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
