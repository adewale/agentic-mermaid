# Divergences from AGENT_NATIVE.md

This file tracks decisions made during the build that differ from the spec, with rationale. Updated as work proceeds.

## Package layout

**Spec says:** Package renamed to `agentic-mermaid` on npm.
**What I did:** Kept the existing `beautiful-mermaid` package name in `package.json`. The agent surface is added as a new subpath: `beautiful-mermaid/agent` (or just under `src/agent/`). Bin scripts use the `am` and `agentic-mermaid-mcp` names regardless.
**Why:** Renaming the published npm package requires coordination with the package owner, and would also invalidate every existing snapshot/test that touches the `beautiful-mermaid` identifier. The rename is a v1-ship action, not a spec-implementation action.

## `MermaidGraph` removal

**Spec says:** `MermaidGraph` is removed in favor of `ValidDiagram`.
**What I did:** Kept `MermaidGraph` exported. `ValidDiagram` wraps it as its `body` for flowchart. The agent layer composes on top; the existing rendering pipeline is unchanged.
**Why:** Removing an exported type from a library with 61 test files and a public surface in use by Craft Agents would be a destructive refactor I can't do safely in one session. The wrapping approach lets `verify`, `mutate`, and `serialize` work without touching the existing parser.

## Diagram family coverage

**Spec says:** Implicitly covers all 9 diagram families.
**What I did:** `parseMermaid`, `serializeMermaid`, `mutate` fully implemented for **flowchart only** in this slice. Other families parse into `ValidDiagram` but `mutate` rejects ops with `UNSUPPORTED_FAMILY`; `serializeMermaid` re-emits the original source for non-flowchart families (round-trip works because the source is preserved verbatim in `meta`).
**Why:** Each family has its own grammar and would need its own mutation handlers and serializer. Flowchart is the most common; getting it right end-to-end is the meaningful slice.

## ELK seed pinning

**Spec says:** Seeded crossing minimizer.
**What I did:** `LayoutContext.rng` is implemented as a seeded LCG. ELK itself is configured with `"elk.layered.crossingMinimization.semiInteractive": true` and `"randomSeed"` where supported. **The library's nondeterminism through ELK is not fully eliminated in this slice.** The lint rule bans direct `Math.random`/`Date.now` calls; the determinism grid test measures the residual.
**Why:** Truly deterministic ELK requires either a custom build of ELK or a replacement crossing minimizer. Both are scope-blowing. The honest move is to plumb the substrate and measure the gap.

## Frozen font metric table

**Spec says:** Generated once via headless browser, checked in.
**What I did:** Shipped a small JSON file at `src/agent/assets/font-metrics.json` with a curated set of characters and the Inter font's metrics measured via the existing text-metrics module. Production use should regenerate this with a real measurement script.
**Why:** A full headless-browser measurement pipeline is its own subproject.

## CI workflows

**Spec mentions:** GitHub Action for upstream-doc sync; CI determinism matrix.
**What I did:** Did not add the GitHub Actions YAML for the upstream-doc sync; did not configure CI matrix for cross-platform. Added local test infrastructure (determinism grid, drift sentinel, verifier corpus) that runs via `bun test`.
**Why:** GitHub Actions YAML for upstream sync needs the live `mermaid-js/mermaid` repo and a working test environment to validate. Out of scope for a build-only session.

## Test surface

**Spec calls for:** Property tests with fast-check, exhaustive determinism grid, broken-fixture corpus, round-trip golden corpus, MermaidSeqBench integration.
**What I did:** Property tests (fast-check), determinism grid (~50 cases), drift sentinel (small corpus), broken-fixture verifier suite, round-trip golden corpus (small). MermaidSeqBench integration is not wired (the benchmark would need to be downloaded and adapted).
**Why:** MermaidSeqBench is an external dataset; integration is its own ticket.

## MCP Code Mode sandbox

**Spec says:** `node:vm` sandbox running an async-arrow body.
**What I did:** Implemented as specified. The sandbox exposes only `mermaid.*` globals plus `JSON`, `Object`, `Array`, `Math`, `String`, `Number`, `Boolean`, `Symbol`, `console` (captured), and the structured-clone built-ins. `fetch`, `process`, `require`, `import`, filesystem access, and `eval`/`Function` are not reachable.
**Why:** None — this is per spec.

## Skill bundle

**Spec says:** Master `SKILL.md` routes by family + channel; per-family references; `code-mode.md` and `cli.md` channel references.
**What I did:** Implemented as specified. Family references are shipped for flowchart only (sequence, class, etc. linked to upstream Mermaid docs with a one-line note).
**Why:** Per-family content for all 9 families is a documentation project of its own.

## Distribution channels not built

**Spec lists as supported but not shipped:** `--http` transport for the MCP server, Cloudflare Worker deployment.
**What I did:** Stdio MCP server only.
**Why:** Per spec — those are documented options the architecture admits, not v1 deliverables.
