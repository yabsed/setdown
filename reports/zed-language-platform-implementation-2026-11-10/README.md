# Setdown language platform implementation — 2026-11-10

This implements the product integration following the earlier
[Zed investigation](../zed-language-platform-2026-11-10/README.md).
The application recognizes languages independently of installed servers, prepares
language packages asynchronously, and can discover new published languages without
changing or rebuilding the Setdown application.

## Product paths

- `src/core/document/language-catalog.ts`: file names, compound suffixes, globs,
  case-sensitive associations, shebangs, syntax dialects and editing defaults.
  The snapshot contains 805 definitions (including aliases and dialects), 260 lazy
  TextMate grammars and 524 definitions with a Zed Tree-sitter grammar reference.
- `src/main/language/runtime-language-catalog.ts`: official Zed index refresh,
  metadata import, persisted catalog and runtime registration. The initial index
  contains 581 extension packages and 538 extension language configurations.
- `src/main/language/language-package-store.ts`: pinned SHA-256 verification,
  bounded archive extraction, installation serialization, atomic replacement and
  offline reuse. A failed upgrade retains the previous installation.
- `tooling/language-host`: actual Zed Rust language registry, native installers,
  Node runtime, extension host and WASM adapters at commit
  `b5cd310b3b54dfc659fcc06453e6358843dfe216`. This is a separate headless process.
  Zed ProjectSettings supplies adapter configuration; Setdown's existing project
  analysis, LSP transport and document ownership remain responsible for editing.
- `src/main/language/language-provisioner.ts`: existing installed server discovery,
  native/extension/npm preparation and validated launch receipts. There are 560
  server profiles, including 365 newly namespaced extension profiles. Broad
  supplementary tools are not silently enabled for every language they advertise.
- `src/renderer/language/tree-sitter-runtime.ts`: real WASM query captures for
  package languages without a local TextMate grammar, UTF-16 positions, overlap
  flattening and revision/cancellation checks. Installing support never replaces
  a model or loses its current unsaved revision.

Source paths above are relative to `apps/desktop`, except `tooling/language-host`.
The host and its license notices are packaged outside `app.asar`. Generated
catalog checks are available through `npm run check:language-profiles`; refreshing
published packages uses `npm run update:zed-language-packages`.

The reported `Duplicate language server ID` came from overlapping upstream
identities, including underscore/hyphen variants. The importer binds existing
server identities where appropriate and namespaces new extension identities.
Existing custom profiles and saved preferences retain their identities.

## Zed settings and the chess workspace

`zed-project-settings.ts` reads JSONC, including comments and trailing commas,
from Zed's user configuration directory, `~/.zed/settings.json` and ancestor
`.zed/settings.json` files. More specific directories override ancestors; objects
merge recursively and arrays replace arrays. Explicit Setdown connection settings
have final precedence. Both `lsp.<server>.settings` and
`lsp.<server>.initialization_options` apply to installed and automatically prepared
servers. Changes reconnect affected providers while preserving their live text.
Malformed intermediate saves retain the last valid configuration.

The reported open project is
`/home/yabsed/Documents/fall26/work/projects/chess`, not `chess/infra`.
Its actual file is lowercase `.zed/settings.json`. It contains exactly
`["!Sub scalar", "!Sub sequence"]`. No conflicting saved Setdown YAML override
was found. The existing installed application predates these source changes.

A real YAML server was initialized with **chess as its workspace root**, then
checked the original files without modifying them. Applying the inherited
configuration removed these diagnostics:

| File | Unresolved `!Sub` before | After |
| --- | ---: | ---: |
| `infra/foundation/template.yaml` | 44 | 0 |
| `infra/backend/template.yaml` | 7 | 0 |
| `infra/local/compose.yaml` | 0 | 0 |

The current settings only declare `!Sub`. The remaining `!Ref`, `!GetAtt`,
`!Select`, `!GetAZs`, `!Base64` and `!Join` diagnostics are not suppressed by that
configuration. The check deliberately preserves this behavior rather than hiding
all YAML diagnostics. See [exact results](chess-yaml-result.json) and
[reproduction](check-chess-yaml.mjs).

## Verification record

- Real native Zed YAML installer: downloaded its managed Node runtime and YAML
  server with no system Node on PATH; schema diagnostics and completion worked.
  [Results](yaml-feature-result.json).
- Exact user tag example: scalar and sequence `!Sub` both produced diagnostics
  before the inherited settings and none afterward.
  [Results](yaml-zed-settings-result.json).
- Real Zed Svelte WASM extension loaded and prepared its language server and
  TypeScript plugin. An offline launch reused the validated receipt with a
  nonexistent host executable and a download function that throws. Actual type
  diagnostics and hover worked. [Results](svelte-offline-result.json).
- A second real WASM check repackaged that adapter under a previously unknown
  language, server and extension identity with a new compound file suffix. The
  runtime catalog imported the package without changing/rebuilding the app,
  registered the new profile, mapped its protocol language ID and returned real
  type diagnostics and hover. This tests generic integration, not a newly written
  analyzer. [Results](new-language-result.json),
  [reproduction](check-new-language.mjs).
- Runtime catalog unit fixture introduces a previously unknown published language,
  verifies its archive and associations, restores it offline and checks failed
  upgrade preservation. The Electron fixture uses a real MIT-licensed Tree-sitter
  WASM grammar for a language absent from the built catalog.
- Full GUI contract first run: 333/338 passed. Four failures exposed old test
  assumptions about catalog size, explicit installed-only preferences and how to
  open a project folder. One exposed a real notebook Markdown indentation
  regression, which was fixed by retaining notebook/Markdown surface defaults.
  The corrected full run passed **339/339** scenarios without retries, including
  live Zed settings with a project root above `infra`, unsaved text/Undo, Make
  indentation, YAML dialects and a newly registered real WASM grammar.
  [Final GUI log](final-contract-e2e.log.txt).
- Final unit run: **173 files, 1,303 tests passed**. Source/test typechecks,
  Svelte checks (zero warnings), renderer build, actual Rust host inventory smoke
  test and generated catalog checks passed. [Build and unit log](final-build-tests-2.log.txt).
- The required matched preview benchmark passed: **80 launches, 48 comparisons,
  zero regressions** under the unchanged 25% / 50 ms thresholds. Markdown and Git
  review, edited and unedited, 0/3000 ms preparation, first/second/warm cycles and
  both transition directions are reported separately in the
  [complete comparison table](preview-benchmark.md).
- Linux directory packaging passed. The packaged `app.asar` application loaded
  its unpacked Rust host (18 native adapters, including YAML) and highlighted a
  previously unknown runtime language with an actual WASM grammar; no renderer
  errors occurred. [Results](packaged-language-result.json),
  [packaged-app reproduction](check-packaged-language.mjs).

The runnable bundle is `apps/desktop/release/linux-unpacked/setdown` (keep its
surrounding bundle files). The existing `~/.local/share/setdown` installation and
desktop shortcut still point to the previous build. Close the running application
before launching the new executable; the single-instance lock would otherwise
forward the launch to the old running process. User project files and their Zed
configuration were not edited.

### Resource isolation

The machine has 13 GiB RAM and recorded a system OOM during earlier work.
Subsequent verification runs one command tree at a time in a systemd user scope
with `MemoryHigh=3G`, `MemoryMax=4G`, `MemorySwapMax=256M` and `OOMPolicy=kill`.
Cargo uses one build job. All GUI work still uses the required isolated Xvfb,
private runtime directory and D-Bus wrapper. Scenario coverage, assertions,
retry settings and performance tolerances are unchanged. Both benchmark builds
use `SETDOWN_BUILD_SOURCEMAP=0`.
An observation during the final GUI run recorded a peak of 2,648,854,528 bytes
(2.47 GiB) and no swap use at that point.
[Recorded scope limits and peak](memory-scope.txt).
After validation, the task's baseline checkout and real-server fixtures were
moved from RAM-backed `/tmp` to
`target/validation/zed-language-platform-2026-11-10` on disk. Temporary paths are
preserved as symlinks for reproduction. `/tmp` usage fell from 2.6 GiB to 52 MiB;
the archived fixtures occupy about 2.5 GiB on disk.

## Scope of compatibility

A new compatible published Zed package can add a language without changing core
code. This does not create an analyzer where none exists, guarantee every third
party server's quality, or replace a language's project SDK. Runtime provisioning
follows the actual upstream adapter/extension. First use of an uncached package
requires its download source to be available. The WASM highlighting bridge
currently consumes highlighting captures; it is not a port of Zed's entire editor,
Tree-sitter injection system or structural editing UI.
