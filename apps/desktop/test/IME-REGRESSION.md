# Working Tree IME regression checks

This change protects composition, rather than normalizing broken text afterwards.
The reported Korean input failure has not been reproduced on a real OS IME in the
remote implementation environment. A passing mock test is not proof of native
focus or Korean input correctness; keep the PR draft until the checks below pass.

## Why these paths changed

- Working Tree had no composition guard around reactive model reconciliation.
- A delayed initial diff reveal could reset the caret after typing had begun.
- Workspace capture/IPC handlers could turn an IME Escape into a Viewer transition.
- Electron's navigation can focus a hidden WebContents. Returning focus after the
  fact cannot restore a composition that already ended. Hidden preview navigation
  is now detached for the full load and reattached only after completion. A/B view
  identities and the bounds-before-position ordering are retained.

Electron upstream added `webPreferences.focusOnNavigation` in PR 49425. It is not
in this application's pinned Electron 38.8.6 preferences API, so this patch does
not silently pass an unsupported option or upgrade the runtime/lockfile.

Primary reference: https://github.com/electron/electron/pull/49425

## Automated checks

```bash
npm run typecheck
npm test --workspace @setdown/desktop -- composition-guard workspace-events preview-navigation
npm run test:e2e --workspace @setdown/desktop -- git-review-ime
npm run test:e2e --workspace @setdown/desktop -- git-review-cold-escape git-review-tabs tab-detach
```

`git-review-ime` uses CDP `Input.imeSetComposition` to exercise Chromium's preedit
path. It holds `하` and `그` open while the background preview loads, and asserts
no compositionend or shell/editor blur before committing the syllable. It also
checks saved text and the IME-vs-Viewer meaning of Escape. CDP cannot validate an
OS-specific candidate popup or reproduce all IBus/Fcitx behavior.

## Manual acceptance (real input method, not paste)

Use the actual Korean input method on the target desktop (record OS, X11/Wayland,
input method/version, and Electron version). Test ordinary Editor and Working Tree.

1. Type `여기서는 잘 된다. 지금은 왜 괜찮지.` continuously, including final consonants.
2. Type only `하`, keep its composition active for several seconds, then add `ㄴ`.
   The result must be `한`, even if a math-heavy background preview completes.
3. Repeat while a preview was already rendering before composition started.
4. Start typing immediately after opening a new Working Tree review. A late
   first-change reveal must not move the cursor or interrupt the syllable.
5. Press Escape while composing: the IME receives it, without switching to Viewer.
   After composition ends, a subsequent Escape must retain ordinary Viewer behavior.
6. Edit a selection, backspace within a syllable, undo/redo, save, switch tabs,
   close/reopen the review, and compare ordinary-tab and saved-file contents.
7. Check first-Esc position, source/rendered double-click, preview scroll, A/B reuse,
   and tab detach/move. Native view attachment changed; inspect these regressions.

A focus check performed only seconds after typing is insufficient. Record blur,
compositionstart/end, model identity/version, and cursor changes throughout the
transaction if any syllable still breaks. Do not fix it with repeated focus(),
NFC normalization, or dropping intermediate range edits.
