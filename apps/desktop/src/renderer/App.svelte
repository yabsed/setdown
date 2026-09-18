<script lang="ts">
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import TabChrome from './tabs/TabChrome.svelte';
  import TitleBar from './shell/TitleBar.svelte';
  import { view, type AppActions } from './view-state.svelte';

  let { actions }: { actions: AppActions } = $props();
</script>

<TitleBar />
<section class="shell" data-surface="empty" data-tabs="false">
  <TabChrome {actions} />
  <div class="notice" hidden={!view.notice}>
    <span>이 파일이 다른 프로그램에서 변경되었습니다.</span>
    <div>
      <button class="notice-keep" type="button" onclick={actions.keepExternalChange}>현재 내용 유지</button>
      <button class="notice-reload" type="button" onclick={actions.reloadExternalChange}>다시 불러오기</button>
    </div>
  </div>
  <EmptyState {actions} />
  <ReaderSurface {actions} />
  <InsertionDialogs {actions} />
</section>
