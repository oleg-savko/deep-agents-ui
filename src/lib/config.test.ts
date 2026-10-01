import { describe, expect, it } from "vitest";
import { getConfig, saveConfig, type StandaloneConfig } from "@/lib/config";

const config: StandaloneConfig = {
  deploymentUrl: "http://example.test",
  assistantId: "chat",
  llmModelName: "gpt",
};

describe("config persistence", () => {
  it("drops legacy subagent overrides on read and write", () => {
    localStorage.setItem(
      "deep-agent-config",
      JSON.stringify({
        ...config,
        subagentModelOverridesByAssistant: { chat: "old" },
      })
    );
    expect(getConfig()).toEqual(config);
    // Read strips the field in memory only; it does not rewrite storage.
    expect(
      JSON.parse(localStorage.getItem("deep-agent-config")!)
        .subagentModelOverridesByAssistant
    ).toEqual({ chat: "old" });

    saveConfig({
      ...config,
      subagentModelOverridesByAssistant: { chat: "stale" },
    } as StandaloneConfig);
    const stored = JSON.parse(localStorage.getItem("deep-agent-config")!);
    expect(stored).toEqual(config);
    expect(stored.subagentModelOverridesByAssistant).toBeUndefined();
  });

  it("returns null when nothing is stored or the payload is not JSON", () => {
    expect(getConfig()).toBeNull();
    localStorage.setItem("deep-agent-config", "{");
    expect(getConfig()).toBeNull();
  });
});
