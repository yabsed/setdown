import type { AnalysisContext, PythonChecking } from '../../core/document/analysis-context';

/** The checking levels of Pyright, basedpyright and VS Code's Python analysis,
 * described by what a reader will see rather than by rule names. */
export const checkingLevels: { value: PythonChecking; name: string; reports: string }[] = [
  { value: 'off', name: 'Off', reports: 'Syntax errors, unresolved imports and undefined names. Types still power completion and hover. This is the VS Code default.' },
  { value: 'basic', name: 'Basic', reports: 'Also type errors: wrong arguments, unknown attributes, incompatible assignments. Libraries without type information can be reported inaccurately.' },
  { value: 'standard', name: 'Standard', reports: 'Basic, plus stricter rules for method overrides, optional values and unbound names.' },
  { value: 'strict', name: 'Strict', reports: 'Everything, including missing annotations and values whose type is unknown.' },
];

/** What "Project settings / default" resolves to here, so the choice is not a black box. */
export function automaticChecking(checking: NonNullable<AnalysisContext['checking']>): string {
  const level = checkingLevels.find(item => item.value === checking.mode)?.name ?? checking.mode;
  if (checking.projectConfiguration) return 'Decided by the project’s own configuration.';
  return checking.override ? 'Follow .vscode/settings.json, or Setdown’s default.' : `Currently ${level} · ${checking.source}`;
}
