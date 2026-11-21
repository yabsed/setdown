<script lang="ts">
  import { onMount } from 'svelte';
  import type { CloseDecision, ClosePromptContext } from '../../protocol/desktop-api';
  import type { DesktopPort } from '../ports/desktop-port';
  import { applyShellTheme } from '../theme';
  import ClosePrompt from './ClosePrompt.svelte';

  let { api }: { api: DesktopPort['closePromptOverlay'] } = $props();
  let prompt = $state<ClosePromptContext | null>(null);

  function show(context: ClosePromptContext | undefined) {
    if (!context) return;
    applyShellTheme(context.theme); prompt = context;
  }
  function choose(decision: CloseDecision) {
    if (!prompt) return;
    prompt = null; api.decide(decision);
  }
  onMount(() => {
    const off = api.onShow(show);
    // The first question can be sent before this page has started listening.
    void api.context().then(context => { if (!prompt) show(context); });
    return off;
  });
</script>

<ClosePrompt {prompt} {choose} layer />
