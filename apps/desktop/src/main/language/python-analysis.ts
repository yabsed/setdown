import { builtinLanguageServers } from './catalog/profiles';

/** One product default for ordinary Python and native notebooks. The generated
 * profile is owned by scripts/language-profiles/overrides.json. Project-native
 * Pyright configuration remains authoritative inside the language server. */
export const notebookPythonAnalysis = (builtinLanguageServers.find(profile => profile.id === 'pyright')!
  .settings.python as { analysis: Record<string, unknown> }).analysis;
