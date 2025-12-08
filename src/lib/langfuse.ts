"use client";

import { LangfuseWeb } from "langfuse";

let langfuseInstance: LangfuseWeb | null = null;

export function getLangfuseClient(): LangfuseWeb | null {
  // Only initialize on client side
  if (typeof window === "undefined") {
    return null;
  }

  // Return existing instance if already initialized
  if (langfuseInstance) {
    return langfuseInstance;
  }

  // Get environment variables
  const publicKey = process.env.NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_LANGFUSE_HOST;

  // Only initialize if we have the required keys
  if (!publicKey) {
    console.warn("Langfuse public key not found. User feedback will be disabled.");
    return null;
  }

  try {
    langfuseInstance = new LangfuseWeb({
      publicKey,
      baseUrl: baseUrl || undefined,
    });
    return langfuseInstance;
  } catch (error) {
    console.error("Failed to initialize Langfuse:", error);
    return null;
  }
}

export function sendFeedback({
  traceId,
  value,
  comment,
}: {
  traceId: string;
  value: number; // Float score between 0.0 and 1.0
  comment?: string;
}) {
  const langfuse = getLangfuseClient();
  if (!langfuse) {
    return;
  }

  if (!traceId) {
    console.warn("No trace ID provided for feedback");
    return;
  }

  console.log("Sending feedback to Langfuse:", traceId, value, comment);
  try {
    // Send feedback to Langfuse using the trace ID from the backend
    // The trace ID should come from getActiveTraceId() in the backend
    // and be set as the message.id via generateMessageId
    langfuse.score({
      traceId,
      name: "user-feedback",
      value,
      comment,
    });
  } catch (error) {
    console.error("Failed to send feedback to Langfuse:", error);
  }
}
