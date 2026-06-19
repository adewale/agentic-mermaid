/**
 * Generates differences.html — a single page summarizing the user-visible
 * differences between this fork (Agentic Mermaid) and upstream Beautiful Mermaid.
 *
 * Usage: bun run scripts/site/differences.ts
 *
 * The page reuses the main site's visual language: the same fonts, CSS-variable
 * theming (--t-bg / --t-fg / --t-accent), theme-bar with switchable pills, hero
 * header, and footer. The theme engine here is the page-level subset of
 * generate.ts — it recolors the page chrome instantly.
 *
 * Hero examples are rendered at build time and inlined as static SVG figures
 * (pinned to the salmon palette), so they need no client bundle:
 *   - "New diagram types": the six families this fork adds, rendered here.
 *   - "Layout decisions": before/after pairs. The "after" is rendered fresh
 *     from this repo; the "before" is a pinned snapshot of upstream Beautiful
 *     Mermaid (see capture-upstream-layout.ts / upstream-layout-snapshots.json).
 *
 * Content source of truth: docs/fork-differences.md and docs/comparison.md.
 */

import { THEMES } from '../../src/theme.ts'
import { renderMermaidSVG } from '../../src/index.ts'
import upstreamLayout from './upstream-layout-snapshots.json' with { type: 'json' }

// The palette the inlined figures are rendered in. The page defaults to this
// theme, so in the default view the figures blend into the page; under other
// themes they read as fixed light insets (they are baked, not live-themed).
export const FIGURE_THEME_KEY = 'salmon'

// Mirror of the labels used by the gallery + editor so pills read the same.
const THEME_LABELS: Record<string, string> = {
  'zinc-dark': 'Zinc Dark',
  'tokyo-night': 'Tokyo Night',
  'tokyo-night-storm': 'Tokyo Storm',
  'tokyo-night-light': 'Tokyo Light',
  'catppuccin-mocha': 'Catppuccin',
  'catppuccin-latte': 'Latte',
  'nord': 'Nord',
  'nord-light': 'Nord Light',
  'dracula': 'Dracula',
  'github-light': 'GitHub',
  'github-dark': 'GitHub Dark',
  'solarized-light': 'Solarized',
  'solarized-dark': 'Solar Dark',
  'one-dark': 'One Dark',
  'salmon': 'Salmon',
  'salmon-dark': 'Salmon Dark',
  'tufte': 'Tufte',
  'tufte-dark': 'Tufte Dark',
}

const DEFAULT_THEME_KEY = 'salmon'
const VISIBLE_THEMES = new Set([DEFAULT_THEME_KEY, 'dracula', 'solarized-light'])

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildThemePill(key: string, colors: { bg: string; fg: string }, active = false): string {
  const isDark = parseInt(colors.bg.replace('#', '').slice(0, 2), 16) < 0x80
  const shadow = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'
  const label = key === '' ? 'Default' : (THEME_LABELS[key] ?? key)
  const activeClass = active ? ' active' : ''
  return `<button class="theme-pill shadow-minimal${activeClass}" data-theme="${key}"><span class="theme-swatch" style="background:${colors.bg};box-shadow:inset 0 0 0 1px ${shadow}"></span>${escapeHtml(label)}</button>`
}

// ── Page content ────────────────────────────────────────────────────────────

// What both projects share. Stated so the page credits upstream before it
// lists additions — and so no difference is implied where none exists.
const SHARED: string[] = [
  'The renderer itself: one synchronous, no-browser TypeScript library that computes layout and emits SVG strings.',
  'ASCII / Unicode output for terminals.',
  'Two-color theming, a set of named themes (Dracula, Solarized, Nord, Tokyo Night, and more), and Shiki / VS Code theme compatibility.',
  'A hosted live editor with live rendering, theme switching, and PNG / SVG export. Beautiful Mermaid&rsquo;s is at <a href="https://agents.craft.do/mermaid/editor" target="_blank" rel="noopener">agents.craft.do/mermaid/editor</a>; this fork runs a separate one at <a href="editor">/editor</a>.',
]

// Each card describes something this fork's own commits added on top of the
// inherited renderer. Claims name a concrete mechanism rather than assert an
// absence in upstream; "this fork adds X" is grounded in the fork's diff.
type Card = {
  tag: string
  title: string
  body: string
}

const CARDS: Card[] = [
  {
    tag: 'Diagrams',
    title: 'Six more diagram families',
    body: 'Beautiful Mermaid renders six families: flowchart, state, sequence, class, ER, and XY chart. This fork renders those six and adds <strong>timeline</strong>, <strong>user journey</strong>, <strong>architecture</strong>, <strong>pie</strong>, <strong>quadrant</strong>, and <strong>Gantt</strong>. The Gantt renderer reads date axes, sections, task dependencies, milestones, and vertical markers.',
  },
  {
    tag: 'Editing',
    title: 'A typed parse-and-edit API',
    body: 'On top of rendering, the fork exposes <code>parseMermaid</code>, per-family mutation ops, <code>verifyMermaid</code>, and <code>serializeMermaid</code>. A program can rename or move one node and re-serialize instead of regenerating the whole diagram. Syntax the parser does not model is carried through the round-trip verbatim rather than dropped.',
  },
  {
    tag: 'Verification',
    title: 'Verification that returns reasons',
    body: '<code>verifyMermaid</code> reports problems in three tiers — structural, geometric, and lint — and <code>measureQuality</code> returns layout metrics. A caller can branch on a specific warning instead of inspecting the rendered picture.',
  },
  {
    tag: 'Reproducibility',
    title: 'Byte-identical output, checked in CI',
    body: 'The fork&rsquo;s tests assert that rendering the same source twice, and across separate processes, produces identical bytes. That keeps SVG diffs and golden-file tests stable from one run to the next.',
  },
  {
    tag: 'Output',
    title: 'PNG, JSON layout, and debug layout evidence',
    body: 'Alongside SVG and ASCII, the library and the <code>am</code> CLI render PNG without a browser (via resvg) and can emit computed layout JSON. Debug layout JSON can opt into route/family certificates plus region/action sidecars for tools that need evidence; default JSON stays compact.',
  },
  {
    tag: 'Styling',
    title: 'A style option keyed by role',
    body: '<code>renderMermaidSVG</code> accepts a <code>style</code> option grouped by role — <code>node</code>, <code>edge</code>, <code>group</code>, <code>text</code> — so one set of values restyles cards, connectors, containers, and labels together, across the families that support each role.',
  },
  {
    tag: 'Compatibility',
    title: 'Reads Mermaid source wrappers',
    body: 'Diagrams that open with YAML frontmatter, a <code>%%{init: …}%%</code> or <code>%%{initialize: …}%%</code> directive, or comments before the header parse and render here, with those settings merged into the render options.',
  },
  {
    tag: 'Tooling',
    title: 'A CLI and an MCP server',
    body: 'The <code>am</code> binary renders, verifies, mutates, previews, and batch-processes diagrams from a shell, with exit codes and JSONL for scripting. An <code>agentic-mermaid-mcp</code> server and a hosted <code>llms.txt</code> let a coding agent drive the same parse → mutate → verify → serialize loop.',
  },
  {
    tag: 'Layout',
    title: 'Specific layout and parsing fixes',
    body: 'Some routing still differs from the current upstream release (see the layout examples above): decision branches leave a diamond from facet-mid ports as mirror-symmetric routes, and an edge to a subgraph attaches to its container with <code>direction</code> honored inside it. The route engine now carries opt-in proof metadata, and ASCII rendering consumes the same route-intent classifier rather than a separate hand-written guess. Earlier fan-in and fan-out-trunk fixes from this fork were contributed upstream and now render the same in Beautiful Mermaid 1.1.3. ER cardinality is parsed to match Mermaid&rsquo;s lexer, so a malformed relationship line raises an error instead of being silently dropped.',
  },
]

// ── Hero examples ─────────────────────────────────────────────────────────────

// The six families this fork adds. Rendered here at build time; each carries
// its own in-diagram title, so the figures need no separate caption.
const NEW_TYPES: { id: string; name: string; src: string }[] = [
  { id: 'timeline', name: 'Timeline', src: `timeline
  title Product history
  2021 : Founded
  2022 : Seed round : First hire
  2023 : Series A : Launch` },
  { id: 'journey', name: 'User Journey', src: `journey
  title Checkout
  section Browse
    View item: 5: User
    Add to cart: 4: User
  section Pay
    Enter card: 3: User
    Confirm: 5: User, System` },
  { id: 'architecture', name: 'Architecture', src: `architecture-beta
  group api(cloud)[API]
  service gw(server)[Gateway] in api
  service db(database)[Postgres] in api
  service cache(disk)[Redis] in api
  gw:R --> L:db
  gw:B --> T:cache` },
  { id: 'pie', name: 'Pie chart', src: `pie showData
  title Traffic sources
  "Search" : 52
  "Direct" : 23
  "Social" : 15
  "Referral" : 10` },
  { id: 'quadrant', name: 'Quadrant chart', src: `quadrantChart
  title Reach vs effort
  x-axis Low effort --> High effort
  y-axis Low reach --> High reach
  "Blog": [0.3, 0.7]
  "Ads": [0.8, 0.6]
  "SEO": [0.5, 0.8]
  "Cold email": [0.6, 0.2]` },
  { id: 'gantt', name: 'Gantt chart', src: `gantt
  title Launch plan
  dateFormat YYYY-MM-DD
  section Build
    Spec      :a1, 2024-01-01, 7d
    Implement :a2, after a1, 14d
  section Ship
    QA        :a3, after a2, 5d
    Release   :milestone, after a3, 0d` },
]

// Layout decisions where this fork's output still differs visibly from the
// pinned upstream release: decision/diamond branch routing (the symmetry-floor
// work). The "after" is rendered fresh; the "before" comes from
// upstream-layout-snapshots.json, keyed by these ids.
export const LAYOUT_CASES: { id: string; title: string; src: string }[] = [
  { id: 'diamond-td', title: 'Diamond fan-out, top-down', src: `flowchart TD
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]` },
  { id: 'three-way', title: 'Three-way decision', src: `flowchart TD
  Q{Decision} -->|left| L[Left]
  Q -->|middle| M[Middle]
  Q -->|right| R[Right]` },
  { id: 'diamond-lr', title: 'Diamond fan-out, left-to-right', src: `flowchart LR
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]` },
]

// Namespace every id (and its url(#…) / href="#…" references) in an SVG so
// many inlined diagrams — from two library versions that emit overlapping ids
// like "arrowhead" and "Q" — can share one document without collisions.
function namespaceSvg(svg: string, prefix: string): string {
  const ids = [...new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]!))]
    // Longest first so a short id never rewrites a substring of a longer one.
    .sort((a, b) => b.length - a.length)
  let out = svg
  for (const id of ids) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out
      .replace(new RegExp(`id="${e}"`, 'g'), `id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, 'g'), `url(#${prefix}${id})`)
      .replace(new RegExp(`url\\("#${e}"\\)`, 'g'), `url("#${prefix}${id}")`)
      .replace(new RegExp(`((?:xlink:)?href)="#${e}"`, 'g'), `$1="#${prefix}${id}"`)
  }
  return out
}

const figureTheme = THEMES[FIGURE_THEME_KEY]!
const figureOpts = {
  bg: figureTheme.bg, fg: figureTheme.fg, line: figureTheme.line, accent: figureTheme.accent,
  muted: figureTheme.muted, surface: figureTheme.surface, border: figureTheme.border,
}

function renderForkFigure(src: string, id: string): string {
  return namespaceSvg(renderMermaidSVG(src, { ...figureOpts, idPrefix: `fk-${id}-` }), `${id}-`)
}

// ── Assemble ─────────────────────────────────────────────────────────────────

function buildHtml(): string {
  const themeEntries = Object.entries(THEMES)
  const visiblePills = [
    buildThemePill('', { bg: '#FFFFFF', fg: '#27272A' }, false),
    ...themeEntries
      .filter(([key]) => VISIBLE_THEMES.has(key))
      .map(([key, colors]) => buildThemePill(key, colors, key === DEFAULT_THEME_KEY)),
  ]
  const allDropdownPills = [
    buildThemePill('', { bg: '#FFFFFF', fg: '#27272A' }, false),
    ...themeEntries.map(([key, colors]) => buildThemePill(key, colors, key === DEFAULT_THEME_KEY)),
  ]
  const totalThemes = allDropdownPills.length

  const themePillsHtml = `
    <div class="theme-pills-inline">
      ${visiblePills.join('\n      ')}
    </div>
    <div class="theme-more-wrapper">
      <button class="theme-pill shadow-minimal" id="theme-more-btn">${totalThemes} Themes</button>
      <div class="theme-more-dropdown shadow-modal-small" id="theme-more-dropdown">
        ${allDropdownPills.join('\n        ')}
      </div>
    </div>`

  const sharedItems = SHARED.map(item => `          <li>${item}</li>`).join('\n')

  const cardsHtml = CARDS.map(card => `      <article class="diff-card shadow-minimal">
        <span class="diff-tag">${card.tag}</span>
        <h3 class="diff-card-title">${card.title}</h3>
        <p class="diff-card-body">${card.body}</p>
      </article>`).join('\n')

  const newTypesHtml = NEW_TYPES.map(t =>
    `      <figure class="figure-card"><figcaption class="figure-name">${t.name}</figcaption><div class="figure-svg">${renderForkFigure(t.src, t.id)}</div></figure>`
  ).join('\n')

  const layoutHtml = LAYOUT_CASES.map(c => {
    const before = namespaceSvg((upstreamLayout.cases as Record<string, string>)[c.id]!, `${c.id}-up-`)
    const after = renderForkFigure(c.src, c.id)
    return `      <figure class="figure-card">
        <div class="ba-pair">
          <div class="ba-col"><span class="ba-label ba-before">Beautiful Mermaid ${upstreamLayout.upstreamVersion}</span><div class="figure-svg">${before}</div></div>
          <div class="ba-col"><span class="ba-label ba-after">This fork</span><div class="figure-svg">${after}</div></div>
        </div>
      </figure>`
  }).join('\n')

  const themesJson = JSON.stringify(THEMES)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" id="theme-color-meta" content="#f8f2eb" />
  <title>What's different in this fork — Agentic Mermaid</title>
  <meta name="description" content="What Agentic Mermaid adds on top of Beautiful Mermaid, the renderer it forks: six more diagram families, a typed parse-and-edit API, structured verification, byte-identical output, PNG and JSON output, a role-keyed style option, Mermaid source wrappers, and a CLI plus MCP server." />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/x-icon" href="favicon.ico" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
  <meta property="og:title" content="What's different in this fork — Agentic Mermaid" />
  <meta property="og:description" content="What Agentic Mermaid adds on top of Beautiful Mermaid: six more diagram families, a typed parse-and-edit API, verification, byte-identical output, PNG/JSON output, a role-keyed style option, and a CLI plus MCP server." />
  <meta property="og:image" content="https://adewale.github.io/beautiful-mermaid/og-image.png" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://adewale.github.io/beautiful-mermaid/differences" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="What's different in this fork — Agentic Mermaid" />
  <meta name="twitter:description" content="Agentic Mermaid vs Beautiful Mermaid, at a glance." />
  <meta name="twitter:image" content="https://adewale.github.io/beautiful-mermaid/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    /* -- Reset & base -- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* CSS-variable theming: --t-bg and --t-fg drive everything; the rest is
       derived with color-mix(). The theme pills update them on <body>. */
    body {
      --t-bg: #FFFBF5;
      --t-fg: #521000;
      --t-accent: #FF4801;
      --foreground-rgb: 82, 16, 0;
      --accent-rgb: 255, 72, 1;
      --shadow-border-opacity: 0.08;
      --shadow-blur-opacity: 0.06;
      --theme-bar-bg: #f8f2eb;

      font-family: 'Atkinson Hyperlegible', system-ui, -apple-system, sans-serif;
      background: color-mix(in srgb, var(--t-fg) 4%, var(--t-bg));
      color: var(--t-fg);
      line-height: 1.6;
      margin: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    :where(button, a, input, textarea):focus-visible {
      outline: 2px solid color-mix(in srgb, var(--t-accent) 72%, var(--t-bg));
      outline-offset: 2px;
    }
    .content-wrapper {
      max-width: 1180px;
      margin: 0 auto;
      padding: 2rem;
      padding-top: 0;
    }
    @media (max-width: 768px) {
      .content-wrapper { padding: 1rem; padding-top: 0; }
    }
    @media (min-width: 1000px) {
      .content-wrapper { padding: 3rem; padding-top: 0; }
    }

    /* -- Scroll fade gradients -- */
    body::before, body::after {
      content: ''; position: fixed; left: 0; right: 0; height: 64px;
      pointer-events: none; z-index: 1000; will-change: transform;
    }
    body::before { top: 0; background: linear-gradient(to bottom, var(--theme-bar-bg) 0%, transparent 100%); }
    body::after { bottom: 0; background: linear-gradient(to top, var(--theme-bar-bg) 0%, transparent 100%); }

    /* -- Theme selector bar -- */
    .theme-bar {
      position: sticky; top: 0; z-index: 1001;
      background: transparent; padding: 0.5rem 2rem;
      display: flex; align-items: center; gap: 0.75rem; overflow: visible;
    }
    @media (max-width: 768px) { .theme-bar { padding: 0.5rem 1rem; } }
    .theme-pills {
      display: flex; gap: 0.3rem; overflow: visible; padding: 4px; margin: -4px;
      margin-left: auto; position: relative; z-index: 2;
    }
    .theme-pills-inline { display: flex; gap: 0.3rem; }
    @media (max-width: 1024px) { .theme-pills-inline { display: none; } }
    .theme-pill {
      display: flex; align-items: center; height: 32px; gap: 8px;
      padding: 0 14px 0 12px; border: none; border-radius: 8px;
      background: color-mix(in srgb, var(--t-bg) 97%, var(--t-fg));
      color: color-mix(in srgb, var(--t-fg) 80%, var(--t-bg));
      font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s, background 0.15s, box-shadow 0.2s, transform 0.1s;
    }
    .theme-pill:hover { color: var(--t-fg); background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg)); }
    .theme-pill.active { color: var(--t-fg); background: var(--t-bg); font-weight: 600; }
    .theme-pill:active { transform: translateY(0.5px); }
    .theme-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }

    /* -- "More" dropdown -- */
    .theme-more-wrapper { position: relative; }
    .theme-more-dropdown {
      display: none; position: absolute; top: calc(100% + 6px); right: 0;
      background: var(--t-bg); border-radius: 12px; padding: 6px;
      flex-direction: column; gap: 2px; min-width: 160px; z-index: 1002;
      max-height: 70vh; overflow-y: auto;
    }
    .theme-more-dropdown.open { display: flex; }
    .theme-more-dropdown .theme-pill { width: 100%; justify-content: flex-start; background: transparent; box-shadow: none; }
    .theme-more-dropdown .theme-pill:hover { background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg)); }
    .theme-more-dropdown .theme-pill.active,
    .theme-more-dropdown .theme-pill.shadow-tinted {
      background: var(--t-bg);
      box-shadow:
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, var(--shadow-blur-opacity)) 0px 1px 1px -0.5px,
        rgba(0, 0, 0, var(--shadow-blur-opacity)) 0px 3px 3px -1.5px;
    }

    /* -- Brand badge + nav -- */
    .brand-badge {
      display: flex; align-items: center; height: 32px; gap: 6px; padding: 0 12px;
      border: none; border-radius: 8px; text-decoration: none;
      background: color-mix(in srgb, var(--t-bg) 97%, var(--t-fg));
      color: color-mix(in srgb, var(--t-fg) 80%, var(--t-bg));
      font-size: 13px; font-weight: 500; font-family: inherit; white-space: nowrap;
      transition: color 0.15s, background 0.15s, box-shadow 0.2s;
    }
    .brand-badge:hover { color: var(--t-fg); background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg)); }
    .top-nav { display: flex; align-items: center; gap: 0.25rem; }
    @media (max-width: 600px) { .top-nav { display: none; } }
    .top-nav a {
      display: flex; align-items: center; height: 32px; padding: 0 12px;
      border-radius: 8px; text-decoration: none;
      color: color-mix(in srgb, var(--t-fg) 60%, var(--t-bg));
      font-size: 13px; font-weight: 500; transition: color 0.15s, background 0.15s;
    }
    .top-nav a:hover { color: var(--t-fg); background: color-mix(in srgb, var(--t-bg) 94%, var(--t-fg)); }

    /* -- Shadow utilities -- */
    .shadow-minimal {
      box-shadow:
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, var(--shadow-blur-opacity)) 0px 1px 1px -0.5px,
        rgba(0, 0, 0, var(--shadow-blur-opacity)) 0px 3px 3px -1.5px;
    }
    .shadow-modal-small {
      box-shadow:
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, calc(var(--shadow-blur-opacity) * 0.67)) 0px 1px 1px -0.5px,
        rgba(0, 0, 0, calc(var(--shadow-blur-opacity) * 0.67)) 0px 3px 3px 0px,
        rgba(0, 0, 0, calc(var(--shadow-blur-opacity) * 0.33)) 0px 6px 6px 0px,
        rgba(0, 0, 0, calc(var(--shadow-blur-opacity) * 0.33)) 0px 12px 12px 0px,
        rgba(0, 0, 0, calc(var(--shadow-blur-opacity) * 0.33)) 0px 24px 24px 0px;
    }
    .shadow-tinted {
      --shadow-color: 0, 0, 0;
      box-shadow:
        rgba(var(--shadow-color), 0) 0px 0px 0px 0px,
        rgba(var(--shadow-color), 0) 0px 0px 0px 0px,
        rgba(var(--shadow-color), calc(var(--shadow-border-opacity) * 1.5)) 0px 0px 0px 1px,
        rgba(var(--shadow-color), var(--shadow-border-opacity)) 0px 1px 1px -0.5px,
        rgba(var(--shadow-color), var(--shadow-blur-opacity)) 0px 3px 3px -1.5px,
        rgba(var(--shadow-color), calc(var(--shadow-blur-opacity) * 0.67)) 0px 6px 6px -3px;
    }

    /* -- Hero header (matches the gallery hero metrics) -- */
    .hero-header { max-width: 1180px; margin: 0 auto; padding: 6rem 2rem 2rem; text-align: left; }
    @media (min-width: 1000px) { .hero-header { padding: 6rem 3rem 2rem; } }
    .hero-title { font-size: 2.25rem; font-weight: 800; line-height: 1.2; margin: 0 0 0.75rem; color: var(--t-fg); }
    .hero-description {
      font-size: 1rem; line-height: 1.6;
      color: color-mix(in srgb, var(--t-fg) 70%, var(--t-bg));
      margin: 0 0 1.5rem; max-width: 720px;
    }
    .hero-description a { color: var(--t-fg); text-decoration: underline; text-underline-offset: 2px; }
    .hero-description a:hover { color: var(--t-accent); }
    .hero-description code, .diff-card-body code, .credit-box code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.85em;
      background: color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
      padding: 0.15em 0.4em; border-radius: 4px;
    }
    .hero-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    @media (max-width: 768px) { .hero-buttons { flex-direction: column; align-items: stretch; } }
    .hero-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 0.75rem 1.25rem; font-size: 0.875rem; font-weight: 500; line-height: 1.25;
      border-radius: 12px; text-decoration: none; cursor: pointer; border: none;
      box-sizing: border-box; font-family: inherit;
      transition: opacity 0.15s, transform 0.1s;
    }
    .hero-btn:hover { opacity: 0.9; }
    .hero-btn:active { transform: translateY(0.5px); }
    .hero-btn-primary {
      background: var(--t-fg); color: var(--t-bg);
      box-shadow: rgba(0,0,0,0.1) 0px 1px 3px 0px, rgba(0,0,0,0.1) 0px 1px 2px -1px;
    }
    .hero-btn-secondary {
      background: var(--t-bg); color: var(--t-fg);
      box-shadow:
        rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,
        rgba(0,0,0,0.1) 0px 1px 3px 0px, rgba(0,0,0,0.1) 0px 1px 2px -1px;
    }
    .hero-btn svg { width: 16px; height: 16px; }

    /* -- Section headings -- */
    .section-title { font-size: 1.875rem; font-weight: 800; line-height: 1.2; margin: 0; color: var(--t-fg); }
    .section-intro {
      margin: 0.4rem 0 1.5rem; max-width: 70ch; font-size: 0.95rem;
      color: color-mix(in srgb, var(--t-fg) 60%, var(--t-bg));
    }
    .section { margin-top: 3.5rem; }

    /* -- Hero example figures --------------------------------------------------
     * The inlined SVGs are baked in the salmon palette, so the figure cards use
     * a fixed light surface (not var(--t-bg)): in the default theme they blend
     * into the page; under other themes they read as stable light insets. */
    .examples-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 1rem;
    }
    .figure-card {
      margin: 0; border-radius: 16px; padding: 1.25rem;
      background: ${figureTheme.bg};
      box-shadow: 0 0 0 1px rgba(82, 16, 0, 0.08), 0 2px 10px rgba(0, 0, 0, 0.05);
    }
    .figure-name {
      font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #9a4a2a; margin-bottom: 0.9rem;
    }
    .figure-svg { display: flex; align-items: center; justify-content: center; }
    .figure-svg svg { max-width: 100%; height: auto; display: block; }
    .layout-grid { display: grid; gap: 1rem; }
    .ba-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 720px) { .ba-pair { grid-template-columns: 1fr; } }
    .ba-col { display: flex; flex-direction: column; gap: 0.6rem; min-width: 0; }
    .ba-label {
      align-self: flex-start;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      padding: 0.2rem 0.6rem; border-radius: 999px;
    }
    .ba-before { color: rgba(82, 16, 0, 0.62); background: rgba(82, 16, 0, 0.08); }
    .ba-after { color: #c23a06; background: rgba(255, 72, 1, 0.13); }

    /* -- Foundation list (what both projects share) -- */
    .foundation {
      border-radius: 16px; padding: 1.5rem 1.75rem;
      background: color-mix(in srgb, var(--t-fg) 3%, var(--t-bg));
    }
    .foundation-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.7rem; }
    .foundation-list li {
      position: relative; padding-left: 1.5rem;
      font-size: 0.92rem; line-height: 1.6; max-width: 80ch;
      color: color-mix(in srgb, var(--t-fg) 72%, var(--t-bg));
    }
    .foundation-list li::before {
      content: ''; position: absolute; left: 0; top: 0.62em;
      width: 7px; height: 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--t-accent) 60%, var(--t-bg));
    }
    .foundation-list a { color: var(--t-fg); text-decoration: underline; text-underline-offset: 2px; }
    .foundation-list a:hover { color: var(--t-accent); }

    /* -- Difference cards -- */
    .diff-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    .diff-card {
      background: var(--t-bg); border-radius: 16px; padding: 1.5rem;
      display: flex; flex-direction: column; gap: 0.6rem;
    }
    .diff-tag {
      align-self: flex-start;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      padding: 0.2rem 0.6rem; border-radius: 999px;
      color: color-mix(in srgb, var(--t-fg) 62%, var(--t-bg));
      background: color-mix(in srgb, var(--t-fg) 7%, var(--t-bg));
    }
    .diff-card-title { font-size: 1.0625rem; font-weight: 700; margin: 0; color: var(--t-fg); }
    .diff-card-body {
      font-size: 0.9rem; line-height: 1.6; margin: 0;
      color: color-mix(in srgb, var(--t-fg) 70%, var(--t-bg));
    }
    .diff-card-body strong { color: var(--t-fg); font-weight: 700; }

    /* -- Credit box (built on upstream) -- */
    .credit-box {
      border-radius: 16px; padding: 1.5rem 1.75rem; margin-top: 3.5rem;
      background: color-mix(in srgb, var(--t-accent) 6%, var(--t-bg));
    }
    .credit-box h2 { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--t-fg); }
    .credit-box p {
      font-size: 0.92rem; line-height: 1.65; margin: 0 0 0.6rem;
      color: color-mix(in srgb, var(--t-fg) 72%, var(--t-bg)); max-width: 75ch;
    }
    .credit-box p:last-child { margin-bottom: 0; }
    .credit-box a { color: var(--t-fg); text-decoration: underline; text-underline-offset: 2px; }
    .credit-box a:hover { color: var(--t-accent); }

    /* -- Footer -- */
    .site-footer {
      position: relative; z-index: 10; padding: 2.5rem 2rem 2rem;
      display: flex; align-items: center; justify-content: space-between;
      max-width: 1180px; width: 100%; margin: 0 auto; font-size: 13px;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
    }
    @media (min-width: 1000px) { .site-footer { padding: 2.5rem 3rem 2rem; } }
    @media (max-width: 600px) { .site-footer { flex-direction: column; gap: 1rem; text-align: center; } }
    .footer-links { display: flex; align-items: center; gap: 1rem; }
    .footer-links a { color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg)); text-decoration: none; transition: color 0.15s; }
    .footer-links a:hover { color: var(--t-fg); }
    .footer-links svg { width: 1.25rem; height: 1.25rem; display: block; }
  </style>
</head>
<body>

  <!-- Navigation + theme bar -->
  <div class="theme-bar" id="theme-bar">
    <a class="brand-badge shadow-minimal" href="./"><strong>Agentic Mermaid</strong></a>
    <nav class="top-nav" aria-label="Site">
      <a href="./">Gallery</a>
      <a href="editor">Editor</a>
    </nav>
    <div class="theme-pills" id="theme-pills">
      ${themePillsHtml}
    </div>
  </div>

  <!-- Hero -->
  <header class="hero-header">
    <h1 class="hero-title">What's different in this fork</h1>
    <p class="hero-description">
      <strong>Agentic Mermaid</strong> is a fork of
      <a href="https://github.com/lukilabs/beautiful-mermaid" target="_blank" rel="noopener">Beautiful Mermaid</a>,
      Craft's synchronous, browserless Mermaid renderer. It inherits that renderer along with the
      theming, the named themes, and the ASCII output that ship with it, then adds support for
      programs that read and edit diagrams. This page lists what the fork's own changes add;
      everything else is upstream's work.
    </p>
    <div class="hero-buttons">
      <a href="./" class="hero-btn hero-btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Open the gallery
      </a>
      <a href="editor" class="hero-btn hero-btn-secondary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        Try the editor
      </a>
      <a href="https://github.com/adewale/beautiful-mermaid/blob/main/docs/fork-differences.md" target="_blank" rel="noopener" class="hero-btn hero-btn-secondary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Fork notes
      </a>
    </div>
  </header>

  <div class="content-wrapper">

    <!-- New diagram types -->
    <section class="section" id="new-types" aria-labelledby="new-types-title" style="margin-top: 2.5rem;">
      <h2 class="section-title" id="new-types-title">New diagram types</h2>
      <p class="section-intro">
        The six families this fork adds on top of Beautiful Mermaid&rsquo;s, rendered here.
      </p>
      <div class="examples-grid">
${newTypesHtml}
      </div>
    </section>

    <!-- Layout decisions -->
    <section class="section" id="layout" aria-labelledby="layout-title">
      <h2 class="section-title" id="layout-title">Layout decisions</h2>
      <p class="section-intro">
        Same source, same palette, side by side with Beautiful Mermaid ${upstreamLayout.upstreamVersion}.
      </p>
      <div class="layout-grid">
${layoutHtml}
      </div>
    </section>

    <!-- Shared foundation -->
    <section class="section" id="shared" aria-labelledby="shared-title">
      <h2 class="section-title" id="shared-title">Shared with Beautiful Mermaid</h2>
      <p class="section-intro">
        Most of what this fork does, it does because upstream already did it. These come from
        Beautiful Mermaid and are unchanged here:
      </p>
      <div class="foundation shadow-minimal">
        <ul class="foundation-list">
${sharedItems}
        </ul>
      </div>
    </section>

    <!-- What the fork adds -->
    <section class="section" id="additions" aria-labelledby="additions-title">
      <h2 class="section-title" id="additions-title">What this fork adds</h2>
      <p class="section-intro">
        Each item below is introduced by the fork's own commits, on top of the inherited renderer.
        The figures for Beautiful Mermaid are drawn from its
        <a href="https://agents.craft.do/mermaid" target="_blank" rel="noopener">live site</a>.
      </p>
      <div class="diff-grid">
${cardsHtml}
      </div>
    </section>

    <!-- Which to use -->
    <section class="credit-box" aria-label="Which to use">
      <h2>Which should you use?</h2>
      <p>
        For render-only output, or a Mermaid family outside the twelve here, Beautiful Mermaid or
        <a href="https://github.com/mermaid-js/mermaid" target="_blank" rel="noopener">Mermaid</a> itself
        is the better fit — Mermaid defines the language both projects implement and supports far more
        diagram types. Reach for this fork when a program needs to edit a diagram and check the
        result: that editing, verification, and tooling layer is what its changes add.
      </p>
      <p>
        For the longer write-up, see the
        <a href="https://github.com/adewale/beautiful-mermaid/blob/main/docs/fork-differences.md" target="_blank" rel="noopener">fork notes</a>
        and the <a href="https://github.com/adewale/beautiful-mermaid/blob/main/docs/comparison.md" target="_blank" rel="noopener">three-way comparison</a>.
      </p>
    </section>

  </div>

  <footer class="site-footer">
    <span>Open source under the MIT License.</span>
    <div class="footer-links">
      <a href="./">Gallery</a>
      <a href="editor">Editor</a>
      <a href="https://github.com/adewale/beautiful-mermaid/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a>
      <a href="https://github.com/adewale/beautiful-mermaid" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      </a>
    </div>
  </footer>

  <script>
  (function () {
    var THEMES = ${themesJson};
    var DEFAULT_PAGE_THEME = '${DEFAULT_THEME_KEY}';

    function hexToRgb(hex) {
      if (!hex || typeof hex !== 'string') return null;
      var value = hex.trim();
      if (value[0] === '#') value = value.slice(1);
      if (value.length === 3) value = value[0]+value[0]+value[1]+value[1]+value[2]+value[2];
      var num = parseInt(value, 16);
      if (isNaN(num)) return null;
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    function setShadowVars(theme) {
      var body = document.body;
      var fg = theme ? theme.fg : '#27272A';
      var bg = theme ? theme.bg : '#FFFFFF';
      var accent = theme ? (theme.accent || '#3b82f6') : '#3b82f6';
      var fgRgb = hexToRgb(fg) || { r: 39, g: 39, b: 42 };
      var bgRgb = hexToRgb(bg) || { r: 255, g: 255, b: 255 };
      var accentRgb = hexToRgb(accent) || { r: 59, g: 130, b: 246 };
      var brightness = (bgRgb.r * 299 + bgRgb.g * 587 + bgRgb.b * 114) / 1000;
      var darkMode = brightness < 140;
      body.style.setProperty('--foreground-rgb', fgRgb.r + ', ' + fgRgb.g + ', ' + fgRgb.b);
      body.style.setProperty('--accent-rgb', accentRgb.r + ', ' + accentRgb.g + ', ' + accentRgb.b);
      body.style.setProperty('--shadow-border-opacity', darkMode ? '0.15' : '0.08');
      body.style.setProperty('--shadow-blur-opacity', darkMode ? '0.12' : '0.06');
    }

    function updateThemeColor(fg, bg) {
      var fgRgb = hexToRgb(fg) || { r: 39, g: 39, b: 42 };
      var bgRgb = hexToRgb(bg) || { r: 255, g: 255, b: 255 };
      var r = Math.round(bgRgb.r * 0.96 + fgRgb.r * 0.04);
      var g = Math.round(bgRgb.g * 0.96 + fgRgb.g * 0.04);
      var b = Math.round(bgRgb.b * 0.96 + fgRgb.b * 0.04);
      var hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      var meta = document.getElementById('theme-color-meta');
      if (meta) meta.setAttribute('content', hex);
      document.body.style.setProperty('--theme-bar-bg', hex);
    }

    function applyPageTheme(themeKey, persist) {
      if (typeof persist === 'undefined') persist = true;
      var theme = themeKey ? THEMES[themeKey] : null;
      var body = document.body;
      if (theme) {
        body.style.setProperty('--t-bg', theme.bg);
        body.style.setProperty('--t-fg', theme.fg);
        body.style.setProperty('--t-accent', theme.accent || '#3b82f6');
      } else {
        body.style.setProperty('--t-bg', '#FFFFFF');
        body.style.setProperty('--t-fg', '#27272A');
        body.style.setProperty('--t-accent', '#3b82f6');
      }
      setShadowVars(theme);
      updateThemeColor(theme ? theme.fg : '#27272A', theme ? theme.bg : '#FFFFFF');

      var pills = document.querySelectorAll('.theme-pill');
      for (var j = 0; j < pills.length; j++) {
        var isActive = pills[j].getAttribute('data-theme') === (themeKey || '');
        pills[j].classList.toggle('active', isActive);
        pills[j].classList.toggle('shadow-tinted', isActive);
      }
      if (persist) {
        if (themeKey) localStorage.setItem('mermaid-theme', themeKey);
        else localStorage.removeItem('mermaid-theme');
      }
    }

    // -- Theme pill clicks --
    var themePills = document.getElementById('theme-pills');
    var moreDropdown = document.getElementById('theme-more-dropdown');
    themePills.addEventListener('click', function (e) {
      var pill = e.target.closest('.theme-pill');
      if (!pill || pill.id === 'theme-more-btn') return;
      applyPageTheme(pill.getAttribute('data-theme') || '');
      if (moreDropdown && moreDropdown.classList.contains('open')) moreDropdown.classList.remove('open');
    });

    // -- "More" dropdown open/close --
    var moreBtn = document.getElementById('theme-more-btn');
    if (moreBtn && moreDropdown) {
      moreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        moreDropdown.classList.toggle('open');
      });
      document.addEventListener('click', function (e) {
        if (!moreDropdown.classList.contains('open')) return;
        if (e.target.closest('.theme-more-wrapper')) return;
        moreDropdown.classList.remove('open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && moreDropdown.classList.contains('open')) moreDropdown.classList.remove('open');
      });
    }

    // -- Restore saved theme, else default to salmon without persisting --
    var savedTheme = localStorage.getItem('mermaid-theme');
    var initialThemeKey = savedTheme && THEMES[savedTheme] ? savedTheme : DEFAULT_PAGE_THEME;
    applyPageTheme(initialThemeKey, Boolean(savedTheme));

    requestAnimationFrame(function () {
      document.body.style.transition = 'background 0.2s, color 0.2s';
    });
  })();
  </script>
</body>
</html>`
}

if (import.meta.main) {
  const html = buildHtml()
  const outPath = new URL('../../differences.html', import.meta.url).pathname
  await Bun.write(outPath, html)
  console.log(`Written to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
}
