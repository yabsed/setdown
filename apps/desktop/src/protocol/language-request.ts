/** Electron's rejected Error values lose JSON-RPC code/data across IPC and the
 * context bridge. Transport protocol failures as data, decode inside the renderer. */
export type LanguageFailure = { $setdownError: { code: number; message: string; data?: unknown } };
export class LanguageRequestError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); }
}
export function languageFailure(error: unknown): LanguageFailure {
  const value = error as { code?: unknown; message?: unknown; data?: unknown } | null;
  if (!value || !Number.isInteger(value.code)) throw error;
  const encoded = value.data === undefined ? undefined : JSON.stringify(value.data);
  return { $setdownError: { code: value.code as number, message: String(value.message ?? 'Language request failed.').slice(0, 8192),
    data: encoded && encoded.length <= 65536 ? JSON.parse(encoded) : undefined } };
}
export function languageResult<T>(result: unknown): T {
  if (result && typeof result === 'object' && '$setdownError' in result) {
    const error = (result as LanguageFailure).$setdownError;
    throw new LanguageRequestError(error.code, error.message, error.data);
  }
  return result as T;
}

export function languageItemHandles(value: unknown): string[] {
  const result = new Set<string>();
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, entry] of Object.entries(item)) {
      if (key === '$setdownItem' && typeof entry === 'string') result.add(entry);
      else if (key !== 'data') visit(entry);
    }
  };
  visit(value); return [...result];
}

type Cancellation = { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): { dispose(): void } };
/** Only idempotent analysis requests may be retriggered. Every attempt retains
 * the original revision guard; commands/edits are never automatically repeated. */
export async function requestLanguageResult<T>(method: string, send: () => Promise<unknown>, alive: () => boolean, token: Cancellation): Promise<T | null> {
  for (let attempt = 0; attempt < 3 && alive() && !token.isCancellationRequested; attempt++) {
    try {
      const result = languageResult<T>(await send());
      return alive() && !token.isCancellationRequested ? result : null;
    } catch (error) {
      const failure = error as { code?: number; data?: { retriggerRequest?: boolean } };
      const retrigger = failure?.code === -32802 && (method.startsWith('textDocument/semanticTokens/')
        || method === 'textDocument/diagnostic' && failure.data?.retriggerRequest !== false);
      if (!retrigger || attempt === 2) throw error;
      await new Promise<void>(resolve => {
        let finished = false, cancel: { dispose(): void } | undefined;
        const finish = () => { finished = true; clearTimeout(timer); cancel?.dispose(); resolve(); };
        const timer = setTimeout(finish, 25 * (attempt + 1));
        cancel = token.onCancellationRequested(finish);
        if (finished || token.isCancellationRequested) finish();
      });
    }
  }
  return null;
}
