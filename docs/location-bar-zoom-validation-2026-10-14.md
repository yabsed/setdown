# Location bar and zoom validation — 2026-10-14

## Follow-up: uBlock startup, live menus, terminal navigation and per-tab zoom

This section describes the later changes based on `c62229f61dec1e5fd5b7c498e2f835da87df102f`.
The earlier Electron 38 measurements below are historical and do not validate this follow-up.

### Changes and diagnosis

- Electron is now 44.7.2 so native views can use isolated zoom. Content zoom belongs to each tab, including two Markdown tabs, two terminal tabs, and two websites on the same hostname. Web reader mode has its own Markdown factor, separate from the live site's factor. App zoom remains shared.
- The uBlock startup failure was reproduced as `Cannot read properties of undefined (reading 'setBadgeBackgroundColor')`. Chromium exposes distinct `browser` and `chrome` namespaces; uBlock's startup alias replaced the compatibility adapter with the incomplete native API. The build now aliases both names synchronously before extension scripts execute. Real request, scriptlet, frame cosmetic and response-header filtering remain enabled. The existing managed-storage cache migration and user preferences are preserved.
- Top application menus use a transparent native menu layer above the live website. Video frames continue advancing while the menu and its submenu are open. This covers the reported top View menu; other shell context menus retain their existing captured-overlay lifecycle.
- Terminal processes have stable `Terminal N` labels and editable `terminal://<session-id>` locations. Back/Forward spans terminal, file and website visits. Navigating away or closing the resource tab keeps the process available in the Terminal sidebar; explicitly closing the sidebar process ends it.
- Electron upgrade regressions were repaired: Monaco receives pointer/caret focus before group activation and preserves focused hosts when moving them; the authorized local-resource protocol supports video CORS/range requests; native image paste uses Electron's asynchronous clipboard API. Tests resolve the workspace's installed Electron executable, including separately installed benchmark versions.

### Completed checks

| Check | Result |
| --- | --- |
| Full unit suite | 91 files / 664 tests passed |
| Preview contract | 34 unit files / 247 tests, 3 comparator tests, production build/typecheck, 78 real Electron scenarios passed |
| Additional clipboard, read-only editor, installed extension and live menu scenarios | 4 passed |
| uBlock startup and filtering | Fresh startup, real filters, popup and three settings-preserving restarts passed |
| Menu composition | Isolated Xvfb desktop capture shows menu and submenu over the live video |
| Comparative preview benchmark | 5 matched repetitions / 80 fresh applications / all 48 buckets passed |

All GUI runs use the isolated display/runtime/D-Bus launcher. No test windows use the user's desktop. Test retries remain disabled. No required scenario, assertion or performance tolerance was removed. The read-only Monaco check now clicks visible rendered text and asserts textbox focus because Chromium's native EditContext input is underneath the rendered lines.

The first full contract run exposed two source-focus failures and one video CORS failure; those logs are retained with the subsequent passing run. The additional read-only editor check first failed on its old click target, then on an incorrectly scoped replacement selector; the corrected test passes with focus and read-only assertions intact.

[Full contract log](../test-results/tab-behavior-2026-10-14/contract-final.log),
[unit log](../test-results/tab-behavior-2026-10-14/unit.log),
[additional checks](../test-results/tab-behavior-2026-10-14/additional-final.log),
[uBlock startup diagnostic](../test-results/tab-behavior-2026-10-14/ubo-startup-diagnosis.log),
[corrected startup](../test-results/tab-behavior-2026-10-14/ubo-startup-fixed.log),
[composited menu screenshot](../test-results/tab-behavior-2026-10-14/live-menu-composited.png).

The live-menu regression uses a deterministic playing video with advancing frame callbacks, not an authenticated YouTube session. A separate isolated fresh-profile diagnostic also completed navigation to Google. Unsupported manifest-permission/MV2 warnings may still be printed; they are distinct from the repaired startup exception.

### Follow-up comparative timings

Baseline: `c62229f61dec1e5fd5b7c498e2f835da87df102f`, a separate clean checkout with independently installed dependencies and Electron 38.8.6. Candidate: the modified working tree with Electron 44.7.2. Both builds were current before `--skip-build`; the runner verified unchanged build and harness hashes. The same fixture/harness ran serially on one isolated Xvfb display with alternating AB / BA order.

**All 48 comparisons passed; zero regressions.** Five matched repetitions covered all eight scenarios, 80 fresh applications and five cycles per application. No rerun or threshold adjustment was needed for this follow-up comparison. A regression requires an increase exceeding both 25% and 50ms.

Values are median milliseconds, **baseline → candidate**. First and second cycles remain separate; warm is the median of cycles 3–5 per application, then across five repetitions. Preparation is source idle time before Esc.

| Surface | Edit | Preparation | Metric | First | Second | Warm |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Markdown | No | 0ms | Esc → latest native capture | 74.0 → 81.0 | 39.0 → 25.0 | 27.0 → 24.0 |
| Markdown | No | 0ms | Double-click → source | 46.0 → 29.0 | 40.0 → 35.0 | 13.0 → 12.0 |
| Markdown | Yes | 0ms | Esc → latest native capture | 481.0 → 456.0 | 115.0 → 110.0 | 102.0 → 91.0 |
| Markdown | Yes | 0ms | Double-click → source | 24.0 → 18.0 | 16.0 → 19.0 | 16.0 → 14.0 |
| Markdown | No | 3000ms | Esc → latest native capture | 113.0 → 45.0 | 30.0 → 23.0 | 25.0 → 21.0 |
| Markdown | No | 3000ms | Double-click → source | 19.0 → 16.0 | 13.0 → 12.0 | 13.0 → 11.0 |
| Markdown | Yes | 3000ms | Esc → latest native capture | 146.0 → 119.0 | 110.0 → 111.0 | 100.0 → 95.0 |
| Markdown | Yes | 3000ms | Double-click → source | 24.0 → 19.0 | 15.0 → 16.0 | 14.0 → 14.0 |
| Git review | No | 0ms | Esc → latest native capture | 1179.0 → 965.0 | 27.0 → 19.0 | 27.0 → 28.0 |
| Git review | No | 0ms | Double-click → source | 47.0 → 24.0 | 16.0 → 13.0 | 14.0 → 13.0 |
| Git review | Yes | 0ms | Esc → latest native capture | 1231.0 → 1058.0 | 1332.0 → 1560.0 | 224.0 → 178.0 |
| Git review | Yes | 0ms | Double-click → source | 46.0 → 23.0 | 28.0 → 19.0 | 24.0 → 18.0 |
| Git review | No | 3000ms | Esc → latest native capture | 148.0 → 28.0 | 25.0 → 20.0 | 26.0 → 17.0 |
| Git review | No | 3000ms | Double-click → source | 47.0 → 24.0 | 14.0 → 12.0 | 21.0 → 18.0 |
| Git review | Yes | 3000ms | Esc → latest native capture | 315.0 → 239.0 | 299.0 → 187.0 | 191.0 → 182.0 |
| Git review | Yes | 3000ms | Double-click → source | 37.0 → 24.0 | 40.0 → 19.0 | 20.0 → 18.0 |

The edited Git review second cycle with 0ms preparation increased from 1332ms to 1560ms (+228ms, +17.1%); it remains below the unchanged 25% relative threshold. Passing does not mean every individual measurement became faster.

Esc timing includes polling, IPC and native capture readback; it is not a monitor presentation timestamp. Edited scenarios require the latest content before capture. These results describe this machine and workload, not a universal latency bound.

[Follow-up comparison data](tab-behavior-benchmark-2026-10-14.json) retains identities, all samples and all 48 comparisons. [Full raw report and IPC traces](../test-results/tab-preview-benchmark-2026-10-14/comparison.json) and [benchmark log](../test-results/tab-behavior-2026-10-14/benchmark.log) retain the complete run.

## Earlier validation: address-bar controls on Electron 38

Applied bookmark → reader → zoom ordering, removed the address-bar uBlock button, and aligned toolbar icons with Markdown controls. uBlock filtering stays enabled; its Extensions popup now receives the current owned web tab.

Every tab has the same decrease / reset percentage / increase control. Live websites use hostname zoom; web reader mode and Markdown/plain text/Git use shared text zoom; terminals use terminal zoom; PDFs and images use their actual per-file scale including fit modes; videos use app zoom. Toolbar and wheel changes preserve the existing scope boundaries.

Git review toolbar focus and hidden theme completion were also repaired. Native hidden state drives theme settlement even when DOM visibility says visible; spare navigation reconciles the current theme before adoption.

### Validation

| Check | Result |
| --- | --- |
| Staged unit suite before edits | 90 files / 658 tests passed |
| Final full unit suite | 91 files / 661 tests passed |
| Preview contract | 34 unit files / 244 tests, 3 comparator tests, production build/typecheck, 75 Electron scenarios passed |
| Additional insertion and installed-extension scenarios | 2 passed |
| Final display/D-Bus launcher check | 2 real Electron reader/extension scenarios passed; matching isolated process environments |
| Comparative preview benchmark | 5 matched repetitions, 8 scenarios, 80 fresh applications, 48 buckets passed |

Test retries remain disabled. No assertions, performance tolerances, required focus/IME checks, latest-content captures, or scenarios were removed. Existing tests were updated for the new toolbar/terminal selectors and persisted outline defaults; terminal interruption now waits for an actual foreground sleep process before sending Ctrl+C.

### Isolated execution

GUI npm test and benchmark scripts use `apps/desktop/scripts/with-isolated-display.sh`. It runs real Electron/Chromium on a 1920×1080 Xvfb screen, removes inherited Wayland sockets, forces X11, and creates private runtime and D-Bus sessions. D-Bus starts inside Xvfb so activated services also inherit the virtual display. The final reader/extension tests audited both the Electron and D-Bus daemon environments: DISPLAY `:100`, no WAYLAND_DISPLAY or WAYLAND_SOCKET, X11 backends, and the same private runtime. Plain Xvfb with inherited Wayland variables was insufficient on this desktop. The existing headless Mutter fallback is preserved; execution checks on this machine used Xvfb.

Logs and screenshots: [validation artifacts](../test-results/zoom-validation-2026-10-14/), [final contract log](../test-results/zoom-validation-2026-10-14/contract.log), [final benchmark artifacts](../test-results/zoom-benchmark-confirmation-2026-10-14/).

### Measurement variation

The first 5-pair comparison failed one bucket: edited Markdown with no source preparation, first Esc capture, 397ms → 513ms (+116ms, +29.2%). Its run samples were 397/572/519/336/378ms versus 316/513/635/575/352ms. This failure is retained and was not treated as a pass.

A separate 3-pair control compared two copies of the exact same baseline build and installed Electron. That same bucket measured 518ms → 375ms (143ms difference despite identical code). All other conditions and the 25% / 50ms thresholds were preserved. The final comparison below is one explicitly planned 5-pair confirmation with unchanged candidate code, builds, harness, scenarios and tolerances, not an automatic retry loop.

[First failed comparison](../test-results/zoom-benchmark-2026-10-14/comparison.json) and [identical-code control](../test-results/zoom-benchmark-identical-2026-10-14/comparison.json) retain complete samples and IPC traces. All three sets of timing samples and identities are also saved in the [report data](location-bar-zoom-benchmark-2026-10-14.json). First-capture results vary substantially on this runner, so a passing comparison should not be read as proof of a universal latency bound.

### Comparative timings

Baseline: `7aeaee53e325159339b660c520a280c1907a5c64` in a separate checkout with its own installed dependencies and Electron executable. Candidate: the current working tree. Electron: 38.8.6 / 38.8.6. Both versions used the same candidate harness and sample fixture, alternating AB / BA on DISPLAY `:100`. Builds were current before `--skip-build`; the runner verified unchanged artifact and harness hashes.

Values below are medians in milliseconds, written **baseline → candidate**. First and second cycles are kept separate. Warm is the median of cycles 3–5 within each fresh application, then the median across five repetitions. Preparation is source idle time before Esc; all eight combinations are included.

| Surface | Edit | Preparation | Metric | First | Second | Warm |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Markdown | No | 0ms | Esc → latest native capture | 68.0 → 79.0 | 39.0 → 46.0 | 29.0 → 31.0 |
| Markdown | No | 0ms | Double-click → source | 24.0 → 54.0 | 46.0 → 60.0 | 19.0 → 15.0 |
| Markdown | Yes | 0ms | Esc → latest native capture | 500.0 → 449.0 | 126.0 → 119.0 | 112.0 → 113.0 |
| Markdown | Yes | 0ms | Double-click → source | 31.0 → 27.0 | 24.0 → 19.0 | 21.0 → 17.0 |
| Markdown | No | 3000ms | Esc → latest native capture | 122.0 → 125.0 | 25.0 → 38.0 | 28.0 → 33.0 |
| Markdown | No | 3000ms | Double-click → source | 22.0 → 23.0 | 14.0 → 16.0 | 12.0 → 29.0 |
| Markdown | Yes | 3000ms | Esc → latest native capture | 166.0 → 151.0 | 101.0 → 104.0 | 105.0 → 108.0 |
| Markdown | Yes | 3000ms | Double-click → source | 25.0 → 21.0 | 17.0 → 22.0 | 16.0 → 18.0 |
| Git review | No | 0ms | Esc → latest native capture | 1173.0 → 1270.0 | 28.0 → 32.0 | 28.0 → 26.0 |
| Git review | No | 0ms | Double-click → source | 52.0 → 49.0 | 28.0 → 17.0 | 22.0 → 19.0 |
| Git review | Yes | 0ms | Esc → latest native capture | 1456.0 → 1243.0 | 1648.0 → 1625.0 | 239.0 → 250.0 |
| Git review | Yes | 0ms | Double-click → source | 51.0 → 48.0 | 30.0 → 42.0 | 27.0 → 28.0 |
| Git review | No | 3000ms | Esc → latest native capture | 172.0 → 169.0 | 25.0 → 26.0 | 26.0 → 26.0 |
| Git review | No | 3000ms | Double-click → source | 54.0 → 52.0 | 18.0 → 18.0 | 19.0 → 21.0 |
| Git review | Yes | 3000ms | Esc → latest native capture | 385.0 → 395.0 | 296.0 → 346.0 | 224.0 → 227.0 |
| Git review | Yes | 3000ms | Double-click → source | 38.0 → 42.0 | 40.0 → 43.0 | 25.0 → 23.0 |

A bucket fails only when its increase exceeds both 25% and 50ms. All 48 buckets passed under these unchanged tolerances. Esc timing includes polling, IPC and capture readback; it is not a monitor presentation timestamp. Edited scenarios require the latest marker in the captured content. These measurements describe this machine and workload.

[Comparison data](location-bar-zoom-benchmark-2026-10-14.json) retains all three comparisons, per-run timing samples, all bucket comparisons, source/lock/harness/build identity, machine details and the final display/D-Bus audit. The full IPC traces remain in the linked test-results artifacts.
