import type { Client, Thread } from "@langchain/langgraph-sdk";

const cache = new Map<string, string | null>();
const graphByAssistant = new Map<string, Promise<string | null>>();

/** Test-only. Clears the in-memory graph cache between cases. */
export function __resetThreadOwnerCache(): void {
  cache.clear();
  graphByAssistant.clear();
}
const LS = (id: string) => `thread-graph:${id}`;

/** Server assistant ids are UUIDs; graph names (`chat`, `ba_agent`) are not. */
export function isAssistantUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Graph that owns the thread. `metadata.assistant_id` on this server is the
 * assistant UUID, which is not a graph name and must not be used for routing.
 */
export function graphFromMeta(metadata: Thread["metadata"]): string | null {
  const raw = metadata?.graph_id;
  return typeof raw === "string" && raw && !isAssistantUuid(raw) ? raw : null;
}

function readStored(id: string): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LS(id));
  return stored && !isAssistantUuid(stored) ? stored : null;
}

function writeStored(id: string, graph: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS(id), graph);
}

function graphOfAssistant(
  client: Client,
  assistantId: string
): Promise<string | null> {
  if (!isAssistantUuid(assistantId)) return Promise.resolve(assistantId);
  let pending = graphByAssistant.get(assistantId);
  if (!pending) {
    pending = client.assistants
      .get(assistantId)
      .then((assistant) =>
        assistant.graph_id && !isAssistantUuid(assistant.graph_id)
          ? assistant.graph_id
          : null
      )
      .catch(() => null);
    graphByAssistant.set(assistantId, pending);
  }
  return pending;
}

/**
 * Which graph a thread belongs to.
 *
 * Prefers `metadata.graph_id` (what LangGraph records for the run). Falls
 * through a memory cache, localStorage, then the graph of the latest run's
 * assistant. Does not write thread metadata: a previous backfill stored the
 * assistant UUID under `assistant_id` and that blocked every click.
 */
export async function resolveThreadGraph(
  client: Client,
  thread: Pick<Thread, "thread_id" | "metadata">
): Promise<string | null> {
  const fromMeta = graphFromMeta(thread.metadata);
  if (fromMeta) return fromMeta;

  const id = thread.thread_id;
  if (cache.has(id)) return cache.get(id) ?? null;

  const stored = readStored(id);
  if (stored) {
    cache.set(id, stored);
    return stored;
  }

  const [run] = await client.runs.list(id, { limit: 1 });
  const graph = run ? await graphOfAssistant(client, run.assistant_id) : null;
  cache.set(id, graph);
  if (graph) writeStored(id, graph);
  return graph;
}
