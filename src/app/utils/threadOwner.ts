import type { Client, Thread } from "@langchain/langgraph-sdk";

const cache = new Map<string, string | null>();
const LS = (id: string) => `thread-owner:${id}`;

function ownerFromMeta(metadata: Thread["metadata"]): string | null {
  const raw = metadata?.assistant_id ?? metadata?.graph_id;
  return typeof raw === "string" && raw ? raw : null;
}

function readStored(id: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LS(id));
}

function writeStored(id: string, owner: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS(id), owner);
}

/**
 * Which assistant a thread belongs to.
 *
 * Thread metadata is often empty (threads created without `metadata` on
 * submit), so fall through a memory cache, then localStorage, then the
 * assistant recorded on the thread's latest run. A resolved owner is written
 * back onto the thread when the server allows it.
 */
export async function resolveThreadOwner(
  client: Client,
  thread: Pick<Thread, "thread_id" | "metadata">
): Promise<string | null> {
  const fromMeta = ownerFromMeta(thread.metadata);
  if (fromMeta) return fromMeta;

  const id = thread.thread_id;
  if (cache.has(id)) return cache.get(id) ?? null;

  const stored = readStored(id);
  if (stored) {
    cache.set(id, stored);
    return stored;
  }

  const [run] = await client.runs.list(id, { limit: 1 });
  const owner = run?.assistant_id ?? null;
  cache.set(id, owner);
  if (!owner) return null;

  writeStored(id, owner);
  void client.threads
    .update(id, {
      metadata: { ...(thread.metadata ?? {}), assistant_id: owner },
    })
    .catch(() => {});
  return owner;
}
