# CI failure investigation — 2026-09-21

Inspected GitHub job metadata, failed-step logs, and the uploaded benchmark
artifacts for all three requested runs, including both attempts of the newest
run. This investigation does not change application code, tests, retries or
performance thresholds.

## Confirmed failure

All three runs passed `preview-contract` and failed `preview-latency`. Dependency
installation, sandbox setup and both application builds succeeded. Every
available failed benchmark log reports exactly:

```text
Error: electronApplication.evaluate: Resulting promise was garbage collected.
```

| Run | Attempt | Commit | Failed batch | Git review scenario | Failing observation |
| --- | --- | --- | --- | --- | --- |
| [35534593385](https://github.com/yabsed/setdown/actions/runs/35534593385) | 1 | `8033d9a` | `3-candidate` | idle=0, edits=true | `sample-review-cold-cycles.spec.ts:98` |
| [35537111724](https://github.com/yabsed/setdown/actions/runs/35537111724) | 1 | `3759f58` | `2-candidate` | idle=0, edits=false | `sample-review-cold-cycles.spec.ts:102` |
| [35562390759](https://github.com/yabsed/setdown/actions/runs/35562390759/attempts/1) | 1 | `2b04234` | `2-baseline` (`62544a8`) | idle=0, edits=true | `sample-review-cold-cycles.spec.ts:98` |
| [35562390759](https://github.com/yabsed/setdown/actions/runs/35562390759/attempts/2) | 2 | `2b04234` | `1-candidate` | idle=0, edits=true | `sample-review-cold-cycles.spec.ts:98` |

None of these failed scenarios completed its first capture sample. The other
seven scenarios in each failed Playwright batch passed. The aborted benchmark
reports contain `error` and `passed: false`, but no completed `comparisons` or
`regressions` array. They therefore establish a measurement failure, not a
measured latency regression or a successful performance comparison.

The latest run's first attempt failed while testing the baseline. Its second
attempt failed earlier while testing the candidate. This is strong evidence
against treating this as a deterministic regression unique to the new media
implementation. All requested runs also precede the independent-zoom commit
`19b1c2f`. The previously observed local IME failure has a different assertion
and is not the cause shown in these CI artifacts.

## Failure path

At line 98, the test asks Electron's main process for a synchronous number:

```ts
const traceStart = await app.evaluate(() => (globalThis as any).cycleTrace.length);
```

At line 102, it polls another synchronous value: whether a child native view is
visible. Neither callback creates a pending application Promise or performs a
DOM layout query. Three failures happen before the Escape keypress; one happens
in the subsequent native-visibility poll.

The installed Playwright implementation sends `Runtime.callFunctionOn` through
Electron's Node inspector with `awaitPromise: true`. Its `rewriteError` maps
the protocol error containing `Promise was collected` to the exact error above.
The error originates at this evaluation/inspector boundary, rather than in the
benchmark's numeric regression comparator. The local installed source is
`node_modules/playwright-core/lib/coreBundle.js`, in the embedded
`crExecutionContext.ts` implementation. The dependency versions are Playwright
1.63.0 and Electron 38.8.6; all downloaded reports specify Electron 38.8.6.

The shared benchmark runner throws when the Playwright subprocess exits with
code 1 (`scripts/preview-benchmark.mjs:109`). Its final numerical comparison
does not run until all batches finish (line 122). The catch sets `passed: false`
for this infrastructure/measurement error (lines 135–137).

There is an upstream report of intermittent Electron main-process evaluation
errors including the same protocol error:
[microsoft/playwright#33737](https://github.com/microsoft/playwright/issues/33737).
It was closed requesting a self-contained reproduction, not a confirmed fix.
It corroborates the failure class; it does not prove the exact underlying V8
defect or a working fix for this repository's installed versions.

## Why failures appear frequently

One complete gate launches 80 fresh Electron processes: five repetitions × two
versions × eight scenarios. The specific cold Git condition implicated here
occurs 20 times per gate: five repetitions × two versions × two edit modes.
Each test also makes multiple inspector calls. A transient failure in any one
scenario makes its batch fail and aborts the whole comparison. A low per-call
failure frequency can therefore become a substantial whole-workflow failure
frequency; no per-call probability has been measured here.

The seven currently returned workflow runs contain three failures, two
successes and two cancellations. Thus three of five non-cancelled runs failed
in this small observed sample. The cancellations are separate from these
failures: the workflow deliberately uses `cancel-in-progress: true`.

CI reports identify four-vCPU Ubuntu/Azure runners. The concentration at cold
startup and absence of failures in the 3000ms preparation scenarios are
consistent with a startup/lifecycle-sensitive race. They do not establish CPU
speed or memory pressure as the root trigger. There is no OOM, signal-9,
sandbox startup failure or latency-threshold error in these failure records.

## Limits and next corrective work

The direct cause and failing layer are established: an intermittent inspector
evaluation failure in the cold Git benchmark aborts the measurement pipeline.
The exact cause of the inspector Promise losing its lifetime is **not yet
established**. Current artifacts lack raw Node-inspector context lifecycle
events and protocol request/response traces, so distinguishing V8 GC behavior
from an Electron context-lifetime issue requires a focused reproduction.

The next diagnostic should target idle=0 Git startup, capture
`Runtime.executionContextCreated`/`Destroyed`/`executionContextsCleared`, the
failing `Runtime.callFunctionOn`, and Electron process exit/crash events. This
must be a separate diagnostic run, not tracing inside performance measurements.
It should keep the synchronous observation callback and identify whether its
execution occurred before the error; blindly retrying mutating evaluations
would otherwise risk executing them twice.

Once isolated, stabilize the test's main-process observation channel or apply a
verified upstream fix. Readiness must represent the correct inspector/context
lifetime, not wait for the document to finish preparing: adding a 3-second
delay would remove the cold condition being measured. Do not hide this by
loosening latency tolerances, swallowing errors, skipping scenarios or adding
retries to make the gate green.

The runner should also publish the inner Playwright failure summary in the job
log. Currently the Actions step exposes mainly `Command failed (1)` and an
artifact-local filename, obscuring the common root failure.

## Artifact provenance

The latest run has two artifacts with the same name. A name-only
`gh run download` retrieved the first attempt, while `gh run view --log-failed`
showed the latest attempt. These must not be combined as if they were one run.

- Attempt 1: artifact `10623220402`, created `2026-09-21T04:56:01Z`.
- Attempt 2: artifact `10623007388`, created `2026-09-21T05:02:12Z`;
  fetched explicitly by artifact ID.
- Local extracted evidence: `/tmp/setdown-ci-35534593385`,
  `/tmp/setdown-ci-35537111724`, `/tmp/setdown-ci-35562390759`, and
  `/tmp/setdown-ci-35562390759-attempt2`.

No CI jobs were rerun and no remote state was changed during this investigation.
