<script lang="ts">
  import LanguageStatusButton from '../language/LanguageStatusButton.svelte';
  import { notebookAnalysisStatus, presentNotebookAnalysis } from './notebook-analysis-status.svelte';
  let { tabId }: { tabId: string } = $props();
  const status = $derived(notebookAnalysisStatus.get(tabId));
  const shown = $derived(presentNotebookAnalysis(status?.state ?? ''));
</script>

{#if status}<LanguageStatusButton name="Python" label={shown.label} tone={shown.tone} expanded={status.open} onclick={status.toggle} />{/if}
