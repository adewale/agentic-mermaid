# Consolidation audit — 2026-07-03

> **Remediation status (2026-07-04).** Landed on this branch, each with
> red→green or byte-equivalence evidence: 1.2 (STYLE_DEFAULTS single-sourced;
> class/er bold-title sizing fixed), 1.3 (one escape set in multiline-utils,
> property-tested), 1.4 (shared/color-math.ts, property-tested), 1.5 (a11y —
> the central injector's aria-describedby bug and five families' double
> injection fixed; all-family conformance gate added), 2.1 partially
> (serialize chain, verify aliases, mutate overload — and the chain's missing
> pie/quadrant entries were a live bug, INVALID_PAYLOAD on valid payloads),
> 2.2 (aliases from metadata), 2.5 (DiagramKind reuse + metadata-derived
> tables in facade and CLI), 4.1 partially (dead agent/ser2 configs deleted).
> `consolidation-gate.test.ts` pins the single-source invariants against
> recurrence. Still open: 1.1 (shape outlines), 1.6 (accTitle regex), 2.3
> (MCP tool descriptions), 2.4 (MCP bin shim), 2.6, 2.7, Tier 3 body-utils,
> the stryker lane generator, and all Tier 4 owner decisions.

Scope: full-repo audit for duplication whose elimination improves consistency,
coherence, and cohesion. Five parallel sweeps: per-family diagram modules, the
agent surface (`src/agent/` + `route-contracts.ts`), the rendering/theming
stack (`ascii/`, `scene/`, theme/style/color), repo-level tooling/docs, and the
product surfaces + tests (CLI/MCP/editor/website, `__tests__`).

Findings are ranked by impact = lines saved × risk of divergence. Tier 1 items
are **already-diverged duplicates** (latent bugs, not just hygiene). Every
`file:line` below was taken from the current tree; the top Tier 1 claims were
independently re-verified before writing this document.

This is orthogonal to `audit-remediation-2026-07.md` (label-overlap
remediation); nothing here overlaps that plan.

---

## Tier 1 — duplicates that have already diverged (fix first)

### 1.1 Shape geometry authored twice: `renderer.ts` ↔ `shape-clipping.ts`

Every non-rectangular flowchart shape's outline exists in two hand-synced
copies: the shape emitter in `src/renderer.ts` and the edge clipper in
`src/shape-clipping.ts` (whose comments admit they mirror "renderer geometry").

| Shape | renderer.ts | shape-clipping.ts | shared magic constant |
|---|---|---|---|
| hexagon | `renderHexagon` :874 (`inset = h/4`) | `clipToHexagon` :119 | `h/4` |
| cylinder | `renderCylinder` :895 (`ry = 7`) | `clipToCylinder` :142 (`RY = 7`) | `7` |
| trapezoids / leans | :948/:965/:982/:999 (`inset = w*0.15`) | `slantedShapePolygon` :174–190 | `w*0.15` |
| asymmetric | :930 (`indent = 12`) | :187 (`x + 12`) | `12` |
| diamond | `renderDiamond` :808 | `clipToDiamond` :239 | bbox midpoints |
| stadium | `renderStadium` :786 | `clipToStadium` :99 | `r = h/2` |

Changing a silhouette in the renderer silently detaches edges unless the twin
clipper is hand-edited to match. **Consolidation:** one `shapeOutline(shape, x,
y, w, h)` module returning canonical vertices/cap radii; renderer maps vertices
→ SVG, clipper ray-intersects the same vertices. The `ShapePiece.geometry`
objects the renderer already builds (`{kind:'polygon', points}` at :822/:887)
are most of the way there.

### 1.2 Per-family `STYLE_DEFAULTS` duplicated between `layout.ts` and `renderer.ts` — class/er have drifted

Six families define the same `RenderStyleDefaults` twice — once in `layout.ts`
(sizing) and once in `renderer.ts` (drawing). Layout and render must agree on
font weight/size/padding or boxes are sized for one metric and drawn with
another.

- **class — verified diverged:** `src/class/renderer.ts:37` draws titles at
  `nodeLabelFontWeight: 700`; `src/class/layout.ts:38` measures at
  `FONT_WEIGHTS.nodeLabel` = 500 (`src/styles.ts:49`).
- **er — diverged:** `src/er/renderer.ts:33` (`nodePaddingX: 14`, weight 700)
  vs `src/er/layout.ts:30` (`ER.boxPadX`, weight 500).
- **sequence:** values currently equal (16/6/10) but expressed via different
  constants (`SEQ.actorPadX` vs literal `16`), and the renderer copy carries
  `nodeCornerRadius`/`nodeLineWidth` the layout copy omits — value-equal today,
  structurally guaranteed to drift.
- timeline (`layout.ts:58` / `renderer.ts:45`), xychart (`layout.ts:29`
  hardcodes `400/400/500/2` where `renderer.ts:35` reads `CHART_FONT.*`),
  journey (`layout.ts:55` / `renderer.ts:43`, identical pure dup).

**Consolidation:** define each family's defaults once (family `types.ts` or a
small `<family>/style.ts`) and import into both. ~90 lines removed and the
class/er measure-vs-draw mismatch closed.

### 1.3 XML/attribute escaping: 8 divergent copies, two different escape sets

`src/multiline-utils.ts:40` exports the canonical `escapeXml` (escapes
`& < > " '`). Yet (verified):

- 4 full re-implementations of `escapeAttr` that **omit the `'` escape**:
  `src/renderer.ts:1104`, `src/er/renderer.ts:826`,
  `src/sequence/renderer.ts:640`, `src/class/renderer.ts:675`.
- 3 thin wrappers that just forward to `escapeXml`:
  `src/journey/renderer.ts:442`, `src/timeline/renderer.ts:579`,
  `src/architecture/renderer.ts:618`.
- 1 whole local `escapeXml` re-implementation: `src/xychart/renderer.ts:596`.

**Consolidation:** export `escapeAttr` (= `escapeXml`, a valid superset for
attribute contexts) from `multiline-utils.ts`; delete all 7 locals; make
xychart import the shared `escapeXml`.

### 1.4 Color math reimplemented 4× in `src/` with disagreeing thresholds

hex→rgb, rgb→hex, fg/bg mix, and luminance exist as independent private
copies:

| primitive | copies |
|---|---|
| hex → rgb | `theme.ts:460`, `color-resolver.ts:121`, `xychart/colors.ts:66`, `ascii/ansi.ts:131` |
| rgb → hex | `theme.ts:472`, `xychart/colors.ts:75`, inline `ascii/ansi.ts:45` |
| mix by % | `theme.ts:478` `mixHex`, `xychart/colors.ts:101` `mixHexColors`, `ascii/ansi.ts:41` `mixColors` |
| luminance/darkness | `theme.ts:315` (normalized `< 0.4`), `color-resolver.ts:149` (`> 140` on 0–255), `ascii/ansi.ts:219`, `xychart/colors.ts:92` (HSL L) |

The luminance copies disagree on formula domain and threshold; `mixHex` and
`mixHexColors` weight opposite arguments (easy to misuse); `isHexColor`
(3–8 digits) vs `isValidHex` (exactly 6) disagree on what a valid hex is.
Further hand-ported copies live in `editor/js/rendering.js:9,52` and
`scripts/site/{generate,differences,xychart-test}.ts`.

**Consolidation:** `src/shared/color-math.ts` exporting `parseHex`, `toHex`,
`mixHex` (one argument convention), `relativeLuminance`, `isDark`,
`contrastText`, `isHexColor`; point `theme.ts`, `color-resolver.ts`,
`xychart/colors.ts`, `ascii/ansi.ts` at it. Editor/scripts copies follow later.

### 1.5 SVG-root accessibility wiring: 5 variants, pie/quadrant dropped `<title>/<desc>`

The "decorate `<svg>` with `role=img`, `aria-labelledby/describedby`, emit
`<title>/<desc>`" concept is implemented five ways:

- sequence/class/er/timeline: verbatim-copied `buildAccessibilityAttrs`
  (`sequence/renderer.ts:617`, `er/renderer.ts:800`, `class/renderer.ts:648`,
  `timeline/renderer.ts:555`) passed to `svgOpenTag`.
- journey (`renderer.ts:175`): builds attrs then splices them in with
  `.replace('>', …)` — even though `svgOpenTag` (`theme.ts:409`) already
  accepts an attrs record.
- pie (`renderer.ts:212`) and quadrant (`renderer.ts:281`): same `.replace`
  trick but **only** add `role`/`aria-roledescription` — verified: neither file
  contains `aria-labelledby`, `aria-describedby`, or `<title>`. A concrete
  accessibility regression caused by the divergence.
- xychart (`renderer.ts:604`) and architecture (`renderer.ts:71`): two more
  bespoke variants.

**Consolidation:** one `buildSvgRoot(...)` in a shared `src/shared/svg-a11y.ts`
folding in `buildAccessibilityAttrs`; fixes the pie/quadrant gap as a side
effect.

### 1.6 `accTitle`/`accDescr` parsing hand-rolled with a drifting regex

`src/shared/accessibility-directives.ts` only covers accept-and-skip. Parsers
that model the directives each hand-roll the regex, and it has drifted:
`xychart/parser.ts:63` and `agent/parse.ts:27` accept an optional colon
(`accTitle\s*:?`), while `architecture/parser.ts:55`, `timeline/parser.ts:66`,
`gantt/parser.ts:112` require it. Each also re-implements the multi-line
`accDescr { … }` block scan; that block-continuation loop is additionally
copy-pasted verbatim between `families-builtin.ts` label extractors
(`extractJourneyLabels` :460–476 ≡ `extractXyChartLabels` :521–538).

**Consolidation:** extend `shared/accessibility-directives.ts` with a modeling
`parseAccessibilityDirective(lines, i)` used by all parsers and extractors.

---

## Tier 2 — coherence hazards (the "add a family" and "add a tool" taxes)

### 2.1 Adding a diagram family touches ~15 hand-maintained sites

Despite the registry (`getFamily` dispatch in `parse.ts:59`, `serialize.ts:92`,
`mutate.ts:38`), a new family still requires coordinated edits in:
`types.ts` (:20 `DiagramKind`, :501 `DiagramBody`, :548 narrower alias, :560
`MutableValidDiagram`, :636+ op types, :759 `AnyMutationOp`), `families.ts:130`
metadata, `families-builtin.ts` registration, `mutate.ts:17` overloads,
`serialize.ts:129` (a bare `||` chain of body-kind literals that falls to
`INVALID_PAYLOAD` if you forget one — verified), `verify.ts:41` alias map,
`verify.ts:133` branch cascade, `family-layouts.ts:104` switch,
`describe.ts:52` and `:72` (two parallel 12-branch dispatchers), `core.ts:11`
re-exports.

`families.ts:159` already proves the fix pattern: a compile-time
`BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND` check — applied to 1 of ~15
sites. **Consolidation:** derive the runtime sites from
`BUILTIN_FAMILY_METADATA`/the registry: `serialize.ts`'s chain becomes a
known-kinds lookup, `mutate`'s overloads collapse to the generic signature,
and the `verify.ts:41` alias map is deleted in favor of the metadata `headers`
field (see 2.2).

### 2.2 "Which headers map to family X" encoded 3× — and the copies disagree

`BUILTIN_FAMILY_METADATA[].headers` (`families.ts:131–154`), the `detect:`
predicates in `families-builtin.ts` (:110, :143, :187, …), and the hardcoded
alias map in `verify.ts:41–52`. Verified: the `verify.ts` map has **no `gantt`
or `quadrant` entries** — gantt survives via the `?? [kind]` fallback, but
quadrant's fallback `'quadrant'` does not match the real header
`quadrantchart`, so `opaqueSourceHasOnlyHeader` misclassifies a bare
`quadrantChart` header. **Consolidation:** single source in metadata; derive
`detect` and the verify aliases from it.

### 2.3 MCP tool surface duplicated across two servers

`src/mcp/server.ts` and `src/mcp/hosted-server.ts` re-declare the same tools:
byte-identical `describe` description (:98–101 vs :138–141), duplicated
`execute` (:56–74 vs :54–74) and `render_png` (:76–95 vs :106–122)
descriptions + schemas, duplicated JSON-RPC `handleRequest` dispatch (:115–133
vs :154–175), and duplicated `render_png` output normalization (:167–193 vs
:355–379). The hosted-vs-local behavioral split is intentional
(`docs/mcp-code-mode-rationale.md`); the schema/description/dispatch
scaffolding is not. **Consolidation:** shared `TOOL_DESCRIPTIONS`/schemas
module + a `dispatchRpc` helper so a new tool is declared once.

### 2.4 MCP bin entrypoint duplicated: `bin/agentic-mermaid-mcp.ts` ≡ `src/mcp/mcp-bin.ts`

Verified by diff: identical except shebang/import path (the split itself is
deliberate — Bun dev vs node-publish — and documented in `mcp-bin.ts`'s
header). But ~40 lines of real logic (flag parsing, full `--help` text,
`integerFlag`, `main()`) are copied rather than shared. **Consolidation:**
export `runMcpCli(argv)` from `src/mcp/` and make both files 3-line shims —
exactly the existing `bin/am.ts` → `src/cli/index.ts:runCli` pattern.

### 2.5 Family union re-enumerated instead of importing `DiagramKind` — ordering already drifted

`src/mcp/facade.ts:10–11` writes the 12-family union out inline twice (with a
different member order than `types.ts:20`); `facade.ts:245` (`bodyKind`) and
`:392` (`narrowerFamily`) re-list all 12 at runtime; `src/cli/index.ts:494`
(`mutateAny`) repeats the same cascade including the fragile
`asState`-before-`asFlowchart` ordering rule. **Consolidation:** use
`DiagramKind` for the types; drive the runtime cascades from a single
family→narrower table (metadata already has `narrower`).

### 2.6 Two parallel parser stacks per family (design-level)

The agent `*-body.ts` parsers re-encode grammars that `src/<family>/parser.ts`
already owns — the files say so (`pie-body.ts:5` "mirrors the legacy renderer
parser"). `family-layouts.ts:54–81` then re-runs the legacy parsers on
`canonicalSource`, so every family is parsed by two independent parsers kept in
sync only by differential tests. A grammar change must land twice or the
surfaces silently diverge (one renders, the other falls to opaque).
**Consolidation (architectural, schedule separately):** build agent bodies as a
projection of the legacy parser's AST so the legacy parser is the single
grammar authority.

### 2.7 The canonical "minimal diagram per family" is authored in 5 places

`families.ts:131` `example`, `editor/js/examples.js:34`,
`website/build.ts:491` `COMPARISON_CASES`,
`__tests__/helpers/family-count-fixtures.ts:19`,
`__tests__/helpers/metamorphic-families.ts:46`. They already drift (`xychart`
vs `xychart-beta`, different node names). `website/build.ts:350` already reuses
`EDITOR_EXAMPLES` — the right pattern — but `COMPARISON_CASES` in the same file
hand-rolls a second set. **Consolidation:** make
`BUILTIN_FAMILY_METADATA[].example` canonical; derive `COMPARISON_CASES`; let
test fixtures layer counts on a shared base source.

---

## Tier 3 — mechanical de-duplication inside `src/agent/` and renderers

Cheap, high-confidence extractions (a shared `agent/body-utils.ts` covers most):

- **LABEL_OVERFLOW closure copied 6× byte-identically** (`journey-body.ts:274`,
  `architecture-body.ts:433`, `pie-body.ts:260`, `state-body.ts:559`,
  `xychart-body.ts:431`, `quadrant-body.ts:316`) plus 3 inline re-derivations
  in `verify.ts` (:194, :474, :417–426) and 9 copies of the
  `cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP` preamble; the seen-set
  dedup loop appears verbatim at `verify.ts:188–195` and `:468–475`.
- **serialize/mutate body-kind guards** re-typed inline for the 5 custom-parse
  families (`families-builtin.ts:98/196/623/695/857`) although
  `structuredFamilyHooks` (:39–63) already encapsulates them — split the helper
  so custom-parse families can reuse the guards.
- **id allocator** (`let n = 0; while (seen.has(\`${prefix}-${n}\`)) n++`)
  copied 5× (`journey-body.ts:128`, `gantt-body.ts:235`, `pie-body.ts:139`,
  `timeline-body.ts:151`, `xychart-body.ts:266`).
- **per-family mutators share one skeleton** — `set_title` is byte-identical in
  7 files; the add/remove/rename validation idiom drives 114
  `already exists`/`_NOT_FOUND` sites across 13 files; `pie-body.ts:170–253` ≡
  `quadrant-body.ts:212–309` nearly line-for-line. A generic collection-op
  helper (clone/find/allocate/entityName) collapses hundreds of lines.
- **source-map builders**: `buildClassSourceMap` (:255) ≡ `buildErSourceMap`
  (:296) structurally; `buildChartSourceMap`/`buildGanttSourceMap` repeat the
  same "findIndex(line ⊇ label) → loc" primitive.
- **`extractLabels` frame** (split/trim/skip-`%%`/push `line${i+1}`) repeated
  ~12×; a `forEachSourceLine` iterator shrinks each to its regex table.
- trivia: `formatNumber` ×3, `validLabel` ×3, `emptySourceMap` ×2.
- **FNV-1a hash re-rolled in 6 family renderers** instead of importing
  `seedFrom` (`scene/seed.ts:13`): `sequence/renderer.ts:630`,
  `er/renderer.ts:813`, `class/renderer.ts:661` (byte-identical trio),
  `timeline/renderer.ts:569`, `journey/renderer.ts:433`,
  `architecture/renderer.ts:622`. Add `hashId(...parts)` wrapping `seedFrom`.
- **`color-mix(in srgb, …)` strings hand-built 47×** across theme/architecture/
  journey/timeline/quadrant/xychart; promote timeline's local `mix()`
  (`timeline/renderer.ts:541`) to a shared `cssMix`.
- **channel mapping re-read by hand**: `render-family-hooks.ts:132` re-reads
  `themeVariables` keys that `color-resolver.ts:27` (`CHANNEL_THEME_KEYS`)
  already owns, and re-hardcodes the `DEFAULTS` literals (`theme.ts:74`);
  `ascii/ansi.ts:23` freezes hand-computed values instead of deriving via
  `diagramColorsToAsciiTheme(DEFAULTS)` 30 lines below.

---

## Tier 4 — repo, tooling, docs

### 4.1 Stryker configs: 21 near-identical files; 2 dead

All 21 share the same skeleton; only `mutate` globs, the `bun test` command,
and derived names vary. Verified: **`stryker.agent.config.json` and
`stryker.ser2.config.json` are referenced nowhere** (no npm script, no CI, no
docs) and overlap each other (`ser2` mutates a subset of `agent`) — delete.
`stryker.linkrank.config.json` is reachable only via a copy-paste command in
`docs/mutation-testing.md` — either add a `mutation-test:linkrank` script or
retire it. The ~16 family lanes are pure data (family → globs → tests) that
could be generated from the citizenship matrix that already lists them —
caveat: `diagram-family-citizenship.test.ts` and the matrix hard-code the
config **filenames**, so a generator must keep the on-disk names or update
both in lockstep.

### 4.2 Two parallel website pipelines (needs an owner decision)

`scripts/site/*` (`generate.ts`, 75 KB) builds root `public/` for **GitHub
Pages** (`pages.yml`, `build:site`, and `package.json` `homepage` still points
at `adewale.github.io`); `website/build.ts` (102 KB) builds `website/public/`
for **Cloudflare Workers** (`wrangler.jsonc`). Both independently assemble the
same `editor/` source, and each ships its own hand-ported copies of the color
helpers (1.4). If Cloudflare is the destination, the entire `scripts/site/`
pipeline + root `public/` + `pages.yml` can be retired; that is a live-deploy
decision, not a mechanical cleanup. Related: `website/public/` is a 7 MB
committed generated bundle (85 files, one 2.4 MB minified editor JS) that
re-churns on every `src/` change — intentional for Workers static assets and
gated by `website:check`, but worth confirming vs. building at deploy time.

### 4.3 `mockups/` — apparently superseded parallel mini-site

A self-contained earlier prototype of `website/` (parallel `home.html` /
`editor.html` / `docs-article.html` / galleries, duplicate agent surfaces
(`llms.txt`, `agent-manifest.json`), duplicate assets, ~35 `shot-*.png`).
Referenced only by four `research/*.md` notes — nothing in build/CI/tests.
Last touched 2026-07-02, so confirm it isn't an active design scratchpad
before archiving/deleting.

### 4.4 Dead scripts (zero references anywhere)

`scripts/architecture-fidelity.ts`, `scripts/theme-comparison.ts`,
`scripts/tufte-mocks.ts`, `scripts/site/new-diagrams.ts`,
`scripts/site/wrapper-fidelity.ts`, `scripts/site/gantt-evidence.ts` (~45 KB).
One-off PR-evidence generators whose outputs are already committed under
`docs/pr-assets/`. Git history preserves them; delete.

### 4.5 Naming and stale docs

- `eval/` (internal benchmarks, 20 subdirs, wired to `bench`/`track`/etc.) vs
  `evals/` (the published skill-eval manifest, shipped in `package.json`
  `files` — verified). **Not duplicates**; the near-identical names are the
  problem, plus `eval/shared/run-bench.ts` vs `eval/benchmark/run-bench.ts`
  (same filename, different code). Rename `evals/` → `skill-evals/` (touches
  ~15 references) or at least add "this is NOT …" README lines.
- `docs/pr11-reviewer-guide.md` self-declares obsolete ("PR #11 has merged");
  still linked from `docs/README.md` and `TODO.md`. Archive + fix the 2 links.

---

## Test-suite duplication

- `normalizeSvg` defined 5× identically (`architecture-svg-snapshot.test.ts:8`,
  `docs-architecture-diagram.test.ts:23`, `gantt-svg-snapshot.test.ts:14`,
  `journey-svg-snapshot.test.ts:11`, `xychart-svg-snapshot.test.ts:30`) with
  the same golden-compare body around it; three parallel golden mechanisms
  (ascii/unicode `.txt` runner — already shared and good; SVG JSON baseline
  with `UPDATE_SVG_BASELINE`; per-file `testdata/svg/*.svg`). Extract
  `helpers/svg-golden.ts` with `normalizeSvg` + `matchSvgGolden(name, actual)`.
- Trivial smoke diagrams re-inlined broadly (`A --> B` in ~70 files; the MCP
  warm-up string `flowchart LR\n A --> B` at `src/mcp/server.ts:217`); a small
  `helpers/sample-diagrams.ts` for the deliberate smoke inputs is enough — most
  inline literals are legitimately case-specific.
- `eval/shared/` is already clean (pure re-exports of `src/` helpers); keep it
  that way.

---

## Explicit non-findings (do NOT "consolidate" these)

- **`AGENT_NATIVE.md` / `Instructions_for_agents.md` / `llms.txt`** overlap by
  design and are **test-locked** by `agent-doc-sync.test.ts` (which also
  asserts `Instructions_for_agents.md` ≡ `am --agent-instructions`). Leave
  alone.
- **Scene backends** are already well-factored: `hybrid-backend.ts` is a
  one-liner over `createSketchBackend`; no repeated mark emission.
- **Text measurement/wrapping** is single-sourced (`text-metrics.ts`,
  `multiline-utils.ts`, `ascii/width.ts` sharing `shared/unicode-ranges.ts`);
  the SVG vs ASCII multi-line renderers target different media, justifiably.
- **`route-contracts.ts`** (2,768 lines) contains no per-shape/per-family
  duplication — shape handling is already set-membership-driven. Its issue is
  size (`applyRouteContracts` is one 857-line function — a readability
  decomposition, not a dedup).
- **`render-family-hooks.ts`** registry and the `bin/am.ts` → `runCli` shim
  pattern are the house style the fixes above should copy.
- `eval/` vs `evals/` are both live (see 4.5) — rename, don't merge.

---

## Suggested sequencing

1. **Mechanical, zero-behavior-change** (one PR each, small): escape helpers
   (1.3), FNV hash → `seedFrom`, id-allocator/`set_title`/overflow-closure
   utils (Tier 3), MCP bin shim (2.4), `DiagramKind` reuse (2.5), delete dead
   stryker configs + dead scripts (4.1, 4.4), `svg-golden` test helper.
2. **Behavior-affecting but bounded**: single-source `STYLE_DEFAULTS` (1.2 —
   decide per family whether layout or renderer had the intended value; class
   700-vs-500 needs a visual check), shared `svg-a11y` root builder (1.5 —
   adds missing pie/quadrant title/desc, goldens will change),
   `color-math.ts` (1.4 — pick one luminance threshold consciously),
   accessibility-directive parser (1.6 — pick one colon rule), verify-alias
   map from metadata (2.2 — fixes the quadrant misclassification).
3. **Structural**: shape-outline module (1.1), metadata-driven family dispatch
   (2.1), shared MCP tool descriptions (2.3), canonical family examples (2.7),
   stryker config generation (4.1).
4. **Owner decisions**: retire GitHub Pages pipeline vs Cloudflare (4.2),
   archive `mockups/` (4.3), rename `evals/` (4.5), agent-vs-legacy parser
   unification (2.6).

Every Tier 1/2 item should land with the repo's usual discipline: red→green
test (several items above — 1.2 class, 1.5 pie/quadrant, 2.2 quadrant — can
get a bug-discriminating test, not just a regression guard), `bun run website`
after `src/` changes, and the good-pr checklist.
