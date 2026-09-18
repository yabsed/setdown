<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  let { actions }: { actions: AppActions } = $props();
</script>

<section class="empty-state">
  <img class="empty-mark" src="./setdown-mark.svg" alt="Setdown" />
  <div class="wordmark">Setdown</div>
  <h1>Write plain. Read beautifully.</h1>
  <p>Markdown 파일을 아름답게 읽고, 더블 클릭해 바로 고칠 수 있습니다.</p>
  <div class="empty-actions">
    <button class="primary-button empty-new" type="button" onclick={actions.newDocument}>새 문서</button>
    <button class="secondary-button empty-open" type="button" onclick={actions.openDocument}>Markdown 파일 열기</button>
  </div>
  <span class="shortcut">Ctrl/Cmd+N · Ctrl/Cmd+O</span>
</section>
