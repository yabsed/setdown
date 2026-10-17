/** TypeScript ScriptKind values; URI identity is never rewritten. */
export function scriptKindForResource(resource: string, allowJs = false): number {
  let file = resource;
  try { file = new URL(resource).pathname; } catch { /* Plain compiler filenames. */ }
  const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return ({ js: 1, jsx: 2, ts: 3, tsx: 4, mts: 3, cts: 3, mjs: 1, cjs: 1 } as Record<string, number>)[extension] ?? (allowJs ? 1 : 3);
}
