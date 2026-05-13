/** Resolved image for multimodal tool results (e.g. read_file on PNG). */
export interface ToolResultImage {
  url: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  /** LangChain `content_and_artifact` artifact; for MCP Apps tools holds raw MCP content blocks + structured_content. */
  artifact?: unknown;
  /** Images from tool message content (LangChain image / image_url blocks). */
  resultImages?: ToolResultImage[];
  status: "pending" | "completed" | "error" | "interrupted";
  /** Relative order in the full message stream (best-effort, for timelines). */
  order?: number;
}

export type SubAgentStatus =
  | "pending"
  | "active"
  | "completed"
  | "error"
  | "interrupted";

export interface SubAgent {
  id: string;
  name: string;
  subAgentName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: SubAgentStatus;
}

export interface SubAgentProgressItem {
  /** Underlying message id when available (useful for stable keys). */
  messageId?: string;
  /** Relative order in the full message stream. */
  order: number;
  /** Human-readable progress text extracted from AI messages. */
  text: string;
}

/**
 * Derived view of a `task` tool call’s internal activity, reconstructed from the
 * streamed message sequence.
 */
export interface SubAgentRun {
  /** The parent `task` tool_call_id. */
  taskToolCallId: string;
  /** The subagent_type used for the task (if present). */
  subAgentType?: string;
  /** Best-effort runtime status from the parent task tool call. */
  status: ToolCall["status"];
  /** Progress lines collected while the task was active. */
  progress: SubAgentProgressItem[];
  /** Tool calls that happened during the task window. */
  toolCalls: ToolCall[];
  /** Wall-clock ms when the task tool call was first seen (streaming). */
  startedAt?: number;
  /** Wall-clock ms when the task tool result closed the run (streaming). */
  endedAt?: number;
  /** Aggregated token usage from all AI messages in the run. */
  tokenUsage?: { input: number; output: number; total: number };
}

export interface FileItem {
  path: string;
  content: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  updatedAt?: Date;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Attachment {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  preview?: string; // data URL for image preview
  content: string; // text content or base64
  isDocument?: boolean; // true for pdf, doc, docx, xlsx - parsed server-side
}
