# Journey Usage Research

Status: research note
Last checked: 2026-07-09

This note captures online research into how people use Journey diagrams and what
users have asked for in Mermaid, Mermaid ASCII, and Beautiful Mermaid issue/PR
history. It is a companion to `journey-migration-parity.md`.

## Research Method

Sources inspected:

- Mermaid's official User Journey syntax docs.
- Mermaid's current `JourneyDiagramConfig` type on `develop`.
- UX/customer-journey-mapping guidance from Nielsen Norman Group, Atlassian, and
  Interaction Design Foundation.
- Mermaid open and closed issues/PRs around Journey diagrams.
- Mermaid ASCII open and closed issues/PRs.
- Beautiful Mermaid open and closed issues/PRs.
- Agentic Mermaid open and closed Journey-related issues/PRs.
- Public GitHub code search for Mermaid `journey` blocks and prompt/contracts
  that require them.

The 2026-07-09 pass used GitHub issue/PR search for `journey` in
`mermaid-js/mermaid`, the full open/closed issue and PR lists for
  `lukilabs/beautiful-mermaid`, and the Agentic Mermaid issue/PR list. A follow-up
direct-fork pass used GitHub's forks API sorted by stargazers, then searched the
ranked head of each direct-fork set for Journey issue/PR/code signal. The
reusable helper is `scripts/research/fork-journey-crawl.ts`.

This is not a complete corpus study. GitHub code search is especially noisy:
many results are copied Mermaid documentation examples, prompt templates, or
references to "journey" outside Mermaid syntax. The conclusions below focus on
repeated signals across sources.

## Executive Summary

People use journey maps to communicate a user's experience through stages, not
just to list tasks. In UX practice, a journey map commonly includes persona,
scenario, phases, actions, thoughts, emotions, touchpoints, pain points,
opportunities, and ownership. Mermaid's `journey` diagram intentionally models a
small subset of that: sections, scored tasks, and actors.

For Mermaid `journey` specifically, public issue/PR demand is mostly about
rendering fidelity and migration reliability:

- text must not clip,
- long actor labels must wrap,
- margins and viewBox bounds must be tight,
- section bands must span the correct tasks,
- score values must stay within valid bounds,
- title, legend, section, task, actor, and score styling must be configurable,
- `accTitle` and `accDescr` must work,
- config/frontmatter/directives must follow Mermaid's standard pattern.

There is little evidence that users want a radically richer Journey grammar in
Mermaid itself. There is evidence that they expect Mermaid-compatible syntax,
stable classic layout behavior, and enough configurability to embed diagrams in
docs, editors, mobile views, and generated artifacts.

For ASCII renderers, the demand signal is broader than Journey: users want real
Mermaid documents to render in terminals, with graceful handling for unsupported
constructs, multiline labels, width control, and international text. There is no
strong public Mermaid ASCII Journey-specific request yet, so Journey ASCII should
prioritize semantic readability and width correctness over visual mimicry.

## UX Practice: What Journey Maps Usually Contain

Nielsen Norman Group describes journey mapping as first creating a timeline of
user goals and actions, then adding user thoughts and emotions to build a
narrative that can be visualized for design work. Its deconstruction calls out a
lens of persona and scenario, chunkable phases, actions, thoughts, emotional
experience, insights, pain points, opportunities, and ownership. It also says
journey maps can help break organizational silos, assign ownership of
touchpoints, and understand quantitative data in context.

Source:
https://www.nngroup.com/articles/customer-journey-mapping/

Atlassian's playbook treats journey mapping as a collaborative workshop. It
starts with persona back-story, goals, pain points, requested features, and
outcomes; then maps pain points under touchpoints and asks whether each pain
point is trivial, requires a workaround, or causes abandonment. It explicitly
supports current-state and future-state maps.

Source:
https://www.atlassian.com/team-playbook/plays/customer-journey-mapping

Interaction Design Foundation emphasizes that journey maps often over-emphasize
actions and touchpoints while missing the emotional journey. It suggests adding
quotes, symbols, or graphs to represent emotional highs and lows.

Source:
https://www.interaction-design.org/literature/topics/customer-journey-map

Implication for Agentic Mermaid:

- Mermaid Journey should not be over-sold as a full UX journey-map canvas.
- Scores are the only built-in emotional/satisfaction proxy.
- Richer UX concepts should be future extensions, not blockers for Mermaid
  migration parity.

## Mermaid Journey Syntax: Small, Stable Model

Mermaid's official docs define User Journey diagrams as high-detail steps that
different users take to complete a task, showing current workflow and areas for
improvement. The docs say each journey is split into sections, and task syntax is:

```text
Task name: <score>: <comma separated list of actors>
```

The score is documented as a number from 1 through 5 inclusive.

Source:
https://mermaid.js.org/syntax/userJourney.html

Implication for Agentic Mermaid:

- The parser should enforce or diagnose the 1..5 score contract.
- The core model should remain title, sections, tasks, score, actors, and
  accessibility metadata.
- Custom score ranges are a feature request, not baseline Mermaid parity.

## Public GitHub Usage Patterns

Public code search found a thin but useful signal:

- Many public `journey` examples are exact copies or small variants of Mermaid's
  own "working day" example.
- Several repositories use prompt contracts that require generated PRD/user
  journey documents to include renderable Mermaid `journey` blocks.
- A11y-oriented tooling parses Journey diagrams into narrative descriptions.
- Obsidian/Excalidraw-style notes embed Mermaid Journey text as stored diagram
  content.

Examples:

- Prompt contract requiring at least two renderable visual user journeys:
  https://github.com/AcredIA-UMSS/sigesa-docs/blob/2c12a4409129f28d0b17ad6b98d74edb3fe635d7/docs/06_prompt_contracts/contract_sdlc_03_generador_prd.md
- Scenario docs suggesting Mermaid Journey for key end-to-end flows:
  https://github.com/johanolofsson72/juradrop/blob/626e0a670d89155acb2db469bbc5377da13305ca/.claude/rules/scenarios.md
- Accessibility studio notes for extracting Journey title, sections, and steps:
  https://github.com/mgifford/a11y-mermaid-studio/blob/64af9e42d527708e8603fd7840683e737e1dbb85/NARRATIVE_ENHANCEMENT.md
- Mermaid docs copy stored in another project:
  https://github.com/notnotdurgesh/GodChat/blob/8dff2216c5594c85b94023e125427a3a65e7b7e6/backend/MermaidDocs/SyntaxDocs/userJourney.md

Implication for Agentic Mermaid:

- Journey support will see agent-generated inputs, copied examples, and docs
  embeds.
- Tolerant parsing, diagnostics, and accessibility metadata matter.
- We should expect long labels and non-English text because PRD/user-flow
  documents are often prose-heavy.

## Mermaid Issue and PR Demand

Mermaid's Journey issue history is concentrated around the classic renderer's
layout, theming, and parser/config integration.

| Item | State | Signal |
|---|---:|---|
| Mermaid PR #1334, "Feature/user journey" | merged | Original Journey implementation. |
| Mermaid issue #1903 / PR #1916 | closed/merged | Journey needed Mermaid's standard config/directive pattern. |
| Mermaid issue #1966 / PR #1967 | closed/merged | Right margin grew with section count. |
| Mermaid issue #2132 / PR #2133 | closed/merged | Users wanted theme variables for section, task, actors, and score indicator. |
| Mermaid PR #2919 | merged | Added accessible title and description to User Journey. |
| Mermaid issue #3501 | open | Too much bottom whitespace, especially visible on mobile. |
| Mermaid issue #3508 / PR #6225 | closed/merged | Users wanted Journey title color, font family, and font size config. |
| Mermaid issue #4224 / PR #4074 | closed/merged | Section label should span all tasks in the section. |
| Mermaid issue #4248 | open | Request for custom Journey score scale. |
| Mermaid issue #6243 / PRs #6246, #6248 | open/open/closed | Long task text clips; boxes should resize and SVG bounds should update. |
| Mermaid issue #6262 / PR #6263 | open/closed | Invalid high score values move faces out of bounds; users expect validation or clamping. |
| Mermaid PR #6229 | merged | Legend font family should be configurable. |
| Mermaid PR #6274 | merged | Long actor legend labels overlap diagram; added wrapping and `maxLabelWidth`. |
| Mermaid issue #5741 / PR #7410 | open/merged | Duplicate SVG marker/element IDs affect Journey when multiple diagrams share a page. |
| Mermaid issue #6013 | closed | Journey PNG export lost fonts in Firefox. |
| Mermaid issue #7105 / PR #7110 | open/open | Journey titles containing `#` or entity-like text were truncated; title/acc text parsing must preserve literal text. |

Sources:

- https://github.com/mermaid-js/mermaid/pull/1334
- https://github.com/mermaid-js/mermaid/issues/1903
- https://github.com/mermaid-js/mermaid/pull/1916
- https://github.com/mermaid-js/mermaid/issues/1966
- https://github.com/mermaid-js/mermaid/pull/1967
- https://github.com/mermaid-js/mermaid/issues/2132
- https://github.com/mermaid-js/mermaid/pull/2133
- https://github.com/mermaid-js/mermaid/pull/2919
- https://github.com/mermaid-js/mermaid/issues/3501
- https://github.com/mermaid-js/mermaid/issues/3508
- https://github.com/mermaid-js/mermaid/pull/6225
- https://github.com/mermaid-js/mermaid/issues/4224
- https://github.com/mermaid-js/mermaid/pull/4074
- https://github.com/mermaid-js/mermaid/issues/4248
- https://github.com/mermaid-js/mermaid/issues/6243
- https://github.com/mermaid-js/mermaid/pull/6246
- https://github.com/mermaid-js/mermaid/pull/6248
- https://github.com/mermaid-js/mermaid/issues/6262
- https://github.com/mermaid-js/mermaid/pull/6263
- https://github.com/mermaid-js/mermaid/pull/6229
- https://github.com/mermaid-js/mermaid/pull/6274
- https://github.com/mermaid-js/mermaid/issues/5741
- https://github.com/mermaid-js/mermaid/pull/7410
- https://github.com/mermaid-js/mermaid/issues/6013
- https://github.com/mermaid-js/mermaid/issues/7105
- https://github.com/mermaid-js/mermaid/pull/7110

Implication for Agentic Mermaid:

- A Mermaid-classic Journey mode is justified if migration parity matters.
- That mode must include the actor legend, section spans, score-positioned
  sentiment markers, and progression baseline.
- Text measurement and wrapping are not cosmetic; they are recurring user
  complaints.
- Score validation must be explicit.
- Theme/config support must include Journey-specific knobs, not only generic
  node/group styles.
- SVG IDs must be namespaced per render so multiple Journey diagrams can share a
  page without marker collisions.
- Literal title/accessibility text should not be narrowed more strictly than
  Mermaid itself; `#`, entities, and punctuation are content unless the grammar
  says otherwise.

## Mermaid ASCII Issue and PR Demand

Mermaid ASCII has no public Journey-specific issue or PR signal in the inspected
set. Its demand is about rendering real Mermaid documents in terminals.

Important items:

| Item | State | Signal |
|---|---:|---|
| Mermaid ASCII issue #74 | open | A company tested about 590 real RFC diagrams; only about 32% rendered. Goal is broad real-world coverage. |
| Mermaid ASCII issue #61 | open | Requests stateDiagram-v2 support because it is common in technical specs. |
| Mermaid ASCII issue #62 | open | Requests sequence notes because a single unsupported note aborts rendering. |
| Mermaid ASCII PR #47 | open | Adds multiline labels and `--maxWidth`/fitting; discussion says multiline labels are critical for everyday usage. |
| Mermaid ASCII issue #59 | open | International text renders incorrectly. |

Sources:

- https://github.com/AlexanderGrooff/mermaid-ascii/issues/74
- https://github.com/AlexanderGrooff/mermaid-ascii/issues/61
- https://github.com/AlexanderGrooff/mermaid-ascii/issues/62
- https://github.com/AlexanderGrooff/mermaid-ascii/pull/47
- https://github.com/AlexanderGrooff/mermaid-ascii/issues/59

Implication for Agentic Mermaid:

- Journey ASCII does not need to imitate Mermaid's SVG face/axis renderer in P0.
- It does need to preserve section/task/score/actor semantics.
- It should honor `maxWidth`, multiline labels, and display-width correctness.
- Unsupported Journey syntax should not silently abort or become useless without
  explanation.

## Beautiful Mermaid Issue and PR Demand

Beautiful Mermaid's public Journey-specific issue signal is weak. The notable
Journey PRs were closed as wrong-repo attempts:

- https://github.com/lukilabs/beautiful-mermaid/pull/62
- https://github.com/lukilabs/beautiful-mermaid/pull/72
- https://github.com/lukilabs/beautiful-mermaid/pull/75

Those PRs are useful as implementation-history signals because they attempted to
add Journey parser, layout, SVG renderer, ASCII renderer, tests, docs, source
preprocessing, frontmatter/config handling, and accessibility directives. They
are not strong evidence of external user demand because they were not accepted
feature requests in that repository.

The stronger Beautiful Mermaid signals are broader:

| Item | State | Signal |
|---|---:|---|
| Beautiful Mermaid issue #2 | open | Users ask whether syntax is 1:1 with Mermaid and whether original grammars are reused. |
| Beautiful Mermaid issue #59 | open | Users ask for all Mermaid v11 diagrams. |
| Beautiful Mermaid issue #79 | open | Users ask for Mermaid frontmatter/config support. |
| Beautiful Mermaid issue #86 | open | Users request timeline support for education. This is adjacent to Journey because timeline/Journey are often added together. |
| Beautiful Mermaid issue #122 / PR #128 | open/open | ASCII fullwidth/CJK/emoji labels misalign; display-width correctness is important. |
| Beautiful Mermaid issues #100, #101 | open | Users want font and layout controls exposed as render options. |
| Beautiful Mermaid PR #117 | open | Frontmatter/init config support is expected before diagram parsing. |
| Beautiful Mermaid issue #115 / PR #116 | open/open | Custom fills need automatic contrast handling. |
| Beautiful Mermaid issue #18 / PR #123 | open/open | Font settings should accept CSS variables. |
| Beautiful Mermaid issues #5, #26 / PRs #30, #38 | closed/closed/closed/closed | `<br>` and multiline labels are recurring compatibility expectations. |

Sources:

- https://github.com/lukilabs/beautiful-mermaid/issues/2
- https://github.com/lukilabs/beautiful-mermaid/issues/59
- https://github.com/lukilabs/beautiful-mermaid/issues/79
- https://github.com/lukilabs/beautiful-mermaid/issues/86
- https://github.com/lukilabs/beautiful-mermaid/issues/122
- https://github.com/lukilabs/beautiful-mermaid/pull/128
- https://github.com/lukilabs/beautiful-mermaid/issues/100
- https://github.com/lukilabs/beautiful-mermaid/issues/101
- https://github.com/lukilabs/beautiful-mermaid/pull/117
- https://github.com/lukilabs/beautiful-mermaid/issues/115
- https://github.com/lukilabs/beautiful-mermaid/pull/116
- https://github.com/lukilabs/beautiful-mermaid/issues/18
- https://github.com/lukilabs/beautiful-mermaid/pull/123
- https://github.com/lukilabs/beautiful-mermaid/issues/5
- https://github.com/lukilabs/beautiful-mermaid/issues/26
- https://github.com/lukilabs/beautiful-mermaid/pull/30
- https://github.com/lukilabs/beautiful-mermaid/pull/38

Implication for Agentic Mermaid:

- Users compare alternative renderers by syntax compatibility first.
- Mermaid config/frontmatter compatibility is part of perceived parity.
- ASCII text metrics are a recurring serious issue across renderers.
- Family-specific render options should be explicit and documented.
- Theme/palette support should include contrast and CSS-variable font paths, not
  only fixed literal colors.

## Ranked Direct-Fork Crawl

The naive crawl strategy, "inspect every fork equally," is low signal. Mermaid
has 9,099 forks and Beautiful Mermaid has 360 forks as of this pass. Most forks
have no issues, no PRs, and no independent Journey discussion. The better crawl
is:

1. Fetch forks through GitHub REST with `sort=stargazers`.
2. Rank by `stars*10 + forks*3 + openIssues*1.5 + recencyBoost(pushed_at)`.
3. Search issues, PRs, and code only for the ranked head first.
4. Expand to second-order forks only if the ranked head produces Journey signal
   or if a fork is known to carry relevant divergent implementation work.

Commands:

```sh
bun run scripts/research/fork-journey-crawl.ts lukilabs/beautiful-mermaid --max-forks 100 --limit 12
bun run scripts/research/fork-journey-crawl.ts mermaid-js/mermaid --max-forks 100 --limit 12
```

Beautiful Mermaid ranked head:

| Rank | Fork | Stars | Pushed | Journey issue/PR signal |
|---:|---|---:|---|---|
| 1 | `vercel-labs/beautiful-mermaid` | 28 | 2026-02-24 | none found |
| 2 | `adewale/agentic-mermaid` | 9 | 2026-07-09 | issue #128, PR #6, style/test PRs |
| 3 | `ysknsid25/beautiful-mermaid` | 4 | 2026-02-26 | none found |
| 4 | `Orbiter/beautiful-mermaid-py` | 3 | 2026-02-07 | none found |
| 5 | `rohitg00/beautiful-mermaid` | 3 | 2026-02-02 | none found |

Mermaid ranked head:

| Rank | Fork | Stars | Pushed | Journey issue/PR signal |
|---:|---|---:|---|---|
| 1 | `jacob-lcs/mermaid` | 164 | 2026-02-12 | none found |
| 2 | `jgraph/mermaid` | 50 | 2026-05-01 | none found |
| 3 | `Mermaid-Chart/mermaid-develop` | 20 | 2023-11-13 | none found |
| 4 | `credkellar-boop/mermaid` | 4 | 2026-07-03 | none found |
| 5 | `lishid/mermaid` | 5 | 2023-07-04 | none found |

The top-12 Mermaid fork PR search returned one false-positive title hit:
`tractorjuice/mermaid#1`, "Update E2E Timings." It is not Journey feature
demand. Code-search queries for `journey` scoped to the ranked fork heads
returned no additional fork-specific signal in this pass.

Implication for Agentic Mermaid:

- Continue treating upstream Mermaid as the primary Journey demand source.
- Use the ranked direct-fork pass to catch divergent implementation work and
  packaging or CLI expectations, not as a replacement for upstream issue/PR
  research.
- Re-run the ranked crawl periodically; do not spend equal effort on the long
  tail unless new stars, activity, or search hits justify it.

## Product Conclusions

1. Fix parser parity first.

   `accTitle`, `accDescr`, quoted labels, `<br>`, comments, frontmatter, and init
   directives must be structured or explicitly diagnosed. Renderer support alone
   is not enough.

2. Replace the current card layout as the public SVG default.

   The existing Agentic Mermaid Journey look was useful as a compact
   documentation prototype. It is not what Mermaid users expect when migrating a
   Journey diagram, and pre-launch we do not need to preserve it as public
   behavior.

3. Adopt Mermaid's visual metaphor while preserving Agentic Mermaid polish.

   The default renderer should prioritize Mermaid's classic reading model:
   actor legend, left-to-right task progression, section spans, score-positioned
   sentiment markers, and a progression baseline. The implementation should keep
   the library's measured labels, restrained spacing, theme-aware colors, and
   crisp geometry.

4. Treat text handling as a core feature.

   Long labels, actor wrapping, multiline labels, title sizing, international
   text, and SVG bounds have repeated public demand across Mermaid and terminal
   renderers.

5. Namespace SVG internals.

   Journey uses markers and repeated internal IDs. Duplicate IDs are a known
   upstream issue when multiple diagrams appear in one document, so generated
   Journey markers and references must be scoped. The implementation now uses
   Journey-specific marker names and participates in the repo-wide `idPrefix`
   path for true per-instance embedding.

6. Make score behavior strict and explainable.

   Baseline Mermaid syntax is 1..5. Invalid scores should receive targeted
   diagnostics. Custom score scales can be considered later because Mermaid has
   an open request for it, but it is not baseline compatibility.

7. Keep Journey ASCII semantic and width-correct.

   There is no strong signal for classic Journey visuals in ASCII. A compact
   section/task/score/actor view is acceptable if it wraps correctly and explains
   unsupported syntax.

8. Do not expand Journey into a full service-blueprint grammar in this issue.

   UX practice contains richer concepts, but Mermaid's public model is smaller.
   Extra lanes for emotions, touchpoints, pain points, opportunities, and
   ownership should be a separate design, not part of Mermaid parity.
