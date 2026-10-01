import type { Assistant, Message } from "@langchain/langgraph-sdk";
import type { Attachment } from "@/app/types/types";
import { isImageFile } from "@/app/utils/utils";

/**
 * Declared explicitly instead of relying on the SDK inferring modes from which
 * getters happen to be read during render: `todos` and `files` come from
 * `stream.values`, and a refactor that moves that read into a component would
 * otherwise silently drop the mode from the request.
 */
export const STREAM_MODE = ["values", "messages-tuple"] as const;

export const DEFAULT_RECURSION_LIMIT = 1000;

export type RunMetadata = { graph_id: string };

export function buildHumanContent(
  content: string,
  attachments: Attachment[] | undefined,
  currentFiles: Record<string, string> | undefined
): {
  messageContent: Message["content"];
  documentFiles: Record<string, string> | null;
} {
  const documentAttachments: Attachment[] = [];
  const inlineAttachments: Attachment[] = [];

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

  let documentFiles: Record<string, string> | null = null;
  if (documentAttachments.length > 0 || imageAttachments.length > 0) {
    documentFiles = { ...(currentFiles ?? {}) };
    for (const doc of documentAttachments) {
      documentFiles[`uploads/${doc.name}`] = doc.content;
    }
    for (const img of imageAttachments) {
      documentFiles[`uploads/${img.name}`] = img.content;
    }
  }

  const hasInlineAttachments = inlineAttachments.length > 0;
  const hasDocumentAttachments = documentAttachments.length > 0;

  if (!hasInlineAttachments && !hasDocumentAttachments) {
    return { messageContent: content, documentFiles };
  }

  const contentBlocks: Array<{ type: "text"; text: string }> = [];

  if (content.trim()) {
    contentBlocks.push({ type: "text", text: content });
  }

  for (const attachment of inlineAttachments) {
    if (isImageFile(attachment.type, attachment.name)) {
      // Images go to uploads/<name> (above) and are referenced by path:
      // the agent reads them with parse_document_file (server-side parse,
      // images come back as a picture it can look at) or attaches them with
      // jira_add_attachment_file. We do NOT send an image_url vision block —
      // the agents' models are not guaranteed to be vision-capable (Azure
      // returns a hard 400 "unsupported image" on non-vision deployments,
      // breaking the run), so the image is read server-side instead.
      contentBlocks.push({
        type: "text",
        text: `[Uploaded file: ${attachment.name} - use parse_document_file("uploads/${attachment.name}") to read it, or jira_add_attachment_file(issue_key, "uploads/${attachment.name}") to attach it to a Jira issue.]`,
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

  for (const doc of documentAttachments) {
    contentBlocks.push({
      type: "text",
      text: `[Uploaded file: ${doc.name} - use parse_document_file("uploads/${doc.name}") to extract its text.]`,
    });
  }

  return { messageContent: contentBlocks, documentFiles };
}

/**
 * Shared submit options. `configMode` preserves the three call-site shapes:
 * send/continue merge `recursion_limit`, single-step passes config through,
 * resume omits config entirely.
 */
export function buildRunOptions({
  config,
  recursionLimit,
  configMode = "omit",
  runMetadata,
  interrupt,
}: {
  config?: Assistant["config"];
  recursionLimit?: number;
  configMode?: "omit" | "passthrough" | "recursion";
  runMetadata?: RunMetadata;
  interrupt?: "before" | "after";
}) {
  return {
    streamMode: [...STREAM_MODE],
    streamSubgraphs: true as const,
    ...(configMode === "passthrough" ? { config } : {}),
    ...(configMode === "recursion"
      ? {
          config: {
            ...(config ?? {}),
            recursion_limit: recursionLimit ?? DEFAULT_RECURSION_LIMIT,
          },
        }
      : {}),
    ...(runMetadata ? { metadata: runMetadata } : {}),
    ...(interrupt === "before" ? { interruptBefore: ["tools"] } : {}),
    ...(interrupt === "after" ? { interruptAfter: ["tools"] } : {}),
  };
}
