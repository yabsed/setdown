# LSP implementation evidence

The maintained explanation and results are in
[Notebook LSP validation](../../docs/validation/2026-11-08-notebook-lsp.md).
The baseline is `cd6b98d7d8fd4b1b898d47a094155d60bc1db3e2`; the implementation is
the working-tree change recorded by `source-index.json` and the benchmark's
source/build identities. No commit or installed desktop-package replacement was performed.

- `unit.log.txt`: full unit run, 1,253 tests.
- `preview-contract.log.txt`: build/typecheck, 880 contract unit tests, 14 tooling
  tests, then 305/307 Electron scenarios. This command exited nonzero.
- `followup-e2e.log.txt`: both failed scenarios passed in a focused trace run.
  The notebook test's obsolete warning expectation was corrected to error;
  browser code, assertions and timeouts were unchanged. No automatic retries.
- `baseline-focus.log.txt`: the same browser scenario passed on the unchanged
  baseline. The original intermittent failure remains unexplained.
- `kernel.log.txt`: four real Jupyter kernel bridge tests.
- `notebook-analysis-measurements.json`: 100-cell observations, real analyzer
  PID/RSS, twenty tab round trips and six edit-to-current-diagnostic measurements.
- PNGs: actual default Literal diagnostics, successful execution and checking UI.
- `followup-traces/`: Playwright traces for candidate follow-up and baseline.
- `benchmark/comparison.json`: all 80 launches, 400 cycles, 48 comparisons and
  unchanged tolerances; all comparisons passed. Per-run JSON and logs are retained.
- `*-before-*.log.txt` and `contract-interrupted-*.log.txt`: development failures
  and the deliberately interrupted pre-fixture-update run, separate from final results.

Commands used from the repository root:

```sh
npm test
npm run test:preview-contract
python3 apps/desktop/test/notebook/kernel-bridge.test.py
TMPDIR=/var/tmp npm run bench:preview -- \
  --baseline /tmp/setdown-lsp-apply-baseline --runs 5 \
  --output /absolute/path/to/new-results
```

The baseline has its own `npm ci --offline` installation. The benchmark built
both versions and used one isolated Xvfb/D-Bus/runtime session. `/var/tmp` avoids
an unrelated `/tmp/.git`; it was applied to both versions. Logs have `.log.txt`
copies because repository ignore rules exclude `.log` files.
