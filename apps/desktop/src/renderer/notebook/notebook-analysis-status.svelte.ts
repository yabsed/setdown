import { SvelteMap } from 'svelte/reactivity';

/** A notebook tab's Python analysis, as its location bar shows it where other documents
 * show their language status. The notebook surface owns the state and the panel. */
export type NotebookAnalysisStatus = { state: string; open: boolean; toggle(): void };
export const notebookAnalysisStatus = new SvelteMap<string, NotebookAnalysisStatus>();

/** The same words as other documents: nothing while analysis is connected. */
export function presentNotebookAnalysis(state: string): { label: string; tone: 'neutral' | 'warning' | 'busy' } {
  if (state === 'ready') return { label: '', tone: 'neutral' };
  if (!state || state === 'starting') return { label: 'Starting analysis', tone: 'busy' };
  return { label: state === 'failed' ? 'Analysis stopped' : 'Analysis unavailable', tone: 'warning' };
}
