<script lang="ts">
  import { fileIcon } from '../../core/files/file-icon';
  import './file-icons.css';
  let { path }: { path: string } = $props();
  const icon = $derived(fileIcon(path));
</script>

<span class="file-type-icon" aria-hidden="true" data-file-icon={icon.id}
  style:--file-icon-dark={icon.dark} style:--file-icon-light={icon.light}>{#if icon.path}<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d={icon.path} /></svg>{:else}{icon.character}{/if}</span>
