<script lang="ts">
  import { insertion, resizeTable } from './insertion-state.svelte';
  import type { TableAlignment } from '../../shared/markdown-insertions';
  import type { AppActions } from '../view-state.svelte';

  let { actions }: { actions: AppActions } = $props();
  let tableDialog: HTMLDialogElement;
  let linkDialog: HTMLDialogElement;

  $effect(() => {
    if (insertion.tableOpen && !tableDialog.open) {
      tableDialog.showModal();
      queueMicrotask(() => tableDialog.querySelector<HTMLInputElement>('[data-table-header]')?.select());
    } else if (!insertion.tableOpen && tableDialog.open) tableDialog.close();
  });
  $effect(() => {
    if (insertion.linkOpen && !linkDialog.open) {
      linkDialog.showModal();
      queueMicrotask(() => linkDialog.querySelector<HTMLInputElement>('.link-destination')?.focus());
    } else if (!insertion.linkOpen && linkDialog.open) linkDialog.close();
  });

  function bounded(value: string, minimum: number, maximum: number, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
  }

  function navigateCells(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    const cells = Array.from(tableDialog.querySelectorAll<HTMLInputElement>('.table-grid-editor input'));
    const next = cells[cells.indexOf(event.target) + (event.shiftKey ? -1 : 1)];
    next?.focus();
    next?.select();
  }
</script>

<dialog bind:this={tableDialog} class="insertion-dialog table-dialog"
  aria-labelledby="table-dialog-title" onclose={actions.closeTable} onkeydown={navigateCells}>
  <form class="insertion-form table-form" onsubmit={(event) => event.preventDefault()}>
    <header>
      <div><h2 id="table-dialog-title">표 삽입</h2><p>셀 내용과 열 정렬을 지정하세요.</p></div>
      <button class="dialog-close" type="button" aria-label="닫기" onclick={actions.closeTable}>×</button>
    </header>
    <div class="table-size-controls">
      <label>열 <input class="table-columns" type="number" min="1" max="12"
        value={insertion.table.headers.length}
        onchange={(event) => resizeTable(bounded(event.currentTarget.value, 1, 12, 3), insertion.table.rows.length)} /></label>
      <label>데이터 행 <input class="table-rows" type="number" min="0" max="30"
        value={insertion.table.rows.length}
        onchange={(event) => resizeTable(insertion.table.headers.length, bounded(event.currentTarget.value, 0, 30, 2))} /></label>
    </div>
    <div class="table-editor-scroll">
      <div class="table-grid-editor"
        style:grid-template-columns={`repeat(${insertion.table.headers.length}, minmax(0, 1fr))`}
        style:min-width={`${insertion.table.headers.length * 170}px`}>
        {#each insertion.table.headers as _, column}
          <div class="table-column-header">
            <input bind:value={insertion.table.headers[column]} data-table-header={column}
              aria-label={`${column + 1}열 제목`} />
            <select value={insertion.table.alignments[column]} data-table-alignment={column}
              aria-label={`${column + 1}열 정렬`}
              onchange={(event) => insertion.table.alignments[column] = event.currentTarget.value as TableAlignment}>
              <option value="none">기본 정렬</option><option value="left">왼쪽 정렬</option>
              <option value="center">가운데 정렬</option><option value="right">오른쪽 정렬</option>
            </select>
          </div>
        {/each}
        {#each insertion.table.rows as row, rowIndex}
          {#each row as _, column}
            <input class="table-cell-input" bind:value={insertion.table.rows[rowIndex][column]}
              data-table-row={rowIndex} data-table-column={column}
              aria-label={`${rowIndex + 1}행 ${column + 1}열`} />
          {/each}
        {/each}
      </div>
    </div>
    <footer><button class="secondary-button table-cancel" type="button" onclick={actions.closeTable}>취소</button><button class="primary-button table-submit" type="button" onclick={actions.submitTable}>삽입</button></footer>
  </form>
</dialog>

<dialog bind:this={linkDialog} class="insertion-dialog link-dialog"
  aria-labelledby="link-dialog-title" onclose={actions.closeLink}>
  <form class="insertion-form link-form" onsubmit={(event) => { event.preventDefault(); actions.submitLink(); }}>
    <header>
      <div><h2 id="link-dialog-title">링크 삽입</h2><p>URL을 입력하거나 현재 문서에서 연결할 파일을 고르세요.</p></div>
      <button class="dialog-close" type="button" aria-label="닫기" onclick={actions.closeLink}>×</button>
    </header>
    <label>표시할 텍스트<input class="link-label" bind:value={insertion.linkLabel} type="text" autocomplete="off" /></label>
    <label>URL 또는 경로<span class="link-destination-row"><input class="link-destination"
      bind:value={insertion.linkDestination} type="text" required spellcheck="false"
      placeholder="https://example.com" /><button class="secondary-button pick-link-file"
      type="button" onclick={actions.pickLinkFile}>파일 선택…</button></span></label>
    <label>제목 <span class="optional-label">선택 사항</span><input class="link-title"
      bind:value={insertion.linkTitle} type="text" autocomplete="off" /></label>
    <div class="dialog-error" role="alert" hidden={!insertion.linkError}>{insertion.linkError}</div>
    <footer><button class="secondary-button link-cancel" type="button" onclick={actions.closeLink}>취소</button><button class="primary-button" type="submit">삽입</button></footer>
  </form>
</dialog>
