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

/** Access state derived from the caller's Keycloak token, sent to the UI so it
 * can explain *why* the assistant list may be empty (e.g. missing role). */
type AccessInfo = {
  /** True when a decodable bearer token was present on the request. */
  authenticated: boolean;
  /** The caller's `ai-groups` claim ([] when authenticated without the claim). */
  userGroups: string[];
  email: string | null;
  name: string | null;
  /** Assistant count before group filtering. */
  totalAssistants: number;
  /** Assistant count the caller may actually see. */
  visibleAssistants: number;
};

type Identity = {
  authenticated: boolean;
  /** null = token absent or no `ai-groups` claim; [] never returned here. */
  groups: string[] | null;
  email: string | null;
  name: string | null;
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

function extractIdentity(auth: string | null): Identity {
  const anon: Identity = {
    authenticated: false,
    groups: null,
    email: null,
    name: null,
  };
  if (!auth) return anon;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return anon;
  const claims = decodeJwtPayload(token);
  if (!claims) return anon;
  const raw = claims["ai-groups"];
  const groups = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : null;
  const asString = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    authenticated: true,
    groups,
    email: asString(claims["email"]),
    name: asString(claims["name"]),
  };
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

/** True when the UI is being served from localhost (dev). */
function isLocalhostHost(host: string | null): boolean {
  if (!host) return false;
  const name = host
    .split(":")[0]
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/** Filter `parsed` for the caller and attach an `_access` summary so the UI can
 * distinguish "no role" from other empty-list causes. `bypassFilter` disables
 * group gating (used for localhost dev) while keeping `_access` truthful. */
function respond(
  parsed: Config,
  identity: Identity,
  opts?: { bypassFilter?: boolean; init?: ResponseInit }
) {
  const total = Array.isArray(parsed.assistants) ? parsed.assistants.length : 0;
  const filtered = filterAssistants(
    parsed,
    opts?.bypassFilter ? null : identity.groups
  );
  const visible = Array.isArray(filtered.assistants)
    ? filtered.assistants.length
    : 0;
  const access: AccessInfo = {
    authenticated: identity.authenticated,
    userGroups: identity.groups ?? [],
    email: identity.email,
    name: identity.name,
    totalAssistants: total,
    visibleAssistants: visible,
  };
  return NextResponse.json({ ...filtered, _access: access }, opts?.init);
}

export async function GET() {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  const identity = extractIdentity(authHeader);
  // Localhost dev: never gate assistants by group, so local testing (e.g. the
  // connectivity banner) is reachable regardless of the token's ai-groups.
  const bypassFilter = isLocalhostHost(headersList.get("host"));

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
        return respond(parsed, identity, { bypassFilter });
      }
      return respond(emptyConfig(), identity, { bypassFilter });
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Config;
    return respond(parsed, identity, { bypassFilter });
  } catch (error) {
    console.error("Error reading config:", error);
    return respond(emptyConfig(), identity, {
      bypassFilter,
      init: { status: 500 },
    });
  }
}
