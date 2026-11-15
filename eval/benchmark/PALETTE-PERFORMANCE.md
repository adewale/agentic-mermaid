# Palette generation diagnostic

This optional Agentic source diagnostic measures theme/category palette generation and deterministic operation counts. It can locate a palette hotspot or detect a local regression. It says nothing about general Mermaid rendering speed, fidelity or user-visible editor latency.

Run after installing and committing both checkouts:

```sh
bun run bench \
  --profile full --suites palette-performance --out /evidence/palette
```

Inspect `palette-report.json` and the owning log. Compare equivalent themes/counts and configurations. Historical scores have been removed; this diagnostic has **low value as a public benchmark**, but can be useful while changing that subsystem.
