# Mathematical labels: why they matter and what other renderers actually did

Research only, 30 October 2026. The owner asked for an explanation and comparison,
not an implementation. No mathematical-label feature, dependency or resolver API
is added by this work.

## The actual requirement

Math labels are typesetting, not equation evaluation. A label containing `$$\frac{a}{b}$$` asks for a stacked fraction; a matrix asks for rows and columns with brackets; `$$x^2$$` asks for a superscript. They do not make the diagram calculate anything or add new graph relationships.

This matters most to educational, scientific and engineering diagrams and to products that already prompt an LLM to emit Mermaid with TeX labels. It is a compatibility requirement for those users, not proof that every Mermaid renderer needs it.

The strongest concrete evidence is [Pele issue #36](https://github.com/obsidianmd/pele/issues/36). Its reporter uses LLM-written diagrams in a product and wanted to migrate through `streamdown-pele`. Their existing prompt tells the model to use `$$...$$` because Mermaid supports it. Pele 1.7.0 preserved the expression but displayed TeX source instead of a formula, blocking that migration. The report supplies mixed prose/formula node labels and Sequence messages, not just a feature wish.

[Streamdown issue #150](https://github.com/vercel/streamdown/issues/150) supplies another real workflow: a step-by-step integration diagram. Its source has unquoted raw TeX and no `$$` delimiters. That distinction matters: some reported “math rendering” failures are malformed Mermaid input, not missing typesetting. A math engine alone cannot fix all LLM-generated diagrams.

The probes below show ordinary text output in Agentic Mermaid and its sibling forks, including normal label escapes that can alter TeX commands. The migration reports establish demand elsewhere; they do not establish demand among our users. This work remains explanation and comparison only.

## Beautiful Mermaid, Agentic Mermaid and Zombie Mermaid

### Versions and evidence

Public npm artifacts executed with Node 24.19.0:

- `beautiful-mermaid@1.1.3`; registry `gitHead` is `65f4e0ab8c289e9691a9e5bc4f9eac7108cf449b`. Source inspected independently at current main `2ac8bbbb060ca0a65a6a21f3200bd99b1587b488`.
- `zombie-mermaid@5.12.0`. Its registry metadata did not provide `gitHead`; source inspected independently at current main `507a2263b8cc181dff18dd61ddd95eeb15d7169c`. Do not claim those source snapshots identify the exact package build commit.
- Agentic Mermaid's locally packed `0.5.4` candidate from the preceding task, based on `83744a4e1ae5c9d3821ba8a283811367fd31eade`. A repeat of the fraction source through SVG, terminal and `verifyMermaid` on current source commit `354a9e97de5e125d2dec74fc2fd879b65bae8fb7` (package version `0.5.5`) gives the same raw TeX and verification result; see `current-agentic.json`. The historical tarball does not identify the current release version.

`consumer/probe.mjs` exercises twelve sources in SVG and terminal output for each project: **72 render attempts**. Full inputs, outcomes and SVG/text artifacts are in `results.json` and `output/`. PNG was also exercised through Agentic's agent entry and Zombie's installed CLI. Artifact identities are in `beautiful-package.json`, `zombie-package.json` and the consumer lock file. These are bounded examples, not every TeX command, family, platform or font.

### What happens in each situation

| Situation | Beautiful 1.1.3 | Agentic candidate 0.5.4 | Zombie 5.12.0 |
| --- | --- | --- | --- |
| `A["$$\frac{a}{b}$$"]` | Raw delimiters and TeX commands in SVG `<text>` and terminal cells; no fraction layout | Same | Same |
| Mixed prose: `Cost $$x^2$$ per request` | Ordinary label text; `^2` is not raised | Same | Same |
| Invalid command `$$\invalidMath{x}$$`, or unmatched `Cost $$x^2` | Renders text; no typesetter validation/error | Same | Same |
| Sequence message containing a fraction | Message includes raw TeX | Same | Same |
| Class member `$$x^2$$ value` | Raw math text, with ordinary class formatting (`value: $$x^2$$`) | Raw math text | Raw math text |
| Unicode `α + β = γ; x²` | Those Unicode characters remain in SVG/terminal text; font coverage is a separate question | Same | Same |
| `$$\nu + \nabla f$$` | Ordinary escaped-line-break handling consumes each `\n`: lines become `$$`, `u +`, `abla f$$` | Same | Same |
| Markdown-formatted label | Bold text works, math stays text; this package also leaves outer backticks visible in the tested label | Bold works, outer Markdown backticks removed; math stays text | Same as Agentic |
| Entire Markdown document passed to `renderMermaidSVG` | Invalid-header error | Unrecognized-header error | Invalid-header error |
| Incomplete streaming label `A["Cost $$x` | Returns a provisional node labeled `A` | Rejects incomplete flowchart syntax | Returns a provisional node labeled `A` |
| Completed streaming label | Full label appears as ordinary text, including `$$` | Same | Same |

“Raw TeX” therefore needs a qualification: these renderers do **not promise a verbatim TeX transport**. Their normal line-break, Markdown, class-member and family parsing rules still apply. The `\nu`/`\nabla` example is especially concrete: successful rendering does not establish preservation of formula meaning.

Agentic's `verifyMermaid` on the complete fraction example returns `ok: true`, no warnings and checks `{renderability: 'passed', sourceLoss: 'not-detected', taskCorrectness: 'not-checked'}` (`verify-result.json`). This establishes the existing rendering contract, **not** mathematical correctness or mathematical typesetting. No math-specific warning or implementation was added by this research.

### Why the source produces these results

Beautiful's [normalizer](https://github.com/lukilabs/beautiful-mermaid/blob/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488/src/multiline-utils.ts#L16) converts `\n`, HTML breaks and Markdown-lite emphasis; its [writer](https://github.com/lukilabs/beautiful-mermaid/blob/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488/src/multiline-utils.ts#L154) emits escaped `<text>` and `<tspan>`. Its [public dispatch](https://github.com/lukilabs/beautiful-mermaid/blob/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488/src/index.ts#L111) chooses diagram parsers/layout/writers, not a TeX renderer.

Zombie's [normalizer](https://github.com/dfadler/zombie-mermaid/blob/507a2263b8cc181dff18dd61ddd95eeb15d7169c/packages/core/src/multiline-utils.ts#L17) and [text writer](https://github.com/dfadler/zombie-mermaid/blob/507a2263b8cc181dff18dd61ddd95eeb15d7169c/packages/core/src/multiline-utils.ts#L271) follow the same text model, with additional entity/Markdown handling. No math span or typesetter was found in the inspected parser/core/renderer/config paths. Its [optional Inter subset loader](https://github.com/dfadler/zombie-mermaid/blob/507a2263b8cc181dff18dd61ddd95eeb15d7169c/packages/svg-renderer/src/embedded-font.ts#L9) embeds ordinary font data; embedding Inter does not turn TeX commands into mathematical layout.

Agentic's [normalizer](https://github.com/adewale/agentic-mermaid/blob/83744a4e1ae5c9d3821ba8a283811367fd31eade/src/multiline-utils.ts#L22) and [prepared display runs](https://github.com/adewale/agentic-mermaid/blob/83744a4e1ae5c9d3821ba8a283811367fd31eade/src/shared/display-text.ts#L143) own ordinary display interpretation. There is no math span/typesetter in this inspected path. The repository has a KaTeX **override** for its wider dependency graph; that is not a native math rendering feature or a runtime import in this pipeline.

### PNG and fonts

- Beautiful's checked package exposes SVG and terminal rendering, not a PNG renderer or CLI. A downstream rasterizer would rasterize its existing text SVG; it would not discover and typeset TeX by itself. No downstream Beautiful rasterizer was executed here.
- Agentic's public `renderMermaidPNG` is on `agentic-mermaid/agent` (not the root entry used for the SVG probe). It rasterizes the graphical projection through resvg with bundled/caller font selection. The fraction probe produced a 5,117-byte PNG, visually inspected: the node says `$$\frac{a}{b}$$`, not a fraction. Source: [PNG entry](https://github.com/adewale/agentic-mermaid/blob/83744a4e1ae5c9d3821ba8a283811367fd31eade/src/agent/png.ts#L143).
- Zombie's [CLI PNG adapter](https://github.com/dfadler/zombie-mermaid/blob/507a2263b8cc181dff18dd61ddd95eeb15d7169c/src/cli/png.ts#L19) uses its optional resvg dependency. The installed CLI produced a 2,217-byte PNG, visually inspected: it too shows the TeX text. This is a CLI capability, even though the root library exports no `renderMermaidPNG` function.

Unicode notation is a useful existing text capability, not a replacement for fractions, matrices, stretchy delimiters or mathematical alignment. Ordinary SVG fonts, embedded subsets, terminal glyph coverage and PNG fallback fonts affect which Unicode glyphs appear, but none of these three forks gains a math engine by choosing a font.

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

## Remaining projects in the comparison

This covers every additional repository in the upstream review, together with
Mermaid and Pele above. It is not a census of every Mermaid derivative.

### Independent/native and terminal renderers

| Project | What the author gets / capability boundary | Evidence and export limit |
|---|---|---|
| **mmdflux** | The inspected Flowchart path retains `$$x^2$$` as ordinary label text. Shape parsing strips surrounding quotes; the compiler normalizes line breaks; SVG writes escaped text. No formula object is produced in that path. | [Parser](https://github.com/kevinswiber/mmdflux/blob/bc202257ea75cd711b9cea57bd3513fd2ff08c91/src/mermaid/flowchart.rs#L827), [compiler](https://github.com/kevinswiber/mmdflux/blob/bc202257ea75cd711b9cea57bd3513fd2ff08c91/src/diagrams/flowchart/compiler.rs#L664), [SVG text](https://github.com/kevinswiber/mmdflux/blob/bc202257ea75cd711b9cea57bd3513fd2ff08c91/src/render/graph/svg/text.rs#L95). Source walk, not a compiled CLI run. This establishes that ordinary quoted label path, not every future renderer/backend. Text/ASCII output uses label strings rather than TeX geometry. |
| **Ondine** | Its inspected label model has styled text and icons, but no measured formula span or math resolver. `$$x^2$$` follows its ordinary text path. Being a Rust port of Pele does not automatically import Pele's newer math callback. | [Label model and text accumulation](https://github.com/wevm/ondine/blob/c8e8034c009bb6f987258e1c36045e080f46fde3/crates/compiler/src/text/label.rs#L12). Source observation; no independent native/PNG runtime test. Neither formula font coverage nor mathematical PNG/PDF export was established. |
| **Merman (Latias94)** | Explicit **math capability**, using pure-Rust RaTeX in its math-enabled native path. Required delimited formulas in typed diagrams fail with the existing missing-capability error if the chosen artifact lacks math, while family-specific literal behavior remains. A crate name or “SVG enabled” alone does not establish math support. | [Math abstraction](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/crates/merman-render/src/math.rs#L1), [ADR-0097](https://github.com/Latias94/merman/blob/4e9fa48139361bb30f81cb86d413597643978a4f/docs/adr/0097-explicit-math-capability.md). Source-built CLI defaults omit math; the official cli-release recipe selects it explicitly. Published v0.9.3 native SDK variants separate standard/math/full. The Merman section above records source/release evidence and documented paint failures. Native binaries and terminal formula behavior were not independently executed here. |
| **mermaid-rs-renderer (1jehuang)** | **Plain-text approximation**, not raw-literal-only and not a full formula engine: paired `$$...$$` is rewritten; `x^2` becomes `x²`, `\frac{a}{b}` becomes `(a)/(b)`, and `\sqrt{x}` becomes `√(x)`. Surrounding prose is retained. This is ordinary SVG text using glyphs in the selected fonts, not stacked fraction/radical geometry. | [Normalizer](https://github.com/1jehuang/mermaid-rs-renderer/blob/3726ccbffe0e8032361eb9668694b24f77858060/src/layout/text.rs#L169), [upstream actual-SVG fixture/assertions](https://github.com/1jehuang/mermaid-rs-renderer/blob/3726ccbffe0e8032361eb9668694b24f77858060/tests/visual_issue_suite.rs#L124). These are inspected source and authored test expectations, **not a test rerun**. Unknown commands lose their backslash; braces are dropped; `\cdot` is explicitly discarded. An unmatched `$$` opener is retained. Thus “readable approximation” can alter meaning and is not TeX validation. |
| **Mermaid ASCII (AlexanderGrooff)** | Its inspected quoted Flowchart label path keeps mathematical source as cell text. `$$` is not a typesetting switch. Label normalization recognizes `<br>` and literal `\n`, then measures string cell width and paints those strings. | [Label normalization](https://github.com/AlexanderGrooff/mermaid-ascii/blob/5a9df1560871e1ef8037c052b3b5d87de503bc9e/pkg/graph/label.go#L20), [cell emission](https://github.com/AlexanderGrooff/mermaid-ascii/blob/5a9df1560871e1ef8037c052b3b5d87de503bc9e/pkg/graph/draw.go#L330). Source walk only. No formula layout or mathematical SVG/PNG export is claimed; its HTML style output remains terminal-art text. |
| **Termaid** | **Independently executed:** `$$x^2$$`, mixed `cost $$\frac{a}{b}$$ units`, invalid `$$\unknown{z}$$` and unfinished `$$x^2` all appear literally in the rendered node, in both Unicode and ASCII modes. There is no TeX parse error for these well-formed quoted Mermaid labels. | Public `termaid.render` from [source version 0.10.0](https://github.com/fasouto/termaid/blob/78a6f312c4ffeda8b1e20be3887a4f2be1ebf026/src/termaid/__init__.py#L170); [actual label painter](https://github.com/fasouto/termaid/blob/78a6f312c4ffeda8b1e20be3887a4f2be1ebf026/src/termaid/renderer/shapes/__init__.py#L386). Eight runtime cases saved in `termaid-results.json`. This checks terminal output; it does not claim a PNG/PDF math surface. |

### Integrations: the wrapped engine and host still decide

| Project | Mathematical labels inside a Mermaid diagram | Configuration/output distinction |
|---|---|---|
| **Streamdown** | Its default `@streamdown/mermaid` plugin calls Mermaid's `initialize` and `render`; therefore diagram formulas take the installed Mermaid version's browser math path. The inspected plugin dependency is `mermaid ^11.16.1`, not the Mermaid 12.2 source pinned by Agentic's syntax policy. | [Diagram plugin](https://github.com/vercel/streamdown/blob/7dcabc64df944edce6f3993732667652e6214af0/packages/streamdown-mermaid/index.ts#L35), [dependency](https://github.com/vercel/streamdown/blob/7dcabc64df944edce6f3993732667652e6214af0/packages/streamdown-mermaid/package.json#L32). Its separate [`@streamdown/math`](https://github.com/vercel/streamdown/blob/7dcabc64df944edce6f3993732667652e6214af0/packages/streamdown-math/index.ts#L44) uses remark-math/rehype-KaTeX for **Markdown outside code fences**. Supplying that plugin does not typeset raw TeX inside another diagram engine. These integrations were not independently browser-executed here. |
| **streamdown-pele** | The default wrapper delegates to `pele/lazy` and supplies no math resolver. Its checked-in lock selects **Pele 1.6.0**, so that locked build predates Pele's math API. | [Forwarding](https://github.com/farnabaz/streamdown-pele/blob/72b8ad6cc003f6d37397cfbed9004751f882d888/src/index.ts#L55), [lock](https://github.com/farnabaz/streamdown-pele/blob/72b8ad6cc003f6d37397cfbed9004751f882d888/pnpm-lock.yaml#L169). The package range `^1.6.0` can resolve a newer Pele; because the wrapper forwards `renderOptions`, a consumer using a math-capable Pele version can supply its measured resolver. **Capability is conditional on the installed Pele version and host callback**, not supplied by the wrapper's name or Streamdown's Markdown math plugin. No runtime test of that configuration here. |
| **Mermaid to Excalidraw** | Current source uses Pele **1.8.0**, but its adapter's `getRenderOptions` supplies no math resolver. Converted Flowchart labels are decoded into plain Excalidraw text. Pele having a math API does not make those labels formula elements. | [Render options](https://github.com/excalidraw/mermaid-to-excalidraw/blob/0180c98740333987eb6729a658f48b8e89efa8cf/src/pele/parsePele.ts#L112), [Flowchart label conversion](https://github.com/excalidraw/mermaid-to-excalidraw/blob/0180c98740333987eb6729a658f48b8e89efa8cf/src/pele/flowchart.ts#L104), [text decoding](https://github.com/excalidraw/mermaid-to-excalidraw/blob/0180c98740333987eb6729a658f48b8e89efa8cf/src/text.ts#L28), [dependency](https://github.com/excalidraw/mermaid-to-excalidraw/blob/0180c98740333987eb6729a658f48b8e89efa8cf/package.json#L28). Source observation; actual Excalidraw canvas/image export was not executed. Nonconverted families are Pele-produced images using the same resolver-free options. |
| **Mermaid CLI** | Browser wrapper around Mermaid, so supported-family formulas use Mermaid's KaTeX/MathML behavior rather than an independent math implementation. | [Dependencies](https://github.com/mermaid-js/mermaid-cli/blob/7998e38ef5986e301d7350e323cbc7d0bb2a9460/package.json#L31) specify Mermaid `^12.2.0` and KaTeX. The CLI explicitly [loads KaTeX CSS](https://github.com/mermaid-js/mermaid-cli/blob/7998e38ef5986e301d7350e323cbc7d0bb2a9460/src/index.js#L637); PNG uses browser screenshots, PDF browser printing, while SVG preserves the rendered markup. This avoids a separate native formula rasterizer but does not prove every external SVG viewer preserves foreignObject/MathML/fonts. No export rerun here. |
| **Mermaid Live Editor** | Its render utility initializes and calls Mermaid (`^12.2.0` dependency), so supported formulas use Mermaid's implementation and configured browser support. It does not add a different formula engine. | [Render utility](https://github.com/mermaid-js/mermaid-live-editor/blob/b54ef0beb3b80115dc08b56da5862fdf7c74e484/src/lib/util/mermaid.ts#L11), [dependency](https://github.com/mermaid-js/mermaid-live-editor/blob/b54ef0beb3b80115dc08b56da5862fdf7c74e484/package.json#L109). Its [canvas export](https://github.com/mermaid-js/mermaid-live-editor/blob/b54ef0beb3b80115dc08b56da5862fdf7c74e484/src/lib/components/Actions.svelte#L145) reloads SVG as an image before drawing. A correct live formula view alone does not prove a PNG export or reopened standalone SVG; those were not exercised here. |
| **Mermaid MCP Server (peng-shawn)** | Uses an installed Mermaid browser bundle (`^12.2.0`) in Puppeteer, with `securityLevel:'strict'`, then calls `mermaid.render`. Supported formulas therefore depend on Mermaid/browser MathML behavior. | [Initialization and render](https://github.com/peng-shawn/mermaid-mcp-server/blob/06cf82c26388e6ebd21bcc4dff5dfb87809a5744/index.ts#L306), [SVG and screenshot branches](https://github.com/peng-shawn/mermaid-mcp-server/blob/06cf82c26388e6ebd21bcc4dff5dfb87809a5744/index.ts#L372). Unlike the CLI CSS loader, no KaTeX stylesheet setup was found in the inspected server template/render path. No blanket legacy-HTML fallback or standalone SVG portability claim follows. This is source inspection, not an MCP/browser rerun. |

## What we should understand, without building anything

There are at least three legitimate policies: browser-owned KaTeX/MathML (Mermaid), host-supplied measured markup with literal fallback (Pele), and explicit native math capabilities with errors for missing support (Merman). They solve different distribution and output problems.

The important questions are therefore concrete: which users already author formulas, which label roles they need, whether their formulas must survive PNG/PDF and terminal export, who supplies fonts and measurements, which markup can be trusted, and how a missing capability is communicated. Literal TeX output is a clear product boundary; silently missing formula geometry is a correctness failure. A report that a renderer accepts `$$...$$` does not settle either question.

For this project the research result is an explanation and comparison only. **No math feature, dependency, resolver API, fallback mechanism or implementation backlog item has been introduced.**

## Evidence boundaries

Read-only GitHub source snapshots, issue/PR/release metadata and package artifacts were inspected. The Beautiful/Agentic/Zombie probe made 72 public SVG/terminal render attempts; Agentic and Zombie PNGs were also generated and inspected. Agentic's fraction render and verification were repeated on the rebased source. Termaid's public renderer passed eight ASCII/Unicode cases. Those runtime observations are distinct from the source walks and upstream-authored test expectations marked in the tables. No native math engine or browser math export was independently run here.

Raw probes, artifacts and package identities accompany the PR evidence. The downloaded Pele tarball's declarations and registry integrity establish artifact identity/API presence, not visual correctness. Font coverage, every diagram family, real streaming sessions and arbitrary TeX are outside these bounded probes.

`kitlangton/merman` is a different project from Latias94/Merman. `pgavlin/mermaid-ascii`, `toeverything/mermaid-rs-renderer` and `Dicklesworthstone/frankenmermaid` appeared during preliminary discovery but were not among the inventoried repositories. Their math implementations have not been classified by this review.
