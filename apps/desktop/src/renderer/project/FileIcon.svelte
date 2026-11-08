<script lang="ts">
  import { fileIcon } from '../../core/files/file-icon';
  import './file-icons.css';
  let { path }: { path: string } = $props();
  const icon = $derived(fileIcon(path));
</script>

<span class="file-type-icon" aria-hidden="true" data-file-icon={icon.id}
  style:--file-icon-dark={icon.dark} style:--file-icon-light={icon.light}>{icon.character}</span>
