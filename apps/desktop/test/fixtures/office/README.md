# Office viewer fixtures

`report.docx`, `report.doc`, `budget.xlsx`, `budget.xls`, `deck.pptx`, `deck.ppt`
and `links.pptx` were generated for this repository with headless LibreOffice from synthetic HTML,
CSV and flat OpenDocument sources. They contain only the marker text the tests
assert; the link in `links.pptx` points at the reserved `.invalid` domain.

`table.hwp` is `hwplib-table.hwp` from the `neolord0/hwplib` regression corpus
(commit `d9e073d6899d947f8f583492e00a5e1062381d7e`) and `sample.hwpx` is
`testFile/reader_writer/sample1.hwpx` from `neolord0/hwpxlib`
(commit `96ff157eb5973ba1bcf96c00c1b0993d61a718a0`), both copied unchanged through
`vendor/file-viewer/packages/renderers/hangul/test/fixtures`. Both projects are
Apache-2.0; `LICENSE.hwplib.txt` is their license text.

| File | SHA-256 |
| --- | --- |
| `table.hwp` | `ed97e2136e53cbb09ab6362d5631f6f1e4f752a5e53f09e85e4bc9c19f9e6d35` |
| `sample.hwpx` | `516db143466d3bc43e6808d4d5dc9da63abf014ec637ef01594f27998a0bd6c2` |
