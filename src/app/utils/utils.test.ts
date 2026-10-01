import { describe, expect, it, vi } from "vitest";
import type { Interrupt, Message } from "@langchain/langgraph-sdk";
import {
  cn,
  extractFileAttachmentsFromMessageContent,
  extractImagesFromMessageContent,
  extractStringFromMessageContent,
  extractSubAgentContent,
  extractUserTextFromMessageContent,
  formatConversationForLLM,
  formatMessageForLLM,
  getInterruptTitle,
  imageMimeFromFileName,
  isDocumentFile,
  isImageFile,
  isImageMimeType,
  isPreparingToCallTaskTool,
  isTextFile,
  resolveImageMimeType,
  stripUndisplayableMarkdownImages,
} from "@/app/utils/utils";

function msg(over: Partial<Message> & Pick<Message, "type">): Message {
  return { content: "", ...over } as Message;
}

describe("file type helpers", () => {
  it("detects images, text, and documents from mime or extension", () => {
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("text/plain")).toBe(false);
    expect(imageMimeFromFileName("shot.PNG")).toBe("image/png");
    expect(imageMimeFromFileName("noext")).toBeNull();
    expect(imageMimeFromFileName("file.xyz")).toBeNull();
    expect(isImageFile("", "a.jpg")).toBe(true);
    expect(isImageFile("application/octet-stream", "notes.txt")).toBe(false);
    expect(resolveImageMimeType("image/gif", "x.bin")).toBe("image/gif");
    expect(resolveImageMimeType("", "x.webp")).toBe("image/webp");
    expect(isTextFile("application/json", "x.bin")).toBe(true);
    expect(isTextFile("application/octet-stream", "main.py")).toBe(true);
    expect(isTextFile("application/octet-stream", "blob")).toBe(false);
    expect(isDocumentFile("application/pdf", "x")).toBe(true);
    expect(isDocumentFile("", "meet.mp4")).toBe(true);
    expect(isDocumentFile("text/plain", "a.txt")).toBe(false);
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("message content extractors", () => {
  it("extracts display text and drops file blocks", () => {
    expect(
      extractStringFromMessageContent(msg({ type: "human", content: "hi" }))
    ).toBe("hi");
    expect(
      extractStringFromMessageContent(
        msg({
          type: "human",
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: "--- File: a.txt ---\nbody" },
            "tail",
          ] as Message["content"],
        })
      )
    ).toBe("hellotail");
    expect(
      extractStringFromMessageContent(
        msg({ type: "human", content: 1 as never })
      )
    ).toBe("");
  });

  it("extracts images from image_url and image blocks", () => {
    const images = extractImagesFromMessageContent(
      msg({
        type: "human",
        content: [
          "skip",
          { type: "image_url", image_url: "https://a" },
          { type: "image_url", image_url: { url: "https://b" } },
          { type: "image_url", image_url: {} },
          { type: "image", url: "https://c" },
          { type: "image", base64: "QQ", mime_type: "image/png" },
          null,
        ] as Message["content"],
      })
    );
    expect(images.map((i) => i.url)).toEqual([
      "https://a",
      "https://b",
      "https://c",
      "data:image/png;base64,QQ",
    ]);
    expect(
      extractImagesFromMessageContent(msg({ type: "human", content: "x" }))
    ).toEqual([]);
  });

  it("parses file chips and keeps only the user's own text", () => {
    const message = msg({
      type: "human",
      content: [
        { type: "text", text: "please" },
        { type: "text", text: "--- File: a.txt ---\nbody" },
        { type: "text", text: "--- File: b.bin (base64) ---\nQQ==" },
        { type: "text", text: "--- File: broken" },
        {
          type: "text",
          text: '[Uploaded file: report.pdf - use parse_document_file("uploads/report.pdf") to extract its text.]',
        },
        { type: "image_url", image_url: "https://x" },
      ],
    });
    expect(extractFileAttachmentsFromMessageContent(message)).toEqual([
      { name: "a.txt", content: "body", isBinary: false },
      { name: "b.bin", content: "QQ==", isBinary: true },
      { name: "unknown", content: "--- File: broken", isBinary: false },
      { name: "report.pdf", content: "", isBinary: true },
    ]);
    expect(extractUserTextFromMessageContent(message)).toBe("please");
    expect(
      extractUserTextFromMessageContent(
        msg({ type: "human", content: "plain" })
      )
    ).toBe("plain");
    expect(
      extractFileAttachmentsFromMessageContent(
        msg({ type: "human", content: "plain" })
      )
    ).toEqual([]);
  });

  it("strips markdown images the browser cannot load", () => {
    expect(
      stripUndisplayableMarkdownImages(
        "![shot](data:image/png;base64,QQ) ![web](https://x/a.png) ![local](/sandbox/a.png) ![](/tmp/a)"
      )
    ).toBe("![shot](data:image/png;base64,QQ) ![web](https://x/a.png) local ");
  });
});

describe("subagent and interrupt helpers", () => {
  it("pulls a string out of subagent payloads", () => {
    expect(extractSubAgentContent("raw")).toBe("raw");
    expect(extractSubAgentContent({ description: "d" })).toBe("d");
    expect(extractSubAgentContent({ prompt: "p" })).toBe("p");
    expect(extractSubAgentContent({ result: "r" })).toBe("r");
    expect(extractSubAgentContent({ other: 1 })).toBe(
      JSON.stringify({ other: 1 }, null, 2)
    );
    expect(extractSubAgentContent(1)).toBe("1");
  });

  it("detects a trailing task tool call", () => {
    expect(
      isPreparingToCallTaskTool([
        msg({
          type: "ai",
          content: "",
          tool_calls: [{ name: "task", id: "1", args: {} }],
        }),
      ])
    ).toBe(true);
    expect(
      isPreparingToCallTaskTool([msg({ type: "human", content: "hi" })])
    ).toBe(false);
    expect(isPreparingToCallTaskTool([msg({ type: "ai", content: "" })])).toBe(
      false
    );
  });

  it("reads the interrupt action and falls back when the payload is malformed", () => {
    expect(
      getInterruptTitle({
        value: [{ action_request: { action: "ask_user_form" } }],
      } as unknown as Interrupt)
    ).toBe("ask_user_form");
    expect(getInterruptTitle({ value: [{}] } as unknown as Interrupt)).toBe(
      "Unknown interrupt"
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getInterruptTitle({ value: [null] } as unknown as Interrupt)).toBe(
      "Unknown interrupt"
    );
    error.mockRestore();
  });
});

describe("formatMessageForLLM", () => {
  it("formats roles, tool results, and tool calls", () => {
    const human = formatMessageForLLM(
      msg({ type: "human", id: "123456789", content: "hi" })
    );
    expect(human).toBe("Human (12345678): hi");

    const ai = formatMessageForLLM(
      msg({
        type: "ai",
        content: [
          { type: "text", text: "look" },
          { type: "tool_use", id: "x" },
        ] as Message["content"],
        tool_calls: [{ name: "search", id: "c1", args: { q: "a" } }],
      })
    );
    expect(ai).toContain("Assistant:");
    expect(ai).toContain("look");
    expect(ai).toContain("[Tool Call: search]");

    const tool = formatMessageForLLM(
      msg({
        type: "tool",
        content: "",
        name: "search",
        tool_call_id: "call-1234",
      } as Partial<Message> & Pick<Message, "type">)
    );
    expect(tool).toContain("Tool Result [search]");
    expect(tool).toContain("[Empty message]");

    expect(
      formatMessageForLLM(msg({ type: "system", content: "note" }))
    ).toContain("system");
    expect(
      formatConversationForLLM([
        msg({ type: "human", content: "a" }),
        msg({ type: "ai", content: "b" }),
      ])
    ).toContain("\n\n---\n\n");
  });
});
