import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthHeaderProvider } from "@/providers/AuthHeaderProvider";
import { useThreads } from "@/app/hooks/useThreads";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  constructors: [] as Array<{
    apiUrl: string;
    defaultHeaders: Record<string, string>;
  }>,
}));

vi.mock("@langchain/langgraph-sdk", () => ({
  Client: class {
    threads = { search: mocks.search };
    constructor(opts: {
      apiUrl: string;
      defaultHeaders: Record<string, string>;
    }) {
      mocks.constructors.push(opts);
    }
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthHeaderProvider>{children}</AuthHeaderProvider>
    </SWRConfig>
  );
}

function saveConfig() {
  localStorage.setItem(
    "deep-agent-config",
    JSON.stringify({
      deploymentUrl: "http://lg.test",
      assistantId: "ba_agent",
      langsmithApiKey: "key",
      llmModelName: "gpt",
    })
  );
}

beforeEach(() => {
  mocks.search.mockReset();
  mocks.search.mockResolvedValue([]);
  mocks.constructors.length = 0;
  localStorage.clear();
});

describe("useThreads", () => {
  it("does not search until auth is ready, then filters by graph name", async () => {
    saveConfig();
    let resolveAuth: (value: {
      ok: boolean;
      json: () => Promise<{ authorization: string }>;
    }) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAuth = resolve;
          })
      )
    );

    const { result } = renderHook(() => useThreads({ scope: "agent" }), {
      wrapper,
    });
    expect(mocks.search).not.toHaveBeenCalled();

    await act(async () => {
      resolveAuth({
        ok: true,
        json: async () => ({ authorization: "Bearer tok" }),
      });
    });

    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        metadata: { graph_id: "ba_agent" },
      })
    );
    expect(mocks.constructors.at(-1)?.defaultHeaders).toMatchObject({
      "X-Api-Key": "key",
      Authorization: "Bearer tok",
    });
    expect(result.current.error).toBeUndefined();
  });

  it("does not send graph metadata when the scope is all threads", async () => {
    saveConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ authorization: null }),
      }))
    );
    renderHook(() => useThreads({ scope: "all" }), { wrapper });
    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
    expect(mocks.search.mock.calls[0][0].metadata).toBeUndefined();
  });

  it("stops when a page comes back empty", async () => {
    saveConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ authorization: null }),
      }))
    );
    const { result } = renderHook(() => useThreads({}), { wrapper });
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.setSize(3);
    });
    expect(mocks.search.mock.calls.every((call) => call[0].offset === 0)).toBe(
      true
    );
  });

  it("does not search when there is no saved config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ authorization: null }),
      }))
    );
    renderHook(() => useThreads({}), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
