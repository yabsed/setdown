import data from './catalog/languages.json';
import { matchesLanguagePattern } from './language-support';

export type LanguageDefinition = {
  id: string; sourceId: string; name: string; label: string; grammar?: string;
  extensions: string[]; caseSensitiveExtensions?: string[]; filenames: string[]; filenamePatterns: string[];
  shebangs: string[]; lineComment?: string; blockComment?: string[]; tabSize?: number; insertSpaces?: boolean;
  servers?: string[]; zedName?: string;
  treeSitter?: { extension: string; config: string };
};
const catalog:LanguageDefinition[]=[...data.languages];
export const languageDefinitions: readonly LanguageDefinition[] = catalog;
const definitions = new Map(languageDefinitions.map(language => [language.sourceId, language]));
const editors = new Map<string, LanguageDefinition>();
for (const language of languageDefinitions) if (!editors.has(language.id)) editors.set(language.id, language);
export const languageDefinition = (id: string): LanguageDefinition | undefined => definitions.get(id) ?? editors.get(id);
export function updateLanguageDefinitions(additional: readonly LanguageDefinition[]): void {
  const merged = new Map<string,LanguageDefinition>(data.languages.map(language=>[language.sourceId,language]));
  for(const language of additional) merged.set(language.sourceId,language);
  catalog.splice(0,catalog.length,...merged.values());definitions.clear();editors.clear();
  for(const language of catalog){definitions.set(language.sourceId,language);if(!editors.has(language.id))editors.set(language.id,language);}
}

/** Independent of installed/available/enabled servers. Never loads a grammar. */
export function catalogLanguage(file: string, firstLine = ''): LanguageDefinition | undefined {
  const normalized = file.replace(/\\/g, '/'), name = normalized.split('/').at(-1)!;
  if (!name.includes('.')) { const interpreter = interpreterLanguage(firstLine); if (interpreter) return interpreter; }
  const exact = languageDefinitions.find(language => language.filenames.includes(name));
  if (exact) return exact;
  let patterned: LanguageDefinition | undefined, specificity = -1;
  for (const language of languageDefinitions) for (const pattern of language.filenamePatterns) {
    const score = pattern.replace(/[*?]/g, '').length;
    if (score > specificity && matchesLanguagePattern(normalized, pattern)) { patterned = language; specificity = score; }
  }
  if (patterned) return patterned;
  const sensitive = languageDefinitions.find(language => language.caseSensitiveExtensions?.some(extension => name.endsWith(extension)));
  if (sensitive) return sensitive;
  const lower = name.toLowerCase();
  let match: LanguageDefinition | undefined, length = 0;
  for (const language of languageDefinitions) for (const extension of language.extensions) {
    if (extension.length > length && lower.endsWith(extension.toLowerCase())) { match = language; length = extension.length; }
  }
  if (match) return match;
  return interpreterLanguage(firstLine);
}

/** An extensionless executable carries a stronger language hint than a generic filename. */
function interpreterLanguage(firstLine: string): LanguageDefinition | undefined {
  if (firstLine.startsWith('#!')) {
    const words = firstLine.slice(2, 258).trim().split(/\s+/);
    let executable = words.shift()?.split('/').at(-1) ?? '';
    if (executable === 'env') {
      while (words.length && (words[0].startsWith('-') || /^[\w]+=/.test(words[0]))) {
        const option = words.shift(); if (option === '-u' || option === '--unset') words.shift();
      }
      executable = words[0]?.split('/').at(-1) ?? '';
    }
    return languageDefinitions.find(language => language.shebangs.some(name => name === executable || name === executable.replace(/\d+(?:\.\d+)*$/, '')));
  }
}
