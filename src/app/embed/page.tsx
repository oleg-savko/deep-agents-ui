"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Assistant } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { ClientProvider } from "@/providers/ClientProvider";
import { ChatProvider } from "@/providers/ChatProvider";
import { useAuthHeader } from "@/providers/AuthHeaderProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { Button } from "@/components/ui/button";

const EMBED_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_EMBED_DEPLOYMENT_URL || "";
const EMBED_ASSISTANT_ID = "mt_chat";

type ConfigModel = { value: string; label: string };

type ConfigAssistant = {
  value: string;
  defaultModel?: string;
  models?: ConfigModel[];
};

type RuntimeConfig = { assistants?: ConfigAssistant[] };

function EmbedPageContent() {
  const [_threadId, setThreadId] = useQueryState("threadId");
  const { authorization, ready } = useAuthHeader();
  const [embedModelName, setEmbedModelName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/config", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as RuntimeConfig;
        const assistant = (data.assistants ?? []).find(
          (assistant) => assistant.value === EMBED_ASSISTANT_ID
        );
        if (!assistant) return;
        const modelFromList =
          assistant.models?.find((model) => model.value.includes("gemma"))?.value ??
          assistant.defaultModel ??
          assistant.models?.[0]?.value;
        if (!cancelled && modelFromList) {
          setEmbedModelName(modelFromList);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const langsmithApiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";
  const assistant: Assistant = useMemo(
    () => ({
      assistant_id: EMBED_ASSISTANT_ID,
      graph_id: EMBED_ASSISTANT_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      config: {
        configurable: {
          LLM_MODEL: embedModelName,
          PROJECT: undefined
        }
      },
      metadata: {},
      version: 1,
      name: "Embed Assistant",
      context: {}
    }),
    [embedModelName]
  );

  if (ready && !authorization) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Authorization token is required for embedded chat.
        </div>
      </div>
    );
  }

  return (
      <ClientProvider
        deploymentUrl={EMBED_DEPLOYMENT_URL}
        apiKey={langsmithApiKey}
      >
        <div className="flex h-screen flex-col">
          <div className="flex items-center justify-end border-b border-border px-4 py-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setThreadId(null)}
            >
              New chat
            </Button>
          </div>
          <ChatProvider activeAssistant={assistant}>
            <ChatInterface
              assistant={assistant}
              debugMode={false}
              hideInternalToggle
              isAttachmentsAllowed={false}
              controls={<></>}
              skeleton={
                <div className="flex items-center justify-center p-8">
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              }
            />
          </ChatProvider>
        </div>
      </ClientProvider>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <EmbedPageContent />
    </Suspense>
  );
}