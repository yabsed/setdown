import data from './profiles.json';
import mason from './mason.json';
import type { LanguageServerDefinition } from '../../../core/document/language-definition';

// Generated data stays in main. Neither the Mason catalog nor upstream profiles
// belong in the renderer/preview bundle. See scripts/language-profiles for provenance.
export const builtinLanguageServers = data.profiles as LanguageServerDefinition[];
export const profileSource = `Helix ${data.sources.helix.revision.slice(0, 12)}`;
export const languageCatalog = [
  ...mason.packages,
  ...builtinLanguageServers.filter(profile => !mason.packages.some(p => p.id === profile.id)).map(profile => ({
    id: profile.id, languages: profile.languages.map(l => l.languageId), description: 'Connection profile imported from Helix.',
    homepage: 'https://github.com/helix-editor/helix/wiki/Language-Server-Configurations', licenses: ['MPL-2.0'],
    source: { id: '' }, executables: profile.launch.kind === 'native' ? [profile.launch.command] : [],
  })),
];
export function packageDiscovery(id: string): { python?: boolean; npmPackage?: string } {
  const source = mason.packages.find(p => p.id === id)?.source.id ?? '';
  return { python: source.startsWith('pkg:pypi/'),
    npmPackage: source.startsWith('pkg:npm/') ? decodeURIComponent(source.slice(8, source.lastIndexOf('@'))) : undefined };
}
