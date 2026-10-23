# Preview median comparison

Baseline `ebcc57f9d9366762bcde052e795415e139a3dbd4`; candidate same HEAD plus implementation worktree. Both use Electron 44.7.2.

Runs: 5 per version. Display: `:99`. Thresholds: both >25% and >50ms. Result: PASS.

Each value is milliseconds. First/second are medians across fresh applications; warm is the median of each app’s cycles 3–5, then the median across applications. Capture includes IPC/polling/readback and is not a monitor timestamp.

| Surface | Preparation ms | Edited | Cycle | Metric | Baseline | Candidate | Δ ms | Result |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| Markdown | 3000 | true | first | Esc → capture | 107.0 | 100.0 | -7.0 | PASS |
| Markdown | 3000 | true | second | Esc → capture | 98.0 | 102.0 | +4.0 | PASS |
| Markdown | 3000 | true | warm | Esc → capture | 93.0 | 94.0 | +1.0 | PASS |
| Markdown | 3000 | true | first | Double-click → editor | 21.0 | 17.0 | -4.0 | PASS |
| Markdown | 3000 | true | second | Double-click → editor | 13.0 | 13.0 | +0.0 | PASS |
| Markdown | 3000 | true | warm | Double-click → editor | 14.0 | 14.0 | +0.0 | PASS |
| Markdown | 0 | true | first | Esc → capture | 447.0 | 422.0 | -25.0 | PASS |
| Markdown | 0 | true | second | Esc → capture | 102.0 | 104.0 | +2.0 | PASS |
| Markdown | 0 | true | warm | Esc → capture | 96.0 | 92.0 | -4.0 | PASS |
| Markdown | 0 | true | first | Double-click → editor | 21.0 | 19.0 | -2.0 | PASS |
| Markdown | 0 | true | second | Double-click → editor | 14.0 | 14.0 | +0.0 | PASS |
| Markdown | 0 | true | warm | Double-click → editor | 14.0 | 14.0 | +0.0 | PASS |
| Markdown | 0 | false | first | Esc → capture | 43.0 | 44.0 | +1.0 | PASS |
| Markdown | 0 | false | second | Esc → capture | 27.0 | 30.0 | +3.0 | PASS |
| Markdown | 0 | false | warm | Esc → capture | 26.0 | 21.0 | -5.0 | PASS |
| Markdown | 0 | false | first | Double-click → editor | 17.0 | 18.0 | +1.0 | PASS |
| Markdown | 0 | false | second | Double-click → editor | 34.0 | 34.0 | +0.0 | PASS |
| Markdown | 0 | false | warm | Double-click → editor | 12.0 | 12.0 | +0.0 | PASS |
| Markdown | 3000 | false | first | Esc → capture | 50.0 | 43.0 | -7.0 | PASS |
| Markdown | 3000 | false | second | Esc → capture | 21.0 | 22.0 | +1.0 | PASS |
| Markdown | 3000 | false | warm | Esc → capture | 25.0 | 20.0 | -5.0 | PASS |
| Markdown | 3000 | false | first | Double-click → editor | 17.0 | 17.0 | +0.0 | PASS |
| Markdown | 3000 | false | second | Double-click → editor | 11.0 | 12.0 | +1.0 | PASS |
| Markdown | 3000 | false | warm | Double-click → editor | 12.0 | 11.0 | -1.0 | PASS |
| Git review | 3000 | true | first | Esc → capture | 233.0 | 231.0 | -2.0 | PASS |
| Git review | 3000 | true | second | Esc → capture | 181.0 | 182.0 | +1.0 | PASS |
| Git review | 3000 | true | warm | Esc → capture | 180.0 | 174.0 | -6.0 | PASS |
| Git review | 3000 | true | first | Double-click → editor | 24.0 | 23.0 | -1.0 | PASS |
| Git review | 3000 | true | second | Double-click → editor | 18.0 | 19.0 | +1.0 | PASS |
| Git review | 3000 | true | warm | Double-click → editor | 18.0 | 18.0 | +0.0 | PASS |
| Git review | 0 | false | first | Esc → capture | 1344.0 | 951.0 | -393.0 | PASS |
| Git review | 0 | false | second | Esc → capture | 25.0 | 26.0 | +1.0 | PASS |
| Git review | 0 | false | warm | Esc → capture | 29.0 | 30.0 | +1.0 | PASS |
| Git review | 0 | false | first | Double-click → editor | 42.0 | 27.0 | -15.0 | PASS |
| Git review | 0 | false | second | Double-click → editor | 12.0 | 13.0 | +1.0 | PASS |
| Git review | 0 | false | warm | Double-click → editor | 17.0 | 13.0 | -4.0 | PASS |
| Git review | 0 | true | first | Esc → capture | 1024.0 | 988.0 | -36.0 | PASS |
| Git review | 0 | true | second | Esc → capture | 1462.0 | 1457.0 | -5.0 | PASS |
| Git review | 0 | true | warm | Esc → capture | 182.0 | 179.0 | -3.0 | PASS |
| Git review | 0 | true | first | Double-click → editor | 24.0 | 26.0 | +2.0 | PASS |
| Git review | 0 | true | second | Double-click → editor | 22.0 | 22.0 | +0.0 | PASS |
| Git review | 0 | true | warm | Double-click → editor | 20.0 | 20.0 | +0.0 | PASS |
| Git review | 3000 | false | first | Esc → capture | 29.0 | 30.0 | +1.0 | PASS |
| Git review | 3000 | false | second | Esc → capture | 22.0 | 21.0 | -1.0 | PASS |
| Git review | 3000 | false | warm | Esc → capture | 19.0 | 17.0 | -2.0 | PASS |
| Git review | 3000 | false | first | Double-click → editor | 24.0 | 25.0 | +1.0 | PASS |
| Git review | 3000 | false | second | Double-click → editor | 11.0 | 12.0 | +1.0 | PASS |
| Git review | 3000 | false | warm | Double-click → editor | 18.0 | 18.0 | +0.0 | PASS |

Full samples, ordering, hashes and machine metadata: [comparison.json](comparison.json).
