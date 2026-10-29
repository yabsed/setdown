<script lang="ts">
  import 'monaco-editor/features/codicon/register';
  // Microsoft Codicons, MIT licensed; names/codepoints from Monaco's codiconsLibrary.
  const glyphs = { add: 0xea60, stop: 0xea72, edit: 0xea73, sync: 0xea77, more: 0xea7c, trash: 0xea81,
    down: 0xea9a, up: 0xeaa1, check: 0xeab2, chevron: 0xeab4, clear: 0xeabf, gripper: 0xeb04,
    play: 0xeb2c, runAll: 0xeb9e, kernel: 0xeba3 };
  let { name, spinning = false }: { name: keyof typeof glyphs; spinning?: boolean } = $props();
</script>
<span class="notebook-icon" class:spinning aria-hidden="true" data-glyph={String.fromCodePoint(glyphs[name])}></span>
<style>
  .notebook-icon { display: inline-block; flex: 0 0 16px; width: 16px; height: 16px; font: normal 16px/1 codicon; text-align: center; -webkit-font-smoothing: antialiased; }
  .notebook-icon::before { content: attr(data-glyph); }
  .spinning { animation: spin 1.5s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
