// Bundled by lib/product.mjs. Everything the benchmark knows about Setdown's notebook
// analysis comes from these product modules, so a product change is measured without
// editing the benchmark.
import { notebookPythonAnalysis } from '../desktop/src/main/language/python-analysis';
import { applyPythonProjectSettings, withLibraryStubs } from '../desktop/src/main/language/python-project-settings';
import { libraryStubs, type PythonSearch } from '../desktop/src/main/language/python-library-stubs';
export { notebookAnalysisSource, notebookPrelude } from '../desktop/src/main/language/notebook-ipython-syntax';

type Level = 'off' | 'basic' | 'standard' | 'strict';

/** The level a notebook gets when neither the project nor the user chose one. */
export const defaultLevel = notebookPythonAnalysis.typeCheckingMode as Level;

/** The analyzer settings the notebook host sends for a project root and an interpreter,
 * as notebook-language-host.ts and analysis-context.ts build them. */
export function notebookAnalysis(root: string, search: PythonSearch, bundled: string, level?: Level) {
  const stubs = libraryStubs(root, search, bundled);
  const settings = { python: { analysis: notebookPythonAnalysis }, basedpyright: { analysis: notebookPythonAnalysis } };
  const configuration = withLibraryStubs(applyPythonProjectSettings(settings, { errors: [] }, 'basedpyright', false, level), 'basedpyright', stubs.paths);
  return { analysis: (configuration.basedpyright as { analysis: Record<string, unknown> }).analysis, stubs };
}
