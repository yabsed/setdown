import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { clientCapabilities } from '../../protocol/language-features';
import { clangdFileStatus, clangdFileStatusMethod, toolFamily } from './extension-rules';
import { mergeLanguageSettings } from './language-settings';
import type { ServerProfile } from './server-definitions';
import type { ToolRules, ToolRulesFactory } from './tool-signals';
import { customDataAddresses, customDataChanged, htmlCustomDataRules, type MarkupKind } from './markup-custom-data';
import { yamlRules } from './yaml-schema-choice';
import { goplsRules } from './go-gopls-rules';

// Which rules a running tool gets: what its own extension listens to and answers beyond the
// protocol. The rules themselves are carried over in one file for each extension; this file only
// chooses among them and lays them over the tool's profile.

/** vendor/vscode-clangd/src/file-status.ts: what clangd is doing with each file. */
const clangdRules: ToolRulesFactory = () => ({
  notifications: { [clangdFileStatusMethod]: params => { const status = clangdFileStatus(params); return status && { progress: { [status.uri]: status.line } }; } },
});

/** vendor/vscode/extensions/{html,css}-language-features/client: the project's custom data files
 * are named to the tool once it runs (`markup-custom-data.ts`). The HTML tool then asks for the
 * text of each; the CSS tool reads them itself. */
const markupRules = (kind: MarkupKind): ToolRulesFactory => context => {
  const addresses = customDataAddresses(kind, context.settings, context.root), own = kind === 'html' ? htmlCustomDataRules()(context) : {};
  return { ...own, ...(addresses.length ? { announces: [{ method: customDataChanged(kind, addresses).method, params: addresses }] } : {}) };
};

export type ToolRulesContext = Parameters<ToolRulesFactory>[0];
/** The rules of one session of a tool, or none for a tool that is spoken to in the protocol only. */
export function toolRules(tool: Pick<LanguageServerDefinition, 'id' | 'launch' | 'provenance'>, context: ToolRulesContext, factories: Partial<Record<NonNullable<ReturnType<typeof toolFamily>>, ToolRulesFactory>> = {}): ToolRules | undefined {
  const family = toolFamily(tool);
  const factory = family && ({ clangd: clangdRules, gopls: goplsRules, html: markupRules('html'), css: markupRules('css'), yaml: yamlRules, ...factories } as Partial<Record<string, ToolRulesFactory>>)[family];
  return factory?.(context);
}
/** The profile with the rules laid over it: their capabilities over what the tool was already
 * to be told, and their initialization options under what the person or the profile wrote. */
export function withRules(profile: ServerProfile, rules: ToolRules | undefined): ServerProfile {
  if (!rules) return profile;
  return { ...profile, rules,
    capabilities: rules.capabilities ? rules.capabilities(profile.capabilities ?? clientCapabilities()) : profile.capabilities,
    initializationOptions: rules.initializationOptions ? mergeLanguageSettings(rules.initializationOptions, profile.initializationOptions) : profile.initializationOptions };
}
