# Mathematical labels: why they matter and what other renderers actually did

Research only, 30 October 2026. The owner asked for an explanation and comparison,
not an implementation. No mathematical-label feature, dependency or resolver API
is added by this work.

## The actual requirement

Math labels are typesetting, not equation evaluation. A label containing `$$\frac{a}{b}$$` asks for a stacked fraction; a matrix asks for rows and columns with brackets; `$$x^2$$` asks for a superscript. They do not make the diagram calculate anything or add new graph relationships.

This matters most to educational, scientific and engineering diagrams and to products that already prompt an LLM to emit Mermaid with TeX labels. It is a compatibility requirement for those users, not proof that every Mermaid renderer needs it.

The strongest concrete evidence is [Pele issue #36](https://github.com/obsidianmd/pele/issues/36). Its reporter uses LLM-written diagrams in a product and wanted to migrate through `streamdown-pele`. Their existing prompt tells the model to use `$$...$$` because Mermaid supports it. Pele 1.7.0 preserved the expression but displayed TeX source instead of a formula, blocking that migration. The report supplies mixed prose/formula node labels and Sequence messages, not just a feature wish.

[Streamdown issue #150](https://github.com/vercel/streamdown/issues/150) supplies another real workflow: a step-by-step integration diagram. Its source has unquoted raw TeX and no `$$` delimiters. That distinction matters: some reported “math rendering” failures are malformed Mermaid input, not missing typesetting. A math engine alone cannot fix all LLM-generated diagrams.

For Agentic Mermaid, the existing scan demonstrates literal source output. That preserves the author's formula text but does not provide typesetting. These reports establish demand elsewhere; they do not establish demand among our users. The owner's decision remains: understand the capability, do not implement it.

## Mermaid: a browser/MathML choice, not a generic math-to-SVG engine

The inspected source is our pinned Mermaid 12.2.0 revision `1fb7869866dd619168d840291c9c54b4f129758b`.

- **Public syntax and scope:** [math documentation](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/config/math.md) dates support to 10.9.0 and lists Flowchart and Sequence. Examples cover Flowchart node/edge labels and Sequence participant names, messages and notes. It is not a public promise that every Mermaid diagram family supports mathematical labels.
- **Typesetter:** [`common.ts`](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/diagrams/common/common.ts#L291) detects `$$...$$`, dynamically imports KaTeX and calls `renderToString` with `throwOnError: true`, `displayMode: true` and an output mode. The package declares KaTeX as a dependency; lazy execution does not make the installed dependency absent.
- **Default output:** MathML. Browser support is tested with `window.MathMLElement`, which the source itself labels an imperfect support check. If unavailable and no fallback is configured, formula text is replaced by an explanatory message.
- **Legacy configuration:** `legacyMathML` permits KaTeX HTML/CSS output when browser MathML support is unavailable. `forceLegacyMathML` forces that path for more consistent typography. The host must supply matching KaTeX stylesheets; Mermaid does not bundle them. The docs explicitly warn of OS/browser differences in native MathML rendering.
- **SVG packaging and measurement:** formulas are HTML/MathML inside SVG `foreignObject`, not necessarily paths. [`createText.ts`](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/rendering-util/createText.ts#L48) creates the HTML label. [Sequence's `drawKatex`](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/diagrams/sequence/svgDraw.js#L150) creates a `foreignObject`, measures its div using the browser and positions it around the message or note. The common dimension helper temporarily inserts MathML into the document body and reads its dimensions.
- **Security:** Mermaid sanitizes generated markup through its DOMPurify path. The inspected KaTeX call does not enable `trust`; it relies on library defaults. However, the host cannot forward its own KaTeX limits through these fixed options. [Issue #8533](https://github.com/mermaid-js/mermaid/issues/8533) asks for `maxSize`, `maxExpand`, `trust` and error-policy configuration. The reporter measured a `\rule{1000em}{1em}` label creating an approximately 16,320-unit-wide Sequence diagram. I did not independently reproduce those dimensions.
- **Small bundle policy:** the same source explicitly substitutes “KaTeX is not supported in @mermaid-js/tiny” when the build omits large features. This is a deliberate capability boundary in Mermaid's own products.

There are costs beyond adding a delimiter parser. [Issue #8340](https://github.com/mermaid-js/mermaid/issues/8340) shows a label that normally wraps becoming a single long line when it contains a formula. The inspected implementation explicitly uses a `white-space: nowrap` flex row for such a line. Other open reports concern line breaks, Markdown interaction and multiple formulas; their older-version reports are not independently verified current failures in this research.

## Pele: the host owns the typesetter

[PR #45](https://github.com/obsidianmd/pele/pull/45) merged on 20 October. The inspected current source is `36e584d59152181927e0d8bf70fddcd2a5f33d6c`. npm latest is 1.12.0; the independently downloaded `pele@1.12.0` tarball contains the public `MathResolver`, `MathMarkup` and `RenderOptions.math` types. This confirms published API presence, not independently verified cross-browser rendering.

Its approach is different from Mermaid's:

- [`MathResolver`](https://github.com/obsidianmd/pele/blob/36e584d59152181927e0d8bf70fddcd2a5f33d6c/src/types.ts#L7) is a synchronous callback `(tex, fontSize)` returning either SVG or HTML plus width and height. Pele bundles no runtime math typesetter dependency.
- [`math.ts`](https://github.com/obsidianmd/pele/blob/36e584d59152181927e0d8bf70fddcd2a5f33d6c/src/text/math.ts) caches each `(font size, TeX)` within a render, validates finite positive dimensions and restores the previous resolver/cache after nested rendering.
- Its label model stores measured formula spans. The formula is not split during wrapping, and a tall formula increases its line's height. Mixed prose and formulas continue through the surrounding label layout. Missing resolver or declined markup falls back to literal `$$...$$` text.
- The PR covers Flowchart, Swimlane, Sequence, State, Class, ER, Mindmap, Kanban, Block, Requirement and Use Case. Diagram titles and Class members remain text. This is broader declared family scope than Mermaid's public math page, not evidence of identical layout.
- [The playground](https://github.com/obsidianmd/pele/blob/36e584d59152181927e0d8bf70fddcd2a5f33d6c/website/src/scripts/playground-math.ts) lazy-loads Temml and its CSS only after finding `$$`. It writes MathML into a hidden DOM probe, reads `getBoundingClientRect()` and returns the markup and dimensions. Thus the browser playground's measurement choice is distinct from the library's browserless callback contract.
- [Security documentation](https://github.com/obsidianmd/pele/blob/36e584d59152181927e0d8bf70fddcd2a5f33d6c/website/src/content/docs/security.md#app-responsibilities) explicitly delegates markup safety to the host: Pele inserts returned math markup without filtering. It recommends KaTeX's default `trust: false` or MathJax's safe extension. HTML math uses `foreignObject`; hosts whose sanitizers remove that element should use SVG-producing typesetters.

That design avoids choosing one math runtime for every consumer, but moves dimension accuracy, markup trust, CSS and font availability into the host's contract. A “zero dependency renderer” can still require substantial host machinery for math.

## Merman: explicit native capability, with separate output contracts

The inspected development source is `4e9fa48139361bb30f81cb86d413597643978a4f`. [`math.rs`](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/crates/merman-render/src/math.rs) uses the optional pure-Rust **RaTeX** backend; the Cargo math feature includes parser/layout/SVG/font dependencies and embedded fonts. This is not the same mechanism as Mermaid's browser KaTeX path.

[ADR-0097](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/docs/adr/0097-explicit-math-capability.md) treats math as an explicit capability. Diagram-family or SVG/layout selection must not pull it in indirectly. When mathematical output is required but unavailable, typed diagrams use the missing-capability error instead of a new network, JavaScript or literal-output fallback, while preserving family-specific literal behavior.

This is not merely an unshipped proposal. [Version 0.9.3](https://github.com/Latias94/merman/releases/tag/v0.9.3), published on 30 October 2026 at 05:30 UTC, documents native C and WASI SDK variants: `standard` without formulas or ELK, `math` with formulas and no ELK, and `full` with both. Its release notes also report repairs for missing/clipped formula glyphs and fraction bars in native PNG/JPEG/PDF. I inspected release metadata and source, not those native binaries' runtime behavior.

The recent [paint ownership report](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/docs/research/2026-10-27-math-paint.md) and [adversarial review](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/docs/research/2026-10-27-math-review.md) are especially instructive:

- Its older released CLI could drop formula geometry when native export removed `foreignObject`.
- A later browser-shaped implementation preserved geometry but diagram CSS could turn formula glyphs into solid blocks.
- Tall fractions, CJK fallback glyphs, emoji bitmaps and `\smash` could extend beyond nominal formula dimensions.
- An output receipt or markup comparison could pass while a formula was invisible. Their revised evidence checks required actual visible pixel contribution and independently compared bounds.
- Some mixed prose/formula native support remains explicitly bounded; a missing-metrics glyph does not acquire trustworthy dimensions just because its SVG exists.

These are the project's documented findings, not an independent rerun here. They show why “supports math” must be qualified by output backend, capability recipe, fonts and current release.

## Ondine and Streamdown: two different kinds of boundary

At Ondine revision `c8e8034c009bb6f987258e1c36045e080f46fde3`, the inspected [label model](https://github.com/wevm/ondine/blob/c8e8034c009bb6f987258e1c36045e080f46fde3/crates/compiler/src/text/label.rs) is a Rust port of Pele's text layout with text and icon spans. No dedicated math span, resolver, `$$` handling or typesetter dependency was found in the inspected label/compiler/config paths. I found no math issue in its GitHub search, and no GitHub release metadata was available. This is a source-level negative observation, not a runtime proof, a deliberate omission documented by its owner, or a blanket compatibility judgment.

Streamdown is a host integration, not another math diagram engine. Its [plugin-size discussion #319](https://github.com/vercel/streamdown/issues/319) shows users objecting to paying for Mermaid and KaTeX when unused. Its [streaming math report #601](https://github.com/vercel/streamdown/issues/601) concerns Markdown math rather than diagram math: the final string renders correctly once, but incremental token updates reportedly corrupt markup. It is useful as a lesson about host lifecycle and plugin interaction, not evidence of a Mermaid diagram bug. A host's standalone math plugin/configuration also does not automatically control KaTeX calls hidden inside Mermaid.

## What we should understand, without building anything

There are at least three legitimate policies: browser-owned KaTeX/MathML (Mermaid), host-supplied measured markup with literal fallback (Pele), and explicit native math capabilities with errors for missing support (Merman). They solve different distribution and output problems.

The important questions are therefore concrete: which users already author formulas, which label roles they need, whether their formulas must survive PNG/PDF and terminal export, who supplies fonts and measurements, which markup can be trusted, and how a missing capability is communicated. Literal TeX output is a clear product boundary; silently missing formula geometry is a correctness failure. A report that a renderer accepts `$$...$$` does not settle either question.

For this project the research result is an explanation and comparison only. **No math feature, dependency, resolver API, fallback mechanism or implementation backlog item has been introduced.**

## Evidence boundaries

Read-only GitHub API source snapshots, issue/PR/release metadata and an npm tarball were inspected. Upstream code was not executed. No browser or native math renderer was installed or benchmarked. The downloaded Pele tarball's declaration evidence and registry integrity are retained in the session's research artifacts; this proves artifact identity/API presence, not cryptographic provenance verification or visual correctness.
