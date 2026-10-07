export type DeploymentEnv = "local" | "test" | "prod";

export interface DeploymentMark {
  brand: string;
  env: DeploymentEnv;
  /** Short chrome label, e.g. "MMRU TEST". */
  label: string;
}

const BRANDS: ReadonlyArray<readonly [suffix: string, brand: string]> = [
  ["moneyman.ru", "MMRU"],
  ["idcollect.ru", "IDCOLLECT"],
  ["svoi.ru", "SVOI"],
  ["idfaws.com", "LATAM"],
];

function brandForHost(host: string): string {
  const match = BRANDS.find(
    ([suffix]) => host === suffix || host.endsWith(`.${suffix}`)
  );
  if (match) return match[1];
  const labels = host.split(".").filter(Boolean);
  if (labels.length >= 2) return labels[labels.length - 2].toUpperCase();
  return "REMOTE";
}

/** Map a deployment URL to the brand + environment shown in the chrome. */
export function deploymentMark(url: string | undefined | null): DeploymentMark {
  let host = "";
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    host = "";
  }

  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { brand: "LOCAL", env: "local", label: "LOCAL" };
  }

  const env: DeploymentEnv = host.includes("-test") ? "test" : "prod";
  const brand = brandForHost(host);
  return { brand, env, label: `${brand} ${env === "test" ? "TEST" : "PROD"}` };
}
