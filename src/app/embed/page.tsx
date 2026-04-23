"use client";

import { useMemo } from "react";
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
const EMBED_MODEL_NAME = "litellm:openai/gemma-4-26B-A4B-it-AWQ-4bit";

export default function EmbedPage() {
  const [_threadId, setThreadId] = useQueryState("threadId");
  const { authorization, ready } = useAuthHeader();

  const langsmithApiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";
  const assistant: Assistant = useMemo(() => ({
      assistant_id: EMBED_ASSISTANT_ID,
      graph_id: EMBED_ASSISTANT_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      config: {
        configurable: {
          LLM_MODEL: EMBED_MODEL_NAME,
          PROJECT: undefined,
        },
      },
      metadata: {},
      version: 1,
      name: "Embed Assistant",
      context: {},
  }), []);

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
