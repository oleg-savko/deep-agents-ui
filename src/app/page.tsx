"use client";

import React, { Suspense, useState, useEffect, useMemo } from "react";
import { useQueryState } from "nuqs";
import { getConfig, getSubagentOverridesRawForAssistant, saveConfig, StandaloneConfig } from "@/lib/config";
import {
  buildSubagentTemplatesByAssistantId,
  mergeSubagentModelsForAssistant,
} from "@/lib/subagentTemplates";
import { ConfigDialog } from "@/app/components/ConfigDialog";
import { Button } from "@/components/ui/button";
import { Assistant } from "@langchain/langgraph-sdk";
import { ClientProvider } from "@/providers/ClientProvider";
import { Settings, MessagesSquare, SquarePen, Info, Check, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ThreadList } from "@/app/components/ThreadList";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { AccessNotice, type AccessInfo } from "@/app/components/AccessNotice";
import { ConnectivityBanner } from "@/app/components/ConnectivityBanner";
import { useAgentHealth, type AgentHealth } from "@/app/hooks/useAgentHealth";
import { toast } from "sonner";

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [_threadId, setThreadId] = useQueryState("threadId");
  const [sidebar, setSidebar] = useQueryState("sidebar");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [subagentTemplatesByAssistant, setSubagentTemplatesByAssistant] = useState<
    Record<string, Record<string, string>>
  >({});
  const [assistantDescriptions, setAssistantDescriptions] = useState<
    Record<string, string>
  >({});
  const [assistantLabels, setAssistantLabels] = useState<
    Record<string, string>
  >({});
  const [assistantExampleQuestions, setAssistantExampleQuestions] = useState<
    Record<string, string[]>
  >({});
  const [configAssistants, setConfigAssistants] = useState<
    { value: string; label: string; description?: string }[]
  >([]);
  const [assistantModels, setAssistantModels] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const [assistantDefaultModels, setAssistantDefaultModels] = useState<
    Record<string, string>
  >({});
  const [projectAvailableModels, setProjectAvailableModels] = useState<
    Record<string, string[]>
  >({});
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null);

  useEffect(() => {
    const savedConfig = getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
      if (!assistantId) {
        setAssistantId(savedConfig.assistantId);
      }
    } else {
      setConfigDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (config && !assistantId) {
      setAssistantId(config.assistantId);
    }
  }, [config, assistantId, setAssistantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/config");
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) {
          setSubagentTemplatesByAssistant(buildSubagentTemplatesByAssistantId(data));
          const descriptions: Record<string, string> = {};
          const labels: Record<string, string> = {};
          const exampleQuestions: Record<string, string[]> = {};
          const models: Record<string, { value: string; label: string }[]> = {};
          const defaultModels: Record<string, string> = {};
          for (const a of data.assistants ?? []) {
            if (a.description) descriptions[a.value] = a.description;
            if (a.label) labels[a.value] = a.label;
            if (Array.isArray(a.exampleQuestions) && a.exampleQuestions.length > 0) {
              exampleQuestions[a.value] = a.exampleQuestions;
            }
            if (Array.isArray(a.models) && a.models.length > 0) {
              models[a.value] = a.models;
            }
            if (a.defaultModel) defaultModels[a.value] = a.defaultModel;
          }
          setAssistantDescriptions(descriptions);
          setAssistantLabels(labels);
          setAssistantExampleQuestions(exampleQuestions);
          setAssistantModels(models);
          setAssistantDefaultModels(defaultModels);
          const projModels: Record<string, string[]> = {};
          for (const p of data.projects ?? []) {
            if (Array.isArray(p.availableModels) && p.availableModels.length > 0) {
              projModels[p.value] = p.availableModels;
            }
          }
          setProjectAvailableModels(projModels);
          setConfigAssistants(
            (data.assistants ?? []).map(
              (a: { value: string; label?: string; description?: string }) => ({
                value: a.value,
                label: a.label ?? a.value,
                description: a.description,
              }),
            ),
          );
          const access: AccessInfo | undefined = data._access;
          if (access) {
            setAccessInfo(access);
            if (access.visibleAssistants === 0) {
              const roleProblem =
                access.authenticated && access.totalAssistants > 0;
              toast.error(
                roleProblem
                  ? "No assistants available for your account. You need an appropriate AI access role in Keycloak — contact your administrator."
                  : "No assistants are available. Contact your administrator.",
                { id: "no-access", duration: 12000 },
              );
            }
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveConfig = (newConfig: StandaloneConfig) => {
    saveConfig(newConfig);
    setConfig(newConfig);
  };

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  const subagentModelsConfig = useMemo(() => {
    if (!config) return undefined;
    const template = subagentTemplatesByAssistant[config.assistantId] ?? {};
    const raw = getSubagentOverridesRawForAssistant(config);
    const merged = mergeSubagentModelsForAssistant(template, raw);
    if (Object.keys(merged).length === 0) {
      return undefined;
    }
    return merged;
  }, [config, subagentTemplatesByAssistant]);

  const availableModels = useMemo(() => {
    if (!config) return [];
    const models = assistantModels[config.assistantId] ?? [];
    const allowed = config.project
      ? projectAvailableModels[config.project]
      : undefined;
    if (!allowed?.length) return models;
    const allowedSet = new Set(allowed);
    return models.filter((m) => allowedSet.has(m.value));
  }, [config, assistantModels, projectAvailableModels]);

  // On assistant switch, force the assistant's defaultModel. Otherwise only
  // correct the model when it's invalid for the current assistant/project.
  const prevAssistantRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!config || availableModels.length === 0) return;
    const has = (name: string) => availableModels.some((m) => m.value === name);

    const assistantChanged =
      prevAssistantRef.current !== null &&
      prevAssistantRef.current !== config.assistantId;
    prevAssistantRef.current = config.assistantId;

    const fallback = assistantDefaultModels[config.assistantId];
    const desired =
      fallback && has(fallback) ? fallback : availableModels[0]?.value;

    // Same assistant with a still-valid model: leave it alone.
    if (!assistantChanged && config.llmModelName && has(config.llmModelName)) {
      return;
    }
    if (desired && desired !== config.llmModelName) {
      const updated = { ...config, llmModelName: desired };
      saveConfig(updated);
      setConfig(updated);
    }
  }, [config, availableModels, assistantDefaultModels]);

  const agentHealth = useAgentHealth(config?.deploymentUrl);

  // Alert on health transitions; the banner stays as the persistent cue.
  const prevHealthRef = React.useRef<AgentHealth>("checking");
  useEffect(() => {
    const prev = prevHealthRef.current;
    const s = agentHealth.status;
    if (s === "offline" && prev !== "offline") {
      toast.error(
        "Can't reach the agent. Check that your VPN is connected and you're on the corporate network.",
        { id: "agent-offline", duration: 8000 },
      );
    } else if (s === "unhealthy" && prev !== "unhealthy") {
      toast.error(
        "The agent is reachable but its health check failed — it may be starting up or a dependency is down.",
        { id: "agent-offline", duration: 8000 },
      );
    } else if (s === "online" && (prev === "offline" || prev === "unhealthy")) {
      toast.dismiss("agent-offline");
      toast.success("Reconnected to the agent.", {
        id: "agent-online",
        duration: 4000,
      });
    }
    prevHealthRef.current = s;
  }, [agentHealth.status]);

  const debugMode = config?.showInternalSteps ?? false;

  const handleToggleInternalSteps = (checked: boolean) => {
    if (!config) return;
    const updated = { ...config, showInternalSteps: checked };
    saveConfig(updated);
    setConfig(updated);
  };

  if (accessInfo && accessInfo.visibleAssistants === 0) {
    return (
      <>
        <ConfigDialog
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          onSave={handleSaveConfig}
          initialConfig={config ?? undefined}
        />
        <AccessNotice
          access={accessInfo}
          onOpenSettings={() => setConfigDialogOpen(true)}
        />
      </>
    );
  }

  if (!config) {
    return (
      <>
        <ConfigDialog
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          onSave={handleSaveConfig}
        />
        <div className="flex h-screen items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Welcome to Standalone Chat</h1>
            <p className="mt-2 text-muted-foreground">
              Configure your deployment to get started
            </p>
            <Button
              onClick={() => setConfigDialogOpen(true)}
              className="mt-4"
            >
              Open Configuration
            </Button>
          </div>
        </div>
      </>
    );
  }

  const defaultModelName = "litellm:openai/gpt-5-mini";
  const assistant: Assistant = {
    assistant_id: config.assistantId,
    graph_id: config.assistantId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    config: {
      configurable: {
        LLM_MODEL: config.llmModelName || defaultModelName,
        PROJECT: config.project,
        ...(subagentModelsConfig
          ? { SUBAGENT_MODELS: subagentModelsConfig }
          : {}),
      },
    },
    metadata: {},
    version: 1,
    name: assistantLabels[config.assistantId] ?? config.assistantId,
    context: {},
  };

  return (
    <>
      <ConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onSave={handleSaveConfig}
        initialConfig={config}
      />
      <ClientProvider
        deploymentUrl={config.deploymentUrl}
        apiKey={langsmithApiKey}
      >
        <div className="flex h-screen flex-col">
          <header className="flex h-16 items-center justify-between border-b border-border px-6">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold">Deep Agent UI</h1>
              {!sidebar && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSidebar("1")}
                >
                  <MessagesSquare className="mr-2 h-4 w-4" />
                  Threads
                  {interruptCount > 0 && (
                    <span className="ml-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                      {interruptCount}
                    </span>
                  )}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="font-medium">Assistant:</span>
                <Select
                  value={config.assistantId}
                  onValueChange={(newId) => {
                    const updated = {
                      ...config,
                      assistantId: newId,
                      llmModelName:
                        assistantDefaultModels[newId] ?? config.llmModelName,
                    };
                    handleSaveConfig(updated);
                    setThreadId(null);
                  }}
                >
                  <SelectTrigger className="h-7 gap-1 border-none bg-transparent px-1.5 text-sm shadow-none focus:ring-0 [&>svg]:hidden">
                    <SelectValue>
                      {assistantLabels[config.assistantId] ?? config.assistantId}
                    </SelectValue>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </SelectTrigger>
                  <SelectContent align="end" className="max-w-[320px]">
                    {configAssistants.map((a) => (
                      <SelectPrimitive.Item
                        key={a.value}
                        value={a.value}
                        className="relative flex w-full cursor-default select-none flex-col items-start rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                      >
                        <div className="flex w-full items-center gap-2">
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            <SelectPrimitive.ItemIndicator>
                              <Check className="h-4 w-4" />
                            </SelectPrimitive.ItemIndicator>
                          </span>
                          <SelectPrimitive.ItemText>
                            {a.label}
                          </SelectPrimitive.ItemText>
                        </div>
                        {a.description && (
                          <span className="mt-0.5 pl-[22px] text-xs text-muted-foreground whitespace-normal break-words leading-snug">
                            {a.description}
                          </span>
                        )}
                      </SelectPrimitive.Item>
                    ))}
                  </SelectContent>
                </Select>
                {assistantDescriptions[config.assistantId] && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      {assistantDescriptions[config.assistantId]}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {availableModels.length > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="font-medium">Model:</span>
                  <Select
                    value={config.llmModelName}
                    onValueChange={(newModel) => {
                      const updated = { ...config, llmModelName: newModel };
                      handleSaveConfig(updated);
                    }}
                  >
                    <SelectTrigger className="h-7 gap-1 border-none bg-transparent px-1.5 text-sm shadow-none focus:ring-0 [&>svg]:hidden">
                      <SelectValue>
                        <span className="block max-w-[180px] truncate">
                          {availableModels.find(
                            (m) => m.value === config.llmModelName,
                          )?.label ?? config.llmModelName}
                        </span>
                      </SelectValue>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </SelectTrigger>
                    <SelectContent align="end" className="max-w-[320px]">
                      {[
                        ...availableModels,
                        ...(config.llmModelName &&
                        !availableModels.some(
                          (m) => m.value === config.llmModelName,
                        )
                          ? [
                              {
                                value: config.llmModelName,
                                label: config.llmModelName,
                              },
                            ]
                          : []),
                      ].map((m) => (
                        <SelectPrimitive.Item
                          key={m.value}
                          value={m.value}
                          className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            <SelectPrimitive.ItemIndicator>
                              <Check className="h-4 w-4" />
                            </SelectPrimitive.ItemIndicator>
                          </span>
                          <SelectPrimitive.ItemText>
                            {m.label}
                          </SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="header-showInternalSteps"
                      checked={debugMode}
                      onCheckedChange={handleToggleInternalSteps}
                    />
                    <label
                      htmlFor="header-showInternalSteps"
                      className="cursor-pointer text-xs text-muted-foreground"
                    >
                      Internal steps
                    </label>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Show intermediate agent and tool steps in the conversation
                </TooltipContent>
              </Tooltip>
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfigDialogOpen(true)}
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setThreadId(null)}
                disabled={!_threadId}
                className="!border-[var(--color-new-thread-btn)] !bg-[var(--color-new-thread-btn)] !text-white hover:!bg-[var(--color-new-thread-btn-hover)]"
              >
                <SquarePen className="mr-2 h-4 w-4" />
                New Thread
              </Button>
            </div>
          </header>

          {(agentHealth.status === "offline" ||
            agentHealth.status === "unhealthy") && (
            <ConnectivityBanner
              mode={agentHealth.status}
              checking={agentHealth.revalidating}
              onRetry={agentHealth.retry}
            />
          )}

          <div className="flex-1 overflow-hidden">
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="standalone-chat"
            >
              {sidebar && (
                <>
                  <ResizablePanel
                    id="thread-history"
                    order={1}
                    defaultSize={25}
                    minSize={20}
                    className="relative min-w-[380px]"
                  >
                    <ThreadList
                      onThreadSelect={async (id) => {
                        await setThreadId(id);
                      }}
                      onMutateReady={(fn) => setMutateThreads(() => fn)}
                      onClose={() => setSidebar(null)}
                      onInterruptCountChange={setInterruptCount}
                    />
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              )}

              <ResizablePanel
                id="chat"
                className="relative flex flex-col"
                order={2}
              >
                <ChatProvider
                  activeAssistant={assistant}
                  onHistoryRevalidate={() => mutateThreads?.()}
                >
                  <ChatInterface
                    assistant={assistant}
                    debugMode={debugMode}
                    agentDescription={assistantDescriptions[config.assistantId]}
                    exampleQuestions={
                      assistantExampleQuestions[config.assistantId]
                    }
                    controls={<></>}
                    skeleton={
                      <div className="flex items-center justify-center p-8">
                        <p className="text-muted-foreground">Loading...</p>
                      </div>
                    }
                  />
                </ChatProvider>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </ClientProvider>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
