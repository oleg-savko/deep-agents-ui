import { describe, expect, it } from "vitest";
import type { Attachment } from "@/app/types/types";
import {
  DEFAULT_RECURSION_LIMIT,
  buildHumanContent,
  buildRunOptions,
} from "@/app/hooks/chat/buildMessage";

function attachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: "1",
    name: "notes.txt",
    type: "text/plain",
    size: 4,
    content: "body",
    ...over,
  };
}

describe("buildHumanContent", () => {
  it("sends plain text as a string when there are no attachments", () => {
    expect(buildHumanContent("hello", undefined, {})).toEqual({
      messageContent: "hello",
      documentFiles: null,
    });
  });

  it("stores image bytes under uploads/ and never emits an image_url block", () => {
    const { messageContent, documentFiles } = buildHumanContent(
      "see this",
      [attachment({ name: "shot.png", type: "image/png", content: "AAAA" })],
      { "uploads/old.txt": "keep" }
    );
    expect(documentFiles).toEqual({
      "uploads/old.txt": "keep",
      "uploads/shot.png": "AAAA",
    });
    expect(messageContent).toEqual([
      { type: "text", text: "see this" },
      {
        type: "text",
        text: '[Uploaded file: shot.png - use parse_document_file("uploads/shot.png") to read it, or jira_add_attachment_file(issue_key, "uploads/shot.png") to attach it to a Jira issue.]',
      },
    ]);
    expect(JSON.stringify(messageContent)).not.toContain("image_url");
  });

  it("inlines text files and marks other binaries as base64", () => {
    const { messageContent } = buildHumanContent(
      "   ",
      [
        attachment({ name: "a.txt", type: "text/plain", content: "hi" }),
        attachment({
          name: "blob.bin",
          type: "application/octet-stream",
          content: "QQ==",
        }),
      ],
      undefined
    );
    expect(messageContent).toEqual([
      { type: "text", text: "--- File: a.txt ---\nhi" },
      { type: "text", text: "--- File: blob.bin (base64) ---\nQQ==" },
    ]);
  });

  it("points document uploads at parse_document_file and keeps their bytes", () => {
    const { messageContent, documentFiles } = buildHumanContent(
      "read it",
      [
        attachment({
          name: "report.pdf",
          type: "application/pdf",
          content: "pdf-bytes",
          isDocument: true,
        }),
      ],
      {}
    );
    expect(documentFiles).toEqual({ "uploads/report.pdf": "pdf-bytes" });
    expect(messageContent).toEqual([
      { type: "text", text: "read it" },
      {
        type: "text",
        text: '[Uploaded file: report.pdf - use parse_document_file("uploads/report.pdf") to extract its text.]',
      },
    ]);
  });
});

describe("buildRunOptions", () => {
  it("defaults recursion_limit to 1000 and omits metadata when absent", () => {
    const options = buildRunOptions({
      config: { tags: ["x"] },
      configMode: "recursion",
    });
    expect(options.streamMode).toEqual(["values", "messages-tuple"]);
    expect(options.streamSubgraphs).toBe(true);
    expect(options.config).toEqual({
      tags: ["x"],
      recursion_limit: DEFAULT_RECURSION_LIMIT,
    });
    expect(options).not.toHaveProperty("metadata");
    expect(options).not.toHaveProperty("interruptBefore");
  });

  it("honors a custom recursion limit and attaches run metadata", () => {
    expect(
      buildRunOptions({
        recursionLimit: 40,
        configMode: "recursion",
        runMetadata: { graph_id: "ba_agent" },
      }).config
    ).toEqual({ recursion_limit: 40 });
  });

  it("passes config through for single-step and switches interrupt placement", () => {
    const config = { configurable: { model: "x" } };
    expect(
      buildRunOptions({
        config,
        configMode: "passthrough",
        interrupt: "before",
      })
    ).toMatchObject({
      config,
      interruptBefore: ["tools"],
    });
    expect(
      buildRunOptions({ configMode: "passthrough", interrupt: "after" })
    ).toMatchObject({
      config: undefined,
      interruptAfter: ["tools"],
    });
    expect(buildRunOptions({}).config).toBeUndefined();
    expect(buildRunOptions({})).not.toHaveProperty("interruptBefore");
  });
});
