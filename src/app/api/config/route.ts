import { NextResponse } from "next/server";
import { headers } from "next/headers";
import fs from "fs";
import path from "path";

type Assistant = {
  value: string;
  label: string;
  aiGroups?: string[];
  [key: string]: unknown;
};

type Config = {
  deployments?: unknown[];
  assistants?: Assistant[];
  projects?: unknown[];
  [key: string]: unknown;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAiGroups(auth: string | null): string[] | null {
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  if (!claims) return null;
  const raw = claims["ai-groups"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function canAccessAssistant(
  userGroups: string[],
  assistantGroups?: string[]
): boolean {
  if (!assistantGroups || assistantGroups.length === 0) return true;
  const userSet = new Set(userGroups);
  for (const g of assistantGroups) {
    if (userSet.has(g)) return true;
  }
  return false;
}

function filterAssistants(config: Config, userGroups: string[] | null): Config {
  if (!Array.isArray(config.assistants)) return config;
  if (userGroups === null || userGroups.length === 0) return config;
  return {
    ...config,
    assistants: config.assistants.filter((a) =>
      canAccessAssistant(userGroups, a.aiGroups)
    ),
  };
}

function emptyConfig(): Config {
  return { deployments: [], assistants: [], projects: [] };
}

export async function GET() {
  const headersList = await headers();
  const userGroups = extractAiGroups(headersList.get("authorization"));

  try {
    const configPath = path.join(process.cwd(), "config", "config.json");

    if (!fs.existsSync(configPath)) {
      const examplePath = path.join(
        process.cwd(),
        "config",
        "config.example.json"
      );
      if (fs.existsSync(examplePath)) {
        const content = fs.readFileSync(examplePath, "utf-8");
        const parsed = JSON.parse(content) as Config;
        return NextResponse.json(filterAssistants(parsed, userGroups));
      }
      return NextResponse.json(emptyConfig());
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Config;
    return NextResponse.json(filterAssistants(parsed, userGroups));
  } catch (error) {
    console.error("Error reading config:", error);
    return NextResponse.json(emptyConfig(), { status: 500 });
  }
}
