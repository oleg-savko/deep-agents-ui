export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  llmModelName: string;
  project?: string;
  /** When true, show internal LLM/agent steps in the UI. */
  showInternalSteps?: boolean;
}

const CONFIG_KEY = "deep-agent-config";

export function getConfig(): StandaloneConfig | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as StandaloneConfig & {
      subagentModelOverridesByAssistant?: Record<string, string>;
    };
    // Drop any legacy persisted subagent overrides on read so stale/removed
    // models are never loaded (subagent models are per-thread only now).
    delete parsed.subagentModelOverridesByAssistant;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConfig(config: StandaloneConfig): void {
  if (typeof window === "undefined") return;
  // Subagent model overrides are intentionally NOT persisted: they are
  // per-thread/session only (default comes from config.json templates, and an
  // existing thread's models are restored from its checkpoint metadata). Strip
  // any legacy field so stale saved models can never be loaded again.
  const {
    subagentModelOverridesByAssistant: _legacySubagentOverrides,
    ...persisted
  } = config as StandaloneConfig & {
    subagentModelOverridesByAssistant?: Record<string, string>;
  };
  void _legacySubagentOverrides;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(persisted));
}
