<script lang="ts">
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import TabChrome from './tabs/TabChrome.svelte';
  import TitleBar from './shell/TitleBar.svelte';
  import ClosePrompt from './shell/ClosePrompt.svelte';
  import { view, type AppActions } from './view-state.svelte';

  let { actions }: { actions: AppActions } = $props();
</script>

<TitleBar {actions} />
<section class="shell" data-surface="empty" data-tabs="false">
  <TabChrome {actions} />
  <div class="notice" hidden={!view.notice}>
    <span>This file was changed by another application.</span>
    <div>
      <button class="notice-keep" type="button" onclick={actions.keepExternalChange}>Keep My Changes</button>
      <button class="notice-reload" type="button" onclick={actions.reloadExternalChange}>Reload</button>
    </div>
  </div>
  <EmptyState {actions} />
  <ReaderSurface {actions} />
  <InsertionDialogs {actions} />
  <ClosePrompt {actions} />
</section>
