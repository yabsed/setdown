<dialog class="insertion-dialog table-dialog" aria-labelledby="table-dialog-title">
  <form class="insertion-form table-form">
    <header>
      <div><h2 id="table-dialog-title">표 삽입</h2><p>셀 내용과 열 정렬을 지정하세요.</p></div>
      <button class="dialog-close" type="button" aria-label="닫기">×</button>
    </header>
    <div class="table-size-controls">
      <label>열 <input class="table-columns" type="number" min="1" max="12" value="3" /></label>
      <label>데이터 행 <input class="table-rows" type="number" min="0" max="30" value="2" /></label>
    </div>
    <div class="table-editor-scroll"><div class="table-grid-editor"></div></div>
    <footer><button class="secondary-button table-cancel" type="button">취소</button><button class="primary-button table-submit" type="button">삽입</button></footer>
  </form>
</dialog>

<dialog class="insertion-dialog link-dialog" aria-labelledby="link-dialog-title">
  <form class="insertion-form link-form">
    <header>
      <div><h2 id="link-dialog-title">링크 삽입</h2><p>URL을 입력하거나 현재 문서에서 연결할 파일을 고르세요.</p></div>
      <button class="dialog-close" type="button" aria-label="닫기">×</button>
    </header>
    <label>표시할 텍스트<input class="link-label" type="text" autocomplete="off" /></label>
    <label>URL 또는 경로<span class="link-destination-row"><input class="link-destination" type="text" required spellcheck="false" placeholder="https://example.com" /><button class="secondary-button pick-link-file" type="button">파일 선택…</button></span></label>
    <label>제목 <span class="optional-label">선택 사항</span><input class="link-title" type="text" autocomplete="off" /></label>
    <div class="dialog-error" role="alert" hidden></div>
    <footer><button class="secondary-button link-cancel" type="button">취소</button><button class="primary-button" type="submit">삽입</button></footer>
  </form>
</dialog>
