"use client";

import useSWRInfinite from "swr/infinite";
import type { Thread } from "@langchain/langgraph-sdk";
import { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";
import { useAuthHeader } from "@/providers/AuthHeaderProvider";
import { graphFromMeta, resolveThreadGraph } from "@/app/utils/threadOwner";

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

const DEFAULT_PAGE_SIZE = 20;

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
  scope?: ThreadScope;
}) {
  const scope = props.scope ?? "agent";
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;
  const { authorization, ready: authReady } = useAuthHeader();

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      const config = getConfig();
      const apiKey =
        config?.langsmithApiKey ||
        process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
        "";

      // Minimal fix: don't disable threads when apiKey is empty.
      // Many deployments don't require an API key, and the original
      // `!apiKey` check caused the hook to never run.
      if (!config) {
        return null;
      }

      if (!authReady) {
        return null;
      }

      // If the previous page returned no items, we've reached the end
      if (previousPageData && previousPageData.length === 0) {
        return null;
      }

      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: config.deploymentUrl,
        assistantId: scope === "agent" ? config.assistantId : "",
        scope,
        apiKey,
        authorization: authorization ?? "",
        status: props?.status,
      };
    },
    async ({
      deploymentUrl,
      assistantId,
      scope: pageScope,
      apiKey,
      authorization,
      status,
      pageIndex,
      pageSize,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      scope: ThreadScope;
      apiKey: string;
      authorization: string;
      status?: Thread["status"];
    }) => {
      const defaultHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      };
      if (authorization) {
        defaultHeaders["Authorization"] = authorization;
      }

      const client = new Client({
        apiUrl: deploymentUrl,
        defaultHeaders,
      });

      const threads = await client.threads.search({
        limit: pageSize,
        offset: pageIndex * pageSize,
        sortBy: "updated_at",
        sortOrder: "desc",
        status,
        // Filter on the graph name. `assistant_id` here is a server UUID and
        // matching the sidebar's `chat` / `ba_agent` against it returns nothing.
        ...(pageScope === "agent" && assistantId
          ? { metadata: { graph_id: assistantId } }
          : {}),
      });

      const items = threads.map((thread): ThreadItem => {
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
            const firstAiMessage = values.messages.find(
              (m: any) => m.type === "ai"
            );
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
      });

      await Promise.all(
        items.map(async (item, index) => {
          if (item.assistantId) return;
          try {
            item.assistantId = await resolveThreadGraph(client, threads[index]);
          } catch {
            item.assistantId = null;
          }
        })
      );

      return items;
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
    }
  );
}
