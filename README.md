# Diagram 98 review attachments

Existing production-generated evidence uploaded separately for inline PR images; this attachment branch is not intended to merge.

Baseline: 142c97ee6179ef5ad73fd8d804a64f6f0a2adb3f
Current renderer: aa62a0013b91cbd130290725ab51201a06ba3afa

The baseline publication render fails. Its error is retained, with no fabricated before image. The default-style before/after PNG and SVG files are byte-identical. Source/options are recorded in receipt.json.

Regenerate in the implementation checkout:

```sh
bun run scripts/pr-assets/meaning-preservation-evidence.ts 142c97ee6179ef5ad73fd8d804a64f6f0a2adb3f aa62a0013b91cbd130290725ab51201a06ba3afa OUT_DIR flowchart-98-publication compat-corpus-flowchart-98
```

Inspect five nodes, two groups, four directed relationships and the outside-to-top2 exterior approach. This finite fixture does not establish arbitrary compound routing completeness.
