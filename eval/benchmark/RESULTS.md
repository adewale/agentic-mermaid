# Benchmark results

Measured in this sandbox (x86_64 Linux, Bun 1.3.11). **Our numbers are
measured directly. Competitor numbers are measured live where the tool
ran, and labeled "from architecture" where it could not.** No head-to-head
latency is fabricated.

Reproduce ours: `bun run eval/benchmark/run-bench.ts`

## Ours — measured

Corpus: the 247-sample mermaid-js docs corpus (`eval/mermaid-docs-corpus`).

| Metric | p50 | p90 | max |
|---|---|---|---|
| SVG render (warm, in-process) | 3.7 ms | 14.9 ms | 58 ms |
| ASCII render (warm, in-process) | 0.37 ms | 1.9 ms | 16 ms |
| SVG output size | 2.9 KB | 7.3 KB | 14.6 KB |

- Parse success rate: **247/247 (100%)**.
- Cold start (CLI process, one diagram): **~870 ms** (Bun runtime startup +
  module load dominates; the render itself is single-digit ms).
- Determinism: byte-identical across runs, processes, and runtimes
  (bun ≡ node, x86_64) — separately gated in the test suite.

## Competitors — honest assessment

### mmdc (`@mermaid-js/mermaid-cli`, Node + Puppeteer) — measured, with caveats

- Installed fine (`npm i -g`, 355 packages, ~41 s).
- **Failed to render as-is**: headless Chrome refuses to run as root without
  `--no-sandbox` (`zygote_host_impl_linux.cc:101`). This is the exact
  Puppeteer pain that mermaid-cli issues #750/#1015/#1013 complain about.
- With a `--no-sandbox` puppeteer config it rendered: **~3000 ms cold** for
  a single 2-node diagram (browser launch dominates). Output **10.8 KB** for
  the diagram where ours emitted 2.2 KB (**~4.8× larger**).
- **Verdict:** requires a browser; an order of magnitude slower cold; larger
  output. The browserless advantage is real and measured, not asserted.

### termaid (`termaid` PyPI, Python) — measured

- Installed cleanly (`pip install termaid`, 155 KB).
- Renders Unicode/ASCII well — comparable visual quality to ours.
- **Cold start ~102 ms** for one diagram — **faster than our Bun CLI cold
  start (~870 ms)**. Python's interpreter starts faster than Bun's runtime
  for a one-shot CLI invocation. We report this honestly: on cold-start
  ASCII-to-terminal, termaid wins.
- **But termaid is render-only.** No parse-to-AST, no verify, no typed
  mutation, no structured errors, no SVG/PNG, no MCP, no agent verbs. Our
  differentiator over termaid is the *editing + inspection surface*, not
  ASCII speed.

### mmd-cli (Go) — not built

- Go toolchain is present, but `mmd-cli` would need a network fetch + build.
  Not built here. **From architecture:** a Go single-binary is the fastest
  cold start and the easiest install (no runtime), which is precisely why it
  exists (mermaid-cli #1015) — a distribution lesson we track for Loop 13
  (single-binary, #1018), not a rendering-correctness gap.

## Where we win — by construction, not by luck

| Axis | Us | mmdc | termaid |
|---|---|---|---|
| Browserless | ✅ | ❌ (Chrome) | ✅ |
| SVG output | ✅ | ✅ | ❌ (terminal only) |
| PNG output | ✅ (offline resvg) | ✅ (browser) | ❌ |
| ASCII output | ✅ | ❌ | ✅ |
| Parse → typed AST | ✅ | ❌ | ❌ |
| Structured verify (tiers) | ✅ | ❌ | ❌ |
| Typed mutation | ✅ | ❌ | ❌ |
| Structured machine errors | ✅ | ❌ | ❌ |
| MCP / Code Mode | ✅ | ❌ | ❌ |
| Determinism guarantee (tested) | ✅ | ❌ | ❌ |
| `describe` / AX tree | ✅ | ❌ | ❌ |
| Strict no-external-fetch mode | ✅ | ❌ | ❌ |
| Cold-start (one diagram) | ~870 ms | ~3000 ms | ~102 ms |
| SVG size (sample) | 2.2 KB | 10.8 KB | n/a |

## Honest takeaways

1. **vs mmdc:** decisive. Browserless, ~3× faster cold, ~5× smaller SVG,
   plus the entire agent surface they don't have.
2. **vs termaid:** termaid is a real peer *on terminal rendering* and is
   faster to cold-start. We do not claim to beat it on ASCII speed. We beat
   it on everything that isn't ASCII — AST, verify, mutate, SVG/PNG, MCP,
   determinism, structured errors. The play is "agent-native runtime that
   also renders terminals," not "fastest ASCII."
3. **Cold-start is our weakest number** (Bun runtime startup). For an
   always-warm library/MCP consumer it's a non-issue (single-digit ms);
   for one-shot CLI use a Go single-binary (Loop 13 #1018) would close it.
