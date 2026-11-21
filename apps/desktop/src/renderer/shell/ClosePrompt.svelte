<script lang="ts">
  import type { CloseDecision, ClosePromptRequest } from '../../protocol/desktop-api';

  // One dialog, shown in two places: by the shell, and in the layer above a live web page
  // (`close-prompt-overlay-runtime.ts`). The shell's own dialog cannot cover a native page, so
  // there it announces itself and the page is replaced by its picture for the moment. The
  // layer covers nothing with a picture and announces nothing.
  let { prompt, choose, layer = false }: { prompt: ClosePromptRequest | null; choose: (decision: CloseDecision) => void; layer?: boolean } = $props();
  let dialog: HTMLDialogElement;
  let overlayVisible = false;

  function announce(open: boolean) {
    if (layer || overlayVisible === open) return;
    overlayVisible = open;
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: open }));
  }

  $effect(() => {
    if (prompt && !dialog.open) {
      announce(true);
      dialog.showModal();
      queueMicrotask(() => dialog.querySelector<HTMLButtonElement>('.close-save')?.focus());
    } else if (!prompt && dialog.open) {
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
  onclose={() => {
    // HTMLDialogElement queues close events. An old dismissal must not cancel
    // a new prompt opened before that event was delivered.
    if (dialog.open) return;
    announce(false); if (prompt) choose('cancel');
  }}
>
  <form class="close-prompt-form" onsubmit={(event) => event.preventDefault()}>
    <header>
      <h2 id="close-prompt-title">Save Changes</h2>
      <button class="dialog-close" type="button" aria-label="Cancel" onclick={() => choose('cancel')}>×</button>
    </header>
    <div class="close-prompt-body">
      {#if prompt?.names.length === 1}
        <p>Save changes to <strong>{prompt.names[0]}</strong>?</p>
      {:else}
        <p>Save changes to {prompt?.names.length ?? 0} documents?</p>
        <div class="close-document-list" aria-label="Unsaved documents">
          {#each prompt?.names ?? [] as name}<div title={name}>{name}</div>{/each}
        </div>
      {/if}
      <p class="close-prompt-warning">Unsaved changes will be lost.</p>
    </div>
    <footer>
      <button class="close-discard" type="button" onclick={() => choose('discard')}>Don't Save</button>
      <button class="close-cancel" type="button" onclick={() => choose('cancel')}>Cancel</button>
      <button class="close-save" type="button" onclick={() => choose('save')}>Save</button>
    </footer>
  </form>
</dialog>
