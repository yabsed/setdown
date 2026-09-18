<script lang="ts">
  import type { CloseDecision } from '../../protocol/desktop-api';
  import { view, type AppActions } from '../view-state.svelte';

  let { actions }: { actions: AppActions } = $props();
  let dialog: HTMLDialogElement;
  let overlayVisible = false;

  function announce(open: boolean) {
    if (overlayVisible === open) return;
    overlayVisible = open;
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: open }));
  }

  function choose(decision: CloseDecision) {
    actions.resolveClosePrompt(decision);
  }

  $effect(() => {
    if (view.closePrompt && !dialog.open) {
      announce(true);
      dialog.showModal();
      queueMicrotask(() => dialog.querySelector<HTMLButtonElement>('.close-save')?.focus());
    } else if (!view.closePrompt && dialog.open) {
      dialog.close();
      announce(false);
    }
  });
</script>

<dialog
  bind:this={dialog}
  class="close-prompt-dialog"
  aria-labelledby="close-prompt-title"
  oncancel={(event) => { event.preventDefault(); choose('cancel'); }}
  onclose={() => { announce(false); if (view.closePrompt) choose('cancel'); }}
>
  <form class="close-prompt-form" onsubmit={(event) => event.preventDefault()}>
    <header>
      <h2 id="close-prompt-title">변경 내용 저장</h2>
      <button class="dialog-close" type="button" aria-label="취소" onclick={() => choose('cancel')}>×</button>
    </header>
    <div class="close-prompt-body">
      {#if view.closePrompt?.names.length === 1}
        <p><strong>{view.closePrompt.names[0]}</strong>의 변경 내용을 저장하시겠습니까?</p>
      {:else}
        <p>변경된 문서 {view.closePrompt?.names.length ?? 0}개를 저장하시겠습니까?</p>
        <div class="close-document-list" aria-label="저장하지 않은 문서">
          {#each view.closePrompt?.names ?? [] as name}<div title={name}>{name}</div>{/each}
        </div>
      {/if}
      <p class="close-prompt-warning">저장하지 않은 변경 내용은 사라집니다.</p>
    </div>
    <footer>
      <button class="danger-button close-discard" type="button" onclick={() => choose('discard')}>저장 안 함</button>
      <span></span>
      <button class="secondary-button close-cancel" type="button" onclick={() => choose('cancel')}>취소</button>
      <button class="primary-button close-save" type="button" onclick={() => choose('save')}>저장</button>
    </footer>
  </form>
</dialog>
