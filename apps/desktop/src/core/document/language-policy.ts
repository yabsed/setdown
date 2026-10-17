import type { LanguageRoute } from './language-support';
import { languageSupport } from './language-support';
import { documentLanguage, type RegisteredLanguage } from './document-profile';

/** Recognition includes disabled/uninstalled providers. Execution never does. */
export function recognizedLanguage(file: string, languages: readonly RegisteredLanguage[], routes: LanguageRoute[], firstLine = ''): string {
  const match = languageSupport(file, routes.map(route => ({ ...route, enabled: true })));
  const route = routes.find(route => route.server === match?.server && route.languageId === match?.languageId);
  const id = route?.monacoId ?? match?.languageId;
  return id ?? documentLanguage(file, languages, firstLine);
}

export type LocalSupport = { name: string; checks: 'none' | 'syntax' | 'schema' | 'document'; features: string[] };
/** Actual adapters, not a list of language names that supposedly have an LSP. */
export function localSupport(language: string): LocalSupport {
  if (language === 'json') return { name: 'JSON', checks: 'schema', features: ['Completion', 'Hover', 'Formatting', 'Syntax', 'Available schemas'] };
  if (['css', 'scss', 'less'].includes(language)) return { name: language.toUpperCase(), checks: 'document', features: ['Completion', 'Hover', 'Formatting', 'Syntax', 'CSS lint'] };
  if (['html', 'handlebars', 'razor'].includes(language)) return { name: 'HTML', checks: 'none', features: ['Completion', 'Hover', 'Formatting'] };
  if (['typescript', 'javascript'].includes(language)) return { name: language === 'typescript' ? 'TypeScript' : 'JavaScript', checks: 'syntax', features: ['Completion', 'Hover', 'Formatting', 'Syntax'] };
  return { name: language, checks: 'none', features: [] };
}

/** These adapters are known to perform the same check as the local validator.
 * Unknown servers, including formatters, never acquire diagnostic ownership. */
export function replacesLocalChecks(server: string, language: string): boolean {
  return (server === 'typescript-language-server' && ['typescript', 'javascript'].includes(language))
    || (server === 'json-lsp' && language === 'json')
    || (server === 'css-lsp' && ['css', 'scss', 'less'].includes(language));
}

/** Common JSONC resources. This is a dialect adapter, never a diagnostic-code filter. */
export function jsonDialect(file: string): 'json' | 'jsonc' | 'jsonl' {
  const normalized = file.replace(/\\/g, '/');
  if (/\.jsonl$/i.test(normalized)) return 'jsonl';
  return /\.(jsonc|code-workspace)$/i.test(normalized)
    || /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/i.test(normalized)
    || /(?:^|\/)\.vscode\/(?:settings|launch|tasks|extensions)\.json$/i.test(normalized) ? 'jsonc' : 'json';
}
