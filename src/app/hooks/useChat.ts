"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { Attachment, TodoItem } from "@/app/types/types";
import { useClient } from "@/providers/ClientProvider";
import { useAuthHeader } from "@/providers/AuthHeaderProvider";
import { HumanResponse } from "@/app/types/inbox";
import { isImageFile } from "@/app/utils/utils";
import { useQueryState } from "nuqs";

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui?: any;
};

/** A live stream/history error from `useStream.onError`, not a stale checkpoint task. */
export type StreamFailure = {
  err: unknown;
  /** true if a run was already created on the server (has run_id) */
  live: boolean;
  at: number;
};

/**
 * How long after a user-initiated Stop a server-side error is treated as the
 * expected cancellation. Bounded on purpose: an open-ended mute would also
 * swallow unrelated failures (e.g. loading a deleted thread) later on.
 */
const STOP_SILENCE_MS = 3000;

/**
 * Declared explicitly instead of relying on the SDK inferring modes from which
 * getters happen to be read during render: `todos` and `files` come from
 * `stream.values`, and a refactor that moves that read into a component would
 * otherwise silently drop the mode from the request.
 */
const STREAM_MODE = ["values", "messages-tuple"] as const;

const STATE_POLL_MS = 10_000;

/**
 * Root-graph updates arrive un-namespaced. Subagent graphs (`streamSubgraphs`)
 * prefix events with a namespace; their todos/files must not overwrite the
 * main agent's plan. If the root itself is wrapped (depth 1), the getState
 * poll still surfaces the committed checkpoint.
 */
function isMainAgentNamespace(namespace: string[] | undefined): boolean {
  return namespace == null || namespace.length === 0;
}

function todoProgress(todos: TodoItem[]): number {
  return todos.reduce(
    (n, t) =>
      n + (t.status === "completed" ? 2 : t.status === "in_progress" ? 1 : 0),
    0
  );
}

function pickTodos(
  streamed: TodoItem[] | undefined,
  polled: TodoItem[] | undefined
): TodoItem[] {
  const s = streamed ?? [];
  const p = polled ?? [];
  if (!p.length) return s;
  if (!s.length) return p;
  return todoProgress(p) > todoProgress(s) ? p : s;
}

function pickFiles(
  streamed: Record<string, string> | undefined,
  polled: Record<string, string> | undefined
): Record<string, string> {
  const s = streamed ?? {};
  const p = polled ?? {};
  return Object.keys(p).length > Object.keys(s).length ? p : s;
}

export function useChat({
  activeAssistant,
  onHistoryRevalidate,
  thread,
  recursionLimit,
}: {
  activeAssistant: Assistant | null;
  onHistoryRevalidate?: () => void;
  thread?: UseStreamThread<StateType>;
  /** Per-assistant graph step ceiling from config.json (`recursionLimit`).
   * Agents that work rather than chat need far more steps than a conversation does. */
  recursionLimit?: number;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const client = useClient();
  const { authorization } = useAuthHeader();
  const [streamFailure, setStreamFailure] = useState<StreamFailure | null>(
    null
  );
  const [polledState, setPolledState] = useState<{
    todos?: TodoItem[];
    files?: Record<string, string>;
  } | null>(null);
  const stoppedAtRef = useRef(0);
  const onHistoryRevalidateRef = useRef(onHistoryRevalidate);
  onHistoryRevalidateRef.current = onHistoryRevalidate;

  const stream = useStream<StateType>({
    assistantId: activeAssistant?.assistant_id || "",
    client: client ?? undefined,
    reconnectOnMount: true,
    threadId: threadId ?? null,
    onThreadId: setThreadId,
    defaultHeaders: {
      "x-auth-scheme": "langsmith",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    // Revalidate thread list when stream finishes, errors, or creates new thread
    onFinish: onHistoryRevalidate,
    onError: (err, run) => {
      onHistoryRevalidateRef.current?.();
      if (Date.now() - stoppedAtRef.current < STOP_SILENCE_MS) return;
      setStreamFailure({ err, live: run != null, at: Date.now() });
    },
    onCreated: onHistoryRevalidate,
    experimental_thread: thread,
    // `values|namespace` from subgraphs is dropped by the SDK (`event === "values"`).
    // `updates` go through matchEventType, so root-graph todo/file patches still land.
    onUpdateEvent: (data, { namespace, mutate }) => {
      if (!isMainAgentNamespace(namespace)) return;
      const patch: Partial<StateType> = {};
      for (const nodeUpdate of Object.values(data ?? {})) {
        if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
        const { todos, files } = nodeUpdate as Partial<StateType>;
        if (Array.isArray(todos)) patch.todos = todos;
        if (files && typeof files === "object") patch.files = files;
      }
      if (Object.keys(patch).length > 0) mutate(patch);
    },
  });

  const runStartedAtRef = useRef<number | null>(null);
  const prevIsLoadingRef = useRef(stream.isLoading);
  const [responseDurationByAiMessageId, setResponseDurationByAiMessageId] =
    useState<Record<string, number>>({});
  const [isSubmittingAttachments, setIsSubmittingAttachments] = useState(false);

  const markRunStarted = useCallback(() => {
    stoppedAtRef.current = 0;
    setStreamFailure(null);
    runStartedAtRef.current = performance.now();
  }, []);

  const reportFailure = useCallback((err: unknown, live = false) => {
    setStreamFailure({ err, live, at: Date.now() });
  }, []);

  const clearFailure = useCallback(() => {
    setStreamFailure(null);
  }, []);

  const resetThread = useCallback(() => {
    setThreadId(null);
  }, [setThreadId]);

  useEffect(() => {
    setResponseDurationByAiMessageId({});
    setStreamFailure(null);
    setPolledState(null);
    stoppedAtRef.current = 0;
  }, [threadId]);

  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    const nowLoading = stream.isLoading;
    if (wasLoading && !nowLoading && runStartedAtRef.current != null) {
      const started = runStartedAtRef.current;
      runStartedAtRef.current = null;
      const msgs = stream.messages ?? [];
      let lastAiId: string | undefined;
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i];
        if (m.type === "ai" && m.id) {
          lastAiId = m.id;
          break;
        }
      }
      if (lastAiId) {
        const durationMs = Math.round(performance.now() - started);
        setResponseDurationByAiMessageId((prev) => ({
          ...prev,
          [lastAiId!]: durationMs,
        }));
      }
    }
    if (!wasLoading && nowLoading && runStartedAtRef.current == null) {
      runStartedAtRef.current = performance.now();
    }
    prevIsLoadingRef.current = nowLoading;
  }, [stream.isLoading, stream.messages]);

  useEffect(() => {
    if (!stream.isLoading || !threadId) {
      if (!stream.isLoading) setPolledState(null);
      return;
    }

    let cancelled = false;
    let seq = 0;
    const pull = async () => {
      const my = ++seq;
      try {
        const state = await client.threads.getState<StateType>(threadId);
        if (cancelled || my !== seq) return;
        const values = state.values ?? {};
        setPolledState({
          todos: Array.isArray(values.todos) ? values.todos : undefined,
          files:
            values.files && typeof values.files === "object"
              ? values.files
              : undefined,
        });
      } catch {
        // Poll is a fallback; keep showing stream.values on failure.
      }
    };

    void pull();
    const id = window.setInterval(pull, STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [stream.isLoading, threadId, client]);

  const sendMessage = useCallback(
    async (content: string, attachments?: Attachment[]) => {
      let messageContent: Message["content"];
      const documentAttachments: Attachment[] = [];
      const inlineAttachments: Attachment[] = [];

      // Separate document attachments (to files state) from inline attachments (to message)
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.isDocument) {
            documentAttachments.push(attachment);
          } else {
            inlineAttachments.push(attachment);
          }
        }
      }

      // Images are sent inline so the model can SEE them (image_url block), but
      // their bytes must ALSO be exposed as uploads/<name> files: an image_url
      // block is vision-only and the model cannot re-encode it back to base64,
      // so without this the agent can never forward a pasted screenshot to
      // jira_add_attachment.
      const imageAttachments = inlineAttachments.filter((a) =>
        isImageFile(a.type, a.name)
      );

      // Build files map for state update (parsed documents + raw image bytes).
      let documentFiles: Record<string, string> | null = null;
      if (documentAttachments.length > 0 || imageAttachments.length > 0) {
        const currentFiles = stream.values.files ?? {};
        documentFiles = { ...currentFiles };
        for (const doc of documentAttachments) {
          documentFiles[`uploads/${doc.name}`] = doc.content;
        }
        for (const img of imageAttachments) {
          documentFiles[`uploads/${img.name}`] = img.content;
        }

        // If thread exists, update state before sending message
        if (threadId) {
          setIsSubmittingAttachments(true);
          try {
            await client.threads.updateState(threadId, {
              values: { files: documentFiles },
            });
          } finally {
            setIsSubmittingAttachments(false);
          }
        }
      }

      const hasInlineAttachments = inlineAttachments.length > 0;
      const hasDocumentAttachments = documentAttachments.length > 0;

      if (hasInlineAttachments || hasDocumentAttachments) {
        const contentBlocks: Array<{ type: "text"; text: string }> = [];

        // Add user text if present
        if (content.trim()) {
          contentBlocks.push({ type: "text", text: content });
        }

        // Add inline attachment blocks (images, text files)
        for (const attachment of inlineAttachments) {
          if (isImageFile(attachment.type, attachment.name)) {
            // Attach-only: images go to uploads/<name> (above) and are referenced
            // by path so the agent can attach them via jira_add_attachment_file.
            // We do NOT send an image_url vision block — the agents' models are
            // not guaranteed to be vision-capable (Azure returns a hard 400
            // "unsupported image" on non-vision deployments, breaking the run),
            // and the goal is to attach the file, not have the model see it.
            contentBlocks.push({
              type: "text",
              text: `[Uploaded file: uploads/${attachment.name} — use jira_add_attachment_file(issue_key, "uploads/${attachment.name}") to attach it to a Jira issue.]`,
            });
          } else {
            const isBinary = !attachment.type.startsWith("text/");
            const header = isBinary
              ? `--- File: ${attachment.name} (base64) ---`
              : `--- File: ${attachment.name} ---`;
            contentBlocks.push({
              type: "text",
              text: `${header}\n${attachment.content}`,
            });
          }
        }

        // Add references for document attachments
        for (const doc of documentAttachments) {
          contentBlocks.push({
            type: "text",
            text: `[Uploaded file: ${doc.name} - use parse_document_file("uploads/${doc.name}") to extract its text.]`,
          });
        }

        messageContent = contentBlocks;
      } else {
        messageContent = content;
      }

      const newMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: messageContent,
      };

      // Include files in submit values for new threads (no threadId yet)
      const submitValues: Record<string, unknown> = {
        messages: [newMessage],
      };
      if (documentFiles && !threadId) {
        submitValues.files = documentFiles;
      }

      markRunStarted();
      stream.submit(submitValues, {
        optimisticValues: (prev) => ({
          messages: [...(prev.messages ?? []), newMessage],
        }),
        streamMode: [...STREAM_MODE],
        streamSubgraphs: true,
        config: {
          ...(activeAssistant?.config ?? {}),
          recursion_limit: recursionLimit ?? 1000,
        },
      });
      // Update thread list immediately when sending a message
      onHistoryRevalidate?.();
    },
    [
      stream,
      activeAssistant?.config,
      onHistoryRevalidate,
      threadId,
      client,
      markRunStarted,
    ]
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[]
    ) => {
      markRunStarted();
      if (checkpoint) {
        stream.submit(undefined, {
          ...(optimisticMessages
            ? { optimisticValues: { messages: optimisticMessages } }
            : {}),
          streamMode: [...STREAM_MODE],
          streamSubgraphs: true,
          config: activeAssistant?.config,
          checkpoint: checkpoint,
          ...(isRerunningSubagent
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        });
      } else {
        stream.submit(
          { messages },
          {
            streamMode: [...STREAM_MODE],
            streamSubgraphs: true,
            config: activeAssistant?.config,
            interruptBefore: ["tools"],
          }
        );
      }
    },
    [stream, activeAssistant?.config, markRunStarted]
  );

  const setFiles = useCallback(
    async (files: Record<string, string>) => {
      if (!threadId) return;
      // TODO: missing a way how to revalidate the internal state
      // I think we do want to have the ability to externally manage the state
      await client.threads.updateState(threadId, { values: { files } });
    },
    [client, threadId]
  );

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      markRunStarted();
      stream.submit(undefined, {
        streamMode: [...STREAM_MODE],
        streamSubgraphs: true,
        config: {
          ...(activeAssistant?.config || {}),
          recursion_limit: recursionLimit ?? 1000,
        },
        ...(hasTaskToolCall
          ? { interruptAfter: ["tools"] }
          : { interruptBefore: ["tools"] }),
      });
      // Update thread list when continuing stream
      onHistoryRevalidate?.();
    },
    [stream, activeAssistant?.config, onHistoryRevalidate, markRunStarted]
  );

  const sendHumanResponse = useCallback(
    (response: HumanResponse[]) => {
      markRunStarted();
      stream.submit(null, {
        command: { resume: response },
        streamMode: [...STREAM_MODE],
        streamSubgraphs: true,
      });
      // Update thread list when resuming from interrupt
      onHistoryRevalidate?.();
    },
    [stream, onHistoryRevalidate, markRunStarted]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(null, {
      command: { goto: "__end__", update: null },
      streamMode: [...STREAM_MODE],
      streamSubgraphs: true,
    });
    // Update thread list when marking thread as resolved
    onHistoryRevalidate?.();
  }, [stream, onHistoryRevalidate]);

  const stopStream = useCallback(() => {
    stoppedAtRef.current = Date.now();
    runStartedAtRef.current = null;
    stream.stop();
  }, [stream]);

  return {
    stream,
    todos: pickTodos(stream.values.todos, polledState?.todos),
    files: pickFiles(stream.values.files, polledState?.files),
    email: stream.values.email,
    ui: stream.values.ui,
    setFiles,
    messages: stream.messages,
    responseDurationByAiMessageId,
    isLoading: stream.isLoading,
    isSubmittingAttachments,
    isThreadLoading: stream.isThreadLoading,
    interrupt: stream.interrupt,
    getMessagesMetadata: stream.getMessagesMetadata,
    sendMessage,
    runSingleStep,
    continueStream,
    stopStream,
    sendHumanResponse,
    markCurrentThreadAsResolved,
    runStartedAtRef,
    streamFailure,
    reportFailure,
    clearFailure,
    resetThread,
  };
}
