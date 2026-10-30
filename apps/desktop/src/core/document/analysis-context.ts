/** Public analysis metadata. Process environment and executable commands stay in main. */
export type AnalysisEnvironmentKind = 'python' | 'typescript' | 'compilation';
export type AnalysisChoice = { id: string; name: string; path: string; source: string; available: boolean };
export type AnalysisContext = {
  id: string; root: string; rootReason: string;
  environment: 'usable' | 'partial' | 'action-needed';
  kind?: AnalysisEnvironmentKind; label?: string; selected?: string;
  choices: AnalysisChoice[]; evidence: string[];
  issues: { code: string; message: string }[];
  preparation?: 'cmake' | 'meson';
};
export type DocumentAnalysis = AnalysisContext & {
  servers: { id: string; name: string; selected: boolean; enabled: boolean; role: 'primary' | 'supplementary' }[];
};
export type AnalysisSelection = { kind: AnalysisEnvironmentKind | 'server'; value: string };
export type AnalysisObservation = {
  context: AnalysisContext;
  analysis: 'waiting' | 'working' | 'observed';
  scope: 'open-files' | 'project';
  freshness: 'none' | 'current' | 'best-effort' | 'stale';
  progress: string[];
};
