"use client";

import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StandaloneConfig } from "@/lib/config";

interface Project {
  value: string;
  label: string;
}

interface LLMModel {
  value: string;
  label: string;
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
  const [deploymentUrl, setDeploymentUrl] = useState(
    initialConfig?.deploymentUrl || ""
  );
  const [assistantId, setAssistantId] = useState(
    initialConfig?.assistantId || ""
  );
  const [langsmithApiKey, setLangsmithApiKey] = useState(
    initialConfig?.langsmithApiKey || ""
  );
  const [llmModelName, setLlmModelName] = useState(
    initialConfig?.llmModelName || "openai:gpt-5.1"
  );
  const [project, setProject] = useState(
    initialConfig?.project || ""
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [llmModels, setLlmModels] = useState<LLMModel[]>([]);

  useEffect(() => {
    if (open && initialConfig) {
      setDeploymentUrl(initialConfig.deploymentUrl);
      setAssistantId(initialConfig.assistantId);
      setLangsmithApiKey(initialConfig.langsmithApiKey || "");
      setLlmModelName(initialConfig.llmModelName || "openai:gpt-5.1");
      setProject(initialConfig.project || "");
    }
  }, [open, initialConfig]);

  // Load projects and LLM models from config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
          setLlmModels(data.models || []);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    };

    if (open) {
      loadConfig();
    }
  }, [open]);

  const handleSave = () => {
    if (!deploymentUrl || !assistantId) {
      alert("Please fill in all required fields");
      return;
    }

    onSave({
      deploymentUrl,
      assistantId,
      langsmithApiKey: langsmithApiKey || undefined,
      llmModelName: llmModelName || undefined,
      project: project || undefined,
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
            <Input
              id="deploymentUrl"
              placeholder="https://<deployment-url>"
              value={deploymentUrl}
              onChange={(e) => setDeploymentUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assistantId">Assistant ID</Label>
            <Input
              id="assistantId"
              placeholder="<assistant-id>"
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="langsmithApiKey">
              LangSmith API Key{" "}
              <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <Input
              id="langsmithApiKey"
              type="password"
              placeholder="lsv2_pt_..."
              value={langsmithApiKey}
              onChange={(e) => setLangsmithApiKey(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="llmModelName">
              LLM Model Name{" "}
              <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <Select
              value={llmModelName}
              onValueChange={setLlmModelName}
            >
              <SelectTrigger id="llmModelName">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {llmModels.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
