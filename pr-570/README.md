# PR #570 visual evidence

Original production-renderer outputs from [CI run 40747987744](https://github.com/adewale/agentic-mermaid/actions/runs/40747987744), artifact 12842058361.

- Baseline source revision: 26ccb667f57c683443275cd4a94c0a7eadf93a2a.
- Candidate source revision: a988b00a1d57b9653e4d17dde2171b2b6f96568b.
- Input: generatedFlowchartSamples({ start: 40, count: 1 })[0].source, cycle40 TD.
- Same source and render options are recorded in the paired JSON receipts.
- No resizing, annotation, recoloring or other image alteration.
- Before PNG: 62,009 bytes, SHA256 8f477e0ac22f8a6c74183a50cb3ff45baa4c5ce4e613263931ee531e13e130d2.
- After PNG: 61,888 bytes, SHA256 dd42d771db7ee9c3c857086691b5053379b8dbcf19b4b04d42aa1c6379382108.

The feedback routes have 46 → 44 bends and total length 10,688.885 → 10,480.347 px. Area is unchanged; seven crossings, zero caption conflicts and passed paint certification are retained. This demonstrates one fixture, not general layout quality or execution speed.

These six small outputs (199,500 bytes total) are hosted on a separate evidence branch for embedding in the PR description. They are not part of the product PR's source tree or test inputs. The source revision above identifies the renderer; the image-hosting commit identifies the captured bytes.
