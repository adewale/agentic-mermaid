# Selected followups: correctness, numeric formatting and backlog

Evidence for PR #516, candidate `2eb645f93b67aed95a9546df122ca29a1636f90d`,
26 October 2026. These artifacts live outside the product branch.

## Qualification

The final candidate passes 655 owning tests, 163 pinned-Mermaid tests,
canonical core/repository typecheck, lint, build, the lazy-module graph gate,
and the exact 219-file npm package manifest. See the individual logs and
`receipt.json` for the packed artifact's SHA-256.

The corpus comparison uses the correctness-only parent
`fd9ed706334d61ae22a68a2f65b4426b9249966d`, so both sides include the ER
text correction before comparing the numeric optimization. All 5,710 outputs
match byte for byte: 571 inputs, seven SVG options/styles, ASCII, Unicode and
verify. The explicit fresh-layout probe compares another 288 output pairs
with ELK caching disabled and changing padding; all match.

The semantic and red-green CI jobs passed at checkout
`fb1b81ce74f865accfde1e5dd77231a4c4b4ac5a`. Its parents are live main
`18017376db3168579b26cc9ecf01f8526e00146e` and this head; its tree matches
their merge. The red-green job reports 15 assertion failures at test locations
against base production. Other CI lanes were still queued when this evidence
was prepared. These receipts do not claim completed CI or merge readiness.

## Comparisons and their limits

1. `selected-followups-format-cost.*` isolates the cache in the final
   composition against the correctness-only parent, using the repository's
   micro-benchmark. Five alternating process-order rounds, 31 samples,
   1,000 ms warmup, minimum 40 ms samples, ELK cache enabled. Paired ratios:
   Flow5 0.93, Sequence20 1.01, Class80 0.99, State80 1.01, hand-drawn Flow5
   0.96, watercolor Flow5 0.98. Ratios are medians of paired round ratios;
   they can differ from the quotient of the displayed overall medians.

2. `svg-attribute-cache-final.*` compares component `a21e116...` against
   pre-formatting `98f196...`, with the same five-round/six-case configuration.
   State80 is 1.01 and hand-drawn Flow5 is 1.10. Its matching canonical
   identical-code run, `svg-attribute-cache-aa.*`, gives 1.05 for both. These
   process-level results retain the adverse hand-drawn measurement.

3. `selected-followups-interleaved.json` alternates individual calls between
   pre-formatting source and the final candidate in one Bun worker, after
   warming both graphs. Five rounds of 100 paired samples give State80 0.986
   and hand-drawn Flow5 1.007. This diagnostic reduces temporal drift but
   shares runtime and third-party modules; it is not a substitute for the
   canonical isolated-process benchmark. Its exact-source duplicate-checkout
   control is `selected-followups-interleaved-aa.json`: State80 1.006 and
   hand-drawn Flow5 0.991, with both source revisions exactly `2eb645f...`.

4. `selected-followups-interleaved-cache-effect.json` uses the same individual
   call ordering, comparing the correctness-only parent with the final head:
   State80 0.954 and hand-drawn Flow5 0.982. It isolates the numeric module
   within the same correctness changes.

5. `selected-followups-owned-fields.json` replays calls captured from real
   public State80 and hand-drawn Flow5 renders at the formatter boundary.
   It measures only numeric conversion work, excluding layout, rendering,
   output validation and startup. State80's 5,527 calls take about 0.42 ms
   before and 0.087 ms after (0.209 ratio). Hand-drawn's 255 calls take
   about 0.011 ms and 0.003 ms (0.269 ratio). These explain the saved work,
   not a corresponding whole-render speedup. The script consumes lengths;
   the separate full-output comparison establishes byte identity.

6. `selected-followups-fresh-layout.json` uses three alternating worker-order
   rounds with distinct padding values and ELK caching disabled. Paired
   median ratios are State80 0.988 and hand-drawn Flow5 1.034. Individual
   rounds vary in both directions; these are fresh layout requests after
   process warmup, not cold startup measurements. No heap reduction is claimed.

7. The earlier number-only variant was insufficiently stable:
   `svg-cache-matched-confirm.*` records a 1.13 State80 ratio, before the
   attribute cache was added. Its contemporaneous exact-code control is
   `svg-cache-matched-aa.*`. The earlier wider diagnostic bundle remains at
   evidence commit `996c658c4be76c7a8c31c924ceead8d2844bd99e`.
   `selected-followups-composition-control.json` compares component `a21e116`
   with the combined correctness changes; it is **not** an identical-source
   control, even though both share the numeric module.

The measured formatter work decreases, but whole-render gains are small and
host-sensitive. The within-worker measurements do not reproduce the earlier
14% State80 / 16% hand-drawn regressions. The canonical process measurement
still has an adverse hand-drawn result against pre-formatting. These results
do not establish a universal no-regression claim across runtimes or workloads.

## Reproduction

Use Bun 1.4.2 and the frozen lockfile. The canonical command is recorded in
the `.log` files. `output-identity.ts --baseline fd9ed706... --jobs 1`
replays the corpus. The three temporary `.ts` probes are included with their
original checkout paths; use worktrees at the full revisions in `receipt.json`
or update those path constants. Set `AGENTIC_MERMAID_SCENE_ASSERTIONS=0` for
timing; set `AGENTIC_MERMAID_ELK_CACHE=1` for the interleaved and formatter
probes, and `0` for the fresh-layout worker. Run timing workers sequentially.

Generated ER before/after PNGs, SVGs, input and receipt are pinned separately
at `fecc37cc20284ce3c45c6e811767cda8b9a7b633`. They were regenerated and
visually inspected against this exact final candidate. Other grammar fixes
retain their source-only boundaries and explicit exclusions in PR #516.
