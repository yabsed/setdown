<script lang="ts">
  import { project } from '../project/project-state.svelte';
  import type { AppActions } from '../view-state.svelte';
  import ApplicationMenu from './ApplicationMenu.svelte';

  let { actions }: { actions: AppActions } = $props();
</script>

<header class="product-titlebar">
  <button class="product-identity" type="button" title="Toggle Folder Tools"
    aria-label="Toggle Folder Tools" aria-expanded={project.open}
    onclick={actions.toggleProjectSidebar}>Setdown</button>
  <ApplicationMenu load={actions.loadMenu} execute={actions.executeMenuItem} />
  <div class="titlebar-drag-space" aria-hidden="true"></div>
</header>
