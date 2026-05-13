"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import {
  LoaderCircle,
  Square,
  ArrowUp,
  CheckCircle,
  Clock,
  Circle,
  FileIcon,
  Paperclip,
  X,
  ImageIcon,
  File as FileIconLucide,
  Sparkles,
} from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import type { Attachment, SubAgentRun, TodoItem, ToolCall } from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import {
  extractImagesFromMessageContent,
  extractStringFromMessageContent,
  isDocumentFile,
  isImageFile,
  isPreparingToCallTaskTool,
  isTextFile,
  resolveImageMimeType,
} from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_DEFAULT,
  MAX_FILE_SIZE_LARGE,
} from "@/app/consts/files";

const EXAMPLE_QUESTION_MAX_LENGTH = 140;

interface ChatInterfaceProps {
  assistant: Assistant | null;
  debugMode: boolean;
  agentDescription?: string;
  exampleQuestions?: string[];
  // Optional controlled view props from host app
  view?: "chat" | "workflow";
  onViewChange?: (view: "chat" | "workflow") => void;
  hideInternalToggle?: boolean;
  InterruptActionsRenderer?: React.ComponentType;
  onInput?: (input: string) => void;

  controls: React.ReactNode;
  banner?: React.ReactNode;
  skeleton: React.ReactNode;
  isAttachmentsAllowed?: boolean;
}

function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isImage = isImageFile(file.type, file.name);
    const isDocument = isDocumentFile(file.type, file.name);
    const isText = isTextFile(file.type, file.name);
    const makeId = () =>
      `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    if (isImage) {
      // Read as base64 for images - also generate a preview
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        resolve({
          id: makeId(),
          name: file.name,
          type: resolveImageMimeType(file.type, file.name) ?? file.type,
          size: file.size,
          preview: dataUrl,
          content: base64,
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    } else if (isDocument) {
      // Read as base64 for documents - will be uploaded to files state and parsed server-side
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        resolve({
          id: makeId(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          content: base64,
          isDocument: true,
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    } else if (isText) {
      // Read as text for text files
      reader.onload = () => {
        resolve({
          id: makeId(),
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          content: reader.result as string,
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    } else {
      // Read as base64 for other binary files
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        resolve({
          id: makeId(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          content: base64,
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};

export const ChatInterface = React.memo<ChatInterfaceProps>(
  ({
    assistant,
    debugMode,
    agentDescription,
    exampleQuestions,
    view,
    onViewChange,
    onInput,
    controls,
    banner,
    hideInternalToggle,
    skeleton,
    isAttachmentsAllowed = true,
  }) => {
    const [threadId] = useQueryState("threadId");
    const [agentId] = useQueryState("agentId");
    const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
    const tasksContainerRef = useRef<HTMLDivElement | null>(null);
    const [isWorkflowView, setIsWorkflowView] = useState(false);
    const isMountedRef = useRef(true);

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [loadingAttachmentIds, setLoadingAttachmentIds] = useState<Set<string>>(
      () => new Set()
    );
    const [isDragOver, setIsDragOver] = useState(false);
    const isControlledView = typeof view !== "undefined";
    const workflowView = isControlledView
      ? view === "workflow"
      : isWorkflowView;

    useEffect(() => {
      isMountedRef.current = true;

      return () => {
        isMountedRef.current = false;
      };
    }, []);

    useEffect(() => {
      const timeout = setTimeout(() => void textareaRef.current?.focus());

      return () => clearTimeout(timeout);
    }, [threadId, agentId]);

    const setView = useCallback(
      (view: "chat" | "workflow") => {
        onViewChange?.(view);
        if (!isControlledView) {
          setIsWorkflowView(view === "workflow");
        }
      },
      [onViewChange, isControlledView]
    );

    const [input, _setInput] = useState("");
    const { scrollRef, contentRef } = useStickToBottom();

    const inputCallbackRef = useRef(onInput);
    inputCallbackRef.current = onInput;

    const setInput = useCallback(
      (value: string) => {
        _setInput(value);
        inputCallbackRef.current?.(value);
      },
      [inputCallbackRef]
    );

    const processFiles = useCallback(
      async (fileList: FileList | File[]) => {
        if (!isAttachmentsAllowed) return;
        const files = Array.from(fileList);
        const validFiles = files.filter((f) => {
          const isImage = isImageFile(f.type, f.name);
          const isDoc = isDocumentFile(f.type, f.name);
          const isTxt = isTextFile(f.type, f.name);

          const isAllowed = isImage || isDoc || isTxt;

          if (!isAllowed) {
            toast.error(`File "${f.name}" has unsupported type, skipping.`);

            return false;
          }

          // Allow much larger size for non-image, non-text "documents"
          // (this includes meeting recordings: audio/video files).
          const maxSize =
            isDoc && !isImage && !isTxt
              ? MAX_FILE_SIZE_LARGE
              : MAX_FILE_SIZE_DEFAULT;

          if (f.size > maxSize) {
            const limitMb = (maxSize / (1024 * 1024)).toFixed(0);
            console.warn(
              `File "${f.name}" exceeds ${limitMb} MB limit for this type, skipping.`
            );

            return false;
          }

          return true;
        });
        if (validFiles.length === 0) return;

        const filesWithTempIds = validFiles.map((file) => ({
          file,
          tempId: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }));

        const tempAttachments = filesWithTempIds.map(({ file, tempId }) => ({
          id: tempId,
          name: file.name,
          type: resolveImageMimeType(file.type, file.name) ?? file.type,
          size: file.size,
          content: "",
        }));

        setAttachments((prev) => [...prev, ...tempAttachments]);

        setLoadingAttachmentIds((prev) => {
          const next = new Set(prev);
          filesWithTempIds.forEach(({ tempId }) => next.add(tempId));

          return next;
        });

        const newAttachments = await Promise.all(
          filesWithTempIds.map(async ({ file, tempId }) => ({
            tempId,
            attachment: {
              ...(await readFileAsAttachment(file)),
              id: tempId,
            },
          }))
        );

        if (!isMountedRef.current) {
          return;
        }

        setAttachments((prev) => {
          const byTempId = new Map(
            newAttachments.map(({ tempId, attachment }) => [tempId, attachment])
          );

          return prev.map((attachment) => byTempId.get(attachment.id) ?? attachment);
        });

        setLoadingAttachmentIds((prev) => {
          const next = new Set(prev);
          filesWithTempIds.forEach(({ tempId }) => next.delete(tempId));

          return next;
        });
      },
      [isAttachmentsAllowed]
    );

    const removeAttachment = useCallback((id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    }, []);

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
          processFiles(e.target.files);
          // Reset the input so the same file can be selected again
          e.target.value = "";
        }
      },
      [processFiles]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processFiles(e.dataTransfer.files);
        }
      },
      [processFiles]
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }
        if (imageFiles.length > 0) {
          e.preventDefault();
          processFiles(imageFiles);
        }
      },
      [processFiles]
    );

    const {
      stream,
      messages,
      todos,
      files,
      ui,
      setFiles,
      isLoading,
      isThreadLoading,
      interrupt,
      getMessagesMetadata,
      sendMessage,
      runSingleStep,
      continueStream,
      stopStream,
      responseDurationByAiMessageId,
    } = useChatContext();

    const subAgentRunsCacheRef = useRef<Record<string, SubAgentRun>>({});

    useEffect(() => {
      // Reset cached subagent timelines when switching threads.
      subAgentRunsCacheRef.current = {};
    }, [threadId, agentId]);

    // Bridge for child components (e.g. ChartAppRenderer) to save a file into
    // the thread's Files panel without prop-drilling `setFiles`. The detail
    // carries `resolve`/`reject` so the caller can show save-progress UI.
    useEffect(() => {
      const onSave = (e: Event) => {
        const detail = (
          e as CustomEvent<{
            name: string;
            content: string;
            resolve?: () => void;
            reject?: (err: unknown) => void;
          }>
        ).detail;
        if (!detail?.name || typeof detail.content !== "string") {
          detail?.reject?.(new Error("invalid save payload"));
          return;
        }
        setFiles({ ...(files ?? {}), [detail.name]: detail.content })
          .then(() => detail.resolve?.())
          .catch((err) => detail.reject?.(err));
      };
      window.addEventListener("mcp-ui-save-file", onSave);

      return () => window.removeEventListener("mcp-ui-save-file", onSave);
    }, [files, setFiles]);


    const isUploadingAttachments = loadingAttachmentIds.size > 0;
    const submitDisabled = isLoading || isUploadingAttachments || !assistant;
    const hasAttachments = attachments.length > 0;

    // Bridge for child MCP-app iframes (e.g. jira_required_fields_ui submit)
    // to post a user message into the conversation without prop-drilling
    // `sendMessage`. The detail carries `resolve`/`reject` so the caller can
    // await delivery and reflect submit-progress UI.
    useEffect(() => {
      const onSend = (e: Event) => {
        const detail = (
          e as CustomEvent<{
            text: string;
            resolve?: () => void;
            reject?: (err: unknown) => void;
          }>
        ).detail;
        if (!detail?.text || typeof detail.text !== "string") {
          detail?.reject?.(new Error("invalid message payload"));
          return;
        }
        try {
          sendMessage(detail.text);
          detail.resolve?.();
        } catch (err) {
          detail.reject?.(err);
        }
      };
      window.addEventListener("mcp-ui-send-message", onSend);
      return () => window.removeEventListener("mcp-ui-send-message", onSend);
    }, [sendMessage]);

    const handleSubmit = useCallback(
      (e?: FormEvent) => {
        if (e) {
          e.preventDefault();
        }
        if (submitDisabled) return;

        const messageText = input.trim();
        if ((!messageText && !hasAttachments) || isLoading) return;

        sendMessage(
          messageText,
          hasAttachments ? attachments : undefined
        );

        setInput("");
        setAttachments([]);
      },
      [
        input,
        isLoading,
        sendMessage,
        setInput,
        submitDisabled,
        hasAttachments,
        attachments,
      ]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (submitDisabled) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit, submitDisabled]
    );

    const handleContinue = useCallback(() => {
      const preparingToCallTaskTool = isPreparingToCallTaskTool(messages);
      continueStream(preparingToCallTaskTool);
    }, [continueStream, messages]);

    const handleRestartFromAIMessage = useCallback(
      (message: Message) => {
        if (!debugMode) return;
        const meta = getMessagesMetadata(message);
        const { parent_checkpoint: parentCheckpoint } =
          meta?.firstSeenState ?? {};
        const msgIndex = messages.findIndex((m) => m.id === message.id);
        runSingleStep(
          [],
          parentCheckpoint ?? undefined,
          false,
          messages.slice(0, msgIndex)
        );
      },
      [debugMode, runSingleStep, messages, getMessagesMetadata]
    );

    const handleRestartFromSubTask = useCallback(
      (toolCallId: string) => {
        if (!debugMode) return;
        const msgIndex = messages.findIndex(
          (m) => m.type === "tool" && m.tool_call_id === toolCallId
        );
        const meta = getMessagesMetadata(messages[msgIndex]);
        const { parent_checkpoint: parentCheckpoint } =
          meta?.firstSeenState ?? {};
        runSingleStep(
          [],
          parentCheckpoint ?? undefined,
          true,
          messages.slice(0, msgIndex)
        );
      },
      [debugMode, runSingleStep, messages, getMessagesMetadata]
    );

    // Reserved: additional UI state
    // TODO: can we make this part of the hook?
    const { processedMessages, subAgentRunsByTaskId, totalTokenUsage } = useMemo(() => {
      /*
     1. Loop through all messages
     2. For each AI message, add the AI message, and any tool calls to the messageMap
     3. For each tool message, find the corresponding tool call in the messageMap and update the status and output
    */
      const extractToolCallsFromAiMessage = (
        message: Message & { type: "ai" }
      ): Array<{
        id?: string;
        function?: { name?: string; arguments?: unknown };
        name?: string;
        type?: string;
        args?: unknown;
        input?: unknown;
      }> => {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];
        const msgAny = message as any;
        if (
          msgAny.additional_kwargs?.tool_calls &&
          Array.isArray(msgAny.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...msgAny.additional_kwargs.tool_calls);
        } else if (msgAny.tool_calls && Array.isArray(msgAny.tool_calls)) {
          toolCallsInMessage.push(
            ...msgAny.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== ""
            )
          );
        } else if (Array.isArray(msgAny.content)) {
          const toolUseBlocks = msgAny.content.filter(
            (block: { type?: string }) => block.type === "tool_use"
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }

        return toolCallsInMessage;
      };

      const toToolCall = (
        raw: {
        id?: string;
        function?: { name?: string; arguments?: unknown };
        name?: string;
        type?: string;
        args?: unknown;
        input?: unknown;
        },
        order?: number
      ): ToolCall => {
        const name =
          raw.function?.name || raw.name || raw.type || "unknown";
        const rawArgs =
          raw.function?.arguments || raw.args || raw.input || {};
        let args: Record<string, unknown> = {};
        try {
          args =
            typeof rawArgs === "string"
              ? (JSON.parse(rawArgs) as Record<string, unknown>)
              : rawArgs && typeof rawArgs === "object"
                ? (rawArgs as Record<string, unknown>)
                : {};
        } catch {
          args = { raw: rawArgs };
        }

        return {
          id: raw.id || `tool-${Math.random()}`,
          name,
          args,
          status: interrupt ? "interrupted" : "pending",
          order,
        };
      };

      const messageMap = new Map<
        string,
        { message: Message; toolCalls: ToolCall[] }
      >();

      // Derive subagent (task tool) “run windows” and internal progress/tool calls.
      // This is best-effort: if the backend does not stream internal subagent messages,
      // the run will simply have empty progress/toolCalls (and the UI falls back to input/output).
      const subAgentRunsByTaskId = new Map<string, SubAgentRun>();
      const activeTaskStack: string[] = [];
      const activeTaskBySubAgentType = new Map<string, string>();

      const inferActiveTaskIdForMessage = (message: Message): string | null => {
        if (activeTaskStack.length > 0) {
          return activeTaskStack[activeTaskStack.length - 1] ?? null;
        }
        try {
          const meta = getMessagesMetadata(message) as any;
          const activeAssistantName =
            meta?.activeAssistant?.name ??
            meta?.activeAssistant?.assistant_id ??
            meta?.active_assistant?.name;
          if (typeof activeAssistantName === "string" && activeAssistantName) {
            return activeTaskBySubAgentType.get(activeAssistantName) ?? null;
          }
        } catch {
          // ignore
        }
        return null;
      };

      messages.forEach((message: Message, messageIndex: number) => {
        if (message.type === "ai") {
          const inferredTaskId = inferActiveTaskIdForMessage(message);
          const toolCallsInMessage = extractToolCallsFromAiMessage(message);
          const toolCallsWithStatus = toolCallsInMessage.map((tc) =>
            toToolCall(tc, messageIndex)
          );
          // AI messages produced while a subagent (`task`) run is active should only
          // appear in the subagent timeline, not the main chat transcript.
          if (!inferredTaskId) {
            messageMap.set(message.id!, {
              message,
              toolCalls: toolCallsWithStatus,
            });
          }

          // If we’re currently inside a task run, collect AI progress text and nested tool calls.
          if (inferredTaskId && message.id) {
            const run = subAgentRunsByTaskId.get(inferredTaskId);
            if (run) {
              const text = extractStringFromMessageContent(message).trim();
              if (text) {
                run.progress.push({
                  messageId: message.id,
                  order: messageIndex,
                  text,
                });
              }
              for (const tc of toolCallsWithStatus) {
                // Don’t treat nested `task` calls as regular tool calls (they have their own run).
                if (tc.name === "task") continue;
                if (run.toolCalls.some((x) => x.id === tc.id)) continue;
                run.toolCalls.push(tc);
              }
              const usage = (message as any).usage_metadata;
              if (usage) {
                const prev = run.tokenUsage ?? { input: 0, output: 0, total: 0 };
                run.tokenUsage = {
                  input: prev.input + (usage.input_tokens ?? 0),
                  output: prev.output + (usage.output_tokens ?? 0),
                  total: prev.total + (usage.total_tokens ?? 0),
                };
              }
            }
          }

          // Detect new task runs (subagents).
          for (const tc of toolCallsWithStatus) {
            if (tc.name !== "task") continue;
            // Each task tool call id is the stable identifier to match the tool result message.
            const taskId = tc.id;
            if (!taskId) continue;
            if (!subAgentRunsByTaskId.has(taskId)) {
              const subAgentType =
                typeof tc.args?.["subagent_type"] === "string"
                  ? (tc.args["subagent_type"] as string)
                  : undefined;
              const msgCreatedAt = (getMessagesMetadata(message) as any)
                ?.firstSeenState?.created_at as string | undefined;
              const startedAt = msgCreatedAt
                ? new Date(msgCreatedAt).getTime()
                : subAgentRunsCacheRef.current[taskId]?.startedAt ?? Date.now();
              subAgentRunsByTaskId.set(taskId, {
                taskToolCallId: taskId,
                subAgentType,
                status: tc.status,
                progress: [],
                toolCalls: [],
                startedAt,
              });
              activeTaskStack.push(taskId);
              if (subAgentType) {
                activeTaskBySubAgentType.set(subAgentType, taskId);
              }
            }
          }
        } else if (message.type === "tool") {
          const toolCallId = message.tool_call_id;
          if (!toolCallId) {
            return;
          }
          for (const [, data] of messageMap.entries()) {
            const toolCallIndex = data.toolCalls.findIndex(
              (tc: ToolCall) => tc.id === toolCallId
            );
            if (toolCallIndex === -1) {
              continue;
            }
            const artifact = (message as any).artifact;
            data.toolCalls[toolCallIndex] = {
              ...data.toolCalls[toolCallIndex],
              status: "completed" as const,
              result: extractStringFromMessageContent(message),
              artifact: artifact ?? undefined,
              resultImages: extractImagesFromMessageContent(message),
            };
            break;
          }

          // If this tool result closes a task, mark it completed and pop from stack.
          const taskRun = subAgentRunsByTaskId.get(toolCallId);
          if (taskRun) {
            taskRun.status = interrupt ? "interrupted" : "completed";
            const toolMsgCreatedAt = (getMessagesMetadata(message) as any)
              ?.firstSeenState?.created_at as string | undefined;
            taskRun.endedAt = toolMsgCreatedAt
              ? new Date(toolMsgCreatedAt).getTime()
              : subAgentRunsCacheRef.current[toolCallId]?.endedAt ?? Date.now();
            // Pop only if it’s on stack; tolerate out-of-order/interleaving.
            const idx = activeTaskStack.lastIndexOf(toolCallId);
            if (idx !== -1) {
              activeTaskStack.splice(idx, 1);
            }
            if (taskRun.subAgentType) {
              const current = activeTaskBySubAgentType.get(taskRun.subAgentType);
              if (current === toolCallId) {
                activeTaskBySubAgentType.delete(taskRun.subAgentType);
              }
            }
            return;
          }

          // Otherwise, it may be a nested tool call result inside the current task run.
          const inferredTaskId = inferActiveTaskIdForMessage(message);
          if (inferredTaskId) {
            const run = subAgentRunsByTaskId.get(inferredTaskId);
            if (run) {
              const nestedIdx = run.toolCalls.findIndex((tc) => tc.id === toolCallId);
              const toolResultText = extractStringFromMessageContent(message);
              const toolResultImages = extractImagesFromMessageContent(message);
              if (nestedIdx !== -1) {
                run.toolCalls[nestedIdx] = {
                  ...run.toolCalls[nestedIdx],
                  status: "completed",
                  result: toolResultText,
                  resultImages: toolResultImages,
                };
              }
            }
          }
        } else if (message.type === "human") {
          messageMap.set(message.id!, {
            message,
            toolCalls: [],
          });
        }
      });
      const processedArray = Array.from(messageMap.values());
      const processedMessages = processedArray.map((data, index) => {
        const prevMessage =
          index > 0 ? processedArray[index - 1].message : null;

        return {
          ...data,
          showAvatar: data.message.type !== prevMessage?.type,
        };
      });
      const computedRuns = Object.fromEntries(subAgentRunsByTaskId.entries());

      // Merge with cached runs so stream-only subgraph events don’t disappear
      // once the run finishes and the persisted message history is reloaded.
      const merged: Record<string, SubAgentRun> = {
        ...subAgentRunsCacheRef.current,
        ...computedRuns,
      };
      for (const [taskId, run] of Object.entries(computedRuns)) {
        const prev = subAgentRunsCacheRef.current[taskId];
        if (!prev) continue;

        // Preserve previously seen timeline items if the newly computed run is empty.
        if (run.progress.length === 0 && prev.progress.length > 0) {
          merged[taskId] = { ...merged[taskId], progress: prev.progress };
        }
        if (run.toolCalls.length === 0 && prev.toolCalls.length > 0) {
          merged[taskId] = { ...merged[taskId], toolCalls: prev.toolCalls };
        }
        if (!run.tokenUsage && prev.tokenUsage) {
          merged[taskId] = { ...merged[taskId], tokenUsage: prev.tokenUsage };
        }
      }

      subAgentRunsCacheRef.current = merged;

      // Aggregate token usage across all AI messages in the thread.
      const totalTokenUsage = messages.reduce(
        (acc, msg) => {
          if (msg.type !== "ai") return acc;
          const usage = (msg as any).usage_metadata;
          if (!usage) return acc;
          return {
            input: acc.input + (usage.input_tokens ?? 0),
            output: acc.output + (usage.output_tokens ?? 0),
            total: acc.total + (usage.total_tokens ?? 0),
          };
        },
        { input: 0, output: 0, total: 0 },
      );
      const hasTotalUsage = totalTokenUsage.total > 0;

      return {
        processedMessages,
        subAgentRunsByTaskId: merged,
        totalTokenUsage: hasTotalUsage ? totalTokenUsage : undefined,
      };
    }, [messages, interrupt, getMessagesMetadata]);

    const toggle = !hideInternalToggle && (
      <div className="flex w-full justify-center">
        <div className="flex h-[24px] w-[134px] items-center gap-0 overflow-hidden rounded border border-[#D1D1D6] bg-white p-[3px] text-[12px] shadow-sm">
          <button
            type="button"
            onClick={() => setView("chat")}
            className={cn(
              "flex h-full flex-1 items-center justify-center truncate rounded p-[3px]",
              { "bg-[#F4F3FF]": !workflowView }
            )}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setView("workflow")}
            className={cn(
              "flex h-full flex-1 items-center justify-center truncate rounded p-[3px]",
              { "bg-[#F4F3FF]": workflowView }
            )}
          >
            Workflow
          </button>
        </div>
      </div>
    );

    if (isWorkflowView) {
      return (
        <div className="flex h-full w-full flex-col font-sans">
          {toggle}
          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
              {isThreadLoading && (
                <div className="absolute left-0 top-0 z-10 flex h-full w-full justify-center pt-[100px]">
                  <LoaderCircle className="flex h-[50px] w-[50px] animate-spin items-center justify-center text-primary" />
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4">
                <div className="flex h-full w-full items-stretch">
                  <div className="flex h-full w-full flex-1">
                    {/* <AgentGraphVisualization
                      configurable={
                        (getMessagesMetadata(messages[messages.length - 1])
                          ?.activeAssistant?.config?.configurable as any) || {}
                      }
                      name={
                        getMessagesMetadata(messages[messages.length - 1])
                          ?.activeAssistant?.name || "Agent"
                      }
                    /> */}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const groupedTodos = {
      in_progress: todos.filter((t) => t.status === "in_progress"),
      pending: todos.filter((t) => t.status === "pending"),
      completed: todos.filter((t) => t.status === "completed"),
    };

    const hasTasks = todos.length > 0;
    const hasFiles = Object.keys(files).length > 0;

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    };

    const handleInputResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
      const el = textareaRef.current;
      if (!el) return;

      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const startY = e.clientY;
      const startHeight = el.offsetHeight || 0;

      const onMove = (moveEvent: PointerEvent) => {
        const delta = startY - moveEvent.clientY;
        const minHeight = 32; // px
        const maxHeight = 240; // px (~6+ lines)
        const next = Math.min(
          maxHeight,
          Math.max(minHeight, startHeight + delta)
        );
        el.style.height = `${next}px`;
      };

      const onUp = () => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    };

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          ref={scrollRef}
        >
          <div
            className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
            ref={contentRef}
          >
            {isThreadLoading ? (
              skeleton
            ) : (
              <>
                {processedMessages.length === 0 && (agentDescription ?? assistant?.name) && (
                  <div className="flex min-h-[70vh] flex-col">
                    <div className="flex flex-1 items-center justify-center px-6">
                      <div className="max-w-lg text-center opacity-60">
                        <p className="text-lg font-semibold text-foreground">
                          {assistant?.name ?? assistant?.assistant_id}
                        </p>
                        {agentDescription && (
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {agentDescription}
                          </p>
                        )}
                      </div>
                    </div>
                    {exampleQuestions && exampleQuestions.length > 0 && (
                      <div className="flex w-full max-w-xl flex-col gap-3 px-6 pb-2 pt-8">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#2F6868]">
                          <Sparkles size={14} />
                          <span>Try asking</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {exampleQuestions.map((question, i) => {
                            const isTruncated =
                              question.length > EXAMPLE_QUESTION_MAX_LENGTH;
                            const displayText = isTruncated
                              ? `${question.slice(0, EXAMPLE_QUESTION_MAX_LENGTH).trimEnd()}…`
                              : question;
                            const button = (
                              <button
                                type="button"
                                onClick={() => {
                                  setInput(question);
                                  textareaRef.current?.focus();
                                }}
                                className="group flex w-full items-center gap-3 rounded-xl border border-[#2F6868]/20 bg-[#2F6868]/5 px-4 py-3 text-left text-sm font-medium text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#2F6868]/50 hover:bg-[#2F6868]/10 hover:shadow-md"
                              >
                                <ArrowUp
                                  size={14}
                                  className="flex-shrink-0 rotate-45 text-[#2F6868] transition-transform group-hover:rotate-90"
                                />
                                <span className="flex-1 truncate">
                                  {displayText}
                                </span>
                              </button>
                            );
                            if (!isTruncated) {
                              return <div key={i}>{button}</div>;
                            }
                            return (
                              <Tooltip
                                key={i}
                                delayDuration={200}
                              >
                                <TooltipTrigger asChild>{button}</TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-md whitespace-pre-wrap break-words"
                                >
                                  {question}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  // For each message compute the tool calls that ran earlier in
                  // the *same turn* (since the last human message). Text-only
                  // AI messages use this list to resolve `[[app]]` placeholders
                  // — using the whole-thread list instead would always pick the
                  // first UI tool call of the conversation.
                  const turnToolCallsByIndex: ToolCall[][] = [];
                  let currentTurn: ToolCall[] = [];
                  for (const m of processedMessages) {
                    if (m.message.type === "human") {
                      currentTurn = [];
                      turnToolCallsByIndex.push([]);
                      continue;
                    }
                    turnToolCallsByIndex.push(currentTurn);
                    if (m.toolCalls.length > 0) {
                      currentTurn = [...currentTurn, ...m.toolCalls];
                    }
                  }
                  return processedMessages.map((data, index) => (
                    <ChatMessage
                      key={data.message.id}
                      message={data.message}
                      toolCalls={data.toolCalls}
                      turnToolCalls={turnToolCallsByIndex[index]}
                      subAgentRunsByTaskId={subAgentRunsByTaskId}
                      onRestartFromAIMessage={handleRestartFromAIMessage}
                      onRestartFromSubTask={handleRestartFromSubTask}
                      debugMode={debugMode}
                      isLoading={isLoading}
                      isLastMessage={index === processedMessages.length - 1}
                      interrupt={interrupt}
                      ui={ui}
                      stream={stream}
                      responseDurationMs={
                        data.message.type === "ai" && data.message.id
                          ? responseDurationByAiMessageId[data.message.id]
                          : undefined
                      }
                      totalTokenUsage={
                        index === processedMessages.length - 1
                          ? totalTokenUsage
                          : undefined
                      }
                    />
                  ));
                })()}
                {interrupt && debugMode && (
                  <div className="mt-4">
                    <Button
                      onClick={handleContinue}
                      variant="outline"
                      className="rounded-full px-3 py-1 text-xs"
                    >
                      Continue
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 bg-background">
          <div
            className={cn(
              "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
              "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out"
            )}
          >
            {(hasTasks || hasFiles) && (
              <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
                {!metaOpen && (
                  <>
                    {(() => {
                      const activeTask = todos.find(
                        (t) => t.status === "in_progress"
                      );

                      const totalTasks = todos.length;
                      const remainingTasks =
                        totalTasks - groupedTodos.pending.length;
                      const isCompleted = totalTasks === remainingTasks;

                      const tasksTrigger = (() => {
                        if (!hasTasks) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "tasks" ? null : "tasks"
                              )
                            }
                            className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
                            aria-expanded={metaOpen === "tasks"}
                          >
                            {(() => {
                              if (isCompleted) {
                                return [
                                  <CheckCircle
                                    key="icon"
                                    size={16}
                                    className="text-success/80"
                                  />,
                                  <span
                                    key="label"
                                    className="ml-[1px] min-w-0 truncate text-sm"
                                  >
                                    All tasks completed
                                  </span>,
                                ];
                              }

                              if (activeTask != null) {
                                return [
                                  <div key="icon">
                                    {getStatusIcon(activeTask.status)}
                                  </div>,
                                  <span
                                    key="label"
                                    className="ml-[1px] min-w-0 truncate text-sm"
                                  >
                                    Task{" "}
                                    {totalTasks - groupedTodos.pending.length}{" "}
                                    of {totalTasks}
                                  </span>,
                                  <span
                                    key="content"
                                    className="min-w-0 gap-2 truncate text-sm text-muted-foreground"
                                  >
                                    {activeTask.content}
                                  </span>,
                                ];
                              }

                              return [
                                <Circle
                                  key="icon"
                                  size={16}
                                  className="text-tertiary/70"
                                />,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  Task{" "}
                                  {totalTasks - groupedTodos.pending.length} of{" "}
                                  {totalTasks}
                                </span>,
                              ];
                            })()}
                          </button>
                        );
                      })();

                      const filesTrigger = (() => {
                        if (!hasFiles) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "files" ? null : "files"
                              )
                            }
                            className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                            aria-expanded={metaOpen === "files"}
                          >
                            <FileIcon size={16} />
                            Files (State)
                            <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                              {Object.keys(files).length}
                            </span>
                          </button>
                        );
                      })();

                      return (
                        <div className="grid grid-cols-[1fr_auto_auto] items-center">
                          {tasksTrigger}
                          {filesTrigger}
                        </div>
                      );
                    })()}
                  </>
                )}

                {metaOpen && (
                  <>
                    <div className="sticky top-0 flex items-stretch bg-sidebar text-sm">
                      {hasTasks && (
                        <button
                          type="button"
                          className="py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "tasks" ? null : "tasks"
                            )
                          }
                          aria-expanded={metaOpen === "tasks"}
                        >
                          Tasks
                        </button>
                      )}
                      {hasFiles && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "files" ? null : "files"
                            )
                          }
                          aria-expanded={metaOpen === "files"}
                        >
                          Files (State)
                          <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      )}
                      <button
                        aria-label="Close"
                        className="flex-1"
                        onClick={() => setMetaOpen(null)}
                      />
                    </div>
                    <div
                      ref={tasksContainerRef}
                      className="px-[18px]"
                    >
                      {metaOpen === "tasks" &&
                        Object.entries(groupedTodos)
                          .filter(([_, todos]) => todos.length > 0)
                          .map(([status, todos]) => (
                            <div className="mb-4">
                              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                                {
                                  {
                                    pending: "Pending",
                                    in_progress: "In Progress",
                                    completed: "Completed",
                                  }[status]
                                }
                              </h3>
                              <div className="grid grid-cols-[auto_1fr] gap-3 rounded-sm p-1 pl-0 text-sm">
                                {todos.map((todo, index) => (
                                  <Fragment
                                    key={`${status}_${todo.id}_${index}`}
                                  >
                                    {getStatusIcon(todo.status, "mt-0.5")}
                                    <span className="break-words text-inherit">
                                      {todo.content}
                                    </span>
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          ))}

                      {metaOpen === "files" && (
                        <div className="mb-6">
                          <FilesPopover
                            files={files}
                            setFiles={setFiles}
                            editDisabled={isLoading || interrupt !== undefined}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="flex flex-col"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isAttachmentsAllowed && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              )}
              {isAttachmentsAllowed && isDragOver && (
                <div className="border-primary/30 bg-primary/5 text-primary/60 flex items-center justify-center border-b border-dashed px-[18px] py-4 text-sm">
                  Drop files here to attach
                </div>
              )}
              {hasAttachments && (
                <div className="flex flex-wrap gap-2 border-b border-border px-[18px] py-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="group relative flex items-center gap-1.5 rounded-lg border border-border bg-sidebar px-2 py-1.5 text-xs"
                    >
                      {loadingAttachmentIds.has(attachment.id) ? (
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-muted/40">
                          <LoaderCircle
                            size={14}
                            className="animate-spin text-muted-foreground"
                          />
                        </div>
                      ) : attachment.preview ? (
                        <img
                          src={attachment.preview}
                          alt={attachment.name}
                          className="h-8 w-8 flex-shrink-0 rounded object-cover"
                        />
                      ) : isImageFile(attachment.type, attachment.name) ? (
                        <ImageIcon
                          size={14}
                          className="flex-shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <FileIconLucide
                          size={14}
                          className="flex-shrink-0 text-muted-foreground"
                        />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="max-w-[120px] truncate font-medium">
                          {attachment.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatFileSize(attachment.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        className="ml-1 flex-shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center gap-2 px-[18px] pt-2 text-xs font-medium text-primary">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  <span>Agent is responding...</span>
                </div>
              )}
              <div
                className="mx-[18px] mt-1 h-2 cursor-row-resize"
                onPointerDown={handleInputResizeStart}
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isLoading ? "Running..." : "Write your message..."}
                className="font-inherit resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[10px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
                rows={2}
              />
              <div className="flex justify-between gap-2 p-3">
                <div className="flex items-center gap-2">
                  {controls}
                  {isAttachmentsAllowed && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      title="Attach files"
                      aria-label="Attach files"
                    >
                      <Paperclip size={16} />
                    </button>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    type={isLoading ? "button" : "submit"}
                    variant={isLoading ? "destructive" : "outline"}
                    onClick={isLoading ? stopStream : handleSubmit}
                    disabled={
                      !isLoading &&
                      (submitDisabled || (!input.trim() && !hasAttachments))
                    }
                  >
                    {isLoading ? (
                      <>
                        <Square size={14} />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <ArrowUp size={18} />
                        <span>Send</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
          {banner && (
            <div className="mx-auto mb-3 mt-3 w-[calc(100%-32px)] max-w-[512px]">
              {banner}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatInterface.displayName = "ChatInterface";
