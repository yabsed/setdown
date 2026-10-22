" Focused behavioral evidence, not the upstream test suite or a Setdown test.
set nocompatible nomore nomodeline noswapfile hidden encoding=utf-8
set undolevels=1000
let s:results = []
let s:checks = 0

function! Check(expected, actual, label) abort
  let s:checks += 1
  call assert_equal(a:expected, a:actual, a:label)
endfunction

function! Fresh(lines) abort
  silent! only!
  enew!
  call setline(1, a:lines)
  let &undolevels = &undolevels
  normal! gg0
endfunction

function! CaseTextObjects() abort
  call Fresh(['call("한글🙂", (alpha + beta))'])
  normal! f"yi"
  call Check('한글🙂', getreg('"'), 'quoted Unicode content excludes quotes')
  normal! $yi)
  call Check('"한글🙂", (alpha + beta)', getreg('"'), 'outer nested parentheses')
endfunction

function! CaseDotRepeat() abort
  call Fresh(['red blue green'])
  execute "normal! ciwX\<Esc>"
  normal! w.
  call Check('X X green', getline(1), 'repeat change at a different word')
endfunction

function! CaseRegisters() abort
  call Fresh(['alpha', 'beta', 'gamma'])
  normal! yyj"_dd
  call Check("alpha\n", getreg('0'), 'yank register survives black-hole delete')
  call Check('V', getregtype('0'), 'linewise register type')
  normal! gg"ayyj"Ayy
  call Check("alpha\ngamma\n", getreg('a'), 'uppercase appends to named register')
  call setreg('z', 'preserved', 'v')
  normal! ggdd
  call Check('preserved', getreg('z'), 'unrelated named register survives deletion')
endfunction

function! CaseMacroReplay() abort
  call Fresh(['one', 'two', 'three'])
  call setreg('q', "A!\<Esc>j", 'v')
  normal! 3@q
  call Check(['one!', 'two!', 'three!'], getline(1, '$'), 'register replay with count')
endfunction

function! CaseMarks() abort
  call Fresh(['first', 'target', 'last'])
  normal! jma
  call append(0, ['inserted'])
  call Check(3, getpos("'a")[1], 'mark tracks inserted line')
  normal! `a
  call Check('target', getline('.'), 'jump returns to tracked content')
endfunction

function! CaseJumpHistory() abort
  call Fresh(map(range(1, 20), 'string(v:val)'))
  clearjumps
  normal! 10G20G
  execute "normal! \<C-O>"
  call Check(10, line('.'), 'older jump returns inside same file')
  " A leading literal Tab is parsed as Ex whitespace; count preserves the key.
  execute "normal! 1\<C-I>"
  call Check(20, line('.'), 'newer jump returns to source')
endfunction

function! CaseQuickfix() abort
  call Fresh(['a', 'b'])
  call setqflist([], 'f')
  call setqflist([], ' ', {'title': 'search A', 'context': {'query': 'a'},
        \ 'items': [{'bufnr': bufnr(), 'lnum': 1, 'text': 'a'}]})
  let first = getqflist({'id': 0, 'changedtick': 0})
  call setqflist([], ' ', {'title': 'search B', 'items': [{'bufnr': bufnr(), 'lnum': 2, 'text': 'b'}]})
  call Check(1, getqflist({'id': 0}).id != first.id, 'each list has distinct identity')
  colder
  call Check(first.id, getqflist({'id': 0}).id, 'history restores original list identity')
  call Check({'query': 'a'}, getqflist({'context': 0}).context, 'query context survives history')
  call setqflist([], 'a', {'id': first.id, 'items': [{'bufnr': bufnr(), 'lnum': 2, 'text': 'appended'}]})
  call Check(1, getqflist({'changedtick': 0}).changedtick > first.changedtick, 'append increments change counter')
endfunction

function! CaseLocationList() abort
  call Fresh(['a', 'b'])
  call setloclist(0, [{'bufnr': bufnr(), 'lnum': 1, 'text': 'origin'}])
  let original = win_getid()
  split
  call Check('origin', getloclist(0)[0].text, 'split initially copies location list')
  call setloclist(0, [{'bufnr': bufnr(), 'lnum': 2, 'text': 'other'}], 'r')
  call win_gotoid(original)
  call Check('origin', getloclist(0)[0].text, 'split updates are window-local')
endfunction

function! CaseSharedBuffer() abort
  call Fresh(['first', 'second', 'third'])
  let original = win_getid()
  split
  normal! G
  let second = win_getid()
  call setline(2, 'updated')
  call win_gotoid(original)
  call Check('updated', getline(2), 'split views share edited buffer')
  call Check(1, line('.'), 'original cursor remains independent')
  call win_gotoid(second)
  call Check(3, line('.'), 'second cursor remains independent')
endfunction

function! CaseLocalOptions() abort
  call Fresh(['a'])
  setlocal shiftwidth=3
  let first = bufnr()
  enew
  setlocal shiftwidth=7
  execute 'buffer ' . first
  call Check(3, &l:shiftwidth, 'indent width is buffer-local')
endfunction

function! CasePathResolution() abort
  call mkdir($VIM_AUDIT_TMP . '/src', 'p')
  call writefile(['module body'], $VIM_AUDIT_TMP . '/src/localmodule.py')
  call Fresh(['localmodule'])
  let &l:path = $VIM_AUDIT_TMP . '/src'
  setlocal suffixesadd=.py
  normal! gf
  call Check('localmodule.py', expand('%:t'), 'gf uses configured path and suffix')
  call Check('module body', getline(1), 'resolved file was opened')
endfunction

function! CaseGlobalEdit() abort
  call Fresh(['TODO a', 'keep', 'TODO b'])
  let before = getline(1, '$')
  global/^TODO/s/TODO/DONE/
  call Check(['DONE a', 'keep', 'DONE b'], getline(1, '$'), 'predicate-based line transformation')
  undo
  call Check(before, getline(1, '$'), 'global edits undo as one group')
endfunction

function! CaseUndoBranches() abort
  call Fresh(['base'])
  execute "normal! A-one\<Esc>"
  let &undolevels = &undolevels
  let first = undotree().seq_cur
  undo
  execute "normal! A-two\<Esc>"
  let &undolevels = &undolevels
  let second = undotree().seq_cur
  execute 'undo ' . first
  call Check('base-one', getline(1), 'first branch survives new edit after undo')
  execute 'undo ' . second
  call Check('base-two', getline(1), 'second branch can be selected')
endfunction

function! CasePersistentUndo() abort
  let filename = $VIM_AUDIT_TMP . '/persistent.txt'
  let undofile = $VIM_AUDIT_TMP . '/persistent.undo'
  call writefile(['base'], filename)
  execute 'edit! ' . fnameescape(filename)
  execute "normal! A-changed\<Esc>"
  write
  execute 'wundo ' . fnameescape(undofile)
  bwipe!
  execute 'edit ' . fnameescape(filename)
  execute 'rundo ' . fnameescape(undofile)
  undo
  call Check('base', getline(1), 'undo survives buffer destruction and reload')
endfunction

function! CasePythonFtplugin() abort
  call Fresh(['import localmodule'])
  let baseline = &g:suffixesadd
  execute 'source ' . fnameescape($VIM_AUDIT_ROOT . '/vendor/vim/runtime/ftplugin/python.vim')
  call Check(1, stridx(&l:suffixesadd, '.py') >= 0, 'pinned Python ftplugin adds .py')
  call Check(1, exists('b:undo_ftplugin'), 'ftplugin supplies teardown')
  call Check(1, !empty(maparg(']m', 'n', 0, 1)), 'function motion is installed locally')
  execute b:undo_ftplugin
  call Check(baseline, &l:suffixesadd, 'teardown resets suffix option')
  call Check({}, maparg(']m', 'n', 0, 1), 'teardown removes function motion')
endfunction

for s:name in ['TextObjects', 'DotRepeat', 'Registers', 'MacroReplay', 'Marks',
      \ 'JumpHistory', 'Quickfix', 'LocationList', 'SharedBuffer', 'LocalOptions',
      \ 'PathResolution', 'GlobalEdit', 'UndoBranches', 'PersistentUndo', 'PythonFtplugin']
  let s:before = len(v:errors)
  let s:check_before = s:checks
  let s:exception = ''
  try
    call call(function('Case' . s:name), [])
  catch
    let s:exception = v:exception . ' at ' . v:throwpoint
  endtry
  call add(s:results, {'name': s:name, 'checks': s:checks - s:check_before,
        \ 'passed': len(v:errors) == s:before && empty(s:exception),
        \ 'errors': v:errors[s:before :], 'exception': s:exception})
endfor
let s:failed = len(filter(copy(s:results), '!v:val.passed'))
call writefile([json_encode({'vim_version': execute('version'), 'cases': s:results,
      \ 'case_count': len(s:results), 'assertion_count': s:checks, 'failed_cases': s:failed})], $VIM_AUDIT_OUT)
if s:failed
  cquit 1
endif
qa!
