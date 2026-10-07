import { describe, expect, it } from "vitest";
import {
  buildSubagentTemplatesByAssistantId,
  parseAssistantTemplateObject,
  parseSubagentOverridesRaw,
} from "@/lib/subagentTemplates";

describe("subagent templates", () => {
  it("keeps only string model ids", () => {
    expect(parseAssistantTemplateObject(null)).toEqual({});
    expect(parseAssistantTemplateObject(["x"])).toEqual({});
    expect(
      parseAssistantTemplateObject({ researcher: "gpt", broken: 1 })
    ).toEqual({ researcher: "gpt" });
  });

  it("indexes templates by assistant id and skips junk rows", () => {
    expect(
      buildSubagentTemplatesByAssistantId({
        assistants: [
          null,
          "nope",
          { label: "missing id" },
          { value: "chat", subagentModelOverrideTemplates: { a: "m" } },
          { value: "empty", subagentModelOverrideTemplates: {} },
        ],
      })
    ).toEqual({ chat: { a: "m" } });
    expect(buildSubagentTemplatesByAssistantId({})).toEqual({});
  });

  it("parses a saved override string", () => {
    expect(parseSubagentOverridesRaw(undefined)).toBeUndefined();
    expect(parseSubagentOverridesRaw("  ")).toBeUndefined();
    expect(parseSubagentOverridesRaw("{")).toBeUndefined();
    expect(parseSubagentOverridesRaw("[]")).toBeUndefined();
    expect(parseSubagentOverridesRaw('{"a":"m"}')).toEqual({ a: "m" });
  });
});
