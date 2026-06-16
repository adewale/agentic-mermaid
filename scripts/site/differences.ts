/**
 * Generates differences.html — a single page summarizing the user-visible
 * differences between this fork (Agentic Mermaid) and upstream Beautiful Mermaid.
 *
 * Usage: bun run scripts/site/differences.ts
 *
 * The page is intentionally static (no diagram rendering) but reuses the main
 * site's visual language: the same fonts, CSS-variable theming (--t-bg / --t-fg
 * / --t-accent), theme-bar with switchable pills, hero header, and footer. The
 * theme engine here is the page-level subset of generate.ts — it recolors the
 * page instantly but has no samples to re-render.
 *
 * Content source of truth: docs/fork-differences.md and docs/comparison.md.
 */

import { THEMES } from '../../src/theme.ts'

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

type Row = { feature: string; upstream: string; fork: string }

// User-visible comparison. "—" means the original doesn't offer it.
const COMPARISON_ROWS: Row[] = [
  { feature: 'Diagram families', upstream: '6', fork: '12' },
  { feature: 'Output formats', upstream: 'SVG, ASCII / Unicode', fork: 'SVG, ASCII / Unicode, PNG, JSON layout' },
  { feature: 'Hosted live editor', upstream: '—', fork: 'Yes — examples for every family, theme switching, shareable links' },
  { feature: 'Semantic role styling', upstream: '—', fork: 'Yes — node / edge / group / text' },
  { feature: 'Mermaid wrappers (frontmatter, %%{init}%%)', upstream: '—', fork: 'Yes' },
  { feature: 'Edit diagrams (typed parse → mutate → serialize)', upstream: '—', fork: 'Yes — 12 families, never drops your syntax' },
  { feature: 'Structured verification', upstream: '—', fork: 'Yes — 3 warning tiers + quality metrics' },
  { feature: 'Reproducible output', upstream: 'Not guaranteed', fork: 'Yes — byte-identical across runs, CI-gated' },
  { feature: 'Command-line tool', upstream: '—', fork: 'Yes — the am CLI' },
  { feature: 'Agent / MCP surface', upstream: '—', fork: 'Yes — Code Mode MCP server, llms.txt' },
  { feature: 'Two-color theming + named themes + Shiki', upstream: 'Yes', fork: 'Inherited' },
]

type Card = {
  badge: string
  title: string
  body: string
}

const CARDS: Card[] = [
  {
    badge: '6 → 12 families',
    title: 'Twice as many diagram types',
    body: 'Beautiful Mermaid renders flowchart, state, sequence, class, ER, and XY charts. This fork keeps all six and adds <strong>timeline</strong>, <strong>user journey</strong>, <strong>architecture</strong>, <strong>pie</strong>, <strong>quadrant</strong>, and <strong>Gantt</strong> charts — Gantt with date axes, sections, dependencies, milestones, and markers.',
  },
  {
    badge: 'New',
    title: 'A hosted live editor',
    body: 'A mermaid.live-style editor lives at <code>/editor</code>: type on the left, see SVG and ASCII on the right. It ships <strong>Examples for every supported family</strong> plus role-style presets, instant theme switching, shareable URLs, and one-click SVG download.',
  },
  {
    badge: '+ PNG, JSON',
    title: 'More ways to export',
    body: 'On top of SVG and terminal-friendly ASCII / Unicode, this fork renders <strong>PNG offline</strong> (via resvg, no browser) and emits a <strong>JSON layout</strong> so you can place nodes yourself or feed another tool.',
  },
  {
    badge: 'New',
    title: 'Style by meaning, not by tag',
    body: 'A consistent styling API restyles diagrams by role — <code>style.node</code>, <code>style.edge</code>, <code>style.group</code>, and <code>style.text</code> — so the same options change cards, connectors, and containers across every family. Explore the <strong>Role Styles</strong> samples in the gallery.',
  },
  {
    badge: 'New',
    title: 'Mermaid config &amp; source wrappers',
    body: 'Paste diagrams straight from Mermaid: YAML frontmatter, <code>%%{init: …}%%</code> and <code>%%{initialize: …}%%</code> directives, and comments before the header are all honored and merged with your render options.',
  },
  {
    badge: 'New',
    title: 'Edit diagrams safely, not by regenerating',
    body: 'A render-only library forces you to rebuild the whole diagram to move one node. Here you can <strong>parse → mutate → verify → serialize</strong>: typed edits for all 12 families, and anything the parser doesn’t model round-trips <strong>losslessly</strong> instead of being silently dropped. Built for AI agents, useful for any script.',
  },
  {
    badge: 'New',
    title: 'Verify before you ship',
    body: '<code>verifyMermaid</code> returns <strong>structured warnings in three tiers</strong> (structural, geometric, lint) plus perceptual quality metrics for every family — so you catch a broken diagram from a report instead of by squinting at pixels.',
  },
  {
    badge: 'New',
    title: 'Reproducible, byte-identical output',
    body: 'Layout is deterministic and verified <strong>byte-for-byte identical across runs and processes</strong>, gated in CI. The same source always produces the same SVG — friendly to diffs, caches, and golden-file tests.',
  },
  {
    badge: 'Improved',
    title: 'Sharper layout &amp; ASCII',
    body: 'Fixes beyond upstream: cleaner fan-in grouping and fan-out trunk sharing, edges that attach to a subgraph container instead of a phantom node, <code>direction</code> overrides honored inside subgraphs, and ER cardinality parsed exactly like Mermaid — malformed lines error loudly instead of vanishing.',
  },
  {
    badge: 'New',
    title: 'A command line and an agent surface',
    body: 'The <code>am</code> CLI renders, verifies, mutates, previews, and batch-processes diagrams from a shell — and an <code>agentic-mermaid-mcp</code> Code Mode server plus a hosted <code>llms.txt</code> let coding agents drive the whole workflow.',
  },
]

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

  const comparisonRows = COMPARISON_ROWS.map(row => {
    const forkIsDash = row.fork === '—'
    const upstreamIsDash = row.upstream === '—'
    return `        <tr>
          <th scope="row">${row.feature}</th>
          <td${upstreamIsDash ? ' class="cell-dash"' : ''}>${escapeHtml(row.upstream)}</td>
          <td class="cell-fork${forkIsDash ? ' cell-dash' : ''}">${escapeHtml(row.fork)}</td>
        </tr>`
  }).join('\n')

  const cardsHtml = CARDS.map(card => `      <article class="diff-card shadow-minimal">
        <span class="diff-badge">${card.badge}</span>
        <h3 class="diff-card-title">${card.title}</h3>
        <p class="diff-card-body">${card.body}</p>
      </article>`).join('\n')

  const themesJson = JSON.stringify(THEMES)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" id="theme-color-meta" content="#f8f2eb" />
  <title>What's different in this fork — Agentic Mermaid</title>
  <meta name="description" content="The user-visible differences between Agentic Mermaid (this fork) and the original Beautiful Mermaid: twice the diagram types, a live editor, PNG and JSON output, semantic role styling, structured verification, deterministic output, and typed editing for agents." />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/x-icon" href="favicon.ico" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
  <meta property="og:title" content="What's different in this fork — Agentic Mermaid" />
  <meta property="og:description" content="Agentic Mermaid vs Beautiful Mermaid: twice the diagram types, a live editor, PNG/JSON output, semantic role styling, verification, deterministic output, and typed editing." />
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

    /* -- Hero header -- */
    .hero-header { max-width: 1180px; margin: 0 auto; padding: 5rem 2rem 1.5rem; text-align: left; }
    @media (min-width: 1000px) { .hero-header { padding: 5rem 3rem 1.5rem; } }
    .hero-eyebrow {
      font-size: 0.8125rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--t-accent); margin: 0 0 0.6rem;
    }
    .hero-title { font-size: 2.5rem; font-weight: 800; line-height: 1.15; margin: 0 0 0.5rem; color: var(--t-fg); }
    @media (max-width: 600px) { .hero-title { font-size: 2rem; } }
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

    /* -- Comparison table -- */
    .compare-wrap {
      border-radius: 18px; overflow: hidden;
      background: color-mix(in srgb, var(--t-fg) 2.5%, var(--t-bg));
    }
    .compare-table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
    .compare-table th, .compare-table td {
      text-align: left; padding: 0.85rem 1.15rem; vertical-align: top;
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
    }
    .compare-table thead th {
      font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 55%, var(--t-bg));
      background: color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
      position: sticky; top: 0;
    }
    .compare-table thead th.col-fork { color: var(--t-accent); }
    .compare-table tbody th {
      font-weight: 700; color: var(--t-fg);
      width: 38%;
    }
    .compare-table td { color: color-mix(in srgb, var(--t-fg) 72%, var(--t-bg)); }
    .compare-table td.cell-fork {
      color: var(--t-fg);
      background: color-mix(in srgb, var(--t-accent) 5%, var(--t-bg));
      font-weight: 500;
    }
    .compare-table td.cell-dash { color: color-mix(in srgb, var(--t-fg) 32%, var(--t-bg)); }
    .compare-table tbody tr:last-child th,
    .compare-table tbody tr:last-child td { border-bottom: none; }
    @media (max-width: 640px) {
      .compare-table th, .compare-table td { padding: 0.7rem 0.8rem; }
      .compare-table tbody th { width: 42%; }
    }

    /* -- Difference cards -- */
    .diff-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    .diff-card {
      background: var(--t-bg); border-radius: 16px; padding: 1.5rem;
      display: flex; flex-direction: column; gap: 0.6rem;
    }
    .diff-badge {
      align-self: flex-start;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.02em;
      padding: 0.2rem 0.6rem; border-radius: 999px;
      color: var(--t-accent);
      background: color-mix(in srgb, var(--t-accent) 12%, var(--t-bg));
      font-variant-numeric: tabular-nums;
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
    <p class="hero-eyebrow">Fork differences</p>
    <h1 class="hero-title">What's different in this fork</h1>
    <p class="hero-description">
      <strong>Agentic Mermaid</strong> is a fork of
      <a href="https://github.com/lukilabs/beautiful-mermaid" target="_blank" rel="noopener">Beautiful Mermaid</a>,
      the synchronous, browserless Mermaid renderer by Craft. It keeps everything that makes the
      original fast and good-looking, and adds twice the diagram types, a live editor, more
      export formats, semantic styling, structured verification, deterministic output, and a typed
      workflow for editing diagrams safely. Here is what you'll actually notice.
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

    <!-- At a glance -->
    <section class="section" id="at-a-glance" aria-labelledby="at-a-glance-title">
      <h2 class="section-title" id="at-a-glance-title">At a glance</h2>
      <p class="section-intro">
        The same core, two columns. The original is render-only for six families; this fork
        broadens what you can draw and adds an editing, verification, and tooling layer on top.
      </p>
      <div class="compare-wrap shadow-minimal">
        <table class="compare-table">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Beautiful Mermaid</th>
              <th scope="col" class="col-fork">Agentic Mermaid (this fork)</th>
            </tr>
          </thead>
          <tbody>
${comparisonRows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- The differences -->
    <section class="section" id="differences" aria-labelledby="differences-title">
      <h2 class="section-title" id="differences-title">The differences, in detail</h2>
      <p class="section-intro">
        Everything below is new or improved compared with upstream Beautiful Mermaid.
      </p>
      <div class="diff-grid">
${cardsHtml}
      </div>
    </section>

    <!-- Credit -->
    <section class="credit-box" aria-label="Built on Beautiful Mermaid">
      <h2>Built on Beautiful Mermaid</h2>
      <p>
        The synchronous zero-DOM renderer, the two-color theming foundation with named themes and
        Shiki compatibility, and the ASCII / Unicode output are all upstream's work — credit belongs
        there. This fork inherits them and layers new capabilities on top.
      </p>
      <p>
        Want the full story, including how this compares to Mermaid itself? See the
        <a href="https://github.com/adewale/beautiful-mermaid/blob/main/docs/comparison.md" target="_blank" rel="noopener">three-way comparison</a>
        and the <a href="https://github.com/adewale/beautiful-mermaid/blob/main/docs/fork-differences.md" target="_blank" rel="noopener">fork notes</a>.
        Need a different diagram family, or render-only output? The original
        <a href="https://github.com/lukilabs/beautiful-mermaid" target="_blank" rel="noopener">Beautiful Mermaid</a>
        and <a href="https://github.com/mermaid-js/mermaid" target="_blank" rel="noopener">Mermaid</a> may fit better.
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

const html = buildHtml()
const outPath = new URL('../../differences.html', import.meta.url).pathname
await Bun.write(outPath, html)
console.log(`Written to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
