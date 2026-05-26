/**
 * Generates index.html showcasing all beautiful-mermaid rendering capabilities.
 *
 * Usage: bun run index.ts
 *
 * This file doubles as a **visual test suite** — every supported feature,
 * shape, edge type, block construct, and theme variant is exercised by at
 * least one sample. If a rendering change causes regressions, it will be
 * visible in the generated HTML.
 *
 * The generated HTML is **dynamic** — it includes a bundled copy of the
 * mermaid renderer and renders all diagrams client-side in real time,
 * showing progressive loading and per-diagram render timing.
 *
 * Sample definitions live in samples-data.ts (shared with bench.ts).
 */

import { samples } from './samples-data.ts'
import { THEMES } from './src/theme.ts'
import { createHighlighter } from 'shiki'

// ============================================================================
// HTML generation — dynamic version
//
// Instead of pre-rendering SVGs at build time, we:
//   1. Bundle the mermaid renderer for the browser via Bun.build()
//   2. Embed sample definitions as inline JSON
//   3. Emit client-side JS that renders each diagram on page load
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert markdown-style backtick spans to <code> tags in description text. */
function formatDescription(text: string): string {
  return text.replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** Human-readable labels for theme keys */
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

export interface GenerateHtmlOptions {
  /** Filter to only these categories. If omitted, all categories are included. */
  categories?: Set<string>
  /** Override the page title. */
  title?: string
  /** Override the meta description. */
  description?: string
  /** Extra samples to append before filtering. */
  extraSamples?: typeof samples
  /** Theme keys to show as inline pills (in addition to Default). If omitted, uses built-in defaults. */
  visibleThemes?: Set<string>
}

// Lazy singleton Shiki highlighter — avoids creating multiple instances
// when generateHtml is called repeatedly (e.g. in property-based tests).
let _highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null
async function getHighlighter() {
  if (!_highlighter) {
    _highlighter = await createHighlighter({
      langs: ['mermaid'],
      themes: ['github-light'],
    })
  }
  return _highlighter
}

export async function generateHtml(options: GenerateHtmlOptions = {}): Promise<string> {
  // Step 0: Get (or create) Shiki highlighter for mermaid syntax highlighting.
  // We use 'github-light' as the base theme — its hex colors get overridden by CSS
  // color-mix() rules derived from --t-fg / --t-bg so tokens adapt to any theme.
  const highlighter = await getHighlighter()

  // Step 1: Bundle the mermaid renderer for the browser
  const buildResult = await Bun.build({
    entrypoints: [new URL('./src/browser.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!buildResult.success) {
    console.error('Bundle build failed:', buildResult.logs)
    process.exit(1)
  }
  const bundleJs = await buildResult.outputs[0]!.text()
  console.log(`Browser bundle: ${(bundleJs.length / 1024).toFixed(1)} KB`)

  // Step 2: Filter and build sample JSON
  const allSamples = options.extraSamples
    ? [...samples, ...options.extraSamples]
    : samples
  const filteredSamples = options.categories
    ? allSamples.filter(s => options.categories!.has(s.category ?? 'Other'))
    : allSamples

  const samplesJson = JSON.stringify(filteredSamples.map(s => ({
    title: s.title,
    description: s.description,
    source: s.source,
    category: s.category ?? 'Other',
    options: s.options ?? {},
  })))

  // Step 3: Group samples by category for TOC (done at build time since it's static)
  const categories = new Map<string, number[]>()
  filteredSamples.forEach((sample, i) => {
    const cat = sample.category ?? 'Other'
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(i)
  })

  const categoryBadgeColors: Record<string, string> = {
    Flowchart: '#3b82f6',
    Architecture: '#0ea5e9',
    State: '#8b5cf6',
    Sequence: '#10b981',
    Class: '#f59e0b',
    ER: '#ef4444',
    Journey: '#14b8a6',
    'XY Chart': '#f97316',
    'Role Styles': '#f97316',
    'Theme Showcase': '#06b6d4',
  }

  // Map category names to the title prefixes they use, so we can strip duplicates in the ToC
  const categoryPrefixes: Record<string, string> = {
    'Architecture': 'Architecture: ',
    'State': 'State: ',
    'Sequence': 'Sequence: ',
    'Class': 'Class: ',
    'ER': 'ER: ',
    'Journey': 'Journey: ',
    'XY Chart': 'XY: ',
    'Role Styles': 'Style: ',
    'Theme Showcase': 'Theme: ',
  }

  // Build mapping from original index to display number (excluding Hero samples)
  const heroCount = filteredSamples.filter(s => s.category === 'Hero').length
  const displayNum = (i: number) => i + 1 - heroCount

  const tocSections = [...categories.entries()]
    .filter(([cat]) => cat !== 'Hero') // Skip Hero from TOC
    .map(([cat, indices]) => {
    const badgeColor = categoryBadgeColors[cat] ?? '#71717a'
    const prefix = categoryPrefixes[cat]
    const items = indices.map(i => {
      let title = filteredSamples[i]!.title
      // Strip the category prefix from the title since it's already under the category heading
      if (prefix && title.startsWith(prefix)) title = title.slice(prefix.length)
      return `<li><a href="#sample-${i}"><span class="toc-num">${displayNum(i)}.</span> ${escapeHtml(title)}</a></li>`
    }).join('\n            ')
    return `
        <div class="toc-category">
          <h3>${escapeHtml(cat)} (${indices.length} samples)</h3>
          <ol start="${displayNum(indices[0]!)}">
            ${items}
          </ol>
        </div>`
  }).join('\n')

  // Step 3b: Build theme selector pills (build-time so we include swatches)
  // Only show Default, Dracula, and Solarized inline; rest go in "More" dropdown
  const DEFAULT_THEME_KEY: string = 'salmon'
  const VISIBLE_THEMES = options.visibleThemes ?? new Set([DEFAULT_THEME_KEY, 'dracula', 'solarized-light'])

  function buildThemePill(key: string, colors: { bg: string; fg: string }, active = false): string {
    const isDark = parseInt(colors.bg.replace('#', '').slice(0, 2), 16) < 0x80
    const shadow = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'
    const label = key === '' ? 'Default' : (THEME_LABELS[key] ?? key)
    const activeClass = active ? ' active' : ''
    return `<button class="theme-pill shadow-minimal${activeClass}" data-theme="${key}"><span class="theme-swatch" style="background:${colors.bg};box-shadow:inset 0 0 0 1px ${shadow}"></span>${escapeHtml(label)}</button>`
  }

  const themeEntries = Object.entries(THEMES)
  // Visible inline pills: Default + Dracula + Solarized
  const visiblePills = [
    buildThemePill('', { bg: '#FFFFFF', fg: '#27272A' }, DEFAULT_THEME_KEY === ''),
    ...themeEntries
      .filter(([key]) => VISIBLE_THEMES.has(key))
      .map(([key, colors]) => buildThemePill(key, colors, key === DEFAULT_THEME_KEY)),
  ]
  // All themes go in the dropdown (including Default, Salmon, Dracula, Solarized)
  const allDropdownPills = [
    buildThemePill('', { bg: '#FFFFFF', fg: '#27272A' }, DEFAULT_THEME_KEY === ''),
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

  // Step 4: Pre-highlight all sample sources with Shiki (build-time only, zero runtime cost).
  // The mermaid TextMate grammar requires a fenced code block prefix to tokenize properly
  // (see https://github.com/shikijs/shiki/issues/973), so we wrap each source with
  // ```mermaid ... ``` and then strip those fence lines from the output HTML.
  // Source panels always use github-dark — Shiki's inline colors are used directly.
  const highlightedSources = filteredSamples.map(sample => {
    const fenced = '```mermaid\n' + sample.source.trim() + '\n```'
    const html = highlighter.codeToHtml(fenced, {
      lang: 'mermaid',
      theme: 'github-light',
    })
    // Strip the first line (```mermaid) and last line (```) from the output
    return html.replace(
      /(<code>)<span class="line">.*?<\/span>\n/,  // first line
      '$1'
    ).replace(
      /\n<span class="line">.*?<\/span>(<\/code>)/, // last line
      '$1'
    )
  })

  // Step 5: Build sample card HTML shells (SVG + ASCII are empty, filled client-side)
  // data-sample-bg stores the per-sample background for "Default" mode restoration.
  // Hero samples get special full-width SVG-only treatment and are placed before "Samples" heading.
  const heroCards: string[] = []
  const regularCards: string[] = []

  filteredSamples.forEach((sample, i) => {
    const bg = sample.options?.bg ?? ''
    const isHero = sample.category === 'Hero'

    if (isHero) {
      // Hero sample: full-width SVG only, no header/source/ASCII panels
      heroCards.push(`
    <section class="sample sample-hero" id="sample-${i}">
      <div class="hero-diagram-panel" id="svg-panel-${i}" data-sample-bg="${bg}">
        <div class="svg-container" id="svg-${i}">
          <div class="loading-spinner"></div>
        </div>
      </div>
    </section>`)
    } else {
      regularCards.push(`
    <section class="sample" id="sample-${i}">
      <div class="sample-header">
        <h2>${escapeHtml(sample.title)}</h2>
        <p class="description">${formatDescription(sample.description)}</p>
      </div>
      <div class="sample-content">
        <div class="source-panel" id="source-panel-${i}">
          ${highlightedSources[i]}
          ${sample.options ? `<div class="options"><strong>Options:</strong> <code>${escapeHtml(JSON.stringify(sample.options))}</code></div>` : ''}
          <button class="edit-btn" data-sample="${i}">Edit</button>
        </div>
        <div class="svg-panel" id="svg-panel-${i}" data-sample-bg="${bg}">
          <div class="svg-container" id="svg-${i}">
            <div class="loading-spinner"></div>
          </div>
        </div>
        <div class="ascii-panel" id="ascii-panel-${i}">
          <pre class="ascii-output"><code id="ascii-${i}">Rendering\u2026</code></pre>
        </div>
      </div>
    </section>`)
    }
  })

  const heroCardsHtml = heroCards.join('\n')
  const regularCardsHtml = regularCards.join('\n')

  // ============================================================================
  // Step 5: Assemble full HTML
  // ============================================================================

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" id="theme-color-meta" content="#f8f2eb" />
  <title>${escapeHtml(options.title ?? 'Beautiful Mermaid — Mermaid Rendering, Made Beautiful')}</title>
  <meta name="description" content="${escapeHtml(options.description ?? 'Open source diagram rendering library built for the AI era. Ultra-fast, fully themeable, outputs to SVG and ASCII. Supports Flowchart, State, Architecture, Sequence, Class, ER, Timeline, Journey, and XY diagrams.')}" />
  <link rel="icon" type="image/svg+xml" href="/mermaid/favicon.svg" />
  <link rel="icon" type="image/x-icon" href="/mermaid/favicon.ico" />
  <link rel="apple-touch-icon" href="/mermaid/apple-touch-icon.png" />
  <meta property="og:title" content="Beautiful Mermaid" />
  <meta property="og:description" content="Open source diagram rendering library built for the AI era. Ultra-fast, fully themeable, outputs to SVG and ASCII." />
  <meta property="og:image" content="https://adewale.github.io/beautiful-mermaid/og-image.png" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://adewale.github.io/beautiful-mermaid/" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Beautiful Mermaid" />
  <meta name="twitter:description" content="Mermaid rendering, made beautiful. Ultra-fast, fully themeable, outputs to SVG and ASCII." />
  <meta name="twitter:image" content="https://adewale.github.io/beautiful-mermaid/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    /* -- Reset & base -- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* -----------------------------------------------------------------
     * CSS custom property theming
     *
     * --t-bg and --t-fg drive the entire page color scheme.
     * All other colors are derived via color-mix(). When a theme is
     * selected from the pill bar, JS updates these two variables on
     * <body> — and the whole page adapts instantly.
     * ----------------------------------------------------------------- */
    body {
      --t-bg: #FFFBF5;
      --t-fg: #521000;
      --t-accent: #FF4801;
      --foreground-rgb: 82, 16, 0;
      --accent-rgb: 255, 72, 1;
      --shadow-border-opacity: 0.08;
      --shadow-blur-opacity: 0.06;
      --theme-bar-bg: #f8f2eb;  /* Mixed bg for theme bar and top gradient — updated by JS on theme change */

      font-family: 'Geist', system-ui, -apple-system, sans-serif;
      background: color-mix(in srgb, var(--t-fg) 4%, var(--t-bg));
      color: var(--t-fg);
      line-height: 1.6;
      margin: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .content-wrapper {
      max-width: 1440px;
      margin: 0 auto;
      padding: 2rem;
      padding-top: 0;
    }
    @media (max-width: 768px) {
      .content-wrapper {
        padding: 1rem;
        padding-top: 0;
      }
    }
    @media (min-width: 1000px) {
      .content-wrapper {
        padding: 3rem;
        padding-top: 0;
      }
    }

    /* -- Scroll fade gradients (GPU accelerated) -- */
    body::before,
    body::after {
      content: '';
      position: fixed;
      left: 0;
      right: 0;
      height: 64px;
      pointer-events: none;
      z-index: 1000;
      will-change: transform;
    }
    body::before {
      top: 0;
      background: linear-gradient(to bottom, var(--theme-bar-bg) 0%, transparent 100%);
    }
    body::after {
      bottom: 0;
      background: linear-gradient(to top, var(--theme-bar-bg) 0%, transparent 100%);
    }

    /* -- Theme selector bar (full-width, sits outside .content-wrapper) -- */
    .theme-bar {
      position: sticky;
      top: 0;
      z-index: 1001;
      background: transparent;
      padding: 0.5rem 2rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      overflow: visible;
    }
    @media (max-width: 768px) {
      .theme-bar {
        padding: 0.5rem 1rem;
      }
    }
    .theme-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      white-space: nowrap;
    }
    .theme-pills {
      display: flex;
      gap: 0.3rem;
      overflow: visible;
      padding: 4px;
      margin: -4px;
      margin-left: auto;
      position: relative;
      z-index: 2;
    }
    .theme-pills-inline {
      display: flex;
      gap: 0.3rem;
    }
    /* Hide inline theme pills on smaller screens, show only "15 Themes" dropdown */
    @media (max-width: 1024px) {
      .theme-pills-inline {
        display: none;
      }
    }
    .theme-pill {
      display: flex;
      align-items: center;
      height: 30px;
      gap: 8px;
      padding: 0 14px 0 12px;
      border: none;
      border-radius: 8px;
      background: color-mix(in srgb, var(--t-bg) 97%, var(--t-fg));
      color: color-mix(in srgb, var(--t-fg) 80%, var(--t-bg));
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s, background 0.15s, box-shadow 0.2s, transform 0.1s;
    }
    .theme-pill:hover {
      color: var(--t-fg);
      background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg));
    }
    .theme-pill.active {
      color: var(--t-fg);
      background: var(--t-bg);
      font-weight: 600;
    }
    .theme-pill:active {
      transform: translateY(0.5px);
    }
    .theme-swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* -- "More" dropdown for overflow themes -- */
    .theme-more-wrapper {
      position: relative;
    }
    .theme-more-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: var(--t-bg);
      border-radius: 12px;
      padding: 6px;
      flex-direction: column;
      gap: 2px;
      min-width: 160px;
      z-index: 1002;
    }
    .theme-more-dropdown.open {
      display: flex;
    }
    .theme-more-dropdown .theme-pill {
      width: 100%;
      justify-content: flex-start;
      background: transparent;
      box-shadow: none;
    }
    .theme-more-dropdown .theme-pill:hover {
      background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg));
    }
    /* Active pill in dropdown gets bg + shadow-minimal (same as inline pills) */
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

    /* -- Brand badge (left-aligned in theme bar) -- */
    .brand-badge-wrapper {
      position: relative;
    }
    .brand-badge {
      display: flex;
      align-items: center;
      height: 30px;
      gap: 6px;
      padding: 0 12px;
      border: none;
      border-radius: 8px;
      background: color-mix(in srgb, var(--t-bg) 97%, var(--t-fg));
      color: color-mix(in srgb, var(--t-fg) 80%, var(--t-bg));
      font-size: 12px;
      font-weight: 400;
      font-family: inherit;
      white-space: nowrap;
      cursor: default;
      transition: color 0.15s, background 0.15s, box-shadow 0.2s;
    }

    /* -- Brand dropdown -- */
    .brand-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      background: var(--t-bg);
      border-radius: 12px;
      padding: 6px;
      flex-direction: column;
      gap: 2px;
      width: max-content;
      z-index: 1002;
    }
    .brand-dropdown.open {
      display: flex;
    }
    .brand-dropdown-item {
      display: flex;
      align-items: center;
      height: 34px;
      gap: 8px;
      padding: 0 12px;
      border-radius: 8px;
      background: transparent;
      color: var(--t-fg);
      text-decoration: none;
      font-size: 13px;
      font-weight: 400;
      transition: background 0.15s;
    }
    .brand-dropdown-item:hover {
      background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg));
    }
    .brand-dropdown-logo {
      flex-shrink: 0;
    }
    .brand-dropdown-item .tagline {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      font-weight: 300;
      margin-left: 0.25rem;
    }
    .brand-dropdown-item .tagline::before {
      content: '·';
      margin-right: 0.25rem;
    }

    /* -- Contents button (screen-centered via absolute positioning) -- */
    .contents-btn {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      height: 30px;
      gap: 6px;
      padding: 0 12px;
      border: none;
      border-radius: 8px;
      background: color-mix(in srgb, var(--t-bg) 97%, var(--t-fg));
      color: color-mix(in srgb, var(--t-fg) 80%, var(--t-bg));
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s, background 0.15s, box-shadow 0.2s, transform 0.1s;
    }
    .contents-btn:hover {
      color: var(--t-fg);
      background: color-mix(in srgb, var(--t-bg) 92%, var(--t-fg));
    }
    .contents-btn.active {
      color: var(--t-fg);
      background: var(--t-bg);
    }
    .contents-btn:active {
      transform: translateX(-50%) translateY(0.5px);
    }
    .contents-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    /* Hide contents button before it collides with theme pills */
    @media (max-width: 1200px) {
      .contents-btn,
      .mega-menu {
        display: none !important;
      }
    }
    /* -- Shadow + radius utilities -- */
    .rounded-6px { border-radius: 6px; }
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

    /* -- Mega menu dropdown (x-centered with Contents button) -- */
    .mega-menu {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      max-width: min(1180px, calc(100vw - 2rem));
      width: max-content;
      background: var(--t-bg);
      border-radius: 12px;
      padding: 1.5rem 2rem;
      max-height: 70vh;
      overflow-y: auto;
      overflow-x: hidden;
      z-index: 998;
    }
    .mega-menu.open {
      display: block;
    }
    .toc-grid {
      columns: 4;
      column-gap: 2rem;
    }
    @media (max-width: 1200px) {
      .toc-grid {
        columns: 3;
      }
    }
    .toc-category {
      display: inline-block;
      width: 100%;
      margin: 0;
      padding-bottom: 1rem;
    }
    .toc-category h3 {
      font-size: 0.85rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
      color: var(--t-fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toc-category ol {
      padding: 0;
      margin: 0;
      list-style: none;
      font-size: 0.8rem;
    }
    .toc-category li {
      margin-bottom: 0.15rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toc-category a { color: var(--t-fg); text-decoration: none; }
    .toc-category a:hover { text-decoration: underline; }
    .toc-num { color: color-mix(in srgb, var(--t-fg) 30%, var(--t-bg)); }

    /* -- Sample card -- */
    .sample {
      background: var(--t-bg);
      margin-bottom: 2rem;
      overflow: hidden;
    }

    /* -- Hero sample (full-width SVG showcase, above Samples heading) -- */
    .sample-hero {
      margin-bottom: 0;
      background: transparent;
    }
    .hero-diagram-panel {
      padding: 1rem 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
    }
    .hero-diagram-panel .svg-container {
      width: 100%;
      max-width: 100%;
    }
    .hero-diagram-panel .svg-container svg {
      width: 100%;
      height: auto;
    }

    .sample-header {
      padding: 1.25rem 1.5rem;
      max-width: 48rem;
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
    }
    .sample-header h2 {
      font-size: 1.5rem;
      font-weight: 500;
      color: var(--t-fg);
    }
    .description {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      font-size: 1rem;
      font-weight: 400;
      margin-top: 0.1rem;
    }
    .description code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.875em;
      color: color-mix(in srgb, var(--t-fg) 85%, var(--t-bg));
      background: color-mix(in srgb, var(--t-fg) 6%, var(--t-bg));
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
    }

    .sample-content {
      display: grid;
      grid-template-columns:
        minmax(200px, 1fr)
        minmax(250px, 2fr)
        minmax(250px, 2fr);
      min-height: 420px;
    }
    @media (max-width: 900px) {
      .sample-content { grid-template-columns: 1fr; }
      .ascii-panel { border-left: none !important; border-top: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg)) !important; }
    }

    /* -- Source panel -- */
    .source-panel {
      position: relative;
      padding: 0.75rem 1.5rem;
      border-right: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
      min-width: 0;      /* grid child: allow shrinking below content width */
      overflow-y: auto;
    }
    .source-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .source-panel pre {
      padding: 1rem;
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .source-panel code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    /* -- Shiki syntax highlighting overrides --
     * Shiki outputs inline style="color:#hex" per token. We override these with
     * color-mix() rules derived from --t-fg / --t-bg so tokens adapt to any theme.
     * The hex values below are from the github-light Shiki theme used at build time. */
    .source-panel {
      background: color-mix(in srgb, var(--t-fg) 1.5%, var(--t-bg));
    }
    .source-panel .shiki {
      background: transparent !important;
      padding: 0.5rem 0;
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
    }
    .source-panel .shiki code {
      background: transparent;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }
    /* Default text */
    .source-panel .shiki,
    .source-panel .shiki span[style*="#24292e"],
    .source-panel .shiki span[style*="#24292E"] {
      color: color-mix(in srgb, var(--t-fg) 70%, var(--t-bg)) !important;
    }
    /* Keywords: graph, subgraph, end, participant, -->, classDef, brackets */
    .source-panel .shiki span[style*="#D73A49"],
    .source-panel .shiki span[style*="#d73a49"] {
      color: color-mix(in srgb, var(--t-fg) 90%, var(--t-bg)) !important;
      font-weight: 500;
    }
    /* Direction labels, subgraph names */
    .source-panel .shiki span[style*="#6F42C1"],
    .source-panel .shiki span[style*="#6f42c1"] {
      color: color-mix(in srgb, var(--t-fg) 65%, var(--t-bg)) !important;
    }
    /* Node IDs */
    .source-panel .shiki span[style*="#E36209"],
    .source-panel .shiki span[style*="#e36209"] {
      color: color-mix(in srgb, var(--t-fg) 75%, var(--t-bg)) !important;
    }
    /* Strings, labels, message text */
    .source-panel .shiki span[style*="#032F62"],
    .source-panel .shiki span[style*="#032f62"] {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg)) !important;
    }
    .options {
      margin-top: 0.75rem;
      font-size: 0.8rem;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
    }
    .options code {
      background: color-mix(in srgb, var(--t-fg) 6%, var(--t-bg));
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    /* -- Edit button (subtle text link, bottom-left of source panel) -- */
    .edit-btn {
      position: absolute;
      bottom: 0.75rem;
      left: 1.5rem;
      background: none;
      border: none;
      padding: 0;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      cursor: pointer;
      text-decoration: none;
      transition: color 0.15s;
    }
    .edit-btn:hover {
      color: var(--t-fg);
      text-decoration: underline;
    }

    /* -- Edit dialog overlay -- */
    .edit-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      align-items: center;
      justify-content: center;
    }
    .edit-overlay.open { display: flex; }
    .edit-dialog {
      background: var(--t-bg);
      border-radius: 16px;
      width: min(680px, calc(100vw - 3rem));
      max-height: calc(100vh - 4rem);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .edit-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
    }
    .edit-dialog-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--t-fg);
    }
    .edit-dialog-close {
      background: none;
      border: none;
      font-size: 1.25rem;
      color: color-mix(in srgb, var(--t-fg) 40%, var(--t-bg));
      cursor: pointer;
      padding: 0 0.25rem;
      line-height: 1;
    }
    .edit-dialog-close:hover { color: var(--t-fg); }
    .edit-dialog-textarea {
      flex: 1;
      min-height: 300px;
      max-height: 60vh;
      margin: 0;
      padding: 1rem 1.25rem;
      border: none;
      outline: none;
      resize: none;
      background: color-mix(in srgb, var(--t-fg) 2%, var(--t-bg));
      color: var(--t-fg);
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      white-space: pre;
      tab-size: 2;
    }
    .edit-dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      border-top: 1px solid color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
    }
    .edit-dialog-btn {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: none;
      font-size: 0.8rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .edit-dialog-btn:hover { opacity: 0.85; }
    .edit-dialog-cancel {
      background: color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
      color: var(--t-fg);
    }
    .edit-dialog-save {
      background: var(--t-fg);
      color: var(--t-bg);
    }

    /* -- SVG panel -- */
    .svg-panel {
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      min-width: 0;      /* grid child: allow shrinking below content width */
      /* Background set dynamically: matches the SVG --bg in default mode,
         or the global theme bg when a theme is active. */
    }
    .svg-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .svg-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;     /* flex child: allow shrinking to fit */
    }
    .svg-container svg {
      max-width: 100%;
      max-height: 100%;  /* scale down to fit both axes */
      height: auto;
    }

    /* -- ASCII panel -- */
    .ascii-panel {
      padding: 1.25rem 1.5rem;
      border-left: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 0;      /* grid child: allow shrinking below content width */
    }
    .ascii-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .ascii-output {
      padding: 1rem;
      font-size: 0.7rem;
      line-height: 1.3;
      overflow-x: auto;   /* horizontal scroll only */
      overflow-y: hidden;  /* scale to height, no vertical scroll */
      white-space: pre;
      flex: 1;
      max-width: 100%;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    /* -- Loading spinner -- */
    .loading-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
      border-top-color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* -- Timing badge -- */
    .timing {
      font-size: 0.7rem;
      font-weight: 400;
      color: color-mix(in srgb, var(--t-fg) 30%, var(--t-bg));
      margin-left: 0.5rem;
      text-transform: none;
      letter-spacing: normal;
    }

    /* -- Error state -- */
    .render-error {
      color: #ef4444;
      font-size: 0.85rem;
      font-family: 'JetBrains Mono', monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* -- Hero header section -- */
    .hero-header {
      max-width: 1440px;
      margin: 0 auto;
      padding: 6rem 2rem 2rem;
      text-align: left;
    }
    @media (min-width: 1000px) {
      .hero-header {
        padding: 6rem 3rem 2rem;
      }
    }
    .hero-title {
      font-size: 2.25rem;
      font-weight: 800;
      line-height: 1.2;
      margin: 0 0 0.25rem;
      color: var(--t-fg);
    }
    .hero-tagline {
      font-size: 1rem;
      font-weight: 500;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      margin: 0 0 1rem;
    }
    .hero-description {
      font-size: 0.95rem;
      line-height: 1.6;
      color: color-mix(in srgb, var(--t-fg) 70%, var(--t-bg));
      margin: 0 0 1.5rem;
      max-width: 680px;
    }
    .hero-description a {
      color: var(--t-fg);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .hero-description a:hover {
      color: var(--t-accent);
    }
    .hero-buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    @media (max-width: 768px) {
      .hero-buttons {
        flex-direction: column;
      }
    }
    .hero-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.25;
      border-radius: 12px;
      text-decoration: none;
      transition: opacity 0.15s, transform 0.1s;
      cursor: pointer;
      border: none;
      margin: 0;
      box-sizing: border-box;
      font-family: inherit;
    }
    .hero-btn:hover {
      opacity: 0.9;
    }
    .hero-btn:active {
      transform: translateY(0.5px);
    }
    .hero-btn-primary {
      background: var(--t-fg);
      color: var(--t-bg);
      box-shadow:
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0.1) 0px 1px 3px 0px,
        rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
    }
    .hero-btn-secondary {
      background: var(--t-bg);
      color: var(--t-fg);
      box-shadow:
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(0, 0, 0, 0) 0px 0px 0px 0px,
        rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.1) 0px 1px 3px 0px,
        rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
    }
    .hero-btn svg {
      width: 16px;
      height: 16px;
    }
    .hero-description code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.85em;
      background: color-mix(in srgb, var(--t-fg) 8%, var(--t-bg));
      padding: 0.15em 0.4em;
      border-radius: 4px;
    }

    /* -- Hero meta (below buttons) -- */
    .hero-meta {
      margin-top: 1.25rem;
    }
    .hero-meta .meta {
      font-size: 0.85rem;
      color: color-mix(in srgb, var(--t-fg) 40%, var(--t-bg));
      margin: 0.15rem 0;
    }

    .hero-meta .meta a {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .hero-meta .meta a:hover {
      color: var(--t-fg);
    }

    /* -- Section title -- */
    .section-title {
      font-size: 1.875rem;
      font-weight: 800;
      line-height: 1.2;
      margin: 0;
      padding: 2.5rem 0 1.5rem;
      color: var(--t-fg);
    }

    /* -- Footer -- */
    .site-footer {
      position: relative;
      z-index: 10;
      padding: 1.5rem 2rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 1440px;
      width: 100%;
      margin: 0 auto;
      font-size: 12px;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
    }
    @media (min-width: 1000px) {
      .site-footer {
        padding: 1.5rem 3rem 2rem;
      }
    }
    .footer-links {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .footer-links a {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      text-decoration: none;
      transition: color 0.15s;
    }
    .footer-links a:hover {
      color: var(--t-fg);
    }
    .footer-links svg {
      width: 1.25rem;
      height: 1.25rem;
      display: block;
    }
  </style>
</head>
<body>
  <!-- Safari 26+ reads title bar color from the topmost fixed element's background.
       This invisible 1px div provides a real DOM element for Safari to detect. -->

  <!-- Navigation + theme bar -->
  <div class="theme-bar" id="theme-bar">
    <div class="brand-badge-wrapper">
      <div class="brand-badge shadow-minimal" id="brand-badge"><span><strong>Beautiful Mermaid</strong></span></div>
    </div>
    <button class="contents-btn shadow-minimal" id="contents-btn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="10" y2="12"/></svg>Contents</button>
    <div class="theme-pills" id="theme-pills">
      ${themePillsHtml}
    </div>
    <div class="mega-menu shadow-modal-small" id="mega-menu">
      <div class="toc-grid">
        ${tocSections}
      </div>
    </div>
  </div>

  <!-- Hero header section -->
  <header class="hero-header">
    <h1 class="hero-title">Beautiful Mermaid</h1>
    <p class="hero-tagline">Mermaid Rendering, made beautiful.</p>
    <p class="hero-description">
      An open source library for rendering Mermaid diagrams as polished SVG and terminal-friendly ASCII: <a href="https://www.npmjs.com/package/beautiful-mermaid" target="_blank" rel="noopener"><code>beautiful-mermaid</code></a>.
      Fast, fully themeable, and dependency-light. This fork adds a live editor, expanded diagram coverage, semantic role styling, and export tools.
    </p>
    <div class="hero-buttons">
      <a href="editor" id="editor-link" class="hero-btn hero-btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        Editor
      </a>
      <a href="https://github.com/adewale/beautiful-mermaid/blob/main/FORK_DIFFERENCES.md" target="_blank" rel="noopener" class="hero-btn hero-btn-secondary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Fork Notes
      </a>
      <a href="https://github.com/adewale/beautiful-mermaid" target="_blank" rel="noopener" class="hero-btn hero-btn-secondary">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        GitHub
      </a>
      <button type="button" class="hero-btn hero-btn-secondary" id="random-theme-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
        Random Theme
      </button>
    </div>
    <div class="hero-meta">
      <p class="meta" id="total-timing">Rendering ${filteredSamples.length} examples\u2026</p>
      <div class="meta">ASCII rendering based on <a href="https://github.com/AlexanderGrooff/mermaid-ascii" target="_blank" rel="noopener">Mermaid-ASCII</a></div>
      <div class="meta">New fork features: open <strong>Contents → Role Styles</strong> or the editor <strong>Examples</strong> menu.</div>
      <div class="meta">Early preview — actively evolving</div>
    </div>
  </header>

  <div class="content-wrapper">

${heroCardsHtml}

  <h2 class="section-title">Samples</h2>

${regularCardsHtml}

  <!-- Bundled mermaid renderer — exposes window.__mermaid -->
  <script type="module">
${bundleJs}

  // ============================================================================
  // Client-side rendering + theme switching
  // ============================================================================

  var samples = ${samplesJson};
  var THEMES = window.__mermaid.THEMES;
  var renderMermaid = window.__mermaid.renderMermaidSVGAsync;
  var renderMermaidAscii = window.__mermaid.renderMermaidASCII;
  var diagramColorsToAsciiTheme = window.__mermaid.diagramColorsToAsciiTheme;
  var getSeriesColor = window.__mermaid.getSeriesColor;
  var CHART_ACCENT_FALLBACK = window.__mermaid.CHART_ACCENT_FALLBACK;

  var totalTimingEl = document.getElementById('total-timing');

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    var value = hex.trim();
    if (value[0] === '#') value = value.slice(1);
    if (value.length === 3) {
      value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
    }
    if (value.length !== 6) return null;
    var intValue = parseInt(value, 16);
    if (Number.isNaN(intValue)) return null;
    return {
      r: (intValue >> 16) & 255,
      g: (intValue >> 8) & 255,
      b: intValue & 255,
    };
  }

  var DEFAULT_PAGE_THEME = 'salmon';
  var activeThemeKey = '';

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

  // Update <meta name="theme-color"> and --theme-bar-bg so the browser
  // title bar and scroll-fade gradients match the active theme.
  function updateThemeColor(fg, bg) {
    var fgRgb = hexToRgb(fg) || { r: 39, g: 39, b: 42 };
    var bgRgb = hexToRgb(bg) || { r: 255, g: 255, b: 255 };
    var r = Math.round(bgRgb.r * 0.96 + fgRgb.r * 0.04);
    var g = Math.round(bgRgb.g * 0.96 + fgRgb.g * 0.04);
    var b = Math.round(bgRgb.b * 0.96 + fgRgb.b * 0.04);
    var hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    document.getElementById('theme-color-meta').setAttribute('content', hex);
    document.body.style.setProperty('--theme-bar-bg', hex);
  }

  // Apply theme colors to an SVG element's CSS variables.
  function applySvgThemeVars(svgEl, theme) {
    svgEl.style.setProperty('--bg', theme.bg);
    svgEl.style.setProperty('--fg', theme.fg);
    var props = ['line', 'accent', 'muted', 'surface', 'border'];
    for (var k = 0; k < props.length; k++) {
      if (theme[props[k]]) svgEl.style.setProperty('--' + props[k], theme[props[k]]);
      else svgEl.style.removeProperty('--' + props[k]);
    }
    var maxColor = parseInt(svgEl.getAttribute('data-xychart-colors') || '-1', 10);
    if (maxColor >= 0) {
      var accent = theme.accent || CHART_ACCENT_FALLBACK;
      svgEl.style.setProperty('--xychart-color-0', accent);
      for (var ci = 1; ci <= maxColor; ci++) {
        svgEl.style.setProperty('--xychart-color-' + ci, getSeriesColor(ci, accent, theme.bg));
      }
    }
  }

  // Set page-level CSS variables, pills, and localStorage — no re-rendering.
  function applyPageTheme(themeKey, persist) {
    if (typeof persist === 'undefined') persist = true;
    activeThemeKey = themeKey || '';
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
      var isActive = pills[j].getAttribute('data-theme') === themeKey;
      pills[j].classList.toggle('active', isActive);
      pills[j].classList.toggle('shadow-tinted', isActive);
    }

    if (persist) {
      if (themeKey) {
        localStorage.setItem('mermaid-theme', themeKey);
      } else {
        localStorage.removeItem('mermaid-theme');
      }
    }
  }

  // Full theme switch: update page vars + re-render all diagrams.
  function applyTheme(themeKey) {
    var theme = themeKey ? THEMES[themeKey] : null;
    applyPageTheme(themeKey);

    // Update SVG panel backgrounds (skip hero panels — keep transparent)
    for (var j = 0; j < samples.length; j++) {
      var panel = document.getElementById('svg-panel-' + j);
      if (!panel || panel.classList.contains('hero-diagram-panel')) continue;
      if (theme) {
        panel.style.background = theme.bg;
      } else {
        panel.style.background = panel.getAttribute('data-sample-bg') || '';
      }
    }

    // Re-render all SVGs with theme colors
    (async function() {
      for (var j = 0; j < samples.length; j++) {
        var svgContainer = document.getElementById('svg-' + j);
        if (!svgContainer) continue;
        var opts = theme
          ? Object.assign({}, samples[j].options || {}, { bg: theme.bg, fg: theme.fg, line: theme.line, accent: theme.accent, muted: theme.muted, surface: theme.surface, border: theme.border })
          : samples[j].options;
        try {
          var svg = await renderMermaid(samples[j].source, opts || {});
          svgContainer.innerHTML = svg;
        } catch (e) { /* keep existing */ }
      }
    })();

    // Re-render ASCII panels
    var asciiTheme = theme ? diagramColorsToAsciiTheme(theme) : null;
    for (var j = 0; j < samples.length; j++) {
      var asciiEl = document.getElementById('ascii-' + j);
      if (!asciiEl) continue;
      try {
        asciiEl.innerHTML = renderMermaidAscii(
          samples[j].source,
          asciiTheme ? { theme: asciiTheme } : {}
        );
      } catch (e) { /* keep existing content */ }
    }
  }

  // -- Set up theme pill click handlers --
  document.getElementById('theme-pills').addEventListener('click', function(e) {
    var pill = e.target.closest('.theme-pill');
    if (!pill || pill.id === 'theme-more-btn') return;
    applyTheme(pill.getAttribute('data-theme') || '');
    // Close "More" dropdown if a theme was picked from it
    var dd = document.getElementById('theme-more-dropdown');
    if (dd && dd.classList.contains('open')) dd.classList.remove('open');
  });

  // -- Dropdown helper: open/close, outside-click, Escape --
  function setupDropdown(btn, dropdown, wrapperSelectors, toggleBtnClasses) {
    if (typeof toggleBtnClasses === 'undefined') toggleBtnClasses = true;
    var selectors = typeof wrapperSelectors === 'string' ? [wrapperSelectors] : wrapperSelectors;
    function close() {
      dropdown.classList.remove('open');
      if (toggleBtnClasses) {
        btn.classList.remove('active');
        btn.classList.remove('shadow-tinted');
      }
    }
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.toggle('open');
      if (toggleBtnClasses) {
        btn.classList.toggle('active', isOpen);
        btn.classList.toggle('shadow-tinted', isOpen);
      }
    });
    document.addEventListener('click', function(e) {
      if (!dropdown.classList.contains('open')) return;
      for (var i = 0; i < selectors.length; i++) {
        if (e.target.closest(selectors[i])) return;
      }
      close();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && dropdown.classList.contains('open')) close();
    });
  }

  var moreBtn = document.getElementById('theme-more-btn');
  var moreDropdown = document.getElementById('theme-more-dropdown');
  if (moreBtn && moreDropdown) setupDropdown(moreBtn, moreDropdown, '.theme-more-wrapper', false);

  // -- Random theme button --
  // Resolve the Editor link against the current path so it works under both
  // / (direct Pages URL) and /mermaid (Worker proxy, with or without trailing slash).
  // Note: this script is embedded inside a TypeScript template literal, so regex
  // backslashes get consumed during string interpolation. We use endsWith/slice
  // here instead of a regex literal to avoid escaping pitfalls.
  var editorLink = document.getElementById('editor-link');
  if (editorLink) {
    var basePath = location.pathname;
    if (basePath.indexOf('/index.html', basePath.length - 11) !== -1) {
      basePath = basePath.slice(0, basePath.length - 11);
    }
    if (basePath.charAt(basePath.length - 1) === '/') {
      basePath = basePath.slice(0, basePath.length - 1);
    }
    editorLink.href = basePath + '/editor';
  }

  var randomThemeBtn = document.getElementById('random-theme-btn');
  var themeKeys = Object.keys(THEMES);
  var currentThemeKey = activeThemeKey || localStorage.getItem('mermaid-theme') || '';

  if (randomThemeBtn) {
    randomThemeBtn.addEventListener('click', function() {
      var availableKeys = themeKeys.filter(function(k) { return k !== currentThemeKey; });
      if (currentThemeKey !== '') availableKeys.push('');
      var newThemeKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
      currentThemeKey = newThemeKey;
      applyTheme(newThemeKey);
    });
  }

  var contentsBtn = document.getElementById('contents-btn');
  var megaMenu = document.getElementById('mega-menu');
  setupDropdown(contentsBtn, megaMenu, ['.mega-menu', '.contents-btn']);

  // Close on clicking a ToC link (smooth scroll to target)
  megaMenu.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    megaMenu.classList.remove('open');
    contentsBtn.classList.remove('active');
    contentsBtn.classList.remove('shadow-tinted');
    var target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // -- Restore saved theme, otherwise use salmon without writing localStorage --
  var savedTheme = localStorage.getItem('mermaid-theme');
  var initialThemeKey = savedTheme && THEMES[savedTheme] ? savedTheme : DEFAULT_PAGE_THEME;
  applyPageTheme(initialThemeKey, Boolean(savedTheme));

  // Enable smooth transitions for future theme switches (not on initial load)
  requestAnimationFrame(function() {
    document.body.style.transition = 'background 0.2s, color 0.2s';
  });

  // ============================================================================
  // Progressive rendering — render each diagram sequentially
  // ============================================================================

  var totalStart = performance.now();

  for (var i = 0; i < samples.length; i++) {
    var sample = samples[i];
    var svgContainer = document.getElementById('svg-' + i);
    var asciiContainer = document.getElementById('ascii-' + i);
    var svgPanel = document.getElementById('svg-panel-' + i);

    // Render SVG — wrapped in a timeout guard so a stalled layout
    // doesn't block all remaining diagrams from rendering.
    try {
      var svg = await renderMermaid(sample.source, sample.options);
      svgContainer.innerHTML = svg;

      // Store the SVG's original inline style for Default mode restoration
      var svgEl = svgContainer.querySelector('svg');
      // If a global theme is active, apply its colors to the SVG
      if (svgEl && activeThemeKey && THEMES[activeThemeKey]) {
        applySvgThemeVars(svgEl, THEMES[activeThemeKey]);
      }

      // Set panel background to match the SVG (skip for hero panels - keep transparent)
      var isHeroPanel = svgPanel.classList.contains('hero-diagram-panel');
      if (!isHeroPanel) {
        if (activeThemeKey && THEMES[activeThemeKey]) {
          svgPanel.style.background = THEMES[activeThemeKey].bg;
        } else {
          var sampleBg = svgPanel.getAttribute('data-sample-bg');
          if (sampleBg) svgPanel.style.background = sampleBg;
        }
      }
    } catch (err) {
      svgContainer.innerHTML = '<div class="render-error">SVG Error: ' + escapeHtml(String(err)) + '</div>';
    }

    // Hero samples don't have ASCII panels
    if (asciiContainer) {
      try {
        var asciiOpts = activeThemeKey && THEMES[activeThemeKey]
          ? { theme: diagramColorsToAsciiTheme(THEMES[activeThemeKey]) }
          : {};
        asciiContainer.innerHTML = renderMermaidAscii(sample.source, asciiOpts);
      } catch (e) {
        asciiContainer.textContent = '(ASCII not supported for this diagram type)';
      }
    }

  }

  // Done — show total time
  var totalMs = (performance.now() - totalStart).toFixed(0);
  totalTimingEl.textContent = samples.length + ' examples rendered in ' + totalMs + ' ms';

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================================
  // Edit dialog — open, close, save & re-render
  // ============================================================================

  var editOverlay = document.getElementById('edit-overlay');
  var editTextarea = document.getElementById('edit-dialog-textarea');
  var editSaveBtn = document.getElementById('edit-dialog-save');
  var editCancelBtn = document.getElementById('edit-dialog-cancel');
  var editCloseBtn = document.getElementById('edit-dialog-close');
  var editingSampleIndex = -1;

  function openEditDialog(index) {
    editingSampleIndex = index;
    editTextarea.value = samples[index].source;
    editOverlay.classList.add('open');
    editTextarea.focus();
  }

  function closeEditDialog() {
    editOverlay.classList.remove('open');
    editingSampleIndex = -1;
  }

  async function saveAndRender() {
    var index = editingSampleIndex;
    if (index < 0) return;
    var source = editTextarea.value;
    samples[index].source = source;

    // Close dialog immediately so user sees results rendering
    closeEditDialog();

    // Update source panel with plain text (Shiki not available at runtime)
    var sourcePanel = document.getElementById('source-panel-' + index);
    if (sourcePanel) {
      var shikiEl = sourcePanel.querySelector('.shiki');
      if (shikiEl) {
        shikiEl.innerHTML = '<code>' + escapeHtml(source) + '</code>';
      }
    }

    // Re-render SVG (async — renderMermaid returns a Promise)
    var svgContainer = document.getElementById('svg-' + index);
    try {
      var editTheme = activeThemeKey && THEMES[activeThemeKey] ? THEMES[activeThemeKey] : null;
      var editSvgOpts = editTheme
        ? Object.assign({}, samples[index].options || {}, { bg: editTheme.bg, fg: editTheme.fg, line: editTheme.line, accent: editTheme.accent, muted: editTheme.muted, surface: editTheme.surface, border: editTheme.border })
        : samples[index].options;
      var svg = await renderMermaid(source, editSvgOpts || {});
      svgContainer.innerHTML = svg;
      var svgEl = svgContainer.querySelector('svg');
      if (svgEl && editTheme) {
        applySvgThemeVars(svgEl, editTheme);
      }
    } catch (err) {
      svgContainer.innerHTML = '<div class="render-error">' + escapeHtml(String(err)) + '</div>';
    }

    // Re-render ASCII
    var asciiContainer = document.getElementById('ascii-' + index);
    if (asciiContainer) {
      try {
        var editAsciiOpts = activeThemeKey && THEMES[activeThemeKey]
          ? { theme: diagramColorsToAsciiTheme(THEMES[activeThemeKey]) }
          : {};
        asciiContainer.innerHTML = renderMermaidAscii(source, editAsciiOpts);
      } catch (e) {
        asciiContainer.textContent = '(ASCII error: ' + e.message + ')';
      }
    }
  }

  // Event listeners
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.edit-btn');
    if (btn) openEditDialog(parseInt(btn.dataset.sample, 10));
  });
  editSaveBtn.addEventListener('click', saveAndRender);
  editCancelBtn.addEventListener('click', closeEditDialog);
  editCloseBtn.addEventListener('click', closeEditDialog);
  editOverlay.addEventListener('click', function(e) {
    if (e.target === editOverlay) closeEditDialog();
  });
  document.addEventListener('keydown', function(e) {
    if (!editOverlay.classList.contains('open')) return;
    if (e.key === 'Escape') closeEditDialog();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveAndRender();
  });

  </script>

  <!-- Edit dialog (shared single instance) -->
  <div class="edit-overlay" id="edit-overlay">
    <div class="edit-dialog shadow-modal-small">
      <div class="edit-dialog-header">
        <span class="edit-dialog-title">Edit Diagram</span>
        <button class="edit-dialog-close" id="edit-dialog-close">&times;</button>
      </div>
      <textarea class="edit-dialog-textarea" id="edit-dialog-textarea"
        spellcheck="false" autocomplete="off" autocorrect="off"></textarea>
      <div class="edit-dialog-footer">
        <button class="edit-dialog-btn edit-dialog-cancel" id="edit-dialog-cancel">Cancel</button>
        <button class="edit-dialog-btn edit-dialog-save" id="edit-dialog-save">Save &amp; Render</button>
      </div>
    </div>
  </div>

  </div><!-- .content-wrapper -->

  <footer class="site-footer">
    <span>Open source under the MIT License.</span>
    <div class="footer-links">
      <a href="https://github.com/adewale/beautiful-mermaid/blob/main/FORK_DIFFERENCES.md" target="_blank" rel="noopener noreferrer">Fork notes</a>
      <a href="https://github.com/adewale/beautiful-mermaid/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a>
      <a href="https://github.com/adewale/beautiful-mermaid" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      </a>

    </div>
  </footer>
</body>
</html>`
}

// ============================================================================
// Main — only runs when this file is the entry point (not when imported)
// ============================================================================

if (import.meta.main) {
  const html = await generateHtml()
  const outPath = new URL('./index.html', import.meta.url).pathname
  await Bun.write(outPath, html)
  console.log(`Written to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
}
