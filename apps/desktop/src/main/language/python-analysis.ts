import { builtinLanguageServers } from './catalog/profiles';

/** The analysis settings of ordinary Python files. The generated profile is owned by
 * scripts/language-profiles/overrides.json. Project-native Pyright configuration
 * remains authoritative inside the language server. */
export const pythonAnalysis = (builtinLanguageServers.find(profile => profile.id === 'pyright')!
  .settings.python as { analysis: Record<string, unknown> }).analysis;

/** Native notebooks use the same settings at the checking level VS Code starts with.
 * Notebook code is mostly calls into libraries, where type reports are rarely about
 * the notebook: apps/notebook-benchmark measures it on public notebooks, and
 * reports/notebook-lsp-corpus-2026-11-18 records the run behind this default. Type
 * checking stays one choice away, and a project's own settings win. */
export const notebookPythonAnalysis: Record<string, unknown> = { ...pythonAnalysis, typeCheckingMode: 'off' };

/** basedpyright's `off` preset also silences the four warnings that Pyright and
 * Pylance keep in `off`. Restore that upstream baseline, so `off` means the same
 * thing in a notebook as in a Python file and in VS Code.
 * https://github.com/microsoft/pyright/blob/main/docs/configuration.md#diagnostic-settings-defaults */
export const offBaselineSeverities = {
  reportMissingImports: 'warning',
  reportMissingModuleSource: 'warning',
  reportInvalidTypeForm: 'warning',
  reportUndefinedVariable: 'warning',
} as const;
