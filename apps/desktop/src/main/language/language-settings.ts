export function mergeLanguageSettings(...values: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values) for (const [key, item] of Object.entries(value ?? {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    result[key] = item && typeof item === 'object' && !Array.isArray(item)
      ? mergeLanguageSettings(result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? result[key] as Record<string, unknown> : {}, item as Record<string, unknown>) : item;
  }
  return result;
}

