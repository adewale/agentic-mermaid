# BUILD-31 — lazy all-family browser SVG entry

Status: complete.

The framework-neutral `agentic-mermaid/browser/lazy` ESM entry exposes
`renderMermaidSVGAsync`. A generated hook-free catalog selects one of 15
literal family imports; family chunks include only SVG request normalization,
layout, and Scene lowering. Five ELK-backed families share one on-demand ELK
chunk, while all ten other families have no path to it. The synchronous
`browser.global.js` remains the one-file compatibility artifact.

The build gate records initial and per-family raw, gzip, and Brotli transfer,
rejects ASCII/PNG/agent capability leakage, and verifies exact loader
enrollment. Source and Chromium tests prove strict-mode byte parity for every
canonical family example, non-ELK network exclusion, and shared ELK caching.
The generated framework-neutral `/demo/` page consumes the same published lazy
graph and records the Timeline-only request path as a website payload gate.
Usage, Alpine adapters, pre-rendering, current measurements, and verification
commands live in [`docs/browser.md`](../../browser.md).
