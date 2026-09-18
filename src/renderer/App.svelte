<script lang="ts">
  import EmptyState from './components/EmptyState.svelte';
  import InsertionDialogs from './components/InsertionDialogs.svelte';
  import ReaderSurface from './components/ReaderSurface.svelte';
  import TabChrome from './components/TabChrome.svelte';
  import TitleBar from './components/TitleBar.svelte';
</script>

<TitleBar />
<section class="shell" data-surface="empty" data-tabs="false">
  <TabChrome />
  <div class="notice" hidden>
    <span>이 파일이 다른 프로그램에서 변경되었습니다.</span>
    <div>
      <button class="notice-keep" type="button">현재 내용 유지</button>
      <button class="notice-reload" type="button">다시 불러오기</button>
    </div>
  </div>
  <EmptyState />
  <ReaderSurface />
  <InsertionDialogs />
</section>
