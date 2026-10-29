# GUI test execution

- Run GUI/Electron tests and benchmarks on an isolated virtual display (Xvfb)
  by default, even when the user's desktop display is available. Test windows
  must not appear on the user's desktop or steal its focus.
- On Wayland, also remove the inherited Wayland socket and isolate the runtime
  directory and D-Bus session. Xvfb alone can still let Electron use the desktop.
  `apps/desktop/scripts/with-isolated-display.sh` does this; GUI test and preview
  benchmark npm scripts use it by default.
- For example: `npm run test:preview-contract`. Run benchmark
  baseline and candidate on the same virtual display with identical settings.
- If Xvfb is unavailable, prepare an equivalent isolated display, using a
  temporary directory when needed. Do not silently fall back to the user's
  desktop; use it only when the user explicitly requests visible testing.
- Preserve real Electron/Chromium execution, required scenarios, focus/IME
  checks, logs and artifacts. Hidden execution must not skip tests, add retries,
  weaken assertions or relax performance tolerances.
- Esc transition regression tests also run through the isolated-display wrapper.
  The one-off visible desktop investigation is complete; it is not continuing
  permission to show test windows on the user's desktop.

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
