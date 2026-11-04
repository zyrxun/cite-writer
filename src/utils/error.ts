export function logError(e: unknown): void {
  Zotero.logError(e instanceof Error ? e : new Error(String(e)));
}
