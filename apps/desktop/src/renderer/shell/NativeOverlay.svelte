<script lang="ts">
  import { onMount } from 'svelte';

  onMount(() => {
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: true }));
    return () => window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: false }));
  });
</script>
