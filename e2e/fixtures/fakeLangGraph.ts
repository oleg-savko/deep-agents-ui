import type { Page, Route } from "@playwright/test";

export const DEPLOYMENT = "http://fake-langgraph.test";

type ThreadRecord = {
  thread_id: string;
  created_at: string;
  updated_at: string;
  status: "idle" | "busy" | "interrupted" | "error";
  metadata: Record<string, unknown>;
  values: { messages?: Array<Record<string, unknown>> };
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Location",
};

function now() {
  return new Date().toISOString();
}

function thread(
  partial: Partial<ThreadRecord> & Pick<ThreadRecord, "thread_id">
): ThreadRecord {
  const stamp = now();
  return {
    created_at: stamp,
    updated_at: stamp,
    status: "idle",
    metadata: { graph_id: "chat" },
    values: { messages: [] },
    ...partial,
  };
}

function sse(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map(
      (item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`
    )
    .join("");
}

function htmlArtifact(name: string) {
  return {
    content_blocks: [
      {
        type: "resource",
        resource: {
          uri: `ui://apps/${name}`,
          mimeType: "text/html",
          text: `<!doctype html><html><body><p>${name}</p></body></html>`,
        },
      },
    ],
  };
}

export function askFormThread(): ThreadRecord {
  return thread({
    thread_id: "thread-form",
    metadata: { graph_id: "chat", thread_name: "Ask form" },
    values: {
      messages: [
        { type: "human", id: "h-form", content: "need a form" },
        {
          type: "ai",
          id: "ai-tool",
          content: "opening [[app]]",
          tool_calls: [{ id: "form-1", name: "ask_user_form", args: {} }],
        },
        {
          type: "tool",
          id: "tool-form",
          tool_call_id: "form-1",
          name: "ask_user_form",
          content: "{}",
          artifact: htmlArtifact("ask_user_form"),
        },
        { type: "ai", id: "ai-final", content: "confirm [[app]]" },
      ],
    },
  });
}

export async function installFakeLangGraph(
  page: Page,
  seed: ThreadRecord[] = []
) {
  const threads = new Map<string, ThreadRecord>(
    seed.map((item) => [item.thread_id, item])
  );
  let seq = 0;

  await page.addInitScript(
    (config) => {
      localStorage.setItem("deep-agent-config", JSON.stringify(config));
    },
    {
      deploymentUrl: DEPLOYMENT,
      assistantId: "chat",
      llmModelName: "gpt",
      langsmithApiKey: "test-key",
    }
  );

  await page.route("**/api/auth/header", (route) =>
    route.fulfill({ json: { authorization: null } })
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        deployments: [{ value: DEPLOYMENT, label: "Fake" }],
        assistants: [
          { value: "chat", label: "Chat", defaultModel: "gpt" },
          { value: "ba_agent", label: "BA" },
        ],
        projects: [],
        _access: {
          authenticated: false,
          userGroups: [],
          email: null,
          name: null,
          totalAssistants: 2,
          visibleAssistants: 2,
        },
      },
    })
  );

  await page.route(`${DEPLOYMENT}/**`, (route) =>
    handle(route, threads, () => `thread-${++seq}`)
  );
}

async function handle(
  route: Route,
  threads: Map<string, ThreadRecord>,
  nextId: () => string
) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }

  const url = new URL(request.url());
  const path = url.pathname;
  const json = () =>
    request.postData()
      ? (request.postDataJSON() as Record<string, unknown>)
      : {};

  const fulfill = (
    body: unknown,
    status = 200,
    extra: Record<string, string> = {}
  ) =>
    route.fulfill({
      status,
      headers: { ...cors, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  if (path === "/health") {
    await fulfill({ status: "healthy" });
    return;
  }

  if (request.method() === "POST" && path === "/threads") {
    const body = json();
    const metadata = (body.metadata as Record<string, unknown>) ?? {};
    const created = thread({
      thread_id: nextId(),
      metadata: { graph_id: "chat", ...metadata },
    });
    threads.set(created.thread_id, created);
    await fulfill(created);
    return;
  }

  if (request.method() === "POST" && path === "/threads/search") {
    const body = json();
    const graph = (body.metadata as { graph_id?: string } | undefined)
      ?.graph_id;
    const list = [...threads.values()].filter((item) =>
      graph ? item.metadata.graph_id === graph : true
    );
    await fulfill(list);
    return;
  }

  const threadMatch = path.match(/^\/threads\/([^/]+)(\/.*)?$/);
  if (!threadMatch) {
    await fulfill({ error: `unhandled ${request.method()} ${path}` }, 404);
    return;
  }

  const id = decodeURIComponent(threadMatch[1]);
  const rest = threadMatch[2] ?? "";
  const current = threads.get(id);
  if (!current) {
    await fulfill({ error: `missing thread ${id}` }, 404);
    return;
  }

  if (rest === "" && request.method() === "GET") {
    await fulfill(current);
    return;
  }
  if (rest === "/state" && request.method() === "GET") {
    await fulfill({
      values: current.values,
      metadata: current.metadata,
      next: [],
      tasks: [],
      checkpoint: { checkpoint_id: "cp", thread_id: id },
    });
    return;
  }
  if (rest === "/history" && request.method() === "POST") {
    await fulfill([
      {
        values: current.values,
        metadata: current.metadata,
        next: [],
        tasks: [],
        checkpoint: { checkpoint_id: "cp", thread_id: id },
        created_at: current.updated_at,
      },
    ]);
    return;
  }
  if (rest === "/runs" && request.method() === "GET") {
    await fulfill([]);
    return;
  }
  if (rest === "/state" && request.method() === "POST") {
    const body = json();
    const values = (body.values as ThreadRecord["values"]) ?? {};
    current.values = { ...current.values, ...values };
    await fulfill({ ok: true });
    return;
  }
  if (rest === "/runs/stream" && request.method() === "POST") {
    const body = json();
    const input = (body.input ?? {}) as {
      messages?: Array<Record<string, unknown>>;
    };
    const incoming = Array.isArray(input.messages) ? input.messages : [];
    const ai = {
      type: "ai",
      id: "ai-reply",
      content: "Hello from the agent",
    };
    current.values = {
      messages: [...(current.values.messages ?? []), ...incoming, ai],
    };
    current.updated_at = now();
    const runId = "run-1";
    await route.fulfill({
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Content-Location": `/threads/${id}/runs/${runId}`,
      },
      body: sse([
        { event: "metadata", data: { run_id: runId, thread_id: id } },
        { event: "values", data: current.values },
        {
          event: "messages",
          data: [ai, { tags: [] }],
        },
      ]),
    });
    return;
  }

  await fulfill({ error: `unhandled ${request.method()} ${path}` }, 404);
}
