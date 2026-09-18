<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import ApplicationMenu from './ApplicationMenu.svelte';

  let { actions }: { actions: AppActions } = $props();
</script>

<header class="product-titlebar">
  <div class="product-identity" aria-label="Setdown">Setdown</div>
  <ApplicationMenu load={actions.loadMenu} execute={actions.executeMenuItem} />
  <div class="titlebar-drag-space" aria-hidden="true"></div>
</header>
