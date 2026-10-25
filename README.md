# SVG numeric conversion follow-up

PR #513; source head `0f214b10f50f290e98738d1ac0f07c6c07d735ea`. See `receipt.json` for bases, scope, reproduction and limits. All raw timing populations, including adverse mixed-workload observations, are retained.

`pre505.json` is the six-workload comparison against the original pre-#505 base. `hand-drawn-confirm.json` addresses the remaining hand-drawn observation; `aa.json` is the identical-build control. `fresh-layout.json` varies padding with geometry caching off and compares output hashes after timing. `output-identity.log` records 571 inputs across ten output modes, all byte-identical against current main.

The implementation memoizes a pure decimal spelling, with at most 1024 primitive-number entries and no layout/proof cache. No screenshots are included because output bytes are unchanged. No universal performance-parity, heap-saving or startup-speedup claim is made.
