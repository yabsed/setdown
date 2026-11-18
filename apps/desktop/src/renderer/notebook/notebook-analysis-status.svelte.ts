import { SvelteMap } from 'svelte/reactivity';
import type { LanguageIssue } from '../../protocol/language';

/** A notebook tab's Python analysis, as its location bar shows it where other documents
 * show their language status. The notebook surface owns the state and the panel. */
export type NotebookAnalysisStatus = { state: string; open: boolean; toggle(): void };
export const notebookAnalysisStatus = new SvelteMap<string, NotebookAnalysisStatus>();

/** The same words as other documents: nothing while analysis is connected. */
export function presentNotebookAnalysis(state: string): { label: string; tone: 'neutral' | 'warning' | 'busy' } {
  if (state === 'ready') return { label: '', tone: 'neutral' };
  if (!state || state === 'starting') return { label: '', tone: 'busy' };
  return { label: state === 'failed' ? 'Not working' : 'Needs setup', tone: 'warning' };
}

/** The notebook's analyzer is shipped with the app, so two causes remain once Setdown
 * has stopped reconnecting it: it never answered, or it stopped while serving. */
export function notebookAnalysisStopped(issue?: LanguageIssue): { title: string; description?: string } {
  return issue?.kind === 'startup' ? { title: "Python analysis can't start.", description: issue.detail } : { title: 'Python analysis stopped unexpectedly.' };
}
