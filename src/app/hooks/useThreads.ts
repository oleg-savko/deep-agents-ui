"use client";

import useSWRInfinite from "swr/infinite";
import type { Thread } from "@langchain/langgraph-sdk";
import { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";
import { useAuthHeader } from "@/providers/AuthHeaderProvider";
import { resolveThreadGraph } from "@/app/utils/threadOwner";
import {
  buildThreadSearchParams,
  toThreadItem,
  type ThreadItem,
  type ThreadScope,
} from "@/app/utils/threadItem";

export type { ThreadItem, ThreadScope };

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

      const threads = await client.threads.search(
        buildThreadSearchParams({
          pageIndex,
          pageSize,
          status,
          scope: pageScope,
          assistantId,
        })
      );

      const items = threads.map((thread) => toThreadItem(thread));

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
