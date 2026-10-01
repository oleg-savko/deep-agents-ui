import type { Message } from "@langchain/langgraph-sdk";
import type { TodoItem } from "@/app/types/types";

/**
 * Root-graph updates arrive un-namespaced. Subagent graphs (`streamSubgraphs`)
 * prefix events with a namespace; their todos/files must not overwrite the
 * main agent's plan. If the root itself is wrapped (depth 1), the getState
 * poll still surfaces the committed checkpoint.
 */
export function isMainAgentNamespace(namespace: string[] | undefined): boolean {
  return namespace == null || namespace.length === 0;
}

export function todoProgress(todos: TodoItem[]): number {
  return todos.reduce(
    (n, t) =>
      n + (t.status === "completed" ? 2 : t.status === "in_progress" ? 1 : 0),
    0
  );
}

export function pickTodos(
  streamed: TodoItem[] | undefined,
  polled: TodoItem[] | undefined
): TodoItem[] {
  const s = streamed ?? [];
  const p = polled ?? [];
  if (!p.length) return s;
  if (!s.length) return p;
  return todoProgress(p) > todoProgress(s) ? p : s;
}

export function pickFiles(
  streamed: Record<string, string> | undefined,
  polled: Record<string, string> | undefined
): Record<string, string> {
  const s = streamed ?? {};
  const p = polled ?? {};
  return Object.keys(p).length > Object.keys(s).length ? p : s;
}

/** Merge todos/files out of a root-graph `updates` event. Non-objects are ignored. */
export function extractStatePatch(
  data: Record<string, unknown> | null | undefined
): { todos?: TodoItem[]; files?: Record<string, string> } {
  const patch: { todos?: TodoItem[]; files?: Record<string, string> } = {};
  for (const nodeUpdate of Object.values(data ?? {})) {
    if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
    const { todos, files } = nodeUpdate as {
      todos?: unknown;
      files?: unknown;
    };
    if (Array.isArray(todos)) patch.todos = todos as TodoItem[];
    if (files && typeof files === "object") {
      patch.files = files as Record<string, string>;
    }
  }
  return patch;
}

export function lastAiMessageId(
  messages: Pick<Message, "type" | "id">[] | undefined
): string | undefined {
  const msgs = messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.type === "ai" && m.id) return m.id;
  }
  return undefined;
}
