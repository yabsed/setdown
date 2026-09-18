<script lang="ts">
  import { insertion, resizeTable } from './insertion-state.svelte';
  import type { AppActions } from '../view-state.svelte';

  const TABLE_COLUMNS = 10;
  const TABLE_ROWS = 10;
  const tableCells = Array.from({ length: TABLE_COLUMNS * TABLE_ROWS }, (_, index) => ({
    column: index % TABLE_COLUMNS + 1,
    row: Math.floor(index / TABLE_COLUMNS) + 1,
  }));

  let { actions }: { actions: AppActions } = $props();
  let tablePopover: HTMLElement;
  let linkPopover: HTMLElement;
  let draggingTable = $state(false);
  let tableActive = $state(false);

  const tableColumns = () => insertion.table.headers.length;
  const tableRows = () => insertion.table.rows.length + 1;

  function selectTable(column: number, row: number) {
    tableActive = true;
    if (column === tableColumns() && row === tableRows()) return;
    resizeTable(column, row - 1);
  }

  function tablePointerDown(event: PointerEvent, column: number, row: number) {
    event.preventDefault();
    draggingTable = true;
    selectTable(column, row);
  }

  function tablePointerUp(column: number, row: number) {
    if (!draggingTable) return;
    selectTable(column, row);
    draggingTable = false;
    actions.submitTable();
  }

  function tableKey(event: KeyboardEvent, column: number, row: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.submitTable();
      return;
    }
    const next = {
      ArrowLeft: [column - 1, row],
      ArrowRight: [column + 1, row],
      ArrowUp: [column, row - 1],
      ArrowDown: [column, row + 1],
    }[event.key];
    if (!next) return;
    const [nextColumn, nextRow] = next;
    if (nextColumn < 1 || nextColumn > TABLE_COLUMNS || nextRow < 1 || nextRow > TABLE_ROWS) return;
    event.preventDefault();
    selectTable(nextColumn, nextRow);
    tablePopover.querySelector<HTMLButtonElement>(
      `[data-columns="${nextColumn}"][data-rows="${nextRow}"]`,
    )?.focus();
  }

  function outside(event: PointerEvent) {
    const target = event.target as Element | null;
    if (!target) return;
    if (insertion.tableOpen
      && !tablePopover?.contains(target)
      && !target.closest('.insert-table-button')) actions.closeTable();
    if (insertion.linkOpen
      && !linkPopover?.contains(target)
      && !target.closest('.insert-link-button')) actions.closeLink();
  }

  function shortcuts(event: KeyboardEvent) {
    if (event.key !== 'Escape' || (!insertion.tableOpen && !insertion.linkOpen)) return;
    event.preventDefault();
    event.stopPropagation();
    if (insertion.tableOpen) actions.closeTable();
    if (insertion.linkOpen) actions.closeLink();
  }

  $effect(() => {
    if (!insertion.tableOpen && !insertion.linkOpen) return;
    const stopDragging = () => draggingTable = false;
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('keydown', shortcuts, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('keydown', shortcuts, true);
    };
  });

  $effect(() => {
    if (!insertion.tableOpen) tableActive = false;
  });

  $effect(() => {
    if (!insertion.linkOpen) return;
    queueMicrotask(() => linkPopover?.querySelector<HTMLInputElement>('.link-destination')?.focus());
  });
</script>

<div bind:this={tablePopover} class="insertion-popover table-popover"
  role="dialog" aria-label="Insert table" tabindex="-1" hidden={!insertion.tableOpen}>
  <header class="insertion-popover-header">
    <strong>Table size</strong>
    <span>{tableActive ? `${tableColumns()} × ${tableRows()}` : ''}</span>
    <button type="button" aria-label="Close" onclick={actions.closeTable}>×</button>
  </header>
  <div class="table-size-grid" class:is-dragging={draggingTable} role="group" aria-label="Choose table size"
    onpointerleave={() => tableActive = false}>
    {#each tableCells as cell (`${cell.column}:${cell.row}`)}
      <button
        class="table-size-cell"
        class:is-selected={tableActive && cell.column <= tableColumns() && cell.row <= tableRows()}
        type="button"
        tabindex={cell.column === tableColumns() && cell.row === tableRows() ? 0 : -1}
        aria-label={`${cell.column} columns, ${cell.row} rows`}
        data-columns={cell.column}
        data-rows={cell.row}
        onpointerenter={() => selectTable(cell.column, cell.row)}
        onpointerdown={(event) => tablePointerDown(event, cell.column, cell.row)}
        onpointerup={() => tablePointerUp(cell.column, cell.row)}
        onkeydown={(event) => tableKey(event, cell.column, cell.row)}
      ></button>
    {/each}
  </div>
</div>

<div bind:this={linkPopover} class="insertion-popover link-popover"
  role="dialog" aria-labelledby="link-popover-title" tabindex="-1" hidden={!insertion.linkOpen}>
  <header class="insertion-popover-header">
    <strong id="link-popover-title">URL</strong>
    <button type="button" aria-label="Close" onclick={actions.closeLink}>×</button>
  </header>
  <form class="link-popover-form" onsubmit={(event) => { event.preventDefault(); actions.submitLink(); }}>
    <div class="link-address-row">
      <input class="link-destination" bind:value={insertion.linkDestination} type="text" required
        spellcheck="false" aria-label="URL or file path" placeholder="URL or file path" />
      <button class="pick-link-file" type="button" title="Choose file"
        aria-label="Choose file" onclick={actions.pickLinkFile}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.25A2.25 2.25 0 0 1 5.75 4h4.05l1.5 1.75h6.95A2.25 2.25 0 0 1 20.5 8v8.75A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25V6.25Zm2.25-.75a.75.75 0 0 0-.75.75v10.5c0 .41.34.75.75.75h12.5a.75.75 0 0 0 .75-.75V8a.75.75 0 0 0-.75-.75H10.6L9.1 5.5H5.75Z"/></svg>
      </button>
    </div>
    <input class="link-label" bind:value={insertion.linkLabel} type="text" autocomplete="off"
      aria-label="Display text" placeholder="Display text (optional)" />
    <div class="dialog-error" role="alert" hidden={!insertion.linkError}>{insertion.linkError}</div>
    <footer>
      <button class="link-submit primary-button" type="submit">Insert</button>
    </footer>
  </form>
</div>
