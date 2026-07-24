# Balanced Mermaid family portfolio

This 64-example companion corpus gives every registered built-in Mermaid family
the same four-example quota. It is the macro/family-balanced input for evals;
the larger documentation corpus remains useful for syntax breadth but must not
stand in for balanced family coverage.

The builder derives the family inventory from the product registry, draws only
from committed provenance-bearing sources, deduplicates exact source text, and
fails if any family cannot fill its quota. Its deterministic priority is:
upstream documentation (at most two), layout fixture, skill fixture, dedicated
family corpus, then the registry discovery and editor examples. Mindmap,
GitGraph, radar, Sankey, and the
sparsely documented families therefore receive the same weight as flowchart.

Regenerate and verify with:

```sh
bun run eval:family-portfolio
bun run eval:family-portfolio:check
```

Reports should publish both this portfolio's family-macro result and the full
documentation corpus's example-weighted result. Neither number replaces
per-family slices.
