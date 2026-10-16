/** basedpyright 1.40.2's off preset also disables the four core warnings that
 * Pyright/Pylance keep in off mode. Restore only that upstream baseline.
 * https://github.com/microsoft/pyright/blob/main/docs/configuration.md#diagnostic-rule-defaults
 * Type inference and notebook synchronization remain enabled. */
export const notebookPythonAnalysis = {
  typeCheckingMode: 'off',
  diagnosticMode: 'openFilesOnly',
  autoSearchPaths: true,
  useLibraryCodeForTypes: true,
  diagnosticSeverityOverrides: {
    reportMissingImports: 'warning',
    reportMissingModuleSource: 'warning',
    reportInvalidTypeForm: 'warning',
    reportUndefinedVariable: 'warning',
  },
};
