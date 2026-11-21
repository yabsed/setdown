import { expect, test } from 'vitest';
import type { LanguageRoute } from '../../core/document/language-support';
import type { LanguageCapabilities } from '../../protocol/language';
import { languageFeaturePlan } from './language-feature-plan';

const everything = { hoverProvider: true, renameProvider: { prepareProvider: true }, semanticTokensProvider: { full: true, legend: { tokenTypes: [], tokenModifiers: [] } },
  documentFormattingProvider: true, documentRangeFormattingProvider: true } as LanguageCapabilities;
const route = (server: string, more: Partial<LanguageRoute> = {}): LanguageRoute => ({ server, languageId: 'vue', extensions: ['.vue'], ...more });

test("the language's own tool keeps everything it offers", () => {
  expect(languageFeaturePlan('vue', true, [route('vue'), route('typescript', { role: 'supplementary', beside: true })], everything)).toEqual(everything);
});

test('a linter beside it neither renames, colours nor formats', () => {
  const plan = languageFeaturePlan('linter', false, [route('vue'), route('linter', { role: 'supplementary' })], everything);
  expect(plan.hoverProvider).toBe(true);
  expect(plan).not.toHaveProperty('renameProvider'); expect(plan).not.toHaveProperty('semanticTokensProvider'); expect(plan).not.toHaveProperty('documentFormattingProvider');
});

test('a tool that works together with it keeps its rename, and still leaves colours and formatting to it', () => {
  // TypeScript's server in a `.vue` file: Vue's own tool declines to rename a variable of the script.
  const plan = languageFeaturePlan('typescript', false, [route('vue'), route('typescript', { role: 'supplementary', beside: true })], everything);
  expect(plan.renameProvider).toEqual({ prepareProvider: true });
  expect(plan).not.toHaveProperty('semanticTokensProvider'); expect(plan).not.toHaveProperty('documentFormattingProvider');
});
