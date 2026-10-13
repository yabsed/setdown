<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { APP_FONT_FAMILY } from '../../core/theme/typography';
  import type { TerminalApi, TerminalEvent } from '../../protocol/terminal';
  let { api, id, active, focused, changed }: { api: TerminalApi; id: string; active: boolean; focused: boolean;
    changed(info: { title?: string; cwd?: string; exited?: boolean }): void } = $props();
  let container: HTMLDivElement;
  let error = $state('');
  let term: Terminal | undefined, fit: FitAddon;
  let ready = false, alive = true, starting = true;
  let pending: TerminalEvent[] = [];
  function theme() {
    const style = getComputedStyle(document.documentElement);
    return { background: style.getPropertyValue('--app-editor-background').trim(),
      foreground: style.getPropertyValue('--app-text').trim(), cursor: style.getPropertyValue('--app-text').trim(),
      selectionBackground: `${style.getPropertyValue('--app-accent').trim()}55` };
  }
  function resize() {
    if (!term || !active || !container.clientWidth || !container.clientHeight) return;
    fit.fit();
    if (ready) api.resize(id, { cols: term.cols, rows: term.rows });
  }
  function receive(event: TerminalEvent) {
    if (!term || !alive || event.id !== id) return;
    if (starting) { pending.push(event); return; }
    if (event.type === 'data') term.write(event.data, () => api.acknowledge(id, event.data.length));
    else { ready = false; changed({ exited: true }); term.write(`\r\n[Process exited with code ${event.exitCode}]\r\n`); }
  }
  $effect(() => {
    const visible = active, selected = focused;
    void tick().then(() => {
      if (!alive || !visible) return;
      resize(); if (selected) term?.focus();
    });
  });
  onMount(() => {
    term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000, fontFamily: APP_FONT_FAMILY,
      theme: theme(), allowProposedApi: false, screenReaderMode: true });
    fit = new FitAddon(); term.loadAddon(fit); term.open(container);
    term.onData(data => {
      if (!ready) return;
      for (let offset = 0; offset < data.length; offset += 16384) api.write(id, data.slice(offset, offset + 16384));
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.code === 'Backquote') return false;
      if ((event.ctrlKey && event.shiftKey) || event.metaKey) {
        if (event.code === 'KeyC' && term?.hasSelection()) {
          if (event.type === 'keydown') void navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (event.code === 'KeyV') {
          // Returning false only skips xterm's key handling; cancel Chromium's
          // native paste so it cannot also feed the clipboard into the PTY.
          event.preventDefault();
          if (event.type === 'keydown') void navigator.clipboard.readText().then((text) => term?.paste(text)).catch(() => {});
          return false;
        }
      }
      return true;
    });
    const unsubscribe = api.onEvent(receive);
    const observer = new ResizeObserver(resize); observer.observe(container);
    const themes = new MutationObserver(() => { if (term) term.options.theme = theme(); });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const focus = (event: Event) => { if ((event as CustomEvent<string>).detail === id && active) term?.focus(); };
    window.addEventListener('setdown:focus-terminal', focus);
    resize();
    void api.create(id, { cols: term.cols, rows: term.rows }).then(async info => {
      if (!alive || !term) return;
      changed({ title: info.title, cwd: info.cwd, exited: info.exitCode !== undefined });
      // Attach replays the bounded PTY transcript before accepting new output.
      // Keep the original terminal dimensions during replay, then fit this group.
      if (info.replay) {
        term.resize(info.size.cols, info.size.rows);
        await new Promise<void>(resolve => term!.write(info.replay, resolve));
      }
      if (!alive) return;
      starting = false; ready = info.exitCode === undefined;
      if (info.exitCode !== undefined) receive({ id, type: 'exit', exitCode: info.exitCode });
      for (const event of pending) receive(event);
      pending = [];
      resize(); if (focused && active) term?.focus();
    }).catch(cause => { if (alive) { error = String(cause); starting = false; changed({ title: 'Terminal failed', exited: true }); } });
    return () => {
      alive = false; unsubscribe(); observer.disconnect(); themes.disconnect();
      window.removeEventListener('setdown:focus-terminal', focus);
      // The workspace owns the process lifetime; moving/unmounting a surface
      // must never kill a PTY that has been adopted by another window.
      if (container.contains(document.activeElement)) api.focus(false);
      term?.dispose(); term = undefined;
    };
  });
</script>
<section class="terminal-surface" aria-label="Terminal" data-terminal-id={id}>
  {#if error}<div class="terminal-error" role="alert">{error}</div>{/if}
  <div class="terminal-instance" bind:this={container} role="group" aria-label="Terminal input and output"
    onfocusin={() => api.focus(true)} onfocusout={event => {
      if (!container.contains(event.relatedTarget as Node | null)) api.focus(false);
    }}></div>
</section>
<style>
  .terminal-surface { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-editor-background); padding: 8px 10px; }
  .terminal-instance { flex: 1; min-height: 0; overflow: hidden; }
  .terminal-error { color: var(--app-danger-text); font-size: 12px; padding: 8px; }
</style>
