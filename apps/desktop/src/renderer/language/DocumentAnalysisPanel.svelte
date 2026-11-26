<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { documentSupport, featureLabels, type DocumentSupportTarget, type AnalysisPage, type ToolEnvironment } from './document-support';
  import { DocumentAnalysisController, type AnalysisState } from './document-analysis-controller';
  import { presentSupport, providerStatus, analysisResult, projectLabel, type SupportAction } from './document-presentation';
  import AnalysisEnvironment from './AnalysisEnvironment.svelte';
  import ChoiceList from './ChoiceList.svelte';
  import DocumentProviderDetails from './DocumentProviderDetails.svelte';
  import { isComposingInput } from '../editor/composition-guard';
  import type { AnalysisSelection } from '../../core/document/analysis-context';
  let { target, initialPage = 'summary', initialItem, onclose, onpagechange }: {
    target: DocumentSupportTarget; initialPage?: AnalysisPage; initialItem?: string; onclose(): void; onpagechange(page: AnalysisPage): void;
  } = $props();
  let selectedServer = $state('');
  let page = $state<AnalysisPage>('summary'), revision = $state(0), error = $state('');
  let analysis = $state<AnalysisState>({ busy: false, preparing: false, error: '', output: '' });
  let controller: DocumentAnalysisController;
  let heading = $state<HTMLHeadingElement>();
  const support = $derived.by(() => { revision; return documentSupport.current(target); });
  const provider = $derived(support?.providers.find(item => item.id === selectedServer));
  const context = $derived(analysis.context);
  // The same providers the name in the location bar is made from: the two cannot disagree.
  const summary = $derived(presentSupport(support?.providers ?? [], context, support?.name));
  // The choices a tool keeps itself (the Go in use, a YAML file's schema) are rows like the
  // others. The tool is asked once the panel is open; until it answers the row shows no value.
  let toolRows = $state<Record<string, ToolEnvironment>>({}), toolRow = $state(''), toolBusy = $state(false), toolNote = $state('');
  const toolRowIds = $derived(support?.toolEnvironments.map(row => row.id).join('|') ?? '');
  async function loadToolRows() {
    for (const row of documentSupport.current(target)?.toolEnvironments ?? []) {
      try { const found = await documentSupport.current(target)?.toolEnvironment(row.id); if (found) toolRows = { ...toolRows, [row.id]: found }; }
      catch (reason) { toolRows = { ...toolRows, [row.id]: { ...row, value: '', choices: [], refusal: String(reason instanceof Error ? reason.message : reason) } }; }
    }
  }
  $effect(() => { if (toolRowIds) void loadToolRows(); });
  async function chooseTool(id: string, choice: string) {
    if (toolBusy) return;
    toolBusy = true; toolNote = ''; error = '';
    try { toolNote = await documentSupport.current(target)?.chooseToolEnvironment(id, choice) ?? ''; await loadToolRows(); }
    catch (reason) { error = String(reason instanceof Error ? reason.message : reason); }
    finally { toolBusy = false; }
  }
  /** A command of the tool that acts on the project. Its answer, when it has one, is a document
   * beside the code, so the panel gets out of the way. */
  function runTool(id: string) { const current = documentSupport.current(target); onclose(); void current?.runToolAction(id).catch(reason => console.warn('Language tool action:', String(reason))); }
  const hasPrimary = $derived(context?.servers.some(server => server.role === 'primary'));
  const environment = $derived(context?.choices.find(choice => choice.id === context.selected));
  const title = $derived(({ summary: support?.name ?? 'Code support', details: 'Document analysis', language: 'Document language', environment: context?.label ?? 'Project environment',
    'tool-environment': support?.toolEnvironments.find(row => row.id === toolRow)?.label ?? 'Environment', provider: 'Choose analysis tool', tool: provider?.name ?? 'Analysis tool', settings: 'Project connection settings', output: 'Server output' })[page]);
  onMount(() => {
    page = initialPage; toolRow = initialItem ?? ''; onpagechange(page);
    controller = new DocumentAnalysisController(target, value => analysis = value);
    let observed = '';
    const off = documentSupport.subscribe(() => {
      revision++;
      const next = documentSupport.current(target)?.providers.map(p => `${p.id}:${p.state}:${p.analysis?.context.id ?? ''}`).join('|') ?? '';
      if (next !== observed) { observed = next; void controller.refresh(); }
    });
    void controller.refresh();
    void tick().then(() => heading?.focus());
    return () => { off(); controller.dispose(); clearTimeout(repairTimer); };
  });
  async function navigate(next: AnalysisPage) {
    page = next; onpagechange(next); error = ''; await tick(); heading?.focus();
  }
  async function select(value: AnalysisSelection) { if (await controller.select(value)) await navigate('summary'); }
  async function perform(action: () => Promise<unknown>) { try { await action(); } catch (reason) { error = String(reason); } }
  /** A repair runs where the problem is shown; none of them sends the person to another panel. */
  function repair(action: SupportAction) {
    const current = () => documentSupport.current(target), server = action.server;
    const apply = (task: () => Promise<unknown> | undefined) => void perform(async () => {
      repairing = true; clearTimeout(repairTimer); repairTimer = setTimeout(() => repairing = false, 6000);
      await task(); await controller.refresh();
    });
    if (action.kind === 'restart') apply(() => current()?.restart(server));
    else if (action.kind === 'automatic' && server) apply(() => current()?.useAutomatic(server));
    else if (action.kind === 'install' && server) apply(() => current()?.allowDownload(server));
    else if (action.kind === 'locate' && server) apply(() => current()?.chooseExecutable(server));
    else if (action.kind === 'help' && server) void perform(async () => current()?.openHelp(server, action.runtime));
    else if (action.kind === 'log' && server) { selectedServer = server; direct = page === 'summary'; void navigate('output'); }
    else if (action.kind === 'details' && server) inspectProvider(server, page === 'summary');
    else if (action.kind === 'provider' && server && context?.servers.some(item => item.id === server && item.role === 'primary')) void select({ kind: 'server', value: server });
    else if (action.kind === 'environment' || action.kind === 'provider') void navigate(action.kind);
    else if (action.kind === 'problems') { current()?.problems(); onclose(); }
    else if (action.kind === 'details') void navigate(context?.kind ? 'environment' : 'details');
  }
  // Between a repair and the tool's next status the document briefly has no tool at all.
  // That moment is the repair in progress, not a document without checks. Any status the
  // tool reports is shown instead; the flag only covers the gap and expires on its own.
  let repairing = $state(false), repairTimer: ReturnType<typeof setTimeout> | undefined;
  // A log or tool opened from the summary returns to the summary, not through every step between.
  let direct = false;
  function back() {
    if (page === 'summary') onclose();
    else if (direct && (page === 'output' || page === 'tool')) { direct = false; void navigate('summary'); }
    else if (page === 'output' && logParent === 'details') { logParent = 'tool'; void navigate('details'); }
    else void navigate(page === 'settings' || page === 'output' ? 'tool' : page === 'tool' ? 'details' : page === 'provider' && selectedServer && provider ? 'tool' : 'summary');
  }
  function inspectProvider(id: string, fromSummary = false) { selectedServer = id; direct = fromSummary; void navigate('tool'); }
  function showLog(id: string) { selectedServer = id; direct = false; logParent = 'details'; void navigate('output'); }
  // The log opens from the list of tools as well as from one tool's own page.
  let logParent: 'tool' | 'details' = 'tool';
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
  {:else if page === 'tool-environment'}
    {@const row = toolRows[toolRow]}
    {#if !row}<p class="muted" role="status">Asking the tool…</p>
    {:else if row.refusal}<p>{row.refusal}</p>{#if row.value}<p class="muted">In use: {row.value}</p>{/if}
    {:else}
      <ChoiceList label={row.label} choices={row.choices} busy={toolBusy} choose={choice => void chooseTool(row.id, choice)} />
      {#if row.note}<p class="muted">{row.note}</p>{/if}
    {/if}
    {#if toolBusy}<p class="muted" role="status">Applying…</p>{/if}
    {#if toolNote}<p role="status">{toolNote}</p>{/if}
  {:else if page === 'provider'}
    <p class="muted">Project · {context ? projectLabel(context.root) : 'Loading…'}</p>
    {#if context?.servers.some(server => server.role === 'primary')}
      <label>Analysis provider <select aria-label="Analysis provider" disabled={analysis.busy} value={context.analysisSelection?.source === 'project' ? context.analysisSelection.mode === 'off' ? 'off' : context.analysisSelection.server ?? 'automatic' : 'automatic'} onchange={event => select({ kind: 'server', value: event.currentTarget.value })}>
        <option value="automatic">Use app default</option>
        <option value="off">Basic editing · no project analysis</option>
        {#each context.servers.filter(server => server.role === 'primary') as server}<option value={server.id}>{server.name}</option>{/each}
      </select></label>
      <p class="muted">Applies to files using this analysis root, including other tabs and windows.</p>
    {/if}
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
          <button onclick={() => { logParent = 'tool'; void navigate('output'); }}>Show log</button>
          {#if hasPrimary && provider.role !== 'supplementary'}<button onclick={() => navigate('provider')}>Choose analysis tool…</button>{/if}
          <button onclick={() => navigate('settings')}>Project connection settings…</button>
          {#each support.toolActions.filter(action => action.server === provider.id && action.place === 'settings') as action (action.id)}<button onclick={() => runTool(action.id)}>{action.title}</button>{/each}
        </div>
        <!-- What the tool's own extension offers for the project as a whole: named plainly here, under the tool's name. -->
        {#if support.toolActions.some(action => action.server === provider.id && action.place === 'project')}
          <h4 class="section">Project</h4>
          <div class="actions">
            {#each support.toolActions.filter(action => action.server === provider.id && action.place === 'project') as action (action.id)}<button onclick={() => runTool(action.id)}>{action.title}</button>{/each}
          </div>
        {/if}
      {/if}
    {:else}<p>This tool is no longer attached to the document.</p>{/if}
  {:else}
    {#if summary.title}
      <div class="analysis-notice" class:issue={summary.tone === 'warning'}>
        <strong>{#if summary.tone === 'busy'}<span class="turning" aria-hidden="true"></span>{/if}{summary.title}</strong>
        {#if summary.description}<p>{summary.description}</p>{/if}
        <div class="notice-actions">
          {#if summary.action && !(page === 'details' && summary.action.kind === 'details' && !summary.action.server)}<button disabled={analysis.busy} onclick={() => repair(summary.action!)}>{summary.action.label}</button>{/if}
          {#if summary.secondary}<button class="link" disabled={analysis.busy} onclick={() => repair(summary.secondary!)}>{summary.secondary.label}</button>{/if}
        </div>
      </div>
    {:else if page === 'summary'}
      <!-- Not ready yet (starting, or still reading the project): the ring that turns beside the name turns here too. -->
      <p class="result">{#if repairing || summary.tone === 'busy'}<span class="turning" aria-hidden="true"></span>{summary.working && !repairing ? 'Analyzing…' : 'Starting…'}{:else if summary.working}<span aria-hidden="true">✓</span> Working{:else}{support.limits ?? summary.description}{/if}{#if summary.action && !repairing} <button class="link" disabled={analysis.busy} onclick={() => repair(summary.action!)}>{summary.action.label}</button>{/if}</p>
    {/if}
    <!-- Said in place of the summary sentence above when nothing else is reported there. -->
    {#if page === 'summary' && support.limits && (summary.title || repairing || summary.tone === 'busy' || summary.working)}<p class="muted">{support.limits}</p>{/if}
    <div class="rows">
      <button class="analysis-row" onclick={() => navigate('language')}><span>Language</span><strong>{support.name} <span aria-hidden="true">›</span></strong></button>
      {#if context}
        {#if context.kind}<button class="analysis-row" onclick={() => navigate('environment')}><span>{context.label}</span><strong>{environment?.name ?? context.unselected ?? 'Choose…'} <span aria-hidden="true">›</span></strong></button>{/if}
      {/if}
      {#each support.toolEnvironments as row (row.id)}
        <button class="analysis-row" onclick={() => { toolRow = row.id; toolNote = ''; void navigate('tool-environment'); }}><span>{row.label}</span><strong>{toolRows[row.id]?.value ?? ''} <span aria-hidden="true">›</span></strong></button>
      {/each}
    </div>
    {#if page === 'details'}
      <!-- One block per tool: its name, what it reported, and the two things a person does to it. -->
      {#each support.providers as item (item.id)}
        <section class="detail-block" data-tool={item.id}>
          <button class="analysis-row" onclick={() => inspectProvider(item.id)}><span>{item.name}</span><strong>{providerStatus(item)} ›</strong></button>
          <p class="result">{analysisResult(item)}{item.role === 'supplementary' ? ' · Additional diagnostics and tools' : ''}</p>
          {#if item.kind === 'server' && item.state !== 'missing' && item.state !== 'off'}
            <div class="actions">
              <button onclick={() => perform(async () => { await documentSupport.current(target)?.restart(item.id); await controller.refresh(); })} aria-label={`Restart ${item.name}`}>Restart</button>
              <button onclick={() => showLog(item.id)} aria-label={`Show log of ${item.name}`}>Show log</button>
            </div>
          {/if}
        </section>
      {/each}
      {#if summary.description && !summary.title}<p class="muted">{summary.description}</p>{/if}
      {#if hasPrimary && !support.providers.some(item => item.kind === 'server' && item.role !== 'supplementary')}<button onclick={() => navigate('provider')}>Choose analysis tool…</button>{/if}
    {/if}
    <footer>
      {#if page === 'summary'}<button class="link" onclick={() => navigate('details')}>More…</button>
      {:else}<button onclick={() => { documentSupport.current(target)?.problems(); onclose(); }}>Problems</button>{/if}
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
  h4.section { margin-top: 16px; color: var(--app-muted-text); font-weight: 600; }
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
  .notice-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 8px; } .issue { color: var(--app-warning-text); }
  .analysis-notice p { margin: 4px 0 0; }
  .turning { display: inline-block; box-sizing: border-box; width: 10px; height: 10px; margin-right: 7px; border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color: currentColor; border-radius: 50%;
    animation: notice-turning .9s linear infinite; }
  @keyframes notice-turning { to { transform: rotate(360deg); } }
  /* Without motion the ring still says "working"; it just does not turn. */
  @media (prefers-reduced-motion: reduce) { .turning { animation: none; } }
  button.link { border: 0; padding: 2px 4px; text-decoration: underline; text-underline-offset: 2px; }
  .result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
  p { margin: 8px 0; overflow-wrap: anywhere; } .muted, .path, .provider-title > span { color: var(--app-muted-text); font-size: 11px; }
  .result { margin: 12px 4px; } .detail-block { border-top: 1px solid var(--app-border); padding: 12px 0; }
  details { margin: 10px 0; } summary { cursor: pointer; }
  .actions, footer { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  footer { justify-content: flex-end; }
</style>
