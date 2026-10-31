<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { documentSupport, featureLabels, type DocumentSupportTarget, type AnalysisPage } from './document-support';
  import { DocumentAnalysisController, type AnalysisState } from './document-analysis-controller';
  import { presentSupport, providerStatus, analysisResult, projectLabel, selectionSource, type SupportAction } from './document-presentation';
  import AnalysisEnvironment from './AnalysisEnvironment.svelte';
  import DocumentProviderDetails from './DocumentProviderDetails.svelte';
  import { isComposingInput } from '../editor/composition-guard';
  import type { AnalysisSelection } from '../../core/document/analysis-context';
  let { target, initialPage = 'summary', onclose, onmanage, onpagechange }: {
    target: DocumentSupportTarget; initialPage?: AnalysisPage; onclose(): void;
    onmanage(language: string, server?: string): void; onpagechange(page: AnalysisPage): void;
  } = $props();
  let selectedServer = $state('');
  let page = $state<AnalysisPage>('summary'), revision = $state(0), error = $state('');
  let analysis = $state<AnalysisState>({ busy: false, preparing: false, error: '', output: '' });
  let controller: DocumentAnalysisController;
  let heading = $state<HTMLHeadingElement>();
  const support = $derived.by(() => { revision; return documentSupport.current(target); });
  const provider = $derived(support?.providers.find(item => item.id === selectedServer));
  const context = $derived(analysis.context);
  const summary = $derived(presentSupport(support?.providers ?? [], context));
  const active = $derived(support?.providers.find(p => p.kind === 'server' && p.role !== 'supplementary' && p.state === 'ready'));
  const local = $derived(support?.providers.find(p => p.kind === 'builtin' && p.state === 'ready'));
  const environment = $derived(context?.choices.find(choice => choice.id === context.selected));
  const title = $derived(({ summary: 'Code support', details: 'Document analysis', language: 'Document language', environment: context?.label ?? 'Project environment', provider: 'Choose analysis tool', tool: provider?.name ?? 'Analysis tool', settings: 'Project connection settings', output: 'Server output' })[page]);
  onMount(() => {
    page = initialPage; onpagechange(page);
    controller = new DocumentAnalysisController(target, value => analysis = value);
    let observed = '';
    const off = documentSupport.subscribe(() => {
      revision++;
      const next = documentSupport.current(target)?.providers.map(p => p.analysis?.context.id ?? '').join('|') ?? '';
      if (next !== observed) { observed = next; void controller.refresh(); }
    });
    void controller.refresh();
    void tick().then(() => heading?.focus());
    return () => { off(); controller.dispose(); };
  });
  async function navigate(next: AnalysisPage) {
    page = next; onpagechange(next); error = ''; await tick(); heading?.focus();
  }
  async function select(value: AnalysisSelection) { if (await controller.select(value)) await navigate('summary'); }
  async function perform(action: () => Promise<unknown>) { try { await action(); } catch (reason) { error = String(reason); } }
  function repair(action: SupportAction) {
    if (action.kind === 'restart') void perform(async () => { await documentSupport.current(target)?.restart(action.server); await controller.refresh(); });
    else if (action.kind === 'details' && action.server) inspectProvider(action.server);
    else void navigate(action.kind);
  }
  function back() { if (page === 'summary') onclose(); else void navigate(page === 'settings' || page === 'output' ? 'tool' : page === 'tool' ? 'details' : 'summary'); }
  function inspectProvider(id: string) { selectedServer = id; void navigate('tool'); }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape belongs to the inspection and its focused child controls.) -->
<section class="analysis-panel" aria-label="Document analysis" onkeydown={event => {
  if (event.key === 'Escape' && !isComposingInput(event)) { event.preventDefault(); event.stopPropagation(); back(); }
}}>
  <header>
    {#if page !== 'summary'}<button class="back" aria-label="Back to code support" onclick={back}>‹</button>{/if}
    <h3 bind:this={heading} tabindex="-1">{title}</h3>
    <button aria-label="Close language status" onclick={onclose}>×</button>
  </header>
  {#if !support}
    <p>This document was closed or its language changed. Reopen code support from the document you want to inspect.</p>
  {:else if page === 'language'}
    <p class="muted">This document · {support.path.split(/[/\\]/).pop()}</p>
    <label>Language mode <select aria-label="Language mode" value={support.language} onchange={event => { documentSupport.current(target)?.setLanguage(event.currentTarget.value); onclose(); }}>
      <option value="">Auto-detect</option>
      {#each support.choices as choice}<option value={choice.id}>{choice.name}</option>{/each}
    </select></label>
  {:else if page === 'environment'}
    <AnalysisEnvironment state={analysis} {select} refresh={() => void controller.refresh()} prepare={() => void controller.prepare()} cancel={() => void controller.cancel()} />
  {:else if page === 'provider'}
    <p class="muted">Project · {context ? projectLabel(context.root) : 'Loading…'}</p>
    {#if context?.servers.some(server => server.role === 'primary')}
      <label>Analysis provider <select aria-label="Analysis provider" disabled={analysis.busy} value={context.servers.some(server => server.enabled && server.role === 'primary') ? context.servers.find(server => server.selected)?.id ?? '' : 'off'} onchange={event => select({ kind: 'server', value: event.currentTarget.value })}>
        <option value="" disabled>Choose an analysis tool…</option>
        <option value="off">Basic editing · no project analysis</option>
        {#each context.servers.filter(server => server.role === 'primary') as server}<option value={server.id}>{server.name}{server.enabled ? '' : ' · disabled'}</option>{/each}
      </select></label>
      <p class="muted">Applies to files using this analysis root, including other tabs and windows.</p>
    {/if}
    <button onclick={() => onmanage(support!.language)}>Manage analysis tools…</button>
  {:else if page === 'settings' || page === 'output'}
    {#key selectedServer + page}<DocumentProviderDetails {target} server={selectedServer} mode={page} />{/key}
  {:else if page === 'tool'}
    {#if provider}
          <div class="provider-title"><h4>{provider.name}</h4><span>{providerStatus(provider)}</span></div>
          {#if provider.role === 'supplementary'}<p class="muted">Additional diagnostics and tools</p>{/if}
          <p>{analysisResult(provider)}</p>
          {#if provider.analysis?.analysis === 'observed'}<p>{provider.diagnosticCount ?? 0} diagnostics reported{provider.analysis.freshness === 'stale' ? ' before the latest change' : ''}.</p>{/if}
          {#if provider.analysis?.freshness === 'best-effort'}<p class="muted">The server did not include a document version.</p>{/if}
          {#each provider.analysis?.progress ?? [] as progress}<p role="status">{progress}</p>{/each}
          {#if provider.message}<p>{provider.message}</p>{/if}
          {#each provider.messages ?? [] as message (message.id)}
            <div class="analysis-notice"><p>{message.message}</p>
              {#each message.actions as action, index}<button onclick={() => perform(async () => documentSupport.current(target)?.answerMessage(provider.id, message.id, index))}>{action}</button>{/each}
              <button onclick={() => perform(async () => documentSupport.current(target)?.answerMessage(provider.id, message.id))}>Dismiss</button>
            </div>
          {/each}
          <details><summary>Supported features and service context</summary>
            <p>Checks: {provider.checks === 'none' ? 'Not provided' : provider.checks}</p>
            {#if provider.features.length}<p>{featureLabels(provider.features).join(' · ')}</p>{/if}
            {#each provider.context ?? [] as item}<p class="path">{item}</p>{/each}
          </details>
      {#if provider.kind === 'server'}
        <p class="muted">Session for {provider.analysis?.context.root || context?.root ? projectLabel(provider.analysis?.context.root ?? context!.root) : 'this document'}. Restarting also reconnects files sharing this session in this window.</p>
        <div class="actions">
          <button onclick={() => perform(async () => { await documentSupport.current(target)?.restart(provider.id); await controller.refresh(); })}>Restart {provider.name}</button>
          <button onclick={() => navigate('settings')}>Project connection settings…</button>
          <button onclick={() => navigate('output')}>Server output…</button>
          <button onclick={() => onmanage(support!.language, provider.id)}>Manage installation…</button>
        </div>
      {/if}
    {:else}<p>This tool is no longer attached to the document.</p>{/if}
  {:else}
    {#if summary.title}
      <div class="analysis-notice" class:issue={summary.tone === 'warning'}>
        <strong>{summary.title}</strong>
        {#if summary.description}<p>{summary.description}</p>{/if}
        {#if summary.action && !(page === 'details' && summary.action.kind === 'details' && !summary.action.server)}<button disabled={analysis.busy} onclick={() => repair(summary.action!)}>{summary.action.label}</button>{/if}
      </div>
    {/if}
    <div class="rows">
      <button class="analysis-row" onclick={() => navigate('language')}><span>Document language</span><strong>{support.name} <span aria-hidden="true">›</span></strong></button>
      {#if context}
        <button class="analysis-row" onclick={() => navigate('details')} title={context.root}><span>Project</span><strong>{projectLabel(context.root)} <span aria-hidden="true">›</span></strong></button>
        {#if context.kind}<button class="analysis-row" onclick={() => navigate('environment')}><span>{context.label}</span><strong>{environment?.name ?? 'Choose…'} <span aria-hidden="true">›</span></strong></button>{/if}
      {/if}
    </div>
    {#if active}<p class="result">{active.name} · {providerStatus(active)}<br />{analysisResult(active)}</p>
    {:else if local}<p class="result">{local.name} · {analysisResult(local)}</p>{/if}
    {#if summary.description && !summary.title}<p class="muted">{summary.description}</p>{/if}
    {#if page === 'details'}
      <p class="path">Document · {support.path}</p>
      {#if context}
        <section class="detail-block"><h4>Project environment</h4><p class="path">{context.root}</p><p class="muted">{context.rootReason}</p>
          {#if environment}<p class="path">{environment.path}</p><p>{selectionSource(context)}</p>{/if}
          <button onclick={() => navigate('provider')}>Choose analysis tool…</button>
          <button disabled={analysis.busy} onclick={() => controller.refresh()} aria-label="Refresh project environment">Refresh</button>
          <details><summary>Environment details</summary>{#each context.evidence as evidence}<p class="path">{evidence}</p>{/each}</details>
        </section>
      {/if}
      <section class="detail-block"><h4>Tools for this document</h4>
        {#each support.providers as item (item.id)}
          <button class="analysis-row" onclick={() => inspectProvider(item.id)}><span>{item.name}</span><strong>{providerStatus(item)} ›</strong></button>
          {#if item.role === 'supplementary'}<p class="muted">Additional diagnostics and tools</p>{/if}
        {/each}
      </section>
      <button onclick={() => onmanage(support!.language)}>Manage analysis tools…</button>
    {/if}
    <footer>
      <button onclick={() => { documentSupport.current(target)?.problems(); onclose(); }}>Problems</button>
      {#if page === 'summary'}<button onclick={() => navigate('details')}>Details…</button>{/if}
      {#if page === 'summary' && !active}<button onclick={() => navigate('provider')}>Choose analysis tool…</button>{/if}
    </footer>
  {/if}
  {#if analysis.busy}<p class="muted" role="status">{analysis.preparing ? 'Configuring project…' : 'Updating project environment…'}</p>{/if}
  {#if analysis.error || error}<p class="issue" role="alert">{analysis.error || error}</p>{/if}
</section>

<style>
  .analysis-panel { color: var(--app-text); font: 12px/1.5 var(--app-font-family); min-width: 0; }
  header, .provider-title { display: flex; align-items: center; gap: 8px; }
  header { margin-bottom: 10px; } h3 { margin: 0; flex: 1; font-size: 13px; } h3:focus { outline: none; }
  h4 { margin: 0; font-size: 12px; } .provider-title { justify-content: space-between; }
  button { background: transparent; color: inherit; font: inherit; border: 1px solid var(--app-border); border-radius: 4px; padding: 5px 8px; cursor: pointer; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .6; cursor: default; }
  button:focus-visible, select:focus-visible, summary:focus-visible { outline: 1px solid var(--app-focus-ring); }
  header button { border: 0; font-size: 18px; padding: 0 5px; }
  label { display: grid; gap: 6px; margin: 12px 0; }
  select { min-width: 0; width: 100%; padding: 6px; background: var(--app-canvas); color: inherit; border: 1px solid var(--app-border); font: inherit; }
  .rows { border-block: 1px solid var(--app-border); padding: 4px 0; }
  .analysis-row { display: flex; flex-wrap: wrap; width: 100%; justify-content: space-between; align-items: center; gap: 10px; border: 0; padding: 8px 4px; text-align: left; }
  .analysis-row > span { color: var(--app-muted-text); max-width: 100%; overflow-wrap: anywhere; }
  .analysis-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; text-align: right; }
  .analysis-notice { padding: 10px; margin: 0 0 12px; border: 1px solid var(--app-border); border-radius: 4px; }
  .analysis-notice button { margin-top: 6px; } .issue { color: var(--app-warning-text); }
  p { margin: 8px 0; overflow-wrap: anywhere; } .muted, .path, .provider-title > span { color: var(--app-muted-text); font-size: 11px; }
  .result { margin: 12px 4px; } .detail-block { border-top: 1px solid var(--app-border); padding: 12px 0; }
  details { margin: 10px 0; } summary { cursor: pointer; }
  .actions, footer { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  footer { justify-content: space-between; }
</style>
