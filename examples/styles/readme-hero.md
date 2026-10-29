# README hero: login with MFA

The hero is a direct Agentic Mermaid PNG render of
[`readme-hero.mmd`](readme-hero.mmd). The source includes credential validation,
an MFA decision and two labeled retry paths to sign-in. Its authored classes
color the MFA check and the successful session path.

The style stack is `hand-drawn`, `nord-light`, then
[`readme-hero.style.json`](readme-hero.style.json), which increases node and edge
label sizes. The drawing seed is 11. No other artwork or text is added to the
renderer output.

From a source checkout with dependencies installed, generate the PNG directly:

```sh
bun run bin/am.ts render examples/styles/readme-hero.mmd --format png \
  --style hand-drawn,nord-light,examples/styles/readme-hero.style.json \
  --seed 11 --fit-width 1600 --security strict --output assets/hero.png
```

`bun run hero` uses the same source and options through `renderMermaidPNG` and
updates the existing SVG freshness record. `bun run hero:check` checks that
record against fresh renderer output; inspect the PNG after regeneration.

This is an illustrative login flow, not a complete authentication design.
