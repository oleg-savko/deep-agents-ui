const KEY = (threadId: string) => `run-started:${threadId}`;

export function readRunStart(threadId: string): number | null {
  if (typeof window === "undefined") return null;
  const v = Number(localStorage.getItem(KEY(threadId)));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function writeRunStart(threadId: string, at: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY(threadId), String(at));
}

export function clearRunStart(threadId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY(threadId));
}
