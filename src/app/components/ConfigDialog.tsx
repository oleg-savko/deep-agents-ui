"use client";

import { useState, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { StandaloneConfig } from "@/lib/config";
import { buildSubagentTemplatesByAssistantId } from "@/lib/subagentTemplates";
import { cn } from "@/lib/utils";

function validateSubagentOverridesJson(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return 'Value must be a JSON object (e.g. {"subagent-name": "model-id"}).';
    }
    return null;
  } catch {
    return "Invalid JSON.";
  }
}

interface Project {
  value: string;
  label: string;
  /** When set, only these model values are available for selection. */
  availableModels?: string[];
}

interface Deployment {
  value: string;
  label: string;
}

interface LLMModel {
  value: string;
  label: string;
}

interface Assistant {
  value: string;
  label: string;
  /** Short description of what this agent does. */
  description?: string;
  /** Available models for this assistant (from config.json). */
  models?: LLMModel[];
  /** Default model to preselect for this assistant (from config.json). */
  defaultModel?: string;
  /** Default subagent → model map for this assistant (from config.json). */
  subagentModelOverrideTemplates?: Record<string, string>;
  /** Access control: JWT `ai-groups` required to see this assistant. */
  aiGroups?: string[];
}

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: StandaloneConfig) => void;
  initialConfig?: StandaloneConfig;
}

export function ConfigDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: ConfigDialogProps) {
  const DEFAULT_LLM_MODEL_NAME = "litellm:openai/gpt-5-mini";

  const [deploymentUrl, setDeploymentUrl] = useState(
    initialConfig?.deploymentUrl || ""
  );
  const [assistantId, setAssistantId] = useState(
    initialConfig?.assistantId || ""
  );
  const [llmModelName, setLlmModelName] = useState(
    initialConfig?.llmModelName || DEFAULT_LLM_MODEL_NAME
  );
  const [project, setProject] = useState(
    initialConfig?.project || ""
  );
  const [subagentModelOverrides, setSubagentModelOverrides] = useState("");
  const [subagentModelOverridesError, setSubagentModelOverridesError] = useState<
    string | null
  >(null);
  const [overridesByAssistant, setOverridesByAssistant] = useState<
    Record<string, string>
  >({});
  const [subagentModelOverrideTemplates, setSubagentModelOverrideTemplates] =
    useState<Record<string, Record<string, string>>>({});
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [showInternalSteps, setShowInternalSteps] = useState(
    initialConfig?.showInternalSteps ?? false,
  );

  const assistantIdRef = useRef(assistantId);
  const overridesMapRef = useRef(overridesByAssistant);
  assistantIdRef.current = assistantId;
  overridesMapRef.current = overridesByAssistant;

  const selectedAssistant = assistants.find((a) => a.value === assistantId);
  const selectedProject = projects.find((p) => p.value === project);
  const availableModelsForAssistant = (() => {
    const models = selectedAssistant?.models ?? [];
    if (!selectedProject?.availableModels?.length) return models;
    const allowed = new Set(selectedProject.availableModels);
    return models.filter((m) => allowed.has(m.value));
  })();

  useEffect(() => {
    if (open && initialConfig) {
      setDeploymentUrl(initialConfig.deploymentUrl);
      setAssistantId(initialConfig.assistantId);
      setLlmModelName(initialConfig.llmModelName || DEFAULT_LLM_MODEL_NAME);
      setProject(initialConfig.project || "");
      setShowInternalSteps(initialConfig.showInternalSteps ?? false);
      const map = { ...(initialConfig.subagentModelOverridesByAssistant ?? {}) };
      const id = initialConfig.assistantId;
      setOverridesByAssistant(map);
      const editor =
        map[id] !== undefined
          ? map[id]!
          : JSON.stringify({}, null, 2);
      setSubagentModelOverrides(editor);
      setSubagentModelOverridesError(null);
    }
  }, [open, initialConfig]);

  // When config.json templates load, hydrate empty "{}" editor from template for this assistant.
  useEffect(() => {
    if (!open) return;
    const id = assistantIdRef.current;
    const map = overridesMapRef.current;
    setSubagentModelOverrides((cur) => {
      if (map[id] !== undefined) {
        return map[id]!;
      }
      const tmpl = subagentModelOverrideTemplates[id] ?? {};
      if (Object.keys(tmpl).length === 0) {
        return cur;
      }
      const compact = cur.trim().replace(/\s/g, "");
      if (compact !== "" && compact !== "{}") {
        return cur;
      }
      return JSON.stringify(tmpl, null, 2);
    });
  }, [subagentModelOverrideTemplates, open]);

  // Load projects and LLM models from config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const data = await response.json();
          setDeployments(data.deployments || []);
          setProjects(data.projects || []);
          setAssistants(data.assistants || []);
          setSubagentModelOverrideTemplates(
            buildSubagentTemplatesByAssistantId(data),
          );
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    };

    if (open) {
      loadConfig();
    }
  }, [open]);

  // When assistant or project changes (or config loads), ensure current model is valid.
  // If invalid or empty, fall back to assistant.defaultModel (or first in filtered list).
  useEffect(() => {
    if (!open) return;
    const a = selectedAssistant;
    if (!a) return;
    const list = availableModelsForAssistant;
    if (list.length === 0) return;

    const has = (name: string) => list.some((m) => m.value === name);
    if (llmModelName && has(llmModelName)) return;

    const next = a.defaultModel && has(a.defaultModel) ? a.defaultModel : list[0]?.value;
    if (next && next !== llmModelName) {
      setLlmModelName(next);
    }
  }, [assistantId, assistants, availableModelsForAssistant, llmModelName, open, selectedAssistant]);

  const handleSave = () => {
    if (!deploymentUrl || !assistantId || !llmModelName) {
      alert("Please fill in all required fields");
      return;
    }

    if (subagentModelOverridesError) {
      alert("Please fix the JSON in subagent model overrides before saving.");
      return;
    }

    const mergedOverrides = {
      ...overridesByAssistant,
      [assistantId]: subagentModelOverrides,
    };
    onSave({
      ...(initialConfig ?? {}),
      deploymentUrl,
      assistantId,
      llmModelName,
      project: project || undefined,
      showInternalSteps,
      subagentModelOverridesByAssistant: mergedOverrides,
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Configuration</DialogTitle>
          <DialogDescription>
            Configure your LangGraph deployment settings. These settings are
            saved in your browser&apos;s local storage.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="deploymentUrl">Deployment URL</Label>
            <Select
              value={deploymentUrl}
              onValueChange={setDeploymentUrl}
            >
              <SelectTrigger id="deploymentUrl">
                <SelectValue placeholder="Select a deployment URL" />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...deployments,
                  ...(deploymentUrl &&
                  !deployments.some((deployment) => deployment.value === deploymentUrl)
                    ? [{ value: deploymentUrl, label: deploymentUrl }]
                    : []),
                ].map((deployment) => (
                  <SelectItem key={deployment.value} value={deployment.value}>
                    {deployment.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assistantId">Assistant ID</Label>
            <Select
              value={assistantId}
              onValueChange={(newAssistantId) => {
                const next = {
                  ...overridesByAssistant,
                  [assistantId]: subagentModelOverrides,
                };
                setOverridesByAssistant(next);
                const editor =
                  next[newAssistantId] !== undefined
                    ? next[newAssistantId]!
                    : JSON.stringify(
                        subagentModelOverrideTemplates[newAssistantId] ?? {},
                        null,
                        2,
                      );
                setSubagentModelOverrides(editor);
                setSubagentModelOverridesError(
                  validateSubagentOverridesJson(editor),
                );
                setAssistantId(newAssistantId);
              }}
            >
              <SelectTrigger id="assistantId">
                <SelectValue placeholder="Select an assistant" />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...assistants,
                  ...(assistantId && !assistants.some((a) => a.value === assistantId)
                    ? [{ value: assistantId, label: assistantId }]
                    : []),
                ].map((assistant) => (
                  <SelectPrimitive.Item
                    key={assistant.value}
                    value={assistant.value}
                    className="relative flex w-full cursor-default select-none flex-col items-start rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        <SelectPrimitive.ItemIndicator>
                          <Check className="h-4 w-4" />
                        </SelectPrimitive.ItemIndicator>
                      </span>
                      <SelectPrimitive.ItemText>
                        {assistant.label}
                      </SelectPrimitive.ItemText>
                    </div>
                    {"description" in assistant && assistant.description && (
                      <span className="mt-0.5 text-xs text-muted-foreground whitespace-normal leading-snug">
                        {assistant.description}
                      </span>
                    )}
                  </SelectPrimitive.Item>
                ))}
              </SelectContent>
            </Select>
            {selectedAssistant?.description && (
              <p className="text-xs text-muted-foreground leading-snug">
                {selectedAssistant.description}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project">
              Project{" "}
              <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <Select
              value={project}
              onValueChange={setProject}
            >
              <SelectTrigger id="project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((proj) => (
                  <SelectItem key={proj.value} value={proj.value}>
                    {proj.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="llmModelName">LLM Model Name</Label>
            <Select
              value={llmModelName}
              onValueChange={setLlmModelName}
            >
              <SelectTrigger id="llmModelName">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...availableModelsForAssistant,
                  ...(llmModelName &&
                  !availableModelsForAssistant.some((m) => m.value === llmModelName)
                    ? [{ value: llmModelName, label: llmModelName }]
                    : []),
                ].map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor="showInternalSteps">Display internal LLM steps</Label>
              <p className="text-xs text-muted-foreground">
                Show intermediate agent and tool steps in the conversation.
              </p>
            </div>
            <Switch
              id="showInternalSteps"
              checked={showInternalSteps}
              onCheckedChange={setShowInternalSteps}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="subagentModelOverrides">
                Subagent model overrides{" "}
                <span className="text-muted-foreground">(JSON, optional)</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  Object.keys(
                    subagentModelOverrideTemplates[assistantId] ?? {},
                  ).length === 0
                }
                title={
                  Object.keys(
                    subagentModelOverrideTemplates[assistantId] ?? {},
                  ).length === 0
                    ? "Add subagentModelOverrideTemplates for this assistant in config.json"
                    : undefined
                }
                onClick={() => {
                  const model = llmModelName;
                  const tmplKeys = Object.keys(
                    subagentModelOverrideTemplates[assistantId] ?? {},
                  );
                  const template = Object.fromEntries(
                    tmplKeys.map((k) => [k, model]),
                  );
                  const value = JSON.stringify(template, null, 2);
                  setSubagentModelOverrides(value);
                  setSubagentModelOverridesError(null);
                }}
              >
                Use current model for all
              </Button>
            </div>
            <div
              className={cn(
                "w-full overflow-hidden rounded-md border text-xs font-mono",
                subagentModelOverridesError
                  ? "border-destructive"
                  : "border-input",
              )}
            >
              <CodeMirror
                value={subagentModelOverrides}
                height="140px"
                theme={oneDark}
                basicSetup={{ lineNumbers: false }}
                placeholder={`{\n  "subagent-name": "model-id"\n}`}
                extensions={[jsonLang()]}
                className="w-full"
                onChange={(value) => {
                  setSubagentModelOverrides(value);
                  setSubagentModelOverridesError(
                    validateSubagentOverridesJson(value),
                  );
                }}
              />
            </div>
            {subagentModelOverridesError ? (
              <p className="text-xs text-destructive">
                {subagentModelOverridesError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Per-assistant overrides: defaults come from each entry in{" "}
                <code className="text-xs">config.json</code>{" "}
                <code className="text-xs">assistants</code> via optional{" "}
                <code className="text-xs">subagentModelOverrideTemplates</code>
                ; omitted or empty uses{" "}
                <code className="text-xs">{"{}"}</code>.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
