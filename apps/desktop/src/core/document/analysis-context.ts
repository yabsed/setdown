/** Public analysis metadata. Process environment and executable commands stay in main. */
export type PythonChecking = 'off' | 'basic' | 'standard' | 'strict';
export type AnalysisEnvironmentKind = 'python' | 'typescript' | 'compilation';
export type AnalysisChoice = { id: string; name: string; path: string; source: string; available: boolean };
export type AnalysisContext = {
  id: string; root: string; rootReason: string;
  environment: 'usable' | 'partial' | 'action-needed';
  kind?: AnalysisEnvironmentKind; label?: string; selected?: string;
  choices: AnalysisChoice[]; evidence: string[];
  selectionSource?: 'project' | 'connection' | 'automatic' | 'notebook';
  /** Effective choice after removing only the project override. */
  inherited?: AnalysisChoice;
  issues: { code: string; message: string }[];
  checking?: { mode: PythonChecking; override?: PythonChecking; source: string; projectConfiguration?: string };
  preparation?: 'cmake' | 'meson';
};
export type DocumentAnalysis = AnalysisContext & {
  analysisSelection?: AnalysisPolicy;
  servers: { id: string; name: string; selected: boolean; enabled: boolean; role: 'primary' | 'supplementary' }[];
};
export type AnalysisPolicy = { mode: 'automatic' | 'server' | 'off'; source: 'project' | 'global' | 'default'; server?: string };
export type AnalysisSelection = { kind: AnalysisEnvironmentKind | 'server' | 'python-checking'; value: string; root?: string };
export type AnalysisObservation = {
  context: AnalysisContext;
  analysis: 'waiting' | 'working' | 'observed';
  scope: 'open-files' | 'project';
  freshness: 'none' | 'current' | 'best-effort' | 'stale';
  progress: string[];
};
