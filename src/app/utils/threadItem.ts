import type { Thread } from "@langchain/langgraph-sdk";
import { graphFromMeta } from "@/app/utils/threadOwner";

export interface ThreadItem {
  id: string;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  /** Owning assistant, or null when the thread has never been run. */
  assistantId: string | null;
}

export type ThreadScope = "agent" | "all";

export function buildThreadSearchParams({
  pageIndex,
  pageSize,
  status,
  scope,
  assistantId,
}: {
  pageIndex: number;
  pageSize: number;
  status?: Thread["status"];
  scope: ThreadScope;
  assistantId: string;
}) {
  return {
    limit: pageSize,
    offset: pageIndex * pageSize,
    sortBy: "updated_at" as const,
    sortOrder: "desc" as const,
    status,
    // Filter on the graph name. `assistant_id` here is a server UUID and
    // matching the sidebar's `chat` / `ba_agent` against it returns nothing.
    ...(scope === "agent" && assistantId
      ? { metadata: { graph_id: assistantId } }
      : {}),
  };
}

export function toThreadItem(thread: Thread): ThreadItem {
  let title = "Untitled Thread";
  let description = "";

  const meta = thread.metadata;
  const threadNameFromMeta =
    meta &&
    typeof meta.thread_name === "string" &&
    meta.thread_name.trim().length > 0
      ? meta.thread_name.trim()
      : null;
  if (threadNameFromMeta) {
    title = threadNameFromMeta;
  }

  try {
    if (thread.values && typeof thread.values === "object") {
      const values = thread.values as any;
      const firstHumanMessage = values.messages.find(
        (m: any) => m.type === "human"
      );
      if (!threadNameFromMeta && firstHumanMessage?.content) {
        const content =
          typeof firstHumanMessage.content === "string"
            ? firstHumanMessage.content
            : firstHumanMessage.content[0]?.text || "";
        title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      }
      const firstAiMessage = values.messages.find((m: any) => m.type === "ai");
      if (firstAiMessage?.content) {
        const content =
          typeof firstAiMessage.content === "string"
            ? firstAiMessage.content
            : firstAiMessage.content[0]?.text || "";
        description = content.slice(0, 100);
      }
    }
  } catch {
    if (!threadNameFromMeta) {
      title = `Thread ${thread.thread_id.slice(0, 8)}`;
    }
  }

  return {
    id: thread.thread_id,
    updatedAt: new Date(thread.updated_at),
    status: thread.status,
    title,
    description,
    assistantId: graphFromMeta(thread.metadata),
  };
}
