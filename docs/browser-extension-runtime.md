# Browser extension runtime

Setdown runs extensions in `persist:setdown-browser`. The document renderer and
preview sessions do not share its proxy, cookies, downloads or extension preloads.
Electron and electron-chrome-extensions remain pinned; native Chromium APIs such
as content scripts, messaging, storage, scripting and DNR remain native.

## Ownership and UI

- The location bar has one outlined puzzle Extensions button immediately after the
  address input, before the other page actions, matching the Markdown editing controls.
  Its resting background is transparent; the icon strip uses the active shell theme's chrome color.
  It keeps the same space in live web and Reader mode, so the address field and
  site/bookmark/reader controls do not shift on transition. It opens a compact horizontal
  icon strip with tooltips, badges and per-tab enabled state. Selecting an icon
  replaces that strip with the extension's own popup at the same toolbar anchor.
  Actions are not individually pinned; `getUserSettings().isOnToolbar` is false.
- The management sidebar shows manifest icons, names, short descriptions and
  enable switches. Installation sources and each extension's options, update,
  removal and technical details are disclosed through Add extension / More.
- An action popup is a sandboxed native WebContentsView inside its owning window,
  below the Extensions button. This avoids compositor-controlled child-window
  centering on Wayland. It is not registered as a browser tab.
  `tabs.query({active:true,currentWindow:true})`
  continues to identify the original page, including in another Setdown window.
- Bounds cross IPC in CSS pixels and are converted to DIP with app zoom once.
  Escape, loss of focus, parent move/resize, navigation, tab change, destruction
  or unloading closes the popup. Escape returns focus to the visible page, or
  the shell while Reader mode covers that page. The view is
  rounded, clipped to the owner and resized by Chromium's preferred-size events.
  The underlying page keeps its live view, size and visibility.
- Options pages still open as tabs. Extension links and `windows.create` use
  Setdown's browser tabs/windows. Window removal uses the normal close path,
  preserving document save confirmation. Incognito and `windows.create({tabId})`
  are not implemented.
- Native page context menus include the extension host's menu contributions.

## Module boundaries

`src/main/browser/extensions/host-bridge.ts` is the single guarded dependency on
private interfaces in electron-chrome-extensions 4.9.0. It authenticates the frame
or service-worker origin against the extension ID and exposes actions, tab
ownership, API registration and events to the other adapters. The build patches
fail if their upstream sites change; upgrading the library requires review.

`extension-permissions.ts` owns optional grants and confirmation.
`extension-network.ts` owns proxy, WebRTC policy and browsing-data operations.
`extension-proxy-auth.ts` owns bounded, in-memory authentication challenges.
`extension-downloads.ts` adapts the existing BrowserDownloads library.
`browser-extensions.ts` retains package installation, rollback and the registry.

The build produces separate frame and worker preloads from the same patched
compatibility source. The DOM-dependent cosmetic CSS and managed-cache migration
are appended only to the frame preload and authorized only for the bundled
uBlock path. Generic extensions do not get that special CSS IPC. Preload API
payload logging is removed because authentication replies contain credentials. Those replies use a private channel that also bypasses upstream debug logging.

## Supported adapters and limits

| API | Behavior |
| --- | --- |
| `action` / `browserAction` | Existing title/icon/badge/popup APIs plus per-tab enable/disable, toolbar state and actual popups |
| `permissions` | Mandatory permissions; explicit, persisted optional grants for implemented proxy/privacy/browsingData/downloads adapters; contains and actual revocation events |
| `proxy.settings` | Regular-profile system/direct/auto-detect/fixed-server settings and mandatory HTTP(S) PAC URL; serial application, persistence, control precedence, restoration on unload |
| `webRequest.onAuthRequired` | Native event retained; additional async/blocking fixed-server proxy challenges for the verified browser WebContents, delivered only to the controlling extension with required permissions |
| `privacy.network.webRTCIPHandlingPolicy` | Applies to existing and future browser WebContents and resets when the grant/controller disappears |
| `browsingData.remove` | Cookies, cache, localStorage, IndexedDB, service workers; origin filters with Chromium registrable-domain cookie semantics and extension storage preserved |
| `downloads` | HTTP(S) GET, save dialog or safely uniquified relative filename, existing download library integration, search, pause/resume/cancel/show/open and created/changed/erased events |

Implemented adapters reject unsupported inputs and report errors through Promise
rejection or callback-scoped `runtime.lastError`. This does not mean every
upstream or Chromium API is implemented. In particular:

- Electron exposes no host API to grant Chromium `activeTab` access or arbitrary
  optional native host permissions. Such grants are not fabricated. Declarative
  content scripts work on their declared hosts; install confirmation includes
  those hosts and optional permissions.
- Worker-origin HTTP authentication can arrive at `app.login` with null
  WebContents and pid 0. Setdown cannot prove its profile. It does not dispatch
  that challenge to another profile's credential provider. An already established
  Chromium proxy auth cache is a separate native mechanism. This remains a
  limitation for a complete Surfshark certification.
- PAC inline data/non-mandatory fallback behavior, incognito proxy scope, most privacy
  settings, time-filtered browsing-data removal, standalone CacheStorage deletion,
  download request bodies/headers and destructive download APIs are unsupported.
- `downloads.download` does not translate Blob URLs from another process.
  Content-script `<a download>` exports use Chromium's existing page download
  flow and are covered separately.
- Extension disable/re-enable does not reload user pages. Existing pages need a
  navigation/reload before declarative content scripts are installed again.
- CRX signature verification, automated updates, complete optional/native API
  permissions, and full Chrome API parity remain separate work. Installation
  keeps its existing confirmation and rollback flow.

## Verification

`test/e2e/browser/extension-runtime.spec.ts` uses a local MV3 fixture, real
Chromium and local origin/proxy servers. It checks the popup's tab/window identity,
keyboard input, worker namespace, badge updates, grant/revoke effects, actual
proxied bytes, HTTP 407 retry, WebRTC settings, scoped cookie deletion, file bytes,
callback/Promise errors, traversal rejection, DNR block/unblock, Blob exports,
popup dismissal, extension disable, and another Setdown window.

`extension-policy.test.ts` checks proxy input validation, persistent grant
semantics and authentication ownership. Existing installation/update/restart and
uBlock tests remain in the preview contract. GUI tests run with Chromium sandbox
enabled on an isolated Xvfb/runtime/D-Bus session. Playwright's Linux default
`--no-sandbox` otherwise prevents Electron service-worker preloads from running.

Run `npm run test:preview-contract`. For native bounds or presentation changes,
compare a separate installed baseline with `npm run bench:preview -- --baseline
/absolute/path/to/baseline`. See the preview performance contract for the full
scenario matrix and unchanged tolerances.

These fixtures verify browser behavior, not authenticated Surfshark or ChatGPT
Exporter product workflows. Their login, subscription, actual proxy service,
ChatGPT DOM compatibility and server-generated PDF output need separate validation
with those products; they are not marked certified by these tests.

The implementation's [dated verification record](../reports/2026_10_16_22_40_chrome_extension_compatibility_strategy.md#14-최종-회귀-검사와-성능-비교)
contains the full contract log and baseline/candidate measurements: 465 unit tests,
11 tooling tests and 129 Electron tests passed; all 48 preview comparison buckets
passed the unchanged regression thresholds across 80 fresh application runs.

Browser-data deletion follows Chromium's web-origin filtering, preserving extension
local storage; cookies follow the registrable-domain rule. See the
[Chrome API contract](https://developer.chrome.com/docs/extensions/reference/api/browsingData)
and [Electron 44.7.2 implementation](https://github.com/electron/electron/blob/v44.7.2/shell/browser/api/electron_api_session.cc).
The same pinned Electron source fixes PAC mode to mandatory, so the adapter rejects
non-mandatory PAC requests rather than silently changing their fallback behavior.


## Extension UI verification — 2026-10-17

The Extensions button is the first action after the address input, matching the
Markdown editing controls. Its resting background is transparent. The compact
icon strip uses the active shell chrome palette; Paper and Night are verified.
Live web ↔ Reader transitions preserve every location control's coordinates.
Native OS Escape closes the strip while keeping Reader visible and its hidden
web page unfocused. Extension popups remain anchored child views. The existing
uBlock filtering/popup checks and MV3 proxy, permissions, exports, multiple-window
identity, keyboard input and app zoom checks all pass.

`npm run test:preview-contract` passed: **465 unit, 11 tooling and 130 Electron
tests**. Earlier validation found an obsolete sidebar button selector and missing
second-window shell readiness in the test harness. Both were corrected before
the final complete run; no assertions, scenarios or tolerances were removed and
retries remain disabled.

The baseline is independently installed/built `3348823c21240660608d531d6ca0df226e6dd9e7`;
the candidate is that checkout with this UI change. Both use the same candidate
harness, fixture, virtual display and settings. Five repetitions per version
cover **80 fresh application launches and 48 comparison buckets**, with **zero
regressions** under the unchanged **25% AND 50 ms** threshold. Build/harness
hashes and individual samples are retained in the
[verification artifacts](../reports/chrome-extension-ui-2026-10-17/verification.json),
[contract log](../reports/chrome-extension-ui-2026-10-17/preview-contract.txt),
[comparison summary](../reports/chrome-extension-ui-2026-10-17/preview-summary.json) and
[compressed raw measurements](../reports/chrome-extension-ui-2026-10-17/preview-comparison.json.gz).

Each cell below is **baseline → candidate milliseconds**. First and second are
separate fresh-app cycle medians; warm is the median of cycles 3–5 within each
app, then across repetitions. Preparation is time in source before Escape.
The capture metric includes IPC, polling and native readback; it is not a monitor
presentation timestamp. Edited captures must contain the latest revision.

### Escape → latest-content native capture

| Surface | Preparation (ms) | Edits | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| Markdown | 0 | No | 43.0 → 40.0 | 19.0 → 22.0 | 25.0 → 21.0 |
| Markdown | 0 | Yes | 447.0 → 445.0 | 95.0 → 97.0 | 89.0 → 92.0 |
| Markdown | 3000 | No | 43.0 → 41.0 | 23.0 → 17.0 | 20.0 → 25.0 |
| Markdown | 3000 | Yes | 90.0 → 112.0 | 99.0 → 102.0 | 90.0 → 93.0 |
| Git review | 0 | No | 928.0 → 973.0 | 22.0 → 28.0 | 29.0 → 28.0 |
| Git review | 0 | Yes | 970.0 → 1022.0 | 1497.0 → 1491.0 | 174.0 → 181.0 |
| Git review | 3000 | No | 27.0 → 28.0 | 22.0 → 23.0 | 17.0 → 18.0 |
| Git review | 3000 | Yes | 232.0 → 233.0 | 188.0 → 188.0 | 174.0 → 173.0 |

### Double-click → editable source

| Surface | Preparation (ms) | Edits | First | Second | Warm |
| --- | ---: | --- | ---: | ---: | ---: |
| Markdown | 0 | No | 17.0 → 19.0 | 34.0 → 36.0 | 12.0 → 11.0 |
| Markdown | 0 | Yes | 20.0 → 21.0 | 16.0 → 14.0 | 14.0 → 14.0 |
| Markdown | 3000 | No | 16.0 → 16.0 | 12.0 → 12.0 | 11.0 → 11.0 |
| Markdown | 3000 | Yes | 20.0 → 16.0 | 13.0 → 15.0 | 12.0 → 14.0 |
| Git review | 0 | No | 23.0 → 25.0 | 12.0 → 12.0 | 12.0 → 13.0 |
| Git review | 0 | Yes | 14.0 → 16.0 | 21.0 → 22.0 | 18.0 → 19.0 |
| Git review | 3000 | No | 24.0 → 23.0 | 12.0 → 11.0 | 17.0 → 18.0 |
| Git review | 3000 | Yes | 21.0 → 22.0 | 18.0 → 18.0 | 18.0 → 17.0 |
