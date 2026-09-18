<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  let { actions }: { actions: AppActions } = $props();
</script>

<section class="empty-state">
  <img class="empty-mark" src="./setdown-mark.svg" alt="Setdown" />
  <div class="wordmark">Setdown</div>
  <h1>Write plain. Read beautifully.</h1>
  <p>Read Markdown beautifully, then double-click anywhere to edit it.</p>
  <div class="empty-actions">
    <button class="primary-button empty-new" type="button" onclick={actions.newDocument}>New Document</button>
    <button class="secondary-button empty-open" type="button" onclick={actions.openDocument}>Open Markdown File</button>
    <button class="secondary-button empty-folder" type="button" onclick={actions.chooseProjectFolder}>Open Folder</button>
  </div>
  <span class="shortcut">Ctrl/Cmd+N · Ctrl/Cmd+O</span>
</section>
