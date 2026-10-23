# Preview median comparison

Baseline `ebcc57f9d9366762bcde052e795415e139a3dbd4`; candidate same HEAD plus editor-report implementation and cross-window drag fixes. Both use Electron 44.7.2.

Runs: 5 per version. Display: `:99`. Thresholds: both >25% and >50ms. Result: PASS.

Each value is milliseconds. First/second are medians across fresh applications; warm is the median of each app’s cycles 3–5, then the median across applications. Capture includes IPC/polling/readback and is not a monitor timestamp.

| Surface | Preparation ms | Edited | Cycle | Metric | Baseline | Candidate | Δ ms | Result |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| Markdown | 3000 | true | first | Esc → native capture | 111.0 | 99.0 | -12.0 | PASS |
| Markdown | 3000 | true | second | Esc → native capture | 100.0 | 103.0 | +3.0 | PASS |
| Markdown | 3000 | true | warm | Esc → native capture | 95.0 | 93.0 | -2.0 | PASS |
| Markdown | 3000 | true | first | Double-click → source | 20.0 | 21.0 | +1.0 | PASS |
| Markdown | 3000 | true | second | Double-click → source | 13.0 | 14.0 | +1.0 | PASS |
| Markdown | 3000 | true | warm | Double-click → source | 14.0 | 15.0 | +1.0 | PASS |
| Markdown | 0 | true | first | Esc → native capture | 390.0 | 421.0 | +31.0 | PASS |
| Markdown | 0 | true | second | Esc → native capture | 96.0 | 105.0 | +9.0 | PASS |
| Markdown | 0 | true | warm | Esc → native capture | 89.0 | 91.0 | +2.0 | PASS |
| Markdown | 0 | true | first | Double-click → source | 21.0 | 20.0 | -1.0 | PASS |
| Markdown | 0 | true | second | Double-click → source | 16.0 | 14.0 | -2.0 | PASS |
| Markdown | 0 | true | warm | Double-click → source | 14.0 | 14.0 | +0.0 | PASS |
| Markdown | 0 | false | first | Esc → native capture | 43.0 | 41.0 | -2.0 | PASS |
| Markdown | 0 | false | second | Esc → native capture | 30.0 | 28.0 | -2.0 | PASS |
| Markdown | 0 | false | warm | Esc → native capture | 23.0 | 24.0 | +1.0 | PASS |
| Markdown | 0 | false | first | Double-click → source | 18.0 | 21.0 | +3.0 | PASS |
| Markdown | 0 | false | second | Double-click → source | 35.0 | 34.0 | -1.0 | PASS |
| Markdown | 0 | false | warm | Double-click → source | 12.0 | 12.0 | +0.0 | PASS |
| Markdown | 3000 | false | first | Esc → native capture | 41.0 | 42.0 | +1.0 | PASS |
| Markdown | 3000 | false | second | Esc → native capture | 19.0 | 18.0 | -1.0 | PASS |
| Markdown | 3000 | false | warm | Esc → native capture | 23.0 | 23.0 | +0.0 | PASS |
| Markdown | 3000 | false | first | Double-click → source | 16.0 | 17.0 | +1.0 | PASS |
| Markdown | 3000 | false | second | Double-click → source | 12.0 | 12.0 | +0.0 | PASS |
| Markdown | 3000 | false | warm | Double-click → source | 11.0 | 11.0 | +0.0 | PASS |
| Git review | 3000 | true | first | Esc → native capture | 237.0 | 232.0 | -5.0 | PASS |
| Git review | 3000 | true | second | Esc → native capture | 187.0 | 184.0 | -3.0 | PASS |
| Git review | 3000 | true | warm | Esc → native capture | 182.0 | 177.0 | -5.0 | PASS |
| Git review | 3000 | true | first | Double-click → source | 23.0 | 23.0 | +0.0 | PASS |
| Git review | 3000 | true | second | Double-click → source | 18.0 | 19.0 | +1.0 | PASS |
| Git review | 3000 | true | warm | Double-click → source | 18.0 | 19.0 | +1.0 | PASS |
| Git review | 0 | false | first | Esc → native capture | 928.0 | 912.0 | -16.0 | PASS |
| Git review | 0 | false | second | Esc → native capture | 21.0 | 21.0 | +0.0 | PASS |
| Git review | 0 | false | warm | Esc → native capture | 30.0 | 29.0 | -1.0 | PASS |
| Git review | 0 | false | first | Double-click → source | 24.0 | 28.0 | +4.0 | PASS |
| Git review | 0 | false | second | Double-click → source | 12.0 | 12.0 | +0.0 | PASS |
| Git review | 0 | false | warm | Double-click → source | 12.0 | 13.0 | +1.0 | PASS |
| Git review | 0 | true | first | Esc → native capture | 991.0 | 993.0 | +2.0 | PASS |
| Git review | 0 | true | second | Esc → native capture | 1463.0 | 1457.0 | -6.0 | PASS |
| Git review | 0 | true | warm | Esc → native capture | 182.0 | 183.0 | +1.0 | PASS |
| Git review | 0 | true | first | Double-click → source | 16.0 | 17.0 | +1.0 | PASS |
| Git review | 0 | true | second | Double-click → source | 23.0 | 22.0 | -1.0 | PASS |
| Git review | 0 | true | warm | Double-click → source | 20.0 | 21.0 | +1.0 | PASS |
| Git review | 3000 | false | first | Esc → native capture | 30.0 | 26.0 | -4.0 | PASS |
| Git review | 3000 | false | second | Esc → native capture | 21.0 | 19.0 | -2.0 | PASS |
| Git review | 3000 | false | warm | Esc → native capture | 18.0 | 18.0 | +0.0 | PASS |
| Git review | 3000 | false | first | Double-click → source | 23.0 | 25.0 | +2.0 | PASS |
| Git review | 3000 | false | second | Double-click → source | 12.0 | 11.0 | -1.0 | PASS |
| Git review | 3000 | false | warm | Double-click → source | 17.0 | 18.0 | +1.0 | PASS |
