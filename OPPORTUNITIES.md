# Opportunities — Status Tracker

The full set of opportunities identified during the design and build of `agentic-mermaid`, with current status. Each is one of:

- **Done** — implemented and shipped on this branch.
- **Cut** — deliberately removed; rationale in `AGENT_NATIVE.md` or below.
- **Deferred** — recognized as valuable; awaiting evidence to justify the cost.
- **Open** — actionable but not yet started.

---

## Core agent surface

| # | Opportunity | Status |
|---|---|---|
| 1 | `ValidDiagram` sealed IR with frontmatter / init / comments / accessibility / source-map in `meta` | **Done** |
| 2 | `parseMermaid` with multi-error `Result<ValidDiagram, ParseError[]>` | **Done** |
| 3 | `serializeMermaid` with round-trip on canonical input | **Done** for flowchart + state; opaque families round-trip via `canonicalSource` |
| 4 | `mutate(d, op)` with six MutationOp kinds | **Done** for flowchart + state |
| 5 | `verifyMermaid` with structured `LayoutWarning` codes (×8) and `suppress` filter | **Done**; all 8 codes implemented |
| 6 | Branded `Finite` type enforced at coordinate emission | **Done** (`toFinite()` throws on NaN/Infinity) |
| 7 | Deterministic-by-default layout via `LayoutContext` (seeded RNG, frozen font metrics, mock clock) | **Done** in form; **partial** in effect (see "What's broken") |

## Distribution

| # | Opportunity | Status |
|---|---|---|
| 8 | npm library subpath export (`./agent`) | **Done** |
| 9 | CLI binary `am` with verbs `render`/`verify`/`parse`/`serialize`/`mutate`/`format` + `--json` + `--agent-instructions` | **Done** |
| 10 | Code Mode MCP server (`agentic-mermaid-mcp`) with single `execute(code)` tool, `node:vm` sandbox | **Done** (stdio transport) |
| 11 | Claude Code skill bundle with master `SKILL.md` + `code-mode.md` + `cli.md` + `flowchart.md` | **Done** |
| 12 | `AGENTS.md` under 100 lines, byte-synced with `am --agent-instructions` | **Done** (39 lines) |
| 13 | Package rename from `beautiful-mermaid` to `agentic-mermaid` on npm | **Deferred** — coordinate with package owner; would invalidate snapshots/consumers |
| 14 | `MermaidGraph` exported type removed in favor of `ValidDiagram` | **Deferred** — would break 61 test files and Craft Agents consumers |
| 15 | `--http` / SSE transport for the MCP server | **Deferred** — stdio is enough for v1 |
| 16 | Cloudflare Worker deployment via `@cloudflare/codemode` + `DynamicWorkerExecutor` | **Deferred** — pattern documented; not shipped as a hosted service |
| 17 | Editor WebSocket live-watch | **Cut** — niche workflow that doesn't exist yet |
| 18 | HTTP endpoint colocated with the editor (separate from MCP HTTP) | **Cut** — duplicates the MCP surface |

## Test infrastructure

| # | Opportunity | Status |
|---|---|---|
| 19 | Determinism grid (~100 cases: direction × node-count × density) | **Done** (120 cases, all byte-identical) |
| 20 | Drift sentinel of hand-picked canonical layout JSONs | **Done** (8 fixtures, snapshot-based) |
| 21 | Round-trip property tests with `fast-check` | **Done** (100 cases per PR) |
| 22 | Per-code positive / negative verifier fixtures | **Done** (inline in `agent-verify.test.ts`); fixtures-on-disk layout **Deferred** |
| 23 | Code Mode sandbox isolation property test | **Done** (12 cases including `process`/`require`/`fetch`/timeout) |
| 24 | Doc-sync test (`AGENTS.md` ↔ `am --agent-instructions` byte-equality) | **Done** |
| 25 | Doc-sync test (every `LayoutWarning` code + `MutationOp` kind appears in `AGENT_NATIVE.md`) | **Done** |
| 26 | Bloat budget on `AGENTS.md` (≤100 lines) | **Done** (tested) |
| 27 | Stryker mutation testing targets specific `src/agent/**` paths | **Deferred** — Stryker config exists for the repo; agent-specific targets not added |
| 28 | Cross-platform CI matrix (Linux + macOS) | **Deferred** — single-platform catches most |
| 29 | Memory-pressure / GC fuzz tests | **Deferred** — real bug class, low frequency |
| 30 | 10K-case nightly property runs | **Deferred** — 1K per PR is enough for v1 |
| 31 | MermaidSeqBench integration as the single decisive eval number | **Open** — benchmark is external; integration is its own ticket |
| 32 | DiagramEval structural diff integration | **Open** — same shape as #31 |
| 33 | Differential corpus vs Mermaid.js | **Deferred** |
| 34 | Differential corpus vs D2 / Structurizr | **Deferred** |

## Composition (the deferred fourth property)

| # | Opportunity | Status |
|---|---|---|
| 35 | `@include other.mmd` syntax | **Deferred** (justified by Code Mode opportunity #38 — agent can implement own splice) |
| 36 | `@template` syntax (function-style) | **Deferred** |
| 37 | D2-style `vars` blocks + `${}` substitution + spread | **Deferred** |
| 38 | D2-style partial-path imports (`@file.element.subelement`) | **Deferred** |
| 39 | `layers` / `scenarios` / `steps` for multi-board diagrams | **Deferred** |
| 40 | Explicit `id:` override on `@use` expansions for refactor-stable identity | **Deferred** with composition |

## Verb surface

| # | Opportunity | Status |
|---|---|---|
| 41 | `diffDiagrams(a, b)` as a first-class verb | **Cut** — agent composes from `parse` + `ValidDiagram` inspection |
| 42 | `explainDiagram(d)` as a first-class verb | **Cut** — same |
| 43 | `verifyMermaidVisual(input, prompt)` — vision fallback (multimodal) | **Deferred** — add if MermaidSeqBench shows visual judgment is needed |
| 44 | `query` / `inspect` verb family (LikeC4-style 20 read tools) | **Deferred** — Code Mode lets the agent express queries directly |
| 45 | Stable opaque IDs (REQ-*/TC-*/ADR-* style) for elements that must outlive renames | **Cut** — content-hashed IDs cover the use case; explicit overrides only emerge with composition |
| 46 | Read-only MCP mode (LikeC4 stance) | **Deferred** — single MCP tool means there's nothing to gate; relevant when verb-per-tool MCP is added |

## Code Mode unlocks (captured in spec § "What Code Mode unlocks")

| # | Opportunity | Status |
|---|---|---|
| 47 | Composition without shipping composition (agent writes splice in TS) | **Open** — capability exists, no canonical example yet |
| 48 | Multi-diagram repo operations in one round-trip | **Open** — capability exists, no example yet |
| 49 | Auto-fix loop within one `execute()` call | **Open** — sketched in `references/code-mode.md`; needs a worked example |
| 50 | Diagram-as-tests / CI gate | **Open** — capability exists; example workflow not shipped |
| 51 | Cross-tool agent interface (linter / converter / importer share Code Mode shape) | **Open** — pattern documented; other tools haven't adopted yet |
| 52 | Benchmark eval at speed (one `execute()` per case) | **Open** — gated on #31 |
| 53 | Cross-language reach via Worker deployment | **Open** — documented; no Worker shipped |
| 54 | Skill `references/code-mode.md` ships runnable patterns | **Done** (3 patterns including auto-fix + multi-diagram cross-cut) |
| 55 | Diagram REPL (`am repl` interactive Code Mode shell) | **Open** — sandbox is reusable; CLI subcommand not added |

## Doc / discovery surfaces

| # | Opportunity | Status |
|---|---|---|
| 56 | Upstream-doc sync GitHub Action (weekly cron from `mermaid-js/mermaid`) | **Open** — workflow not authored; needs live repo to validate |
| 57 | `llms.txt` at deployed site | **Open** |
| 58 | Comparison page (agentic-mermaid vs mermaid vs D2 vs Structurizr) à la text-to-diagram.com | **Deferred** — discoverability play, not core |
| 59 | `FORMAT_SPEC.md` as a versioned sibling document | **Cut** — folded into `AGENT_NATIVE.md`; resurrect when consumers depend on a stable contract |
| 60 | "Why fork Beautiful Mermaid?" section in spec naming the three-layer stack | **Done** |

## Substrate

| # | Opportunity | Status |
|---|---|---|
| 61 | `LayoutContext` type and constructor | **Done** |
| 62 | Seeded LCG RNG (deterministic) | **Done** |
| 63 | Frozen font-metric table shipped as JSON | **Done** (curated stub; production regeneration is a separate ticket) |
| 64 | Mock clock | **Done** |
| 65 | ESLint rule banning `Math.random` / `Date.now` / `performance.now` in layout/render | **Open** — no ESLint config in repo |
| 66 | ELK seeded crossing minimizer (full nondeterminism elimination) | **Open** — biggest gap (see "What's broken") |
| 67 | CI font-metric drift check | **Open** |

## Anti-patterns considered and rejected

These came up but were not adopted:

- Pixel-difference testing — replaced by structural layout-JSON equality.
- Vision-on-PNG as primary feedback channel — replaced by `verifyMermaid` (vision fallback deferred per #43).
- Verb-per-tool MCP — replaced by Code Mode.
- AGENTS.md as a comprehensive reference — capped at 100 lines per InfoQ 2026 research showing bloat regresses agent performance.
- Anchor metric "never having looked at an image" — cut as overcorrected after research surfaced VisPainter / VIGA.

---

## Counts

- **Done**: 25 items
- **Cut**: 7 items
- **Deferred**: 19 items
- **Open**: 16 items

Total tracked: 67.
