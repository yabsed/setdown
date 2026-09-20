<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { terminal } from './terminal-state.svelte';

  type Tab = { id: string; title: string; cwd: string; exited: boolean };
  type Runtime = { term: Terminal; fit: FitAddon; node: HTMLDivElement; ready: boolean };
  import type { TerminalApi } from '../../protocol/terminal';
  let { api }: { api: TerminalApi } = $props();
  const runtimes = new Map<string, Runtime>();
  let tabs: Tab[] = $state([]);
  let active = $state('');
  let error = $state('');
  let creating = $state(false);
  let container: HTMLDivElement;
  let alive = true;

  function theme() {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--app-editor-background').trim(),
      foreground: style.getPropertyValue('--app-text').trim(),
      cursor: style.getPropertyValue('--app-text').trim(),
      selectionBackground: `${style.getPropertyValue('--app-accent').trim()}55`,
    };
  }

  function fitActive() {
    const runtime = runtimes.get(active);
    if (!terminal.open || !runtime || !container.clientWidth || !container.clientHeight) return;
    runtime.fit.fit();
    if (runtime.ready) api.resize(active, { cols: runtime.term.cols, rows: runtime.term.rows });
  }

  async function create() {
    if (creating) return;
    creating = true;
    error = '';
    const id = crypto.randomUUID();
    const node = document.createElement('div');
    node.className = 'terminal-instance';
    node.style.cssText = 'position:absolute;inset:0';
    container.append(node);
    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000,
      fontFamily: '"DejaVu Sans Mono", "Cascadia Mono", Menlo, monospace', theme: theme(),
      allowProposedApi: false, screenReaderMode: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const runtime: Runtime = { term, fit, node, ready: false };
    runtimes.set(id, runtime);
    tabs = [...tabs, { id, title: 'Starting…', cwd: '', exited: false }];
    active = id;
    term.open(node);
    term.onData((data) => {
      if (!runtime.ready) return;
      // Large clipboard pastes are streamed in bounded IPC messages.
      for (let offset = 0; offset < data.length; offset += 16384) api.write(id, data.slice(offset, offset + 16384));
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.code === 'Backquote') return false;
      if ((event.ctrlKey && event.shiftKey) || event.metaKey) {
        if (event.code === 'KeyC' && term.hasSelection()) {
          if (event.type === 'keydown') void navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (event.code === 'KeyV') {
          if (event.type === 'keydown') void navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => {});
          return false;
        }
      }
      return true;
    });
    await tick();
    fitActive();
    try {
      const info = await api.create(id, { cols: term.cols, rows: term.rows });
      if (!alive || !runtimes.has(id)) { api.close(id); return; }
      runtime.ready = true;
      tabs = tabs.map((tab) => tab.id === id ? { ...tab, ...info } : tab);
      fitActive();
      if (terminal.open && active === id) term.focus();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      remove(id);
    } finally { creating = false; }
  }

  function remove(id: string) {
    api.close(id);
    const runtime = runtimes.get(id);
    runtime?.term.dispose();
    runtime?.node.remove();
    runtimes.delete(id);
    tabs = tabs.filter((tab) => tab.id !== id);
    if (active === id) active = tabs.at(-1)?.id || '';
  }

  function hide() {
    terminal.open = false;
    api.focus(false);
    document.querySelector<HTMLButtonElement>('.terminal-activity')?.focus();
  }

  function resize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLButtonElement;
    const start = event.clientY;
    const height = handle.parentElement!.getBoundingClientRect().height;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => terminal.height = Math.max(120, Math.min(innerHeight * .65, height + start - next.clientY));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }

  $effect(() => {
    const visible = terminal.open;
    const selected = active;
    for (const [id, runtime] of runtimes) runtime.node.hidden = id !== selected;
    if (!visible) { api.focus(false); return; }
    void tick().then(() => {
      if (!alive || !terminal.open) return;
      fitActive();
      runtimes.get(selected)?.term.focus();
    });
  });

  onMount(() => {
    const unsubscribe = api.onEvent((event) => {
      const runtime = runtimes.get(event.id);
      if (!runtime) return;
      if (event.type === 'data') {
        runtime.term.write(event.data, () => api.acknowledge(event.id, event.data.length));
      } else {
        runtime.ready = false;
        tabs = tabs.map((tab) => tab.id === event.id ? { ...tab, exited: true } : tab);
        runtime.term.write(`\r\n[Process exited with code ${event.exitCode}]\r\n`);
      }
    });
    const observer = new ResizeObserver(fitActive);
    observer.observe(container);
    const themes = new MutationObserver(() => {
      for (const runtime of runtimes.values()) runtime.term.options.theme = theme();
    });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    void create();
    return () => {
      alive = false;
      unsubscribe(); observer.disconnect(); themes.disconnect();
      for (const id of runtimes.keys()) remove(id);
      api.focus(false);
    };
  });
</script>

<section class="terminal-panel" aria-label="Integrated terminal" hidden={!terminal.open}>
  <button class="terminal-resize" type="button" aria-label="Resize Terminal" onpointerdown={resize}
    onkeydown={(event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      terminal.height = Math.max(120, Math.min(innerHeight * .65, terminal.height + (event.key === 'ArrowUp' ? 16 : -16)));
    }}></button>
  <header>
    <span class="terminal-heading">TERMINAL</span>
    <div class="terminal-tabs" role="tablist" aria-label="Terminal sessions">
      {#each tabs as tab}
        <button type="button" role="tab" aria-selected={active === tab.id} title={tab.cwd}
          onclick={() => { active = tab.id; runtimes.get(tab.id)?.term.focus(); }}>
          {tab.title}{tab.exited ? ' (exited)' : ''}
        </button>
      {/each}
    </div>
    <button type="button" aria-label="New Terminal" title="New Terminal" disabled={creating} onclick={create}>+</button>
    <button type="button" aria-label="Kill Terminal" title="Kill Terminal" disabled={!active} onclick={() => remove(active)}>
      <svg viewBox="0 0 24 24"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>
    </button>
    <button type="button" aria-label="Hide Terminal" title="Hide Terminal" onclick={hide}>×</button>
  </header>
  {#if error}<div class="terminal-error" role="alert">{error} <button type="button" onclick={create}>Retry</button></div>{/if}
  <div class="terminal-body" bind:this={container} role="group" aria-label="Terminal input and output"
    onfocusin={() => api.focus(true)} onfocusout={(event) => {
      if (!container.contains(event.relatedTarget as Node | null)) api.focus(false);
    }}></div>
</section>

<style>
  .terminal-panel { grid-column: 2; grid-row: 4; position: relative; min-width: 0; min-height: 0;
    display: flex; flex-direction: column; background: var(--app-editor-background); border-top: 1px solid var(--app-border); }
  .terminal-panel[hidden] { display: none; }
  header { display: flex; align-items: center; gap: 5px; height: 36px; flex-shrink: 0; padding: 0 8px 0 14px; }
  .terminal-heading { align-self: stretch; display: flex; align-items: center; border-bottom: 1px solid var(--app-accent);
    font-size: 11px; letter-spacing: .04em; margin-right: 12px; }
  .terminal-tabs { display: flex; flex: 1; overflow: auto; min-width: 0; gap: 3px; }
  button { color: var(--app-muted-text); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }
  header > button { width: 28px; height: 26px; flex-shrink: 0; font-size: 20px; }
  button:hover, button[aria-selected="true"] { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  button:disabled { opacity: .4; cursor: default; }
  .terminal-tabs button { padding: 4px 9px; white-space: nowrap; font-size: 12px; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .terminal-body { position: relative; flex: 1; min-height: 0; margin: 4px 8px 6px 14px; overflow: hidden; }
  .terminal-resize { position: absolute; top: -3px; left: 0; width: 100%; height: 5px; z-index: 20; padding: 0;
    cursor: row-resize; touch-action: none; border-radius: 0; }
  .terminal-resize:hover, .terminal-resize:focus-visible { background: var(--app-accent); }
  .terminal-error { color: var(--app-danger-text); padding: 4px 14px; font-size: 12px; }
</style>
