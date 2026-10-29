# PR #571 embedded lineage evidence

These are the existing generated #566 before/after renders, uploaded separately so the PR can embed them. This branch contains only review attachments and is not intended to merge.

Baseline: c4a8eeb8a3c472fd73e6654c0efa151b8f19a7f5
After: 8b3927102b62d2fd8675939453e499bfdce937b4

The receipt records exact source/options; both complete default and publication figures retain all ten projects, seven relationships, and two groups.

Regenerate from the implementation checkout:

```sh
bun run scripts/pr-assets/meaning-preservation-evidence.ts c4a8eeb8a3c472fd73e6654c0efa151b8f19a7f5 8b3927102b62d2fd8675939453e499bfdce937b4 OUT_DIR flowchart-lineage-default flowchart-lineage-publication
```

This finite fixture does not certify universal layout quality.
