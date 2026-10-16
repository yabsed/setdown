# Browser extension runtime

Setdown runs extensions in `persist:setdown-browser`. The document renderer and
preview sessions do not share its proxy, cookies, downloads or extension preloads.
Electron and electron-chrome-extensions remain pinned; native Chromium APIs such
as content scripts, messaging, storage, scripting and DNR remain native.

## Ownership and UI

- The location bar shows up to three pinned actions and an Extensions menu. The
  menu opens any action and changes its persisted pin state. Titles, badges,
  icons and enabled state can vary by native tab ID.
- An action popup is a sandboxed native child window below its button. It is not
  registered as a browser tab. `tabs.query({active:true,currentWindow:true})`
  continues to identify the original page, including in another Setdown window.
- Bounds cross IPC in CSS pixels and are converted to DIP with app zoom once.
  Escape, loss of focus, parent move/resize, navigation, tab change, destruction
  or unloading closes the popup. Escape returns focus to the page.
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
