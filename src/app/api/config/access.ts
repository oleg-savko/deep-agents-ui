export type Assistant = {
  value: string;
  label: string;
  aiGroups?: string[];
  [key: string]: unknown;
};

export type Config = {
  deployments?: unknown[];
  assistants?: Assistant[];
  projects?: unknown[];
  [key: string]: unknown;
};

/** Access state derived from the caller's Keycloak token, sent to the UI so it
 * can explain *why* the assistant list may be empty (e.g. missing role). */
export type AccessInfo = {
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

export type Identity = {
  authenticated: boolean;
  /** null = token absent or no `ai-groups` claim; [] never returned here. */
  groups: string[] | null;
  email: string | null;
  name: string | null;
};

export function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
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

export function extractIdentity(auth: string | null): Identity {
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

export function canAccessAssistant(
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

export function filterAssistants(
  config: Config,
  userGroups: string[] | null
): Config {
  if (!Array.isArray(config.assistants)) return config;
  if (userGroups === null || userGroups.length === 0) return config;
  return {
    ...config,
    assistants: config.assistants.filter((a) =>
      canAccessAssistant(userGroups, a.aiGroups)
    ),
  };
}

export function emptyConfig(): Config {
  return { deployments: [], assistants: [], projects: [] };
}

/** True when the UI is being served from localhost (dev). */
export function isLocalhostHost(host: string | null): boolean {
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
export function applyAccess(
  parsed: Config,
  identity: Identity,
  opts?: { bypassFilter?: boolean }
): { body: Config & { _access: AccessInfo } } {
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
  return { body: { ...filtered, _access: access } };
}
