# PR #505 evidence

Source base: `98f19638d489badb278e3aa694b7f5a0c5234a5f`. Source head: `b6d033a6c9ee04a7847953dc1852b75d6391b211`.

`generate.ts` calls production APIs for the same four inputs at each revision. Pass ROOT PHASE OUT_DIR REVISION to regenerate. `receipt.json` records options and output hashes. `before-results.json` and `after-results.json` retain real error baselines and output receipts.

`geometry-summary.json` compares all 44 contact-sheet scenarios; `pixel-review.json` compares the 29 changed SVG goldens. `golden-review.md` lists every changed golden and its reason.

`current-micro.json` is the current paired timing run; `current-quiet-aa.json` is the identical-build control without a concurrent local test workload. The files prefixed `prior-12d-` retain earlier timings at their original revisions. The timing results include adverse observations and do not establish performance parity. `current-numeric-cost.log` is a diagnostic using temporary formatter mocks, not a production acceptance benchmark.

Images were inspected; AJ before/after exposes label 8 and the changed feedback turns. Class and Quadrant retain honest error baselines. Numeric SVG changes are not visibly perceptible; all 29 reviewed goldens rasterize identically.
