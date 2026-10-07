import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Assistant } from "@langchain/langgraph-sdk";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/app/hooks/useChat";

const stream = vi.hoisted(() => ({
  isLoading: false,
  messages: [] as Array<{ type: string; id?: string; content: string }>,
  values: {} as {
    todos?: Array<{ id: string; content: string; status: "completed" }>;
    files?: Record<string, string>;
  },
  submit: vi.fn(),
  stop: vi.fn(),
  getMessagesMetadata: vi.fn(),
  options: null as null | {
    onError: (err: unknown, run: unknown) => void;
    onCreated: (run: { thread_id: string }) => void;
    onThreadId: (id: string) => void;
  },
}));

const client = vi.hoisted(() => ({
  threads: {
    updateState: vi.fn(),
    getState: vi.fn(),
  },
  runs: { list: vi.fn(), get: vi.fn() },
}));

vi.mock("@langchain/langgraph-sdk/react", () => ({
  useStream: (options: typeof stream.options) => {
    stream.options = options;
    return {
      submit: stream.submit,
      stop: stream.stop,
      get isLoading() {
        return stream.isLoading;
      },
      get messages() {
        return stream.messages;
      },
      get values() {
        return stream.values;
      },
      isThreadLoading: false,
      interrupt: undefined,
      getMessagesMetadata: stream.getMessagesMetadata,
    };
  },
}));

vi.mock("@/providers/ClientProvider", () => ({
  useClient: () => client,
}));

vi.mock("@/providers/AuthHeaderProvider", () => ({
  useAuthHeader: () => ({ authorization: null, ready: true }),
}));

const assistant = {
  assistant_id: "chat",
  config: { tags: ["t"] },
} as unknown as Assistant;

function wrapper({ children }: { children: ReactNode }) {
  return <NuqsTestingAdapter hasMemory>{children}</NuqsTestingAdapter>;
}

beforeEach(() => {
  stream.isLoading = false;
  stream.messages = [];
  stream.values = {};
  stream.submit.mockReset();
  stream.stop.mockReset();
  stream.options = null;
  client.threads.getState.mockReset();
  client.threads.getState.mockResolvedValue({ values: {} });
  client.threads.updateState.mockReset();
  client.runs.list.mockReset();
  client.runs.list.mockResolvedValue([]);
  client.runs.get.mockReset();
  client.runs.get.mockRejectedValue(new Error("not found"));
});

describe("useChat", () => {
  it("refuses to send on a thread owned by another agent", async () => {
    const { result } = renderHook(
      () => useChat({ activeAssistant: assistant, runsBlocked: true }),
      { wrapper }
    );
    await expect(result.current.sendMessage("hi")).rejects.toThrow(
      /another agent/
    );
    expect(stream.submit).not.toHaveBeenCalled();
  });

  it("reports a new thread once, whether the id arrives via onCreated or onThreadId", async () => {
    const onThreadCreated = vi.fn();
    const { result } = renderHook(
      () => useChat({ activeAssistant: assistant, onThreadCreated }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sendMessage("hi");
    });
    await act(async () => {
      stream.options?.onCreated({ thread_id: "thread-1" });
    });
    await act(async () => {
      await stream.options?.onThreadId("thread-1");
    });
    expect(onThreadCreated).toHaveBeenCalledTimes(1);
    expect(onThreadCreated).toHaveBeenCalledWith("thread-1");
  });

  it("does not report the thread again when onThreadId wins the race", async () => {
    const onThreadCreated = vi.fn();
    const { result } = renderHook(
      () => useChat({ activeAssistant: assistant, onThreadCreated }),
      { wrapper }
    );
    await act(async () => {
      await result.current.sendMessage("again");
    });
    await act(async () => {
      await stream.options?.onThreadId("thread-2");
    });
    await waitFor(() => expect(onThreadCreated).toHaveBeenCalledTimes(1));
    await act(async () => {
      stream.options?.onCreated({ thread_id: "thread-2" });
    });
    expect(onThreadCreated).toHaveBeenCalledTimes(1);
  });

  it("swallows a server error for 3s after Stop, then records the next one", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(
        () => useChat({ activeAssistant: assistant }),
        { wrapper }
      );
      act(() => {
        result.current.stopStream();
      });
      act(() => {
        stream.options?.onError(new Error("cancel"), { id: "run" });
      });
      expect(result.current.streamFailure).toBeNull();

      act(() => {
        vi.advanceTimersByTime(3001);
      });
      act(() => {
        stream.options?.onError(new Error("boom"), { id: "run" });
      });
      expect(result.current.streamFailure).toMatchObject({ live: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stamps the response duration onto the last AI message when loading ends", async () => {
    const { result, rerender } = renderHook(
      () => useChat({ activeAssistant: assistant }),
      {
        wrapper: ({ children }) => (
          <NuqsTestingAdapter
            hasMemory
            searchParams="?threadId=thread-1"
          >
            {children}
          </NuqsTestingAdapter>
        ),
      }
    );
    await act(async () => {
      await result.current.sendMessage("hi");
    });
    stream.isLoading = true;
    rerender();
    stream.isLoading = false;
    stream.messages = [{ type: "ai", id: "ai-1", content: "done" }];
    rerender();
    expect(result.current.responseDurationByAiMessageId["ai-1"]).toEqual(
      expect.any(Number)
    );
  });

  it("clears a failure and polled state when the thread changes", async () => {
    client.threads.getState
      .mockResolvedValueOnce({
        values: {
          todos: [{ id: "1", content: "ship", status: "completed" }],
          files: { "a.txt": "a" },
        },
      })
      .mockResolvedValue({ values: {} });

    const { result, rerender } = renderHook(
      () => useChat({ activeAssistant: assistant }),
      {
        wrapper: ({ children }) => (
          <NuqsTestingAdapter
            hasMemory
            searchParams="?threadId=thread-1"
          >
            {children}
          </NuqsTestingAdapter>
        ),
      }
    );

    act(() => {
      stream.options?.onError(new Error("load failed"), null);
    });
    expect(result.current.streamFailure?.live).toBe(false);

    stream.isLoading = true;
    rerender();
    await waitFor(() => expect(result.current.todos).toHaveLength(1));

    await act(async () => {
      await stream.options?.onThreadId("thread-2");
    });
    await waitFor(() => expect(result.current.streamFailure).toBeNull());
    await waitFor(() => expect(result.current.todos).toEqual([]));
  });
});
