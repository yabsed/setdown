# Preview performance

Read [the preview performance contract](docs/preview-performance-contract.md)
before changing preview preparation/presentation, native bounds or zoom, source ↔
reader transitions, hydration, source-position lookup, themes/CSS, or Electron /
Crossnote dependencies. It records the reasons, code owners by module, and checks
behind commits `57729a8` and `d77e652`.

- Preserve the contract's observable guarantees; do not freeze implementation text.
- Run `npm run test:preview-contract` for changes in that scope. It includes a
  build/typecheck, focused unit tests, and real Electron/Chromium tests.
- Run `npm run bench:preview -- --baseline /absolute/path/to/installed-baseline`
  when changing those performance paths. Read the contract for baseline setup.
  Report first, second, and warm cycles separately for both ordinary Markdown and
  Git review, with/without edits and with/without preparation time.
- Missing scenarios, stale-content captures, or test failures are not successful
  benchmarks. Do not silently loosen tolerances, skip tests, add retries, or move
  preparation into the measured input path to obtain a pass.
- Update the contract and its tests together when an intentional behavior change
  replaces a guarantee. Preserve focus/IME, latest revision, and visual correctness.
