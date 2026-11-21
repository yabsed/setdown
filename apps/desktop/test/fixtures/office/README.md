# Office viewer fixtures

`report.docx`, `report.doc`, `budget.xlsx`, `budget.xls`, `deck.pptx`, `deck.ppt`
and `links.pptx` were generated for this repository with headless LibreOffice from synthetic HTML,
CSV and flat OpenDocument sources. They contain only the marker text the tests
assert; the link in `links.pptx` points at the reserved `.invalid` domain.

`table.hwp` and `pictures.hwp` are `hwplib-table.hwp` and `hwplib-image.hwp` from the
`neolord0/hwplib` regression corpus (commit `d9e073d6899d947f8f583492e00a5e1062381d7e`);
`sample.hwpx` and `columns.hwpx` are `testFile/reader_writer/sample1.hwpx` and
`testFile/reader_writer/MultiColumn.hwpx` from `neolord0/hwpxlib`
(commit `96ff157eb5973ba1bcf96c00c1b0993d61a718a0`). All four were copied unchanged through
`vendor/file-viewer/packages/renderers/hangul/test/fixtures`. `pictures.hwp` (placed
pictures) and `columns.hwpx` (text running over several pages) are there for
`media/office-pdf-export.spec.ts`. Both projects are
Apache-2.0; `LICENSE.hwplib.txt` is their license text.

| File | SHA-256 |
| --- | --- |
| `table.hwp` | `ed97e2136e53cbb09ab6362d5631f6f1e4f752a5e53f09e85e4bc9c19f9e6d35` |
| `sample.hwpx` | `516db143466d3bc43e6808d4d5dc9da63abf014ec637ef01594f27998a0bd6c2` |
| `pictures.hwp` | `c9d6726edce369955821a06d9a0f9b3887d733e9d99ee122b23299c6db4d2d92` |
| `columns.hwpx` | `c5f0933d6d1fe0a2defd9be7ed3cb3839b16b7f2eabb85b1294f98a3a13badd3` |
