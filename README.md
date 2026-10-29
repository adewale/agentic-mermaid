# PR #582 visual and adapter review evidence

Evidence-only attachment branch following PR #578/#581; not intended to merge.

Baseline SHA: `9fc3a141297ea0dd954fae903e5609e2efb8ba7e`
Current renderer SHA: `f271cd1e71acd5668c8fc87fec6ad2c3df24636b`

Identical source/options are retained beside production SVGs, layout projections, metrics and receipts. The baseline Class tree throws; its honest error is retained instead of a fabricated before image. Chromium screenshots use bundled fonts and unchanged viewBox crops. Inspect C3's bottom contact, the edge 32 label moving clear of a foreign shaft, and Node 5/Node 8 aligning.

The historical Bun sweep reported a 6px multigraph movement. This fresh Node capture measures 10.821875 user units per moved node and the same decrease in total route length; label/edge conflicts also improve from 5 to 4. These current measurements are retained explicitly rather than presented as the older sweep's result.

`adapter-review.json` records the focused review. Forty purposefully selected family/direction/style pairs have identical SVGs and preserve node/relationship identities. Six numeric-boundary probes cover roundoff, genuine ordinary-scale subpixel offsets, the absolute cap and a genuine 2px offset at 1e16. These are bounded review probes, not a general routing proof. No introduced defect was found.

Regenerate SVGs from the retained input and options at either renderer checkout:

```sh
bun run bin/am.ts render cyclic-labelled-15-chains.mmd --format svg --output out.svg
bun run bin/am.ts render class-80-publication.mmd --options '{"style":"publication-figure"}' --format svg --output out.svg
bun run bin/am.ts render multigraph-24-publication.mmd --options '{"style":"publication-figure"}' --format svg --output out.svg
```

The capture/review scripts record the exact source API calls; their local checkout/output paths can be adjusted when rerunning. PNGs prove appearance for the captured font environment. Card-contact certification and relationship preservation are independently checked by the PR's regression tests; the Class paint receipt can still be unverified at its occlusion-work limit.
