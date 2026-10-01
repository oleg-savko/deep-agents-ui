"use client";

import React, { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useQueryState } from "nuqs";
import { Client } from "@langchain/langgraph-sdk";
import { useAuthHeader } from "@/providers/AuthHeaderProvider";
import { getConfig, saveConfig, StandaloneConfig } from "@/lib/config";
import { buildSubagentTemplatesByAssistantId } from "@/lib/subagentTemplates";
import { ConfigDialog } from "@/app/components/ConfigDialog";
import { Button } from "@/components/ui/button";
import { Assistant } from "@langchain/langgraph-sdk";
import { ClientProvider } from "@/providers/ClientProvider";
import {
  Settings,
  MessagesSquare,
  SquarePen,
  Info,
  Check,
  ChevronDown,
} from "lucide-react";
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
import { isAssistantUuid, resolveThreadGraph } from "@/app/utils/threadOwner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{
    config: StandaloneConfig;
    kind: "model" | "assistant" | "project";
    subagentModels?: Record<string, string> | null;
  } | null>(null);
  // Subagent models for the CURRENT thread/session only — never persisted to
  // localStorage. `null` means "use the config.json template default". Reset to
  // null on new thread / assistant switch; restored from checkpoint metadata
  // when an existing thread is opened.
  const [sessionSubagentModels, setSessionSubagentModels] = useState<Record<
    string,
    string
  > | null>(null);
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [threadId, setThreadId] = useQueryState("threadId");
  const [resolvedOwner, setResolvedOwner] = useState<{
    threadId: string;
    owner: string | null;
  } | null>(null);
  const [sidebar, setSidebar] = useQueryState("sidebar");
  // A link from Story Chat (`?assistantId=ba_agent&storyKey=…&traceSession=…`) opens the BA
  // agent on one Story in the intake's Langfuse session. Both values ride into the run's
  // `configurable` as `story_key` / `langfuse_session_id`, where TraceMiddleware reads them.
  const [storyKey, setStoryKey] = useQueryState("storyKey");
  const [traceSession, setTraceSession] = useQueryState("traceSession");
  const { authorization, ready: authReady } = useAuthHeader();
  // Tracks the thread we've already reconciled the model for, so opening a
  // thread only triggers one getState fetch (and never fights a manual switch).
  const modelRestoredForThreadRef = useRef<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  // Updated inside the model-reconcile effect. The thread-restore path sets it
  // before changing assistant so that effect does not treat a restore as a user
  // switch and overwrite the thread's model with the assistant default.
  const prevAssistantRef = useRef<string | null>(null);
  const pendingAssistantMetaRef = useRef<{
    threadId: string;
    assistantId: string;
  } | null>(null);

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [subagentTemplatesByAssistant, setSubagentTemplatesByAssistant] =
    useState<Record<string, Record<string, string>>>({});
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
  // Per-assistant graph step ceiling. An agent that implements a whole task needs far more
  // steps than a conversation does, and the run dies with GraphRecursionError without it.
  const [assistantRecursionLimits, setAssistantRecursionLimits] = useState<
    Record<string, number>
  >({});
  const [projectAvailableModels, setProjectAvailableModels] = useState<
    Record<string, string[]>
  >({});
  const [configProjects, setConfigProjects] = useState<
    { value: string; label: string }[]
  >([]);
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null);
  const configAssistantsRef = useRef(configAssistants);
  configAssistantsRef.current = configAssistants;

  useEffect(() => {
    const savedConfig = getConfig();
    if (savedConfig) {
      // A link names the assistant it opens; the saved one is only the default. Clearing
      // the model lets the reconcile effect below pick that assistant's own default.
      const linked =
        assistantId && assistantId !== savedConfig.assistantId
          ? { ...savedConfig, assistantId, llmModelName: "" }
          : savedConfig;
      setConfig(linked);
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
          setSubagentTemplatesByAssistant(
            buildSubagentTemplatesByAssistantId(data)
          );
          const descriptions: Record<string, string> = {};
          const labels: Record<string, string> = {};
          const exampleQuestions: Record<string, string[]> = {};
          const models: Record<string, { value: string; label: string }[]> = {};
          const defaultModels: Record<string, string> = {};
          const recursionLimits: Record<string, number> = {};
          for (const a of data.assistants ?? []) {
            if (a.description) descriptions[a.value] = a.description;
            if (a.label) labels[a.value] = a.label;
            if (
              Array.isArray(a.exampleQuestions) &&
              a.exampleQuestions.length > 0
            ) {
              exampleQuestions[a.value] = a.exampleQuestions;
            }
            if (Array.isArray(a.models) && a.models.length > 0) {
              models[a.value] = a.models;
            }
            if (a.defaultModel) defaultModels[a.value] = a.defaultModel;
            if (typeof a.recursionLimit === "number") {
              recursionLimits[a.value] = a.recursionLimit;
            }
          }
          setAssistantDescriptions(descriptions);
          setAssistantLabels(labels);
          setAssistantExampleQuestions(exampleQuestions);
          setAssistantModels(models);
          setAssistantDefaultModels(defaultModels);
          setAssistantRecursionLimits(recursionLimits);
          const projModels: Record<string, string[]> = {};
          for (const p of data.projects ?? []) {
            if (
              Array.isArray(p.availableModels) &&
              p.availableModels.length > 0
            ) {
              projModels[p.value] = p.availableModels;
            }
          }
          setProjectAvailableModels(projModels);
          setConfigProjects(
            (data.projects ?? []).map(
              (p: { value: string; label?: string }) => ({
                value: p.value,
                label: p.label ?? p.value,
              })
            )
          );
          setConfigAssistants(
            (data.assistants ?? []).map(
              (a: { value: string; label?: string; description?: string }) => ({
                value: a.value,
                label: a.label ?? a.value,
                description: a.description,
              })
            )
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
                { id: "no-access", duration: 12000 }
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

  // `subagentModels === undefined` means "leave the session value unchanged"
  // (inline dropdowns); `null` resets to the config.json template default; a map
  // sets an explicit per-thread override.
  const applyConfig = (
    newConfig: StandaloneConfig,
    resetThread: boolean,
    subagentModels?: Record<string, string> | null
  ) => {
    const assistantChanged = config?.assistantId !== newConfig.assistantId;
    saveConfig(newConfig);
    setConfig(newConfig);
    // A link's Story and session belong to the assistant it opened, not to the next one.
    // The URL is the source of truth on refresh, so it has to follow the switch.
    // nuqs batches these updates into a single history replace.
    if (assistantChanged) {
      setAssistantId(newConfig.assistantId);
      setStoryKey(null);
      setTraceSession(null);
    }
    if (resetThread) {
      setThreadId(null);
      modelRestoredForThreadRef.current = null;
      setSessionSubagentModels(null); // fresh thread → config.json default
    } else if (assistantChanged) {
      setSessionSubagentModels(null); // new assistant → its own default
    }
    // An explicit editor value (from the dialog) wins over the resets above.
    if (subagentModels !== undefined) {
      setSessionSubagentModels(subagentModels);
    }
  };

  // A stale or forbidden assistantId in the URL (old bookmark, or an agent this
  // account has no role for) would render a broken assistant and, on refresh,
  // overwrite the saved config. Fall back once the allowed list is known.
  useEffect(() => {
    if (!config || configAssistants.length === 0) return;
    if (configAssistants.some((a) => a.value === config.assistantId)) return;
    const saved = getConfig()?.assistantId;
    const fallback = configAssistants.some((a) => a.value === saved)
      ? saved!
      : configAssistants[0].value;
    applyConfig({ ...config, assistantId: fallback, llmModelName: "" }, true);
    // applyConfig closes over the latest config; listing it would re-run every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.assistantId, configAssistants]);

  const handleSaveConfig = (
    newConfig: StandaloneConfig,
    subagentModels?: Record<string, string> | null
  ) => {
    const prev = config;
    const modelChanged = !!prev && prev.llmModelName !== newConfig.llmModelName;
    const assistantChanged =
      !!prev && prev.assistantId !== newConfig.assistantId;
    // The project decides which per-project tool instances an agent binds
    // (clickhouse_<project>_*, gitlab_<project>_*, airflow_<project>_*) and which
    // Confluence space it searches, so replaying a thread under another project
    // leaves tool calls in the history that no longer exist.
    const projectChanged = !!prev && prev.project !== newConfig.project;

    // Switching model or assistant mid-conversation replays the existing
    // message history under a different provider's validation rules, which can
    // break the run (e.g. deepseek/gpt reject dangling `tool_calls` that claude
    // tolerated). If a thread is already active, ask the user to confirm before
    // starting a fresh one; on cancel the switch is discarded and the controlled
    // dropdowns revert to the current config. With no active thread, apply
    // immediately.
    if ((modelChanged || assistantChanged || projectChanged) && threadId) {
      setPendingSwitch({
        config: newConfig,
        kind: assistantChanged
          ? "assistant"
          : projectChanged
          ? "project"
          : "model",
        subagentModels,
      });
      return;
    }
    applyConfig(newConfig, false, subagentModels);
  };

  const confirmSwitch = () => {
    if (!pendingSwitch) return;
    applyConfig(pendingSwitch.config, true, pendingSwitch.subagentModels);
    setPendingSwitch(null);
  };

  const cancelSwitch = () => setPendingSwitch(null);

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  // When an existing thread is opened, restore the model/project it was last run
  // with. LangGraph persists these in the thread checkpoint metadata
  // (`LLM_MODEL`, `PROJECT`), so we read them via `getState` and reconcile the
  // global config. Without this, an old thread would be replayed under whatever
  // model is currently selected — the same cross-provider mismatch that breaks
  // runs (e.g. deepseek/gpt reject dangling `tool_calls`). Best-effort: on any
  // failure or missing metadata we leave the current model untouched.
  //
  // `config` itself is not a dependency: writing the restored model would
  // cancel the in-flight read. A cancelled read clears the guard so the next
  // run (token refresh, deployment url) tries again.
  useEffect(() => {
    const deploymentUrl = config?.deploymentUrl;
    if (!deploymentUrl || !threadId || !authReady) return;
    if (modelRestoredForThreadRef.current === threadId) return;
    const snapshot = configRef.current;
    if (!snapshot) return;
    modelRestoredForThreadRef.current = threadId;

    let cancelled = false;
    let finished = false;

    (async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (langsmithApiKey) headers["X-Api-Key"] = langsmithApiKey;
        if (authorization) headers["Authorization"] = authorization;

        const client = new Client({
          apiUrl: deploymentUrl,
          defaultHeaders: headers,
        });
        const state = await client.threads.getState(threadId);
        if (cancelled) return;

        const meta = (state?.metadata ?? {}) as Record<string, unknown>;

        // Restore this thread's subagent models (or fall back to default if it
        // was never run with an override). Always runs, independent of whether
        // the top-level model changed.
        const threadSubagentModels = meta.SUBAGENT_MODELS;
        setSessionSubagentModels(
          threadSubagentModels &&
            typeof threadSubagentModels === "object" &&
            !Array.isArray(threadSubagentModels)
            ? (threadSubagentModels as Record<string, string>)
            : null
        );

        const threadModel =
          typeof meta.LLM_MODEL === "string" ? meta.LLM_MODEL : null;
        const threadProject =
          typeof meta.PROJECT === "string" ? meta.PROJECT : null;
        const modelFromThread =
          !!threadModel && threadModel !== snapshot.llmModelName;

        if (modelFromThread && threadModel) {
          // Merge into the latest config so an assistant switch that landed
          // while this request was in flight is not overwritten.
          setConfig((prev) => {
            if (!prev) return prev;
            const next: StandaloneConfig = {
              ...prev,
              llmModelName: threadModel,
            };
            if (threadProject) next.project = threadProject;
            saveConfig(next);
            return next;
          });
          toast.info(
            `Using ${threadModel.replace(
              /^litellm:/,
              ""
            )} — the model this conversation was created with.`
          );
        }
        finished = true;
      } catch {
        if (cancelled) return;
        modelRestoredForThreadRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      if (!finished) modelRestoredForThreadRef.current = null;
    };
  }, [
    threadId,
    authReady,
    authorization,
    langsmithApiKey,
    config?.deploymentUrl,
  ]);

  // Which graph owns this thread. Kept apart from the model restore: that
  // effect records the thread id before the request returns, so a cancelled
  // lookup never retried and `resolvedOwner` stayed unset. The composer stays
  // locked until this settles. A failed request does not settle, so a later
  // token or url change runs it again.
  useEffect(() => {
    const deploymentUrl = config?.deploymentUrl;
    if (!deploymentUrl || !threadId || !authReady) return;
    if (resolvedOwner?.threadId === threadId) return;

    let cancelled = false;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (langsmithApiKey) headers["X-Api-Key"] = langsmithApiKey;
    if (authorization) headers["Authorization"] = authorization;
    const client = new Client({
      apiUrl: deploymentUrl,
      defaultHeaders: headers,
    });

    const settle = (raw: string | null) => {
      if (cancelled) return;
      const known = configAssistantsRef.current;
      // Checkpoint read can finish before /api/config returns the allow-list.
      if (raw && known.length === 0 && !isAssistantUuid(raw)) {
        pendingAssistantMetaRef.current = { threadId, assistantId: raw };
        return;
      }
      if (raw && !isAssistantUuid(raw) && !known.some((a) => a.value === raw)) {
        pendingAssistantMetaRef.current = null;
        toast.error(`Тред принадлежит агенту ${raw}, к нему нет доступа`);
        setResolvedOwner(null);
        setThreadId(null);
        return;
      }
      // Unknown id (UUID we could not map, or no runs): open on the current
      // agent instead of locking the composer.
      const owner = raw && known.some((a) => a.value === raw) ? raw : null;
      pendingAssistantMetaRef.current = null;
      setResolvedOwner({ threadId, owner });
      if (!owner) return;
      const current = configRef.current;
      if (!current || owner === current.assistantId) return;
      // Pre-set so the model-reconcile effect does not treat this as a user
      // switch and replace the thread's model with the assistant default.
      prevAssistantRef.current = owner;
      setAssistantId(owner);
      setConfig((prev) => {
        if (!prev || prev.assistantId === owner) return prev;
        const next = { ...prev, assistantId: owner };
        saveConfig(next);
        return next;
      });
    };

    (async () => {
      let raw: string | null = null;
      try {
        const state = await client.threads.getState(threadId);
        if (cancelled) return;
        const meta = (state?.metadata ?? {}) as Record<string, unknown>;
        // Checkpoint `assistant_id` is the server UUID, not the graph name.
        const fromCheckpoint =
          typeof meta.graph_id === "string" ? meta.graph_id : null;
        if (fromCheckpoint && !isAssistantUuid(fromCheckpoint)) {
          const known = configAssistantsRef.current;
          if (
            known.length === 0 ||
            known.some((a) => a.value === fromCheckpoint)
          ) {
            raw = fromCheckpoint;
          }
        }
      } catch {
        // Don't settle: a 401 before the iframe token arrives would pin
        // owner=null and never recheck. The effect retries when auth changes.
        return;
      }
      if (cancelled) return;
      if (!raw) {
        try {
          const thread = await client.threads.get(threadId);
          if (cancelled) return;
          raw = await resolveThreadGraph(client, {
            thread_id: threadId,
            metadata: thread.metadata,
          });
        } catch {
          return;
        }
      }
      if (cancelled) return;
      settle(raw);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    threadId,
    authReady,
    authorization,
    langsmithApiKey,
    config?.deploymentUrl,
    resolvedOwner,
    setAssistantId,
    setThreadId,
  ]);

  // The owner lookup can finish before /api/config returns the assistant
  // list. Retry once that list exists; unknown ids are ignored so a missing
  // or foreign graph_id never switches the agent.
  useEffect(() => {
    const pending = pendingAssistantMetaRef.current;
    if (!pending || pending.threadId !== threadId || !config) return;
    if (configAssistants.length === 0) return;
    pendingAssistantMetaRef.current = null;
    if (!configAssistants.some((a) => a.value === pending.assistantId)) {
      if (!isAssistantUuid(pending.assistantId)) {
        toast.error(
          `Тред принадлежит агенту ${pending.assistantId}, к нему нет доступа`
        );
        setResolvedOwner(null);
        setThreadId(null);
        return;
      }
      setResolvedOwner({ threadId: pending.threadId, owner: null });
      return;
    }
    setResolvedOwner({
      threadId: pending.threadId,
      owner: pending.assistantId,
    });
    if (pending.assistantId === config.assistantId) return;
    prevAssistantRef.current = pending.assistantId;
    setAssistantId(pending.assistantId);
    setConfig((prev) => {
      if (!prev || prev.assistantId === pending.assistantId) return prev;
      const next = { ...prev, assistantId: pending.assistantId };
      saveConfig(next);
      return next;
    });
  }, [threadId, config, configAssistants, setAssistantId, setThreadId]);

  // Effective subagent models sent with each run. Never read from persisted
  // config, so stale user-saved models can't leak in.
  const subagentModelsConfig = useMemo(() => {
    if (!config) return undefined;
    // Explicit per-thread/session value (dialog editor or thread restore) wins.
    // An empty object means "explicitly none" → subagents follow the main model.
    if (sessionSubagentModels) {
      return Object.keys(sessionSubagentModels).length > 0
        ? sessionSubagentModels
        : undefined;
    }
    // No explicit value: apply the config.json template ONLY when the main model
    // equals the assistant's default (the model the template was authored for).
    // If the user switched to a different main model, send nothing so subagents
    // run on that main model — mixing e.g. deepseek thinking-mode subagents under
    // a Qwen main model is incompatible and errors the run.
    const template = subagentTemplatesByAssistant[config.assistantId] ?? {};
    const defaultModel = assistantDefaultModels[config.assistantId];
    const useTemplate =
      Object.keys(template).length > 0 &&
      !!defaultModel &&
      config.llmModelName === defaultModel;
    return useTemplate ? template : undefined;
  }, [
    config,
    subagentTemplatesByAssistant,
    assistantDefaultModels,
    sessionSubagentModels,
  ]);

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
        { id: "agent-offline", duration: 8000 }
      );
    } else if (s === "unhealthy" && prev !== "unhealthy") {
      toast.error(
        "The agent is reachable but its health check failed — it may be starting up or a dependency is down.",
        { id: "agent-offline", duration: 8000 }
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
          subagentModels={sessionSubagentModels}
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
          subagentModels={sessionSubagentModels}
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

  const ownerPending = !!threadId && resolvedOwner?.threadId !== threadId;
  const threadOwner =
    resolvedOwner?.threadId === threadId ? resolvedOwner.owner : null;
  const ownerMismatch = !!threadOwner && threadOwner !== config.assistantId;
  // Pending blocks too: a deep link can name another agent's thread, and a
  // send before the lookup returns would run it on the current graph. The
  // lookup retries after a cancel, and a thread opened from the sidebar or
  // just created already has an owner, so this does not stick.
  const runsBlocked = ownerPending || ownerMismatch;

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
        ...(storyKey ? { story_key: storyKey } : {}),
        ...(traceSession ? { langfuse_session_id: traceSession } : {}),
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
        subagentModels={sessionSubagentModels}
      />
      <Dialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) cancelSwitch();
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Start a new conversation?</DialogTitle>
            <DialogDescription>
              {pendingSwitch?.kind === "assistant"
                ? "Switching assistant starts a new conversation. Your current chat history won't carry over."
                : pendingSwitch?.kind === "project"
                ? "Switching project starts a new conversation. Each project has its own data sources and tools, so the current history can't be replayed under another one."
                : "Switching model starts a new conversation. Chat history isn't shared across models, and keeping it can break the new model."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelSwitch}
            >
              Cancel
            </Button>
            <Button onClick={confirmSwitch}>Start new conversation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                  }}
                >
                  <SelectTrigger className="h-7 gap-1 border-none bg-transparent px-1.5 text-sm shadow-none focus:ring-0 [&>svg]:hidden">
                    <SelectValue>
                      {assistantLabels[config.assistantId] ??
                        config.assistantId}
                    </SelectValue>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    className="max-w-[320px]"
                  >
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
                          <span className="mt-0.5 whitespace-normal break-words pl-[22px] text-xs leading-snug text-muted-foreground">
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
                    <TooltipContent
                      side="bottom"
                      className="max-w-xs"
                    >
                      {assistantDescriptions[config.assistantId]}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {configProjects.length > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="font-medium">Project:</span>
                  <Select
                    value={config.project ?? ""}
                    onValueChange={(newProject) => {
                      handleSaveConfig({ ...config, project: newProject });
                    }}
                  >
                    <SelectTrigger className="h-7 gap-1 border-none bg-transparent px-1.5 text-sm shadow-none focus:ring-0 [&>svg]:hidden">
                      <SelectValue placeholder="Select">
                        <span className="block max-w-[140px] truncate">
                          {configProjects.find(
                            (p) => p.value === config.project
                          )?.label ?? config.project}
                        </span>
                      </SelectValue>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </SelectTrigger>
                    <SelectContent
                      align="end"
                      className="max-w-[320px]"
                    >
                      {configProjects.map((p) => (
                        <SelectPrimitive.Item
                          key={p.value}
                          value={p.value}
                          className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            <SelectPrimitive.ItemIndicator>
                              <Check className="h-4 w-4" />
                            </SelectPrimitive.ItemIndicator>
                          </span>
                          <SelectPrimitive.ItemText>
                            {p.label}
                          </SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                            (m) => m.value === config.llmModelName
                          )?.label ?? config.llmModelName}
                        </span>
                      </SelectValue>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </SelectTrigger>
                    <SelectContent
                      align="end"
                      className="max-w-[320px]"
                    >
                      {[
                        ...availableModels,
                        ...(config.llmModelName &&
                        !availableModels.some(
                          (m) => m.value === config.llmModelName
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
                onClick={() => {
                  setThreadId(null);
                  // Fresh thread → subagent models fall back to the default.
                  setSessionSubagentModels(null);
                  modelRestoredForThreadRef.current = null;
                }}
                disabled={!threadId}
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
                      assistantLabels={assistantLabels}
                      onThreadSelect={async (id, owner) => {
                        const known =
                          !!owner &&
                          configAssistants.some((a) => a.value === owner);
                        if (owner && !known && !isAssistantUuid(owner)) {
                          toast.error(
                            `Тред принадлежит агенту ${
                              assistantLabels[owner] ?? owner
                            }, к нему нет доступа`
                          );
                          return;
                        }
                        if (known && owner !== config.assistantId) {
                          prevAssistantRef.current = owner;
                          applyConfig(
                            { ...config, assistantId: owner, llmModelName: "" },
                            false
                          );
                        }
                        setResolvedOwner({
                          threadId: id,
                          owner: known ? owner : null,
                        });
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
                  onThreadCreated={(id) =>
                    setResolvedOwner({
                      threadId: id,
                      owner: config.assistantId,
                    })
                  }
                  recursionLimit={assistantRecursionLimits[config.assistantId]}
                  runsBlocked={runsBlocked}
                >
                  <ChatInterface
                    assistant={assistant}
                    debugMode={debugMode}
                    inputLocked={runsBlocked}
                    banner={
                      ownerPending ? (
                        <p className="text-center text-xs text-muted-foreground">
                          Проверяем агента треда…
                        </p>
                      ) : ownerMismatch && threadOwner ? (
                        <div className="flex items-center justify-center gap-2 text-xs">
                          <span>
                            Тред агента{" "}
                            {assistantLabels[threadOwner] ?? threadOwner}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              prevAssistantRef.current = threadOwner;
                              applyConfig(
                                {
                                  ...config,
                                  assistantId: threadOwner,
                                  llmModelName: "",
                                },
                                false
                              );
                            }}
                          >
                            Переключить
                          </Button>
                        </div>
                      ) : undefined
                    }
                    agentDescription={assistantDescriptions[config.assistantId]}
                    exampleQuestions={
                      assistantExampleQuestions[config.assistantId]
                    }
                    initialInput={
                      storyKey ? `Работаем с ${storyKey}` : undefined
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
