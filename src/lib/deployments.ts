/** Registrable root domain (last two labels), e.g. "deep-agent-ui.moneyman.ru" -> "moneyman.ru". */
function rootDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

/**
 * Keep only deployments whose URL host shares the current page's root domain.
 * Falls back to all deployments when host can't be parsed (e.g. SSR / no window)
 * or on localhost dev, where every deployment (incl. remote ones) must stay
 * selectable for testing.
 */
export function filterDeploymentsByHost<T extends { value: string }>(
  deployments: T[],
  host: string | undefined
): T[] {
  if (!host) return deployments;
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") {
    return deployments;
  }
  const current = rootDomain(host);
  const matched = deployments.filter((d) => {
    try {
      return rootDomain(new URL(d.value).hostname) === current;
    } catch {
      return false;
    }
  });
  return matched.length > 0 ? matched : deployments;
}
