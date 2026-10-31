<script lang="ts">
  import { onMount } from 'svelte';
  import type { LanguageServerOptions } from '../../protocol/language';
  let { initial, languages, server, scope, apply }: {
    initial: LanguageServerOptions; languages: string[]; server: string; scope?: string;
    apply(options: LanguageServerOptions): Promise<void>;
  } = $props();
  let role = $state<'primary' | 'supplementary'>('primary'), formatting = $state('auto'), root = $state('');
  let interpreter = $state(''), compilation = $state(''), json = $state(''), busy = $state(false), error = $state(''), saved = $state(false);
  // Catalog language labels use "Python"; custom profiles may use "python".
  const supportsPython = $derived(languages.some(language => language.toLowerCase() === 'python'));
  let live = true;
  onMount(() => {
    role = initial.role ?? 'primary'; formatting = initial.formatting === undefined ? 'auto' : initial.formatting ? 'on' : 'off'; root = initial.root ?? '';
    const python = initial.settings.python;
    interpreter = python && typeof python === 'object' ? String((python as Record<string, unknown>).pythonPath ?? '') : '';
    const index = initial.args.findIndex(arg => arg === '--compile-commands-dir' || arg.startsWith('--compile-commands-dir='));
    compilation = index < 0 ? '' : initial.args[index].split('=').slice(1).join('=') || initial.args[index + 1] || '';
    json = JSON.stringify(initial, null, 2);
    return () => { live = false; };
  });
  async function save() {
    if (busy) return; busy = true; error = ''; saved = false;
    try {
      const options = JSON.parse(json) as LanguageServerOptions;
      if (!Array.isArray(options.args) || !options.settings || typeof options.settings !== 'object') throw Error('Arguments and settings must be valid JSON.');
      if (supportsPython) {
        const python = { ...(options.settings.python as object ?? {}) } as Record<string, unknown>;
        if (interpreter.trim()) python.pythonPath = interpreter.trim(); else delete python.pythonPath;
        options.settings = { ...options.settings, python };
      }
      if (server === 'clangd') {
        const args: string[] = [];
        for (let index = 0; index < options.args.length; index++) {
          const arg = options.args[index]; if (arg === '--compile-commands-dir') { index++; continue; }
          if (!arg.startsWith('--compile-commands-dir=')) args.push(arg);
        }
        if (compilation.trim()) args.push(`--compile-commands-dir=${compilation.trim()}`);
        options.args = args;
      }
      await apply({ ...options, scope, root: root.trim() || undefined, role, formatting: formatting === 'auto' ? undefined : formatting === 'on' });
      if (live) saved = true;
    } catch (reason) { if (live) error = String(reason); }
    finally { if (live) busy = false; }
  }
</script>

<div class="connection-form" aria-busy={busy}>
  <p class="scope">{scope ? `This project · ${scope}` : 'Global defaults · applies where a project has no override'}</p>
  <label>Provider role<select aria-label="Provider role" bind:value={role}><option value="primary">Project analysis</option><option value="supplementary">Additional diagnostics and tools</option></select></label>
  <label>Formatting<select aria-label="Formatting provider" bind:value={formatting}><option value="auto">Default for this role</option><option value="on">Use this provider</option><option value="off">Do not use this provider</option></select></label>
  <label>Analysis root<input aria-label="Analysis root" bind:value={root} placeholder="Detect from project files" /></label>
  {#if supportsPython}<label>Python interpreter<input aria-label="Analysis Python interpreter" bind:value={interpreter} placeholder="Server's project environment" /></label>{/if}
  {#if server === 'clangd'}<label>Compilation database directory<input aria-label="Compilation database directory" bind:value={compilation} placeholder="Detect compile_commands.json" /></label>{/if}
  <details><summary>Advanced server options (JSON)</summary><label>Arguments, settings and initialization options<textarea rows="12" spellcheck="false" bind:value={json}></textarea></label></details>
  <button disabled={busy} onclick={save}>Apply settings</button>
  {#if saved}<p role="status">Settings applied.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .scope { color: var(--app-muted-text); font-size: 11px; overflow-wrap: anywhere; }
  label { display: grid; gap: 5px; margin: 12px 0; }
  input, select, textarea { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 7px; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 3px; font: inherit; }
  input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  button { color: inherit; background: transparent; border: 1px solid var(--app-border); border-radius: 4px; padding: 5px 8px; cursor: pointer; font: inherit; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .6; }
  details { margin: 10px 0; } summary { cursor: pointer; } .error { color: var(--app-warning-text); overflow-wrap: anywhere; }
</style>
