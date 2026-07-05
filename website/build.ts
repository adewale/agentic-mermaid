import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renderMermaidSVG as renderBeautifulMermaidSVG } from 'beautiful-mermaid'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { verifyMermaid } from '../src/agent/index.ts'
import { buildCapabilities } from '../src/cli/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../src/index.ts'
import { namespaceSvgIds } from '../src/renderer.ts'
import { computeDeployVersion } from './src/deploy-hash.ts'

const ROOT = join(import.meta.dir, '..')
const SOURCE = join(import.meta.dir, 'source')
const SOURCE_PAGES = join(SOURCE, 'pages')
const SOURCE_ASSETS = join(SOURCE, 'assets')
const SOURCE_DIAGRAMS = join(SOURCE, 'diagrams')
const OUT = join(import.meta.dir, 'public')
const CHECK = process.argv.includes('--check')

type FileContent = string | Buffer
const generated = new Map<string, FileContent>()

const routeMap: Record<string, string> = {
  'home.html': '/',
  'editor.html': '/editor/',
  'docs-article.html': '/docs/',
  'skill-workflow.html': '/skills/agentic-mermaid-diagram-workflow/',
  'llms.txt': '/llms.txt',
  'agent-instructions.md': '/agent-instructions.md',
  'capabilities.json': '/capabilities.json',

}

const pageOutputs: Array<[source: string, target: string]> = [
  ['home.html', 'index.html'],
  ['docs-article.html', 'docs/index.html'],
  ['skill-workflow.html', 'skills/agentic-mermaid-diagram-workflow/index.html'],
]

const rootAssets = new Set([
  'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og-image.png',
  'styles.css', 'theme.js', 'shader-mark.js', 'llms.txt', 'agent-instructions.md',
  'capabilities.json',
])

const EDITOR_ROUTE = '/editor/'
const GENERIC_EDITOR_HREF = '/editor/?empty=1'

function splitUrl(value: string): [path: string, suffix: string] {
  const i = value.search(/[?#]/)
  return i === -1 ? [value, ''] : [value.slice(0, i), value.slice(i)]
}

function rewriteUrl(value: string): string {
  if (value === '/beautiful-mermaid/' || value === '/beautiful-mermaid') return '/'
  if (/^(https?:|mailto:|tel:|data:|#)/.test(value)) return value
  if (value.startsWith('/')) return value
  const [path, suffix] = splitUrl(value)
  if (routeMap[path]) return routeMap[path] + suffix
  if (rootAssets.has(path)) return '/' + path + suffix
  if (path.startsWith('diagrams/') || path.startsWith('skills/') || path.startsWith('examples/')) {
    return '/' + path + suffix
  }
  return value
}

const agentDiscoveryLinks = [
  '<link rel="alternate" type="text/plain" href="/llms.txt">',
  '<link rel="alternate" type="application/json" href="/capabilities.json">',
  '<link rel="alternate" type="text/markdown" href="/agent-instructions.md">',
].join('\n')

function addHeadDescription(html: string) {
  if (html.includes('name="description"')) return html
  // Match any viewport tag variant (the editor emits `initial-scale=1.0` with
  // a self-closing slash) so every shipped page gets a meta description.
  return html.replace(/<meta name="viewport"[^>]*>/, '$&\n<meta name="description" content="Agentic Mermaid renders, verifies, and edits Mermaid diagrams locally, with compact agent instructions for CLI, library, and MCP use.">')
}

// Social/canonical metadata. og:image, og:url, and rel=canonical need absolute
// URLs, so they ship only when the deploy sets SITE_ORIGIN (same pattern as
// SITE_GIT_SHA); the scheme-relative tags ship on every build.
const siteOrigin = process.env.SITE_ORIGIN ?? ''
// titleAttr/descriptionAttr must already be attribute-escaped by the caller.
function socialMetaTags(titleAttr: string, descriptionAttr: string, route = '') {
  const tags = [
    `<meta property="og:title" content="${titleAttr}">`,
    `<meta property="og:description" content="${descriptionAttr}">`,
    '<meta property="og:type" content="website">',
    '<meta name="twitter:card" content="summary_large_image">',
  ]
  if (siteOrigin && route) {
    tags.push(
      `<link rel="canonical" href="${escapeAttr(siteOrigin + route)}">`,
      `<meta property="og:url" content="${escapeAttr(siteOrigin + route)}">`,
      `<meta property="og:image" content="${escapeAttr(siteOrigin + '/og-image.png')}">`,
    )
  }
  return tags.join('\n')
}

// Head-injection step for mockup-derived pages (and the editor): reuse the
// page's own <title> and meta description so the social card never drifts
// from the visible page. Both are lifted from markup, so they are already
// entity-escaped; only stray quotes need re-escaping for the attribute.
function addSocialMeta(html: string, route = '') {
  if (html.includes('property="og:title"')) return html
  const title = (html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Agentic Mermaid').trim().replace(/"/g, '&quot;')
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
  return html.replace('</head>', socialMetaTags(title, description, route) + '\n</head>')
}

function addAgentDiscoveryLinks(html: string) {
  if (html.includes('rel="alternate" type="application/json" href="/capabilities.json"')) return html
  if (/<link rel="stylesheet" href="([^\"]+)"\s*>/.test(html)) {
    return html.replace(/<link rel="stylesheet" href="([^\"]+)"\s*>/, '<link rel="stylesheet" href="$1">\n' + agentDiscoveryLinks)
  }
  return html.replace('</head>', agentDiscoveryLinks + '\n</head>')
}

function addSkipLink(html: string, target = 'main') {
  if (html.includes('class="skip-link"')) return html
  return html.replace(/<body([^>]*)>/, `<body$1>\n<a class="skip-link" href="#${target}">Skip to content</a>`)
}

function ensureMainId(html: string) {
  return html.replace(/<main(?![^>]*\bid=)([^>]*class="[^"]*"[^>]*)>/, '<main id="main"$1>')
}

function rewriteAttrs(html: string) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (_m, attr, value) => `${attr}="${rewriteUrl(value)}"`)
}

function topNavHrefForRoute(route = '') {
  if (route === '/examples/') return '/examples/'
  if (route === '/comparisons/') return '/comparisons/'
  if (route === '/docs/' || route.startsWith('/docs/')) return '/docs/'
  if (route === EDITOR_ROUTE) return GENERIC_EDITOR_HREF
  return ''
}

function setNavCurrent(html: string, currentHref = '') {
  if (!currentHref) return html
  const labels: Record<string, string> = {
    '/examples/': 'Examples',
    '/comparisons/': 'Comparisons',
    '/docs/': 'Docs',
    [GENERIC_EDITOR_HREF]: 'Open editor',
  }
  const label = labels[currentHref]
  if (!label || html.includes(`href="${currentHref}" aria-current="page"`) || html.includes(`aria-current="page" href="${currentHref}"`)) return html
  return html.replace(`<a href="${currentHref}">${label}</a>`, `<a href="${currentHref}" aria-current="page">${label}</a>`)
}

function transformHtml(html: string, currentHref = '', route = ''): string {
  return setNavCurrent(ensureMainId(addSkipLink(addAgentDiscoveryLinks(addSocialMeta(addHeadDescription(rewriteAttrs(html)), route)))), currentHref)
}

function transformEditorHtml(html: string): string {
  let out = html
    .replace(/\n\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"\s*\/?>/g, '')
    .replace(/\n\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>/g, '')
    .replace(/\n\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^>]+>/g, '')
    .replace(/Agentic Mermaid homepage/g, 'Agentic Mermaid homepage')
  out = rewriteAttrs(out)
  out = out.replace(/href="\/beautiful-mermaid\/"/g, 'href="/"')
  out = addHeadDescription(out)
  out = addSocialMeta(out, '/editor/')
  out = addAgentDiscoveryLinks(out)
  out = addSkipLink(out, 'editor-main')
  return out
}

async function readSourcePage(path: string) {
  return await Bun.file(join(SOURCE_PAGES, path)).text()
}

async function readSourceDiagram(path: string) {
  return await Bun.file(join(SOURCE_DIAGRAMS, path)).text()
}

async function emit(rel: string, content: FileContent) {
  generated.set(rel, content)
  if (CHECK) return
  const dest = join(OUT, rel)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, content)
}

async function emitJson(rel: string, data: unknown) {
  await emit(rel, JSON.stringify(data, null, 2) + '\n')
}

async function copyFileFrom(src: string, destRel: string) {
  const bytes = Buffer.from(await Bun.file(src).arrayBuffer())
  await emit(destRel, bytes)
}

async function copySourceAsset(rel: string, destRel = rel) {
  await copyFileFrom(join(SOURCE_ASSETS, rel), destRel)
}

async function copyDir(srcAbs: string, destRel: string) {
  async function walk(abs: string, rel: string) {
    for (const ent of await readdir(abs, { withFileTypes: true })) {
      const childAbs = join(abs, ent.name)
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(childAbs, childRel)
      else await copyFileFrom(childAbs, `${destRel}/${childRel}`)
    }
  }
  await walk(srcAbs, '')
}

function sha256(text: string | Buffer) {
  return createHash('sha256').update(text).digest('hex')
}

function extractBalancedLiteral(src: string, marker: string, open: string, close: string): string {
  const lb = src.indexOf(open, src.indexOf(marker))
  let depth = 0, q: string | null = null
  for (let i = lb; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return src.slice(lb, i + 1)
  }
  throw new Error('could not extract ' + marker)
}
function extractArrayLiteral(src: string, marker: string): string {
  return extractBalancedLiteral(src, marker, '[', ']')
}
function extractObjectLiteral(src: string, marker: string): string {
  return extractBalancedLiteral(src, marker, '{', '}')
}

async function generateEditorHtml() {
  const result = Bun.spawnSync(['bun', 'run', 'scripts/site/editor.ts'], { cwd: ROOT })
  if (result.exitCode !== 0) {
    throw new Error(`scripts/site/editor.ts failed:\n${result.stderr.toString()}`)
  }
  const path = join(ROOT, 'editor.html')
  const html = await Bun.file(path).text()
  try { await unlink(path) } catch {}
  let transformed = transformEditorHtml(html)
  const scriptMatch = transformed.match(/\n<script type="module">\n([\s\S]*?)\n<\/script>\s*\n<\/body>/)
  if (!scriptMatch) throw new Error('editor bundle script not found')
  const script = scriptMatch[1]!
  const scriptRel = `editor/editor-${sha256(script).slice(0, 12)}.js`
  await emit(scriptRel, script.trimEnd() + '\n')
  transformed = transformed.replace(scriptMatch[0], `\n<script type="module" src="/${scriptRel}"></script>\n</body>`)
  return transformed
}

function mastheadHtml(currentHref = '') {
  const links = [
    ['/about/', 'About', ''],
    ['/examples/', 'Examples', ''],
    ['/comparisons/', 'Comparisons', ''],
    ['/docs/', 'Docs', ''],
    [GENERIC_EDITOR_HREF, 'Open editor', 'link-editor'],
  ] as const
  const nav = links.map(([href, label, cls]) => {
    const attrs = [cls ? `class="${cls}"` : '', currentHref === href ? 'aria-current="page"' : ''].filter(Boolean).join(' ')
    return `<a ${attrs ? attrs + ' ' : ''}href="${href}">${label}</a>`
  }).join('')
  return `<header class="masthead"><div class="bar"><a class="brand" href="/"><span class="mark"></span> Agentic&nbsp;Mermaid</a><span class="links">${nav}</span></div><hr></header>`
}

// Two footer rows shared by every shipped page: a human row (reference pages
// plus the repository) and a machine row (agent artifacts). GitHub lives here
// deliberately — the website contract test forbids repository chrome in the
// masthead, so the footer is the one place the repo link ships.
function footerHtml() {
  return `<footer><div class="footlinks"><a href="/warnings/">Warnings</a><span class="sep">&middot;</span><a href="/errors/">Errors</a><span class="sep">&middot;</span><a href="/skills/agentic-mermaid-diagram-workflow/">Skill</a><span class="sep">&middot;</span><a href="/about/design/">Design</a><span class="sep">&middot;</span><a href="https://github.com/adewale/beautiful-mermaid">GitHub</a></div><div class="footlinks"><a href="/llms.txt">llms.txt</a><span class="sep">&middot;</span><a href="/agent-instructions.md">agent-instructions.md</a><span class="sep">&middot;</span><a href="/capabilities.json">capabilities.json</a><span class="sep">&middot;</span><a href="/examples/index.json">examples.json</a><span class="sep">&middot;</span><a href="/skills/agentic-mermaid-diagram-workflow/SKILL.md">workflow skill</a></div></footer>`
}

// Single page header contract: h1 + lead, then an optional meta row
// (e.g. "Updated · source · read time") and actions row. The public site is
// deliberately document-first with no breadcrumb chrome (see the website
// contract test — masthead nav is the only wayfinding the shell ships).
function pageShell(title: string, lead: string, body: string, currentHref = '', meta = '', actions = '', route = '') {
  // Titles that already carry the brand (e.g. "About Agentic Mermaid") do not
  // get the suffix a second time.
  const fullTitle = title.includes('Agentic Mermaid') ? title : `${title} – Agentic Mermaid`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="description" content="${escapeAttr(lead)}">
<title>${escapeHtml(fullTitle)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
${agentDiscoveryLinks}
${socialMetaTags(escapeAttr(fullTitle), escapeAttr(lead), route)}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${mastheadHtml(currentHref)}
<main id="main" class="doc">
<section class="page-header">
<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${meta ? `<p class="page-meta">${meta}</p>\n` : ''}${actions ? `<div class="page-actions">${actions}</div>\n` : ''}</section>
${body}
</main>
${footerHtml()}
<script src="/shader-mark.js"></script>
<script src="/theme.js"></script>
</body>
</html>`
}

// pageShell + emit with the page's own route wired through, so canonical/og:url
// metadata can carry the exact path when SITE_ORIGIN is set.
async function emitShell(rel: string, title: string, lead: string, body: string, currentHref = '', meta = '', actions = '') {
  await emit(rel, pageShell(title, lead, body, currentHref, meta, actions, '/' + rel.replace(/index\.html$/, '')))
}

function escapeHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
// The WARNING_DETAIL prose is authored as inline HTML (<code> spans, entities)
// for the web pages; render it as plain Markdown for the .md siblings. Decode
// &amp; last so pre-encoded entities like &amp;#160; survive as literal text.
function inlineHtmlToMarkdown(s: string) {
  return s
    .replace(/<a href="([^"]+)">(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

const packageJson = JSON.parse(await Bun.file(join(ROOT, 'package.json')).text())
const rawCapabilities = buildCapabilities()
const generatedFrom = {
  packageVersion: packageJson.version,
  gitSha: process.env.SITE_GIT_SHA ?? 'development',
  buildTime: process.env.SITE_BUILD_TIME ?? 'development',
}
const npmPublished = process.env.SITE_NPM_STATUS === 'published' || process.env.SITE_NPM_PUBLISHED === '1'
const installCommand = npmPublished
  ? 'npm i agentic-mermaid'
  : 'git clone https://github.com/adewale/beautiful-mermaid && cd beautiful-mermaid && bun install && bun run build'
const installNotice = npmPublished
  ? 'The npm package is marked published for this build.'
  : 'The npm package is not yet published; install from source.'

const examplesSrc = await Bun.file(join(ROOT, 'editor/js/examples.js')).text()
const EDITOR_SEMANTIC_STYLE: any = new Function('return (' + extractObjectLiteral(examplesSrc, 'EDITOR_SEMANTIC_STYLE =') + ');')()
const EDITOR_EXAMPLES: any[] = new Function('EDITOR_SEMANTIC_STYLE', 'return (' + extractArrayLiteral(examplesSrc, 'EDITOR_EXAMPLES =') + ');')(EDITOR_SEMANTIC_STYLE)
const familyByExampleId = new Map<string, any>(BUILTIN_FAMILY_METADATA.map((f) => [f.editorExampleId, f]))
const familyByDiagramType: Record<string, string> = {
  Flowchart: 'flowchart', State: 'state', Architecture: 'architecture', Sequence: 'sequence', Class: 'class', ER: 'er', Timeline: 'timeline', Journey: 'journey', 'XY Chart': 'xychart', Pie: 'pie', Quadrant: 'quadrant', Gantt: 'gantt',
}
function familyForExample(example: any) {
  return familyByExampleId.get(example.id) ?? BUILTIN_FAMILY_METADATA.find((family) => family.id === familyByDiagramType[example.diagramType])
}
const WEBSITE_EXAMPLE_THEME = {
  bg: '#FFFFFF',
  fg: '#27272A',
  accent: '#1A7351',
  line: '#8B9791',
  muted: '#5D6864',
  surface: '#F8FAF8',
  border: '#D3DDD7',
  font: 'Avenir Next',
}
function addSvgAccessibleName(svg: string, idBase: string, title: string, desc: string) {
  const safeId = idBase.replace(/[^a-z0-9_-]+/gi, '-')
  const titleId = `${safeId}-svg-title`
  const descId = `${safeId}-svg-desc`
  return svg.replace(/^<svg\b([^>]*)>/, (_full, attrs: string) => {
    const cleanAttrs = attrs.replace(/\saria-labelledby="[^"]*"/g, '')
    const role = /\brole=/.test(cleanAttrs) ? '' : ' role="img"'
    return `<svg${cleanAttrs}${role} aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${escapeHtml(title)}</title><desc id="${descId}">${escapeHtml(desc)}</desc>`
  })
}
function renderExampleSvg(example: any) {
  // The editor examples intentionally carry their own options. The public
  // Examples page uses one review theme so cards can be compared side by side;
  // chart palettes still derive from the single site accent above.
  const svg = renderMermaidSVG(example.source, {
    ...WEBSITE_EXAMPLE_THEME,
    interactive: Boolean(example.options?.interactive),
    security: 'strict',
    compact: true,
    embedFontImport: false,
    idPrefix: `example-${example.id}-`,
  }).replace(/[ \t]+$/gm, '')
  return addSvgAccessibleName(
    svg,
    `example-${example.id}`,
    `${example.label} diagram`,
    `Build-time render of the ${example.diagramType ?? 'Mermaid'} example loaded by the editor.`,
  )
}
// Per-family agent task: a plausible prompt and the trace an agent runs before
// it returns source. Absorbed from the former Gallery page so the unified
// Examples page carries the agentic narrative — prompt, trace, render, deep
// link — rather than a bare source dump. Keyed by family id.
const FAMILY_AGENT_TASK: Record<string, { prompt: string; trace: string }> = {
  flowchart:    { prompt: 'Add a labeled failure branch and verify that every decision exit is named.', trace: 'asFlowchart · mutate(add_edge/set_label) · verify' },
  state:        { prompt: 'Add a retry transition from Failed back to Idle, then verify before returning source.', trace: 'asState · mutate(add_transition) · verify' },
  sequence:     { prompt: 'Insert the verification call before export and keep participant order stable.', trace: 'asSequence · mutate(add_message) · verify' },
  timeline:     { prompt: 'Add a Review period with one approval event without rewriting other periods.', trace: 'asTimeline · mutate(add_period) · verify' },
  class:        { prompt: 'Add a repository class and connect it to the service with a typed relationship.', trace: 'asClass · mutate(add_class/add_relation) · verify' },
  er:           { prompt: 'Add an order line-item relationship and verify cardinalities before serialize.', trace: 'asEr · mutate(add_relation) · verify' },
  journey:      { prompt: 'Add an agent verification task and preserve existing scores.', trace: 'asJourney · mutate(add_task) · verify' },
  architecture: { prompt: 'Insert a cache service between the app and database and verify boundaries.', trace: 'asArchitecture · mutate(add_service/add_edge) · verify' },
  xychart:      { prompt: 'Add a forecast series and verify the axes still render cleanly.', trace: 'asXyChart · mutate(add_series) · verify' },
  pie:          { prompt: 'Add a Documentation slice and keep labels readable.', trace: 'asPie · mutate(add_slice) · verify' },
  quadrant:     { prompt: 'Move one point into the high-impact quadrant and verify coordinates.', trace: 'asQuadrant · mutate(move_point) · verify' },
  gantt:        { prompt: 'Add a verification milestone before release and resolve the schedule.', trace: 'asGantt · mutate(add_task) · verify' },
}
// One-per-family supported examples are the canonical render for their family, so
// anchor them by family id — old /gallery/#<family> deep links resolve here after
// the redirect. Other examples (role-style presets) keep their own id.
function exampleAnchor(example: any) {
  const family = familyForExample(example)
  return example.category === 'Supported diagrams' && family ? family.id : example.id
}
function exampleCategoryId(category: string) {
  return 'examples-' + category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
// Compact anchor index at the top of the (very tall) Examples page: one row per
// category, each example label linking to its existing render anchor.
function examplesTocHtml(groups: Map<string, any[]>) {
  const rows = Array.from(groups, ([category, examples]) => {
    const links = examples.map((example) => `<a href="#${escapeAttr(exampleAnchor(example))}">${escapeHtml(example.label)}</a>`).join('<span class="sep">&middot;</span>')
    return `<p><a href="#${escapeAttr(exampleCategoryId(category))}"><strong>${escapeHtml(category)}</strong></a> ${links}</p>`
  }).join('\n')
  return `<div class="example-tools" role="search"><label for="example-filter">Filter examples</label><input id="example-filter" type="search" data-example-filter placeholder="flowchart, gantt, agent trace"></div><nav class="example-toc" aria-label="Examples on this page">\n${rows}\n</nav>`
}
function examplesShowcaseHtml(editorExamples: any[]) {
  const groups = new Map<string, any[]>()
  for (const example of editorExamples) {
    const category = example.category ?? 'Examples'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push(example)
  }
  return '<div class="example-showcase">' + examplesTocHtml(groups) + Array.from(groups, ([category, examples]) => `
<section class="example-group" aria-labelledby="${escapeAttr(exampleCategoryId(category))}">
<h2 id="${escapeAttr(exampleCategoryId(category))}">${escapeHtml(category)}</h2>
<p class="muted">${category === 'Role style presets' ? 'These load role-style presets in the editor. This page renders them with one fixed review theme so the proof stays visually comparable.' : 'One proof per supported family: the exact editor source, an agent task, the trace before return, and a build-time render from that same source.'}</p>
${examples.map((example) => {
  const family = familyForExample(example)
  const task = category === 'Supported diagrams' && family ? FAMILY_AGENT_TASK[family.id] : undefined
  const taskHtml = task ? `
      <p class="example-prompt"><span>Prompt</span> ${escapeHtml(task.prompt)}</p>
      <p class="example-trace"><span>Trace</span> <code>${escapeHtml(task.trace)}</code></p>` : ''
  return `
<article class="example-sample" id="${escapeAttr(exampleAnchor(example))}">
  <header class="example-sample-head">
    <div>
      <p class="example-meta">${escapeHtml(example.diagramType ?? 'Example')}</p>
      <h3>${escapeHtml(example.label)}</h3>
      <p>${escapeHtml(example.description ?? '')}</p>${taskHtml}
    </div>
    <a class="go" href="/editor/?example=${encodeURIComponent(example.id)}">Open in editor</a>
  </header>
  <div class="example-sample-grid">
    <section class="example-source" aria-label="${escapeAttr(example.label)} Mermaid source"><pre><code>${escapeHtml(String(example.source ?? '').trim())}</code></pre></section>
    <figure class="example-render"><div class="example-svg">${renderExampleSvg(example)}</div><figcaption>Build-time proof: rendered from the same source the editor loads.</figcaption></figure>
  </div>
</article>`
}).join('')}
</section>`).join('\n') + `
<script>
(function () {
  var input = document.querySelector('[data-example-filter]');
  if (!input) return;
  var samples = Array.from(document.querySelectorAll('.example-sample'));
  function apply() {
    var q = input.value.trim().toLowerCase();
    samples.forEach(function (sample) {
      var haystack = sample.textContent.toLowerCase() + ' ' + sample.id.toLowerCase();
      sample.hidden = Boolean(q && haystack.indexOf(q) === -1);
    });
  }
  input.addEventListener('input', apply);
})();
</script>` + '\n</div>'
}

const mermaidRuntimeBytes = Buffer.from(await Bun.file(join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js')).arrayBuffer())
const mermaidRuntimeRel = `vendor/mermaid-${sha256(mermaidRuntimeBytes).slice(0, 12)}.min.js`

type ComparisonCase = { id: string; family: string; source: string }
const COMPARISON_CASES: ComparisonCase[] = [
  { id: 'flowchart', family: 'Flowchart', source: `flowchart LR
  Start([Start]) --> Parse[Parse]
  Parse --> Decision{Valid?}
  Decision -->|yes| Cache[(Cache)]
  Decision -->|retry| Parse
  Decision -->|no| Error[Return error]
  Cache --> API[API]
  API --> DB[(Database)]
  API --> Queue[[Queue]]
  Queue --> Worker[Worker]
  Worker --> DB
  DB --> Done([Done])` },
  { id: 'state', family: 'State', source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: start
  state Running {
    [*] --> Fetch
    Fetch --> Verify
    Verify --> Fetch: retry
    Verify --> Commit: ok
  }
  Running --> Failed: error
  Failed --> Idle: reset
  Running --> [*]: done` },
  { id: 'sequence', family: 'Sequence', source: `sequenceDiagram
  actor User
  participant Agent
  participant CLI
  participant Renderer
  User->>Agent: change diagram
  Agent->>CLI: mutate
  CLI->>Renderer: verify
  alt clean
    Renderer-->>CLI: ok
  else warnings
    Renderer-->>CLI: codes
    CLI-->>Agent: repair
  end
  CLI-->>Agent: source` },
  { id: 'class', family: 'Class', source: `classDiagram
  class Diagram {
    +kind
    +source
    +verify()
  }
  class Flowchart {
    +nodes
    +edges
    +mutate()
  }
  class Warning {
    +code
    +tier
  }
  Diagram <|-- Flowchart
  Diagram "1" --> "*" Warning : emits` },
  { id: 'er', family: 'ER', source: `erDiagram
  FAMILY ||--o{ DIAGRAM : accepts
  DIAGRAM ||--o{ WARNING : reports
  DIAGRAM ||--o{ RENDER : produces
  FAMILY {
    string id PK
    string name
  }
  DIAGRAM {
    string id PK
    string source
    string kind
  }
  WARNING {
    string code PK
    string tier
  }
  RENDER {
    string format PK
    string hash
  }` },
  { id: 'xychart', family: 'XY Chart', source: `xychart
  title "Layout score"
  x-axis [Mermaid, Beautiful, Agentic]
  y-axis "score" 0 --> 100
  bar [68, 74, 91]
  line [64, 77, 94]` },
  { id: 'timeline', family: 'Timeline', source: `timeline
  title Diagram edit loop
  Source : Mermaid text
  Parse : typed model
  Mutate : one operation
  Verify : structural warnings
  Render : SVG : ASCII : PNG` },
  { id: 'journey', family: 'Journey', source: `journey
  title Agent editing a diagram
  section Guess
    Rewrite whole diagram: 2: Agent
    Ask human to inspect: 1: Reviewer
  section Verify
    Parse source: 5: Agent
    Mutate target: 5: Agent
    Check warnings: 5: Agent` },
  { id: 'architecture', family: 'Architecture', source: `architecture-beta
  group client(cloud)[Client]
  group app(cloud)[Application]
  group data(database)[Data]
  service browser(server)[Browser] in client
  service web(server)[Web App] in app
  service api(server)[API] in app
  service queue(server)[Queue] in app
  service db(database)[Postgres] in data
  browser:R --> L:web
  web:R --> L:api
  api:B --> T:queue
  api:R --> L:db
  queue:R --> L:db` },
  { id: 'pie', family: 'Pie', source: `pie showData
  title Output formats
  "SVG" : 42
  "PNG" : 28
  "ASCII" : 18
  "Unicode" : 12` },
  { id: 'quadrant', family: 'Quadrant', source: `quadrantChart
  title Edit decisions
  x-axis Low confidence --> High confidence
  y-axis Low reversibility --> High reversibility
  quadrant-1 Commit
  quadrant-2 Review
  quadrant-3 Ask
  quadrant-4 Repair
  typed mutate: [0.82, 0.78]
  source rewrite: [0.24, 0.22]
  verify warnings: [0.71, 0.48]` },
  { id: 'gantt', family: 'Gantt', source: `gantt
  title Release train
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
    Parser        :done, p1, 2024-01-08, 2024-01-10
    Layout pass   :active, l1, 2024-01-11, 3d
    Verify        :v1, after l1, 2d
  section Ship
    Review        :crit, r1, after v1, 2d
    Release       :milestone, m1, after r1, 0d` },
]

function comparisonSvg(svg: string, id: string, engine: string, family: string) {
  const localSvg = svg.replace(/^\s*@import\s+url\([^)]*\);\n?/gm, '')
  const namespaced = namespaceSvgIds(localSvg.replace(/[ \t]+$/gm, ''), `${id}-`)
    .replace(/(<svg\b[^>]*?)\saria-labelledby="[^"]*"/, '$1')
  return addSvgAccessibleName(namespaced, id, `${engine} ${family}`, `${family} rendered by ${engine}.`)
}
function comparisonAgenticSvg(c: ComparisonCase) {
  return comparisonSvg(renderMermaidSVG(c.source, { ...WEBSITE_EXAMPLE_THEME, security: 'strict', compact: true, embedFontImport: false, idPrefix: `comparison-agentic-${c.id}-` }), `comparison-agentic-${c.id}`, 'Agentic Mermaid', c.family)
}
function comparisonBeautifulRender(c: ComparisonCase) {
  try {
    return { supported: true, html: comparisonSvg(renderBeautifulMermaidSVG(c.source, { ...WEBSITE_EXAMPLE_THEME, embedFontImport: false } as any), `comparison-beautiful-${c.id}`, 'Beautiful Mermaid', c.family) }
  } catch {
    return { supported: false, html: '' }
  }
}
function comparisonPanel(label: string, body: string) {
  return `<div class="comparison-panel"><h3>${escapeHtml(label)}</h3><div class="comparison-render">${body}</div></div>`
}
const COMPARISON_TAKEAWAYS: Record<string, string> = {
  flowchart: 'Compare edge routing, label stability, and whether dense fan-out still reads without browser-dependent drift.',
  state: 'Look for nested-state containment and transition labels that remain readable as the lifecycle grows.',
  sequence: 'Check participant alignment, block labels, and warning paths: this is the common agent-edit audit loop.',
  class: 'Compare relationship routing and member-box spacing on a compact class model.',
  er: 'Inspect cardinality labels and orthogonal routes across a wide schema.',
  xychart: 'Confirm chart scales, bars, and lines are deterministic rather than screenshot-only proof.',
  timeline: 'Agentic Mermaid renders this supported family locally; Beautiful Mermaid has no panel for it.',
  journey: 'The score grid and actor pills demonstrate a family that agents can parse, mutate, and verify locally.',
  architecture: 'Service groups and routed connections show agent-readable architecture output without a hosted renderer.',
  pie: 'The slice labels and values come from the same local source model as SVG/PNG/text output.',
  quadrant: 'Points and axes remain inspectable source, not a static image pasted into docs.',
  gantt: 'Schedule resolution is verified locally so bad dependencies can fail before an agent returns source.',
}
function comparisonsHtml() {
  const sections = COMPARISON_CASES.map((c) => {
    const beautiful = comparisonBeautifulRender(c)
    const takeaway = COMPARISON_TAKEAWAYS[c.id] ?? 'Compare deterministic local rendering against the browser/runtime render.'
    const panels = [
      comparisonPanel('Mermaid', `<pre class="mermaid comparison-mermaid" id="comparison-mermaid-${escapeAttr(c.id)}">${escapeHtml(c.source)}</pre>`),
      beautiful.supported ? comparisonPanel('Beautiful Mermaid', beautiful.html) : '',
      comparisonPanel('Agentic Mermaid', comparisonAgenticSvg(c)),
    ].filter(Boolean).join('\n    ')
    const note = beautiful.supported ? '' : '\n  <p class="comparison-note">Beautiful Mermaid does not render this family; only Mermaid and Agentic Mermaid are shown.</p>'
    return `
<section class="comparison-case${beautiful.supported ? '' : ' comparison-case-omits-beautiful'}" id="${escapeAttr(c.id)}" aria-labelledby="comparison-${escapeAttr(c.id)}-title">
  <header class="comparison-case-head">
    <h2 id="comparison-${escapeAttr(c.id)}-title">${escapeHtml(c.family)}</h2>
    <button class="comparison-focus" type="button" data-comparison-focus aria-label="Open ${escapeAttr(c.family)} comparison larger" title="Open larger comparison"><span aria-hidden="true">⤢</span></button>
  </header>
  <p class="comparison-takeaway"><strong>What to look for.</strong> ${escapeHtml(takeaway)}</p>${note}
  <div class="comparison-grid">
    ${panels}
  </div>
</section>`
  }).join('')
  return `<div class="comparison-summary">
<p><strong>Read this page as evidence, not a shootout.</strong> Each row keeps the same Mermaid source visible, then shows what a browser Mermaid render, upstream Beautiful Mermaid, and Agentic Mermaid can produce locally.</p>
<ul>
<li>Agentic Mermaid covers all twelve families shown here and exposes the same source to agents.</li>
<li>Beautiful Mermaid panels appear only for families it supports; absent panels are labeled, not hidden.</li>
<li>The runtime Mermaid panels are progressive enhancement: source stays visible even before the browser renderer loads.</li>
</ul>
</div><div class="comparisons" data-mermaid-runtime="/${mermaidRuntimeRel}">${sections}
<dialog class="comparison-dialog" data-comparison-dialog aria-labelledby="comparison-dialog-title">
  <form class="comparison-dialog-bar" method="dialog">
    <div>
      <h2 id="comparison-dialog-title">Comparison</h2>
      <p class="comparison-dialog-note" data-comparison-dialog-note hidden></p>
    </div>
    <button class="comparison-dialog-close" type="submit">Close</button>
  </form>
  <div class="comparison-dialog-body" data-comparison-dialog-body></div>
</dialog>
<script>
(function () {
  var root = document.querySelector('.comparisons');
  var src = root && root.getAttribute('data-mermaid-runtime');
  var loading = null;
  function loadMermaidRuntime() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!src) return Promise.reject(new Error('missing Mermaid runtime'));
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(window.mermaid); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return loading;
  }
  function renderMermaidPanels() {
    return loadMermaidRuntime().then(function (mermaid) {
      if (!mermaid || renderMermaidPanels.done) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', deterministicIds: true, deterministicIDSeed: 'agentic-mermaid-comparisons', theme: 'base', themeVariables: { fontFamily: 'Avenir Next, Segoe UI, system-ui, sans-serif' } });
      return mermaid.run({ querySelector: '.comparison-mermaid' }).then(function () { renderMermaidPanels.done = true; });
    }).catch(function() {});
  }
  if ('requestIdleCallback' in window) requestIdleCallback(renderMermaidPanels, { timeout: 2500 });
  else setTimeout(renderMermaidPanels, 1200);
  ['pointerenter', 'focusin'].forEach(function (eventName) {
    document.addEventListener(eventName, renderMermaidPanels, { once: true, passive: true });
  });
})();
(function () {
  var dialog = document.querySelector('[data-comparison-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var body = dialog.querySelector('[data-comparison-dialog-body]');
  var title = dialog.querySelector('#comparison-dialog-title');
  var note = dialog.querySelector('[data-comparison-dialog-note]');
  var current = null;
  function restore() {
    if (!current) return;
    current.marker.parentNode.replaceChild(current.grid, current.marker);
    current = null;
  }
  document.querySelectorAll('[data-comparison-focus]').forEach(function (button) {
    button.addEventListener('click', function () {
      restore();
      var section = button.closest('.comparison-case');
      var grid = section && section.querySelector('.comparison-grid');
      if (!section || !grid || !body) return;
      var marker = document.createComment('comparison-grid');
      grid.parentNode.insertBefore(marker, grid);
      body.appendChild(grid);
      title.textContent = section.querySelector('h2').textContent;
      var noteText = section.querySelector('.comparison-note')?.textContent || section.querySelector('.comparison-takeaway')?.textContent || '';
      note.textContent = noteText;
      note.hidden = !noteText;
      current = { grid: grid, marker: marker };
      dialog.showModal();
    });
  });
  dialog.addEventListener('close', restore);
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
</script>
</div>`
}

if (!CHECK) await rm(OUT, { recursive: true, force: true })
await emit(mermaidRuntimeRel, mermaidRuntimeBytes)

// Core source-derived pages.
// #9 — single source of truth for the parse->serialize loop, rendered at two
// densities: the compact rail on the home page and the section headings in the
// docs manual. Editing a label or summary here updates both, so they can't drift.
const LOOP_STEPS = [
  { label: 'Parse', short: 'Read the source into a typed model; unmodeled syntax round-trips as preserved source.' },
  { label: 'Narrow', short: 'Resolve the one node or edge the edit touches via the matching family surface (<code>asFlowchart</code>, <code>asSequence</code>, …).' },
  { label: 'Mutate', short: 'Change the requested node, edge, task, relation, or event while preserving unmodeled syntax.' },
  { label: 'Verify', short: 'Read structural, geometric, and lint warnings before serializing or rendering artifacts.' },
  { label: 'Serialize', short: 'Write the typed model back to Mermaid source, then render only when an artifact is needed.' },
] as const
function injectLoopRail(html: string) {
  const items = LOOP_STEPS.map((s) => `      <li><strong>${s.label}.</strong> ${s.short}</li>`).join('\n')
  return html.replace(/<ol class="quick-steps">[\s\S]*?<\/ol>/, `<ol class="quick-steps">\n${items}\n    </ol>`)
}
function injectLoopHeadings(html: string) {
  return LOOP_STEPS.reduce((h, s, i) => h.replace(new RegExp(`<h2>${i + 1} &middot; [^<]*</h2>`), `<h2>${i + 1} &middot; ${s.label}</h2>`), html)
}
// One canonical docs index. Generated docs pages append it (as `docsIndex`,
// with a leading rule) and the docs article gets it injected at build time —
// same single-source pattern as the loop rail — so the source page's
// hand-baked list can never drift from the pages that actually ship.
const docsIndexBody = '<h2>Docs index</h2><ul class="doc-index doc-index-grouped"><li><strong>Start</strong><ul><li><a href="/docs/getting-started/">Getting started</a></li><li><a href="/docs/families/">Diagram families</a></li><li><a href="/examples/">Examples</a></li></ul></li><li><strong>Use locally</strong><ul><li><a href="/docs/api/">Library API</a></li><li><a href="/docs/cli/">CLI</a></li><li><a href="/docs/mcp/">MCP</a></li></ul></li><li><strong>Debug</strong><ul><li><a href="/warnings/">Warnings</a></li><li><a href="/errors/">Errors</a></li><li><a href="/docs/quality/">Quality</a></li></ul></li><li><strong>Reference</strong><ul><li><a href="/docs/ascii/">ASCII and Unicode</a></li><li><a href="/docs/theming/">Theming</a></li><li><a href="/docs/fork-differences/">Fork differences</a></li></ul></li></ul>'
const docsIndex = '<hr>' + docsIndexBody
function injectDocsIndex(html: string) {
  return html.replace(/<h2>Docs index<\/h2>\s*<ul class="doc-index">[\s\S]*?<\/ul>/, docsIndexBody)
}
const workflowSource = await readSourceDiagram('workflow.mmd')
function addWorkflowSvgA11y(svg: string) {
  return svg.replace(/^<svg\b([^>]*)>/, (_full, attrs: string) => {
    const role = /\brole=/.test(attrs) ? '' : ' role="img"'
    const label = /\baria-labelledby=/.test(attrs) ? '' : ' aria-labelledby="edit-loop-svg-title edit-loop-svg-desc"'
    return `<svg${attrs}${role}${label}>\n<title id="edit-loop-svg-title">Agentic Mermaid edit loop</title>\n<desc id="edit-loop-svg-desc">Source flows through parse, narrow, mutate, verify, and serialize to render, with warnings routed back for another edit.</desc>`
  })
}
// The hero is artwork, not chrome. It used to render with var(--bg/--fg/--accent)
// and inherit the page tokens — invisible while the chrome accent WAS the Paper
// terracotta, but when the shell moved to the Pine brand the hero silently
// re-themed with it, violating the design contract ("diagram themes colour the
// artwork, never this shell"). Bake the Paper render theme instead, exactly like
// the about-page diagrams (ABOUT_DIAGRAM_THEME below).
const workflowPaperSvg = addWorkflowSvgA11y(renderMermaidSVG(workflowSource,
  { bg: '#F5F0E4', fg: '#221E16', accent: '#9A4A24', transparent: true, security: 'strict', embedFontImport: false }))
function injectWorkflowSvg(html: string) {
  return html.replace(/<div class="plate dia-plate">[\s\S]*?<\/div>|<div class="plate"><div class="dia-wrap">[\s\S]*?<\/div><\/div>/,
    `<div class="plate dia-plate">\n      ${workflowPaperSvg}\n    </div>`)
}
function injectWorkflowUnicode(html: string) {
  const unicode = renderMermaidASCII(workflowSource, { useAscii: false })
    .split('\n').map((line) => line.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
  return html.replace(/(The same diagram as Unicode text:<\/p>\s*<pre><code>)[\s\S]*?(<\/code><\/pre>)/,
    '$1' + escapeHtml(unicode) + '$2')
}
for (const [source, target] of pageOutputs) {
  const currentHref = topNavHrefForRoute(routeMap[source])
  let html = transformHtml(await readSourcePage(source), currentHref, routeMap[source])
  // Source pages can carry hand-baked mastheads that predate newer routes.
  // Swap in the one canonical masthead so every shipped page shares one nav.
  html = html.replace(/<header class="masthead">[\s\S]*?<\/header>/, () => mastheadHtml(currentHref))
  // Same treatment for the hand-baked footers: every shipped page carries the
  // one canonical human + machine link rows.
  html = html.replace(/<footer>[\s\S]*?<\/footer>/, () => footerHtml())
  html = injectWorkflowSvg(html)
  if (source === 'home.html') html = injectLoopRail(injectWorkflowUnicode(html))
  if (source === 'docs-article.html') html = injectDocsIndex(injectLoopHeadings(html))
  await emit(target, html)
}
await emit('editor/index.html', await generateEditorHtml())

// Static assets.
for (const asset of ['favicon.svg', 'styles.css', 'theme.js', 'shader-mark.js']) await copySourceAsset(asset)
for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'og-image.png']) await copyFileFrom(join(ROOT, 'public', asset), asset)
await copyDir(SOURCE_DIAGRAMS, 'diagrams')
// Standalone var()-token demo of the live-theming feature (set --bg/--fg/--accent
// on a parent to re-theme it). This is the one place a var-driven render belongs;
// the home hero deliberately stopped using it (see workflowPaperSvg above).
await emit('diagrams/workflow-themeable.svg', addWorkflowSvgA11y(renderMermaidSVG(workflowSource,
  { bg: 'var(--bg)', fg: 'var(--fg)', accent: 'var(--accent)', transparent: true, embedFontImport: false })
  .replace('--bg:var(--bg);--fg:var(--fg);--accent:var(--accent);', '')))

const capabilities = { ...rawCapabilities, generatedFrom }
// capabilities.json is emitted later (after the WARNING_DETAIL table), once each
// warningCodes entry is enriched with its what/triggers/fix prose so the JSON is
// a full machine surface — not just code/tier/severity.

const examples = {
  generatedFrom,
  examples: EDITOR_EXAMPLES.map((example) => {
    const family = familyForExample(example)
    if (!family) throw new Error(`Editor example ${example.id} does not map to a supported family`)
    return {
      id: example.id,
      family: family.id,
      label: example.label,
      description: example.description ?? example.label,
      headers: family.headers,
      source: String(example.source ?? '').trim(),
      renderUrl: `/examples/#${exampleAnchor(example)}`,
      editorUrl: `/editor/?example=${example.id}`,
      outputs: capabilities.outputFormats,
      docs: `/docs/families/#${family.id}`,
    }
  }),
}
await emitJson('examples/index.json', examples)

const skillFiles = ['SKILL.md', 'references/cli.md', 'references/code-mode.md', 'references/flowchart.md', 'references/sequence.md', 'references/timeline.md']
for (const file of skillFiles) {
  const text = await Bun.file(join(ROOT, 'skills/agentic-mermaid-diagram-workflow', file)).text()
  await emit(`skills/agentic-mermaid-diagram-workflow/${file}`, text)
}

// Public llms.txt must not expose repo-only backlog/eval/contributor surfaces.
const publicLlms = `# Agentic Mermaid\n\nAgentic Mermaid renders, verifies, and safely edits Mermaid diagrams. Use the package, CLI, the hosted MCP at /mcp, or a self-hosted MCP; the website is documentation plus a browser-local editor, not a REST render API.\n\nStart here:\n- /mcp \u2013 hosted MCP endpoint (stateless streamable HTTP JSON-RPC; tools: execute, render_svg, render_ascii, render_png, verify, describe)\n- /agent-instructions.md – compact operating guide for agents\n- /capabilities.json – authoritative family/output/mutation/warning contract\n- /examples/index.json – the same example IDs and sources loaded by the editor\n- /skills/agentic-mermaid-diagram-workflow/SKILL.md – optional workflow skill for skills-capable agents\n\nStyles: every render accepts style (a name like hand-drawn/watercolor/blueprint or any theme name, an inline JSON record, or a stack merged left-to-right) plus seed to re-roll styled ink; layout never moves. A colors-only style is a theme. Authoring guide: docs/style-authoring.md in the package.\n\nStop rules:\n- Verify before serialize, render, commit, or return.\n- Do not fabricate ValidDiagram objects. Parse first.\n- Prefer the local library, CLI, or MCP; the hosted /mcp endpoint covers the same tools with 64KB input caps.\n- Call /mcp with MCP JSON-RPC only; the website is not a REST render API.\n`;
await emit('llms.txt', publicLlms)
await emit('agent-instructions.md', await Bun.file(join(ROOT, 'Instructions_for_agents.md')).text())

// Spec route coverage pages.
const aboutLead = 'Agentic Mermaid is a fork of beautiful-mermaid, aimed at a job the original did not have: programs that draw and check diagrams with no person watching. It renders without a browser, reports its own layout errors, and edits diagrams as a typed tree.'
// The brand Paper palette, hex-resolved. The public site is light-only, so these
// diagrams render once in Paper rather than carrying a var()-token SVG: page-level
// custom properties do not inherit into an inlined SVG here, which would leave
// edge-label halos at fill's black initial value. Paper's derived tiers come from
// the engine's MIX weights, matching #F5F0E4 page tokens exactly (see THEMES.paper).
const ABOUT_DIAGRAM_THEME = { bg: '#F5F0E4', fg: '#221E16', accent: '#9A4A24' }
function aboutDiagram(source: string, id: string) {
  // Drawn by the engine at build time — a page about a Mermaid renderer, rendered
  // by it. Transparent canvas so the diagram floats on the page; halos resolve to
  // Paper bg and disappear into it.
  const svg = renderMermaidSVG(source, { ...ABOUT_DIAGRAM_THEME, transparent: true, security: 'strict', compact: true, embedFontImport: false, idPrefix: `about-${id}-` })
  return `<figure class="about-diagram">${svg}</figure>`
}
const aboutBody = `
<h2>An agent writes a diagram it cannot see</h2>
<p>When a coding agent emits a Mermaid block, it is working blind. mermaid.js renders in a browser, so the only way to know whether an edge landed on the right node, or whether two boxes overlap, is to start a headless Chrome, rasterize, and look at the picture. An agent in the middle of a task has no picture to look at, so the diagram ships and the break surfaces when a person opens the page. Agentic Mermaid takes the browser out of the path and hands the agent something it can read instead.</p>

<h2>The same source renders the same way</h2>
<p>The layout is a pure function of the source and the theme tokens. Render twice and the geometry is byte-identical, on any machine, with nothing measuring text in a browser. Because the bytes are stable, a rendered SVG can be committed and diffed in review, a PNG can be cached by the hash of its source, and a render can gate a CI job without flaking. mermaid.js holds none of this: its layout moves between versions and depends on the browser doing the measurement.</p>
<pre><code>am render diagram.mmd --format svg > a.svg
am render diagram.mmd --format svg > b.svg
diff a.svg b.svg        # no output: identical bytes, every run, no browser</code></pre>

<h2>Verify before you serialize</h2>
<p><code>verifyMermaid</code> reads a parsed diagram and sorts its warnings into three tiers. Structural warnings mean the diagram is wrong: an edge anchored to nothing (<code>EDGE_MISANCHORED</code>), a node off the canvas (<code>OFF_CANVAS</code>), content that escaped its group (<code>GROUP_BREACH</code>). Geometric warnings mean it reads but the routing is poor: overlapping nodes (<code>NODE_OVERLAP</code>), a path that crosses itself (<code>ROUTE_SELF_CROSS</code>). Lint warnings cover cleanliness and round-trip loss. Every warning carries a stable code, so an agent runs verify the way it runs a test: check, read the code, fix, check again. The editor shows the same three tiers as you type, <code>am verify</code> prints them, and the MCP server returns them.</p>
<pre><code>const verify = verifyMermaid(parsed.value)
if (!verify.ok) throw new Error(JSON.stringify(verify.warnings, null, 2))
// every warning: a code (EDGE_MISANCHORED), a tier (structural | geometric | lint),
// and a severity, so the fix is mechanical</code></pre>

<h2>Edits go through a typed tree</h2>
<p>To add an edge with a string-based tool, you append a line and hope it parses. Agentic Mermaid parses the source into a typed tree, narrows it to a family with <code>asFlowchart</code>, applies one operation, and serializes back. The operation matches a known shape or returns an error, so it cannot half-apply and leave the source corrupt. Syntax the library cannot narrow is preserved verbatim, and a lossy change asks first.</p>
<pre><code>const flow = asFlowchart(parseMermaid(source).value)   // narrow to flowchart
const r = mutate(flow, { kind: 'add_edge', from: 'API', to: 'Cache' })
if (!verifyMermaid(r.value).ok) throw new Error('mutation left it broken')
const next = serializeMermaid(r.value)                 // typed tree back to text</code></pre>

<h2>One source, five surfaces</h2>
<p>The same parsed diagram serializes to SVG for a web page, PNG for a document, ASCII and Unicode for a terminal, and JSON for the raw layout coordinates. The text forms are the ones agents actually use: an agent reading a pull request or a CI log sees the diagram as box-drawing characters it can parse, where an image tag would be a dead link. The editor renders all three from the one source in the box on the left, so the Diagram, Unicode, and ASCII tabs are the same diagram under three encodings.</p>
<pre><code>am render flow.mmd --format svg    > flow.svg
am render flow.mmd --format png    > flow.png
am render flow.mmd --format ascii          # box-drawing, into the terminal</code></pre>

<h2>The loop</h2>
<p>These are one loop. An agent parses the source, narrows it with <code>asFlowchart</code>, mutates a node, verifies the result, and serializes it back, then renders the same bytes every time and reads the ASCII when it cannot open an image. It runs the whole loop with no browser and without asking a person whether the picture looks right. That last part is what beautiful-mermaid had no reason to do, and the reason this fork exists.</p>
${aboutDiagram('flowchart LR\n  Parse --> Narrow\n  Narrow --> Mutate\n  Mutate --> Verify\n  Verify -- ok --> Serialize\n  Verify -- warnings --> Narrow', 'loop')}
<p class="muted">The loop itself, drawn by Agentic Mermaid at build time from six lines of Mermaid.</p>

<h2>Where it comes from</h2>
<p><a href="https://mermaid.js.org">Mermaid</a> is the text syntax these diagrams are written in; its own renderer draws them in a browser. Drawing that text without a browser has been tried before — <a href="https://github.com/AlexanderGrooff/mermaid-ascii">mermaid-ascii</a> renders Mermaid graphs as ASCII straight in a terminal. <a href="https://github.com/lukilabs/beautiful-mermaid">Beautiful Mermaid</a>, from the team at Craft, is a zero-dependency TypeScript renderer that outputs both SVG and ASCII, with its ASCII engine ported from mermaid-ascii's Go. Agentic Mermaid forks Beautiful Mermaid and adds the typed editing and deterministic verification above it, so an agent can change a diagram and check it, where the renderers before it could only draw one.</p>
${aboutDiagram('flowchart TD\n  M[Mermaid] --> BM[Beautiful Mermaid]\n  MA[mermaid-ascii] --> BM\n  BM --> AM[Agentic Mermaid]', 'lineage')}
`
// The former top-level Families page, folded into Docs as a reference. The 12
// rows keep their family-id anchors so deep links (and the examples manifest's
// `docs` field) resolve to /docs/families/#<family>.
const FAMILY_REFERENCE: Array<[id: string, label: string, draws: string]> = [
  ['flowchart', 'Flowchart', 'Decision flow with labeled branches.'],
  ['state', 'State', 'Lifecycle using Mermaid stateDiagram-v2 syntax.'],
  ['sequence', 'Sequence', 'Request/response messages between participants.'],
  ['timeline', 'Timeline', 'Chronological milestones with sections.'],
  ['class', 'Class', 'Classes with members and relationships.'],
  ['er', 'ER', 'Entities, attributes, keys, and cardinality markers.'],
  ['journey', 'Journey', 'Scored user tasks grouped by section.'],
  ['architecture', 'Architecture', 'Services, groups, icons, and routed connections.'],
  ['xychart', 'XY chart', 'Bar and line series using xychart syntax.'],
  ['pie', 'Pie', 'Proportional slices with values shown in the legend.'],
  ['quadrant', 'Quadrant', 'Two-axis priority map with labeled regions and points.'],
  ['gantt', 'Gantt', 'Sections, dependencies, status tags, and a milestone.'],
]
// Number-word for the family count, derived from the registry so the published
// prose can't drift from BUILTIN_FAMILY_METADATA (adding a family updates this).
const FAMILY_COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const familyCountWord = FAMILY_COUNT_WORDS[BUILTIN_FAMILY_METADATA.length] ?? String(BUILTIN_FAMILY_METADATA.length)
const familiesLead = `${familyCountWord.charAt(0).toUpperCase()}${familyCountWord.slice(1)} families share one deterministic layout engine. Each parses from Mermaid text and renders to SVG, PNG, ASCII, Unicode, and layout JSON from the same positioned model.`
function familiesReferenceHtml() {
  const rows = FAMILY_REFERENCE.map(([id, label, draws]) => `<tr id="${id}"><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(draws)}</td></tr>`).join('')
  return `<p>Every family carries a route certificate: a machine-checkable claim about how its edges were routed — orthogonal boxes for class and ER, lifelines for sequence, side-anchored links for architecture. That certificate is what lets <code>verify</code> answer in tiers instead of guessing.</p>
<table>
<thead><tr><th>Family</th><th>What it draws</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>See any of them rendered on the <a href="/examples/">examples</a> page, or open one in the <a href="${GENERIC_EDITOR_HREF}">editor</a>.</p>${docsIndex}`
}
// The MCP config copy-card, same widget contract as the homepage prompt card
// (data-copy-widget + data-copy-target + copy-prompt-btn, wired by theme.js).
// Getting started is the canonical setup home for this config.
const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "agentic-mermaid": {
      "command": "bun",
      "args": ["run", "bin/agentic-mermaid-mcp.ts"]
    }
  }
}`
function mcpConfigCardHtml(idPrefix: string) {
  return `<div class="copy-prompt-card agent-config" data-copy-widget data-copy-name="MCP config">
<div class="copy-prompt-bar">
<span class="copy-prompt-label meta-label">MCP config</span>
<button class="copy-prompt-btn" type="button" data-copy-target="${idPrefix}-mcp-config" data-copy-name="MCP config" aria-describedby="${idPrefix}-mcp-copy-status"><span class="copy-prompt-icon" aria-hidden="true"></span><span>Copy MCP config</span></button>
</div>
<pre class="agent-prompt"><code id="${idPrefix}-mcp-config">${escapeHtml(MCP_CONFIG_JSON)}</code></pre>
<p class="copy-prompt-hint">Run from the cloned repo root, or replace <code>bin/agentic-mermaid-mcp.ts</code> with an absolute path.</p>
<p class="copy-prompt-status" id="${idPrefix}-mcp-copy-status" role="status" aria-live="polite"></p>
</div>`
}
const gettingStartedBody = `<p>Start with Mermaid source, not a screenshot. Render it locally, then give an agent the prompt from the homepage when you want an edit.</p>
<ol class="start-rail">
<li><strong>Install Agentic Mermaid.</strong><p>${escapeHtml(installNotice)}</p><pre><code>${escapeHtml(installCommand)}</code></pre></li>
<li><strong>Create a diagram.</strong><pre><code>cat > diagram.mmd &lt;&lt;'MMD'
flowchart LR
  Idea[Idea] --&gt; Draft[Draft]
  Draft --&gt; Review{Review}
  Review --&gt;|ok| Ship[Ship]
MMD</code></pre></li>
<li><strong>Verify, then render.</strong><pre><code>bun run bin/am.ts verify diagram.mmd --json
bun run bin/am.ts render diagram.mmd --format svg --output diagram.svg
bun run bin/am.ts render diagram.mmd --format unicode</code></pre></li>
<li><strong>Ask an agent for the smallest edit.</strong><p>Paste your task and source into the homepage agent prompt, and require the agent to return Updated Mermaid, Verification, and Trace.</p><a class="go" href="/#home-agent-prompt">Get the agent prompt on the homepage</a></li>
<li><strong>Optional: wire MCP.</strong><p>Self-hosting over stdio is the default path; a hosted MCP endpoint is also available at <code>https://agentic-mermaid.dev/mcp</code> (streamable HTTP).</p>
${mcpConfigCardHtml('getting-started')}
<pre><code>bun run bin/agentic-mermaid-mcp.ts</code></pre><p>Use stdio MCP from the cloned repo, or point an MCP client at the hosted endpoint.</p></li>
</ol>
<h2>Vocabulary</h2>
<p>Shared terms for humans and agents, used across these docs.</p>
<dl><dt>narrow</dt><dd>Resolve a parsed diagram to a family-specific typed surface.</dd><dt>verify</dt><dd>Return structural, geometric, and lint warnings before artifacts are trusted.</dd><dt>opaque fallback</dt><dd>Preserve unsupported syntax losslessly when structured mutation is unavailable.</dd></dl>
${docsIndex}`

// /about/design — the design-language reference. Specimens read the live CSS
// tokens (var(--…)) rather than repeating hex, so the page cannot drift from
// the stylesheet it documents; hex appears only as the label under a swatch.
const designLead = 'The tokens, type, and motion the site and editor share — documented with the same variables that render this page. Diagram themes are deliberately absent: they colour the artwork, never this shell.'
const designBody = `
<h2>Three layers, one seam</h2>
<p>The stylesheet separates <strong>brand</strong> (the mark, the grain, the type — constants no theme may set), <strong>theme</strong> (a <code>--bg</code>/<code>--fg</code>/<code>--accent</code> triplet everything else derives from), and <strong>scheme</strong> (light/dark polarity). The seam means a renderer theme can restyle a diagram plate without touching the logo or the shell — the same isolation the editor uses when its theme dropdown changes render output but never the app chrome.</p>

<h2>Colour</h2>
<p>The shell is warm stone and ink; one derived ramp covers text, borders, and surfaces. Ink steps keep WCAG AA: soft 8.0:1, faint 5.3:1 on the ground.</p>
<div class="dz-grid">
  <div class="dz-swatch"><div class="chip" style="background:var(--paper)"></div><div class="meta"><b>--paper</b><span>#F8F4F0 · ground</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--ink)"></div><div class="meta"><b>--ink</b><span>#26201B · text</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--ink-soft)"></div><div class="meta"><b>--ink-soft</b><span>fg 80% · secondary</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--ink-faint)"></div><div class="meta"><b>--ink-faint</b><span>fg 68% · captions</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--surface)"></div><div class="meta"><b>--surface</b><span>fg 5% · cards</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--chip)"></div><div class="meta"><b>--chip</b><span>fg 9% · hover</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--line)"></div><div class="meta"><b>--line</b><span>fg 13% · hairline</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--accent)"></div><div class="meta"><b>--accent</b><span>#1B6E52 · pine, 5.7:1</span></div></div>
</div>
<p>The pine accent carries links, buttons, and focus. It sits in the hue region no diagram theme's accent occupies (the renderer accents cluster warm at 21–58° and cool at 217–318°), so chrome and artwork never read as one palette. The brand chip is its own token pair — <code>--brand-pine</code>/<code>--brand-on</code> — outside the theme layer entirely.</p>
<h3>Functional colour</h3>
<p>Four hues carry meaning only, each with a solid ink for text and a 14% tint for fills. On this ground the inks measure success 5.9:1, info 4.8:1, warn 5.4:1, danger 6.3:1. Success is a true leaf green held at least 20° of OkLCH hue from the pine accent, so a link and a confirmation never read as the same colour.</p>
<div class="dz-grid">
  <div class="dz-swatch"><div class="chip" style="background:var(--success)"></div><div class="meta"><b>--success</b><span>copied, verified</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--info)"></div><div class="meta"><b>--info</b><span>notices, drafts</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--warn)"></div><div class="meta"><b>--warn</b><span>advisories</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--danger)"></div><div class="meta"><b>--danger</b><span>errors</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--success-tint)"></div><div class="meta"><b>--success-tint</b><span>14% fill</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--info-tint)"></div><div class="meta"><b>--info-tint</b><span>14% fill</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--warn-tint)"></div><div class="meta"><b>--warn-tint</b><span>14% fill</span></div></div>
  <div class="dz-swatch"><div class="chip" style="background:var(--danger-tint)"></div><div class="meta"><b>--danger-tint</b><span>14% fill</span></div></div>
</div>

<h2>Typography</h2>
<p>Charter carries reading, Avenir carries controls, SF Mono carries code and data. Headings track tighter as they grow (<code>--track-heading</code> −0.018em, <code>--track-display</code> −0.022em) and balance their line breaks; body text wraps pretty at a 46.25rem measure. Anywhere digits change — render times, scales, tables — <code>tabular-nums</code> keeps them from shifting the layout.</p>
<div class="dz-type-row"><span class="spec" style="font-family:var(--serif);font-size:var(--t-h2);font-weight:600;letter-spacing:var(--track-heading)">Charter — headings and prose</span><span class="tok">--serif · --t-h2</span></div>
<div class="dz-type-row"><span class="spec" style="font-family:var(--sans);font-size:var(--t-body);font-weight:650">Avenir Next — controls and labels</span><span class="tok">--sans · --t-body</span></div>
<div class="dz-type-row"><span class="spec" style="font-family:var(--mono);font-size:var(--t-mono)">SF Mono — code, tokens, 0123456789</span><span class="tok">--mono · --t-mono</span></div>

<h2>Space, radii, and nesting</h2>
<p>Spacing runs a 4px-based scale (<code>--sp-1</code> 4px → <code>--sp-9</code> 56px). Radii come in three sizes plus a pill; nested corners are derived, not matched: <code>inner&nbsp;=&nbsp;outer&nbsp;−&nbsp;border&nbsp;−&nbsp;padding</code>, written as a <code>calc()</code> so the derivation is visible in the stylesheet.</p>
<div class="dz-radii">
  <div class="dz-radius" style="border-radius:var(--radius-sm)">sm 6</div>
  <div class="dz-radius" style="border-radius:var(--radius-md)">md 8</div>
  <div class="dz-radius" style="border-radius:var(--radius-lg)">lg 12</div>
  <div class="dz-radius" style="border-radius:var(--radius-pill)">pill</div>
  <div class="dz-nest"><span>lg − 1 − 6 = 5</span></div>
</div>

<h2>Elevation</h2>
<p>Shadows are layered — a hairline ring, a near shadow, a far ambient — because one heavy blur reads flat. Controls sit on a ring alone; cards add the near layer; popovers add the far one.</p>
<div class="dz-shadows">
  <div class="dz-shadow" style="box-shadow:var(--shadow-control)">control</div>
  <div class="dz-shadow" style="box-shadow:var(--card-shadow)">card</div>
  <div class="dz-shadow" style="box-shadow:var(--shadow-popover)">popover</div>
</div>

<h2>Motion</h2>
<p>Three durations, one curve. Presses run <code>--dur-press</code> 0.1s, control state changes <code>--dur-control</code> 0.16s, page-level fades <code>--dur-ui</code> 0.2s, all on <code>--ease-out</code> <code>cubic-bezier(0.22,&nbsp;1,&nbsp;0.36,&nbsp;1)</code> — fast start, soft landing, the curve for anything answering the user. Every press lands at <code>scale(0.96)</code>. Popovers enter with a short fade-and-scale from the corner that anchors them and exit instantly; <code>prefers-reduced-motion</code> flattens all of it.</p>
<div class="dz-motion">
  <button class="dz-press" type="button">Press me — 0.96 at 0.1s</button>
  <span style="font-family:var(--mono);font-size:var(--t-label);color:var(--ink-faint)">hover 0.16s · enter 0.16s ease-out · exit instant</span>
</div>

<h2>Iconography</h2>
<p>Interface icons are hairline strokes with round caps and joins: <code>stroke-width</code> 2 up to 14px, 1.75 from 15px, so optical weight stays even as size grows. The graph mark is exempt — it is brand art with its own drawn weights, isolated in the brand layer.</p>
<div class="dz-mark-row">
  <span class="mark" style="width:32px;height:32px;border-radius:var(--radius-md);background:var(--brand-pine);display:inline-grid;place-items:center"></span>
  <span class="dz-icons">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
  </span>
</div>

<h2>Voice</h2>
<p>Interface copy states what happened and, on failure, what to do next.</p>
<ul class="dz-voice">
<li>Confirmations are calm sentences: <code>SVG saved.</code> <code>PNG copied (2×).</code> — periods, no exclamation marks, a real multiplication sign.</li>
<li>Errors name the unmet condition: <code>Load or write a diagram before exporting.</code> rather than an apology.</li>
<li>Status is concrete: <code>Verified: no warnings</code>, <code>Rendered in 12ms</code> — a measurement, not an adjective.</li>
</ul>
<p class="muted">Diagram styles and themes (hand-drawn, watercolor, paper, dusk, tokyo-night, …) are documented in <a href="/docs/theming/">theming</a>; they style rendered diagrams and stay out of this shell by construction.</p>`

const docPages = [
  ['about/index.html', 'About Agentic Mermaid', aboutLead, aboutBody, '/about/'],
  ['about/design/index.html', 'Design language', designLead, designBody, '/about/'],
  ['docs/getting-started/index.html', 'Getting started', 'From Mermaid source to a verified local render, then to an agent-safe edit loop.', gettingStartedBody, '/docs/'],
  ['docs/families/index.html', 'Diagram families', familiesLead, familiesReferenceHtml(), '/docs/'],
  ['docs/api/index.html', 'Library API', 'Use agentic-mermaid and agentic-mermaid/agent from local JS or TS.', '<p>Import rendering helpers from <code>agentic-mermaid</code> and typed parse/mutate/verify helpers from <code>agentic-mermaid/agent</code>. Everything runs locally with no network.</p>\n<pre><code>import { renderMermaidSVG, renderMermaidASCII } from \'agentic-mermaid\'\nimport { parseMermaid, verifyMermaid } from \'agentic-mermaid/agent\'\n\nconst src = \'flowchart LR\\n  A[Idea] --&gt; B[Ship]\'\nconst svg = renderMermaidSVG(src)           // also renderMermaidASCII / unicode\nconst { ok, warnings } = verifyMermaid(src) // structured, tiered warnings</code></pre>\n<p>Render helpers return strings (SVG, ASCII, Unicode); the agent surface returns typed diagrams plus structured verify warnings. <strong>In React</strong>, call the same helpers in your component and inject the SVG — private diagrams never leave the browser or your own infrastructure. <strong>Config:</strong> supported Mermaid frontmatter and <code>init</code> directives are normalized before rendering; unsupported syntax is preserved or reported, never silently dropped.</p>' + docsIndex],
  ['docs/cli/index.html', 'CLI', 'Use the am CLI for local rendering, verification, batch checks, and Markdown rendering.', '<p>The <code>am</code> CLI wraps the library for local rendering, verification, and batch checks. In the cloned repo, <code>am</code> is <code>bun run bin/am.ts</code>.</p>\n<pre><code>am verify diagram.mmd                # structural + geometric + lint warnings\nam verify diagram.mmd --json         # machine-readable for agents\nam render diagram.mmd --format svg --output diagram.svg\nam render diagram.mmd --format png --output diagram.png\nam render diagram.mmd --format ascii # or --format unicode</code></pre>\n<p>Prefer <code>--json</code> in agent loops so you can branch on <code>verify.ok</code> and the stable warning codes instead of parsing prose.</p>' + docsIndex],
  ['docs/mcp/index.html', 'MCP', 'Hosted MCP at /mcp, plus a local stdio server.', '<p>The hosted MCP endpoint is <code>https://agentic-mermaid.dev/mcp</code>: stateless streamable HTTP (JSON-RPC over POST, no sessions). Hosted tools: <code>execute</code>, <code>render_svg</code>, <code>render_ascii</code>, <code>render_png</code>, <code>verify</code>, and <code>describe</code>. Deterministic responses are edge-cached, inputs are capped at 64KB, and Code Mode <code>execute</code> runs in an isolated on-demand Worker with network access disabled and a CPU budget.</p><p>The local MCP tools are <code>execute</code>, <code>render_png</code>, and <code>describe</code>. Multi-step parse/narrow/mutate/verify workflows run inside <code>execute(code)</code>. For file/URL PNG artifacts, diagrams beyond the hosted caps, or offline use, run the stdio server from the repo: <code>bun run bin/agentic-mermaid-mcp.ts</code>.</p><p><strong>Privacy:</strong> every hosted tool call sends your diagram source (or Code Mode code) to this site\u2019s server, and successful responses are edge-cached for up to a day. For diagrams that must not leave your machine, use the library, the CLI, or the local stdio server \u2014 the pipeline is fully local and needs no network.</p><p><strong>Response framing:</strong> the hosted <code>/mcp</code> endpoint always replies with plain <code>application/json</code> \u2014 no SSE <code>data:</code> framing \u2014 so scripts can parse the body directly. The local HTTP transport\u2019s <code>/sse</code> + <code>/message</code> pair delivers responses as SSE events on the open stream; script writers who want unframed JSON should POST to its <code>/rpc</code> endpoint instead.</p>' + docsIndex],
  ['docs/ascii/index.html', 'ASCII and Unicode', 'Text output is first-class for terminals, PR comments, and agent review.', '<p>Text output is first-class, not a fallback: ASCII (portable 7-bit) and Unicode (box-drawing) renders drop straight into terminals, PR comments, commit messages, and agent transcripts where an SVG cannot go.</p>\n<pre><code>am render diagram.mmd --format ascii    # portable, 7-bit\nam render diagram.mmd --format unicode  # sharper box-drawing glyphs</code></pre>\n<p>The text path is deterministic like the SVG path, so the same source always yields the same characters — reviewable in a plain diff. The ASCII engine is ported from mermaid-ascii; see <a href="/about/">About</a> for the lineage.</p>' + docsIndex],
  ['docs/theming/index.html', 'Theming and styles', 'A style describes how diagrams look; a colors-only style is a theme.', '<p>One primitive covers every look: a <strong>style</strong> is a partial, composable description of how diagrams render — palette, typography, stroke character, fills. A style that only sets colours is what people call a <em>theme</em>; full looks like <code>hand-drawn</code>, <code>watercolor</code>, or <code>blueprint</code> also change the mark treatment. Styles stack left \u2192 right (<code>{ style: [\'hand-drawn\', \'dracula\'] }</code> is hand-drawn geometry in the dracula palette), the optional <code>seed</code> re-rolls styled ink without ever moving layout, and custom styles are plain JSON records. The browser editor exposes both pickers \u2014 Style chooses the look, Theme chooses the palette \u2014 and SVG output can also inherit CSS variables for live theming.</p>' + docsIndex],
  ['docs/quality/index.html', 'Quality', 'Determinism, verify warnings, and layout metrics make diagram edits reviewable.', '<p><code>verify.ok</code> is a gate, not a promise of visual perfection. Include SVG/PNG/ASCII artifacts for human review when the change is visual.</p>\n<p><strong>Warnings are tiered</strong> so an agent knows how to react: <em>structural</em> problems can block a safe return and should be fixed first; <em>geometric</em> warnings ask for visual review; <em>lint</em> warnings mean a smaller or cleaner edit. Every code has a page under <a href="/warnings/">warnings</a> with what triggers it and how to clear it.</p>\n<p><strong>Evidence is curated, not raw private prompts:</strong> rely on CI, deterministic layout metrics, and generated artifacts to review a change. Private eval prompts and holdbacks are not public site content.</p>' + docsIndex],
  ['docs/fork-differences/index.html', 'Fork differences', 'Agentic Mermaid adds typed editing, deterministic verification, CLI, MCP, and more families.', '<p>Agentic Mermaid (<code>agentic-mermaid</code>) forks <a href="https://github.com/lukilabs/beautiful-mermaid">beautiful-mermaid</a> for a job the render-only original did not have: programs that draw and check diagrams with no person watching.</p>\n<ul>\n<li><strong>Typed agent surface.</strong> A render-only library forces an agent to regenerate a whole diagram to change one node. Here new diagrams are authored as source then parsed/verified/rendered, and existing diagrams go parse → narrow → mutate → verify → serialize via <code>agentic-mermaid/agent</code>. All twelve families are structured-when-narrowed; unmodeled syntax still round-trips losslessly as opaque fallback.</li>\n<li><strong>Deterministic, verifiable layout.</strong> Layout is byte-identical across processes, and <code>verifyMermaid</code> returns structured warnings in three tiers (structural, geometric, lint) plus perceptual quality metrics.</li>\n<li><strong>More families.</strong> Adds timeline, journey, architecture, pie, quadrant, and Gantt on top of the upstream six (flowchart, state, sequence, class, ER, and XY chart) — twelve in all.</li>\n<li><strong>Tools.</strong> An <code>am</code> CLI, an <code>agentic-mermaid-mcp</code> Code Mode MCP server (stdio + opt-in HTTP/SSE), and a hosted MCP endpoint at <code>/mcp</code>. There is no REST render API.</li>\n<li><strong>Semantic SVG styling.</strong> A role-based style API (<code>text</code>/<code>node</code>/<code>edge</code>/<code>group</code>) describes meaning rather than SVG element names.</li>\n</ul>\n<p>See <a href="/docs/families/">diagram families</a> for the full family list and <a href="/about/">About</a> for the lineage.</p>' + docsIndex],
  ['examples/index.html', 'Examples', 'Proof that each editor source parses, renders, and carries an agent task you can replay.', examplesShowcaseHtml(EDITOR_EXAMPLES), '/examples/'],
  ['comparisons/index.html', 'Comparisons', 'One source per family, rendered three ways.', comparisonsHtml(), '/comparisons/'],
]
// Prev/next pager for the manual pages under /docs/, in docPages order with no
// wrap: the first page has only next, the last only prev. About and the other
// coverage pages (security, releases, evidence, examples, skills) do not page.
const docsSequence = docPages.filter(([rel]) => rel.startsWith('docs/'))
function docsPagerHtml(rel: string) {
  const i = docsSequence.findIndex(([r]) => r === rel)
  if (i === -1) return ''
  const link = (page: (typeof docPages)[number], dir: 'prev' | 'next') => {
    const href = '/' + page[0].replace(/index\.html$/, '')
    const label = dir === 'prev' ? `&larr; ${escapeHtml(page[1])}` : `${escapeHtml(page[1])} &rarr;`
    return `<a class="doc-pager-${dir}" rel="${dir}" href="${href}">${label}</a>`
  }
  const prev = docsSequence[i - 1]
  const next = docsSequence[i + 1]
  return `\n<nav class="doc-pager" aria-label="Docs pages">${prev ? link(prev, 'prev') : ''}${next ? link(next, 'next') : ''}</nav>`
}
for (const [rel, title, lead, body, currentHref] of docPages) await emitShell(rel, title, lead, body + docsPagerHtml(rel), currentHref || (rel.startsWith('docs/') ? '/docs/' : ''))

// Per-code warning reference. `what` is plain text (it becomes the lead and the
// meta description); `triggers`/`fix` may carry inline markup. `example` is a
// minimal Mermaid source expected to fire the code — it is verified at build
// time against the real engine and the demo ships ONLY when the code actually
// fires, so the pages can never show a stale or fabricated reproduction.
// Codes with no small deterministic reproduction (the layout pipeline prevents
// them by construction, so they are engine-bug tripwires) ship prose only.
const WARNING_DETAIL: Record<string, { what: string; triggers: string; fix: string; example?: string }> = {
  EMPTY_DIAGRAM: {
    what: 'the source parses to a diagram with no drawable content.',
    triggers: 'A bare header like <code>flowchart TD</code> with no statements after it, a body containing only comments, or a mutation sequence that removed the last node, message, or task.',
    fix: 'Add at least one element — <code>add_node</code>/<code>add_edge</code> for flowcharts, <code>add_participant</code>/<code>add_message</code> for sequence, <code>add_task</code> for gantt/journey — or check that the intended body was not lost before serializing.',
    example: 'flowchart TD',
  },
  UNRESOLVABLE_SCHEDULE: {
    what: 'a gantt schedule cannot be resolved to concrete dates, so bars cannot be positioned.',
    triggers: 'A task whose <code>after</code>/<code>until</code> expression references a task id that does not exist, or a start/end that cannot be parsed against the declared <code>dateFormat</code>. The warning carries the engine reason string.',
    fix: 'Point the reference at a real task id or give the task explicit dates with the <code>set_task_dates</code> mutation (or edit the offending source line named in the reason).',
    example: 'gantt\n  title Release\n  dateFormat YYYY-MM-DD\n  section Build\n    Ship :ship, after review, 3d',
  },
  EDGE_MISANCHORED: {
    what: 'an edge, message, or dependency references an endpoint that is not in the diagram.',
    triggers: 'A gantt <code>after</code> dependency naming a missing task, a sequence message whose participant was removed, or edges left dangling after a <code>remove_node</code> mutation.',
    fix: 'Add the missing endpoint (<code>add_node</code>, <code>add_participant</code>, <code>add_task</code>) or retarget/remove the dangling edge (<code>remove_edge</code>, <code>remove_message</code>).',
    example: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Design :design, 2026-01-01, 2d\n    Ship :ship, after review, 3d',
  },
  OFF_CANVAS: {
    what: 'a positioned node extends past the computed canvas on the reported axis.',
    triggers: 'Never in normal operation — the engine sizes the canvas around content, so this is a tripwire that fires only when a layout pass moves geometry after the canvas was sized. Layout is deterministic, so a firing input reproduces byte-identically.',
    fix: 'Not fixable by editing the diagram content itself: simplify or remove the construct that provokes it, and report the source as a renderer bug so the layout defect gets fixed.',
  },
  GROUP_BREACH: {
    what: 'a node that belongs to a subgraph or group is positioned outside its group rectangle.',
    triggers: 'An engine-bug tripwire like <code>OFF_CANVAS</code>: deeply nested subgraphs combined with cross-group edges are historically where containment slipped. The warning names both the group and the escaping member.',
    fix: 'Flatten the nesting or move the member out of the group (source edit, or <code>remove_node</code> then re-add outside the subgraph). A reproducible breach is a renderer bug worth reporting with the source.',
  },
  UNKNOWN_SHAPE: {
    what: 'a node carries a shape outside the renderer’s known vocabulary and falls back to a plain rectangle.',
    triggers: 'Shape syntax the parser modeled but the renderer does not draw — typically newer Mermaid shape names reaching a structured flowchart or state graph.',
    fix: 'Switch the node to a supported shape (rectangle, rounded, diamond, stadium, circle, hexagon, cylinder, …) with a source edit; the diagram still renders meanwhile, so this is a warning rather than an error.',
  },
  LABEL_OVERFLOW: {
    what: 'a label\u2019s longest rendered line exceeds the character cap (default 40), which hurts layout and readability. The count measures what the renderer draws: <code>&lt;br&gt;</code> starts a new line, XML entities like <code>&amp;#160;</code> count as one character, and formatting tags are stripped.',
    triggers: 'Prose sentences pasted into node labels, edge labels, message text, or section/period titles — common when an agent copies requirement text verbatim into the diagram. Multi-line labels fire only when a single rendered line exceeds the cap.',
    fix: 'Shorten the text with <code>set_label</code>, <code>set_message_text</code>, or the matching family mutation; raise <code>labelCharCap</code> in <code>VerifyOptions</code> only when long labels are genuinely intended.',
    example: 'flowchart LR\n  A[This label is far longer than the forty character cap] --> B[Done]',
  },
  NODE_OVERLAP: {
    what: 'two nodes’ boxes intersect in the final layout; the warning reports the pair and the overlap area in pixels.',
    triggers: 'The deterministic layout separates nodes by construction, so no small flowchart source fires this — it appears only when a family adapter or post-pass produces colliding boxes on dense inputs. It is a tripwire, not an everyday lint.',
    fix: 'Shorten the labels of the named pair or reduce local density; if the overlap persists on a stable input, treat it as a layout defect and report the source.',
  },
  ROUTE_SELF_CROSS: {
    what: 'a single edge’s routed polyline crosses over itself.',
    triggers: 'A routing tripwire on the final geometry: the router avoids self-intersection, so a firing means dense cyclic routing degraded. The warning names the edge and the crossing count.',
    fix: 'Remove or redirect the redundant edge (<code>remove_edge</code>, then <code>add_edge</code> along a simpler path); a persistent self-cross on unchanged source is an engine bug to report.',
  },
  ROUTE_HITCH: {
    what: 'an edge deviates from its certified straight lane by more than the tolerance, reported in pixels.',
    triggers: 'The layout certifies clear lanes when routes are frozen; a hitch means a later pass mutated geometry after certification. Agents cannot cause this from source alone.',
    fix: 'Simplify the crossing edges near the named edge if a quick fix is needed, and report the reproducing source — the certificate/geometry mismatch is an engine defect.',
  },
  ROUTE_UNEXPLAINED_BEND: {
    what: 'an orthogonally-routed edge contains a bend its route certificate does not explain.',
    triggers: 'Orthogonal families (class, ER) certify every bend against an obstacle; an unexplained bend means post-certification geometry drift. Not reachable from well-formed source in normal operation.',
    fix: 'No source-level fix is expected to be needed; if verify reports it, capture the source and report it as a renderer bug — determinism makes the reproduction exact.',
  },
  ROUTE_LABEL_ON_SHARED_TRUNK: {
    what: 'an edge label sits on a line segment shared with another edge, so it is ambiguous which edge it names.',
    triggers: 'Fan-in/fan-out patterns where several labeled edges merge onto a shared trunk and a label pill lands on the shared piece rather than the edge’s own segment.',
    fix: 'Shorten the label with <code>set_label</code> so it fits the edge’s exclusive segment, or restructure the fan so the labeled edge has its own approach.',
  },
  ROUTE_CONTAINER_MISANCHOR: {
    what: 'an edge attached to a subgraph or group does not terminate on the container’s border.',
    triggers: 'Container-anchored edges must end exactly on the group rectangle; a miss means the border moved after routing. This is a tripwire over final geometry rather than a source mistake.',
    fix: 'Re-anchor the edge to a member node instead of the container as a workaround, and report the source — the container anchor contract is the engine’s to uphold.',
  },
  ROUTE_SHAPE_MISANCHOR: {
    what: 'an edge endpoint does not sit on the outline of the node shape it connects to (e.g. off a diamond’s facet).',
    triggers: 'Endpoint-on-shape is checked against the final node geometry; a miss usually accompanies a node that changed size or shape after routes were frozen.',
    fix: 'Switching the node to a simpler shape (rectangle) is the mechanical workaround; the underlying anchor drift is an engine defect worth reporting with the source.',
  },
  ROUTE_STALE_AFTER_NODE_MOVE: {
    what: 'an edge still follows a corridor computed before its node moved, so it anchors where the node used to be.',
    triggers: 'A compaction or alignment pass moved a node after edge routing without re-anchoring the affected edges. Not producible from source alone in normal operation.',
    fix: 'No diagram edit reliably clears it; report the reproducing source. If it blocks a task, removing and re-adding the named edge forces a fresh route.',
  },
  DUPLICATE_EDGE: {
    what: 'two edges with identical endpoints, label, and style — the second adds ink but no information.',
    triggers: 'An agent re-adding an edge that already exists, typically an <code>add_edge</code> issued without checking the current edge list, or copy-pasted source lines.',
    fix: 'Remove one copy with <code>remove_edge</code> (or delete the duplicate source line); if two parallel edges are intentional, give them distinct labels so they stop being duplicates.',
    example: 'flowchart LR\n  A[Start] --> B[Finish]\n  A --> B',
  },
  UNREACHABLE_NODE: {
    what: 'a node cannot be reached from any root (a node with no incoming edges) by following edges.',
    triggers: 'Disconnected clusters left behind after <code>remove_edge</code>/<code>remove_node</code> mutations, or a cycle with no entry edge from the main flow.',
    fix: 'Connect the node into the flow with <code>add_edge</code> from a reachable node, or delete it with <code>remove_node</code> if it is leftover.',
    example: 'flowchart LR\n  A[Start] --> B[Done]\n  C[Orphan] --> D[Cycle]\n  D --> C',
  },
  DECISION_BRANCH_UNLABELED: {
    what: 'a decision diamond with two or more exits has at least one unlabeled exit, so the branch condition is ambiguous.',
    triggers: 'Adding a second exit to a diamond without a condition label. ISO 5807 / ANSI X3.5 require each exit of a multi-exit decision to be labeled with its condition value.',
    fix: 'Label every exit — <code>set_label</code> on the unlabeled edge (e.g. <code>yes</code>/<code>no</code>) or add <code>|condition|</code> to the source line.',
    example: 'flowchart TD\n  A{Ready?} -->|yes| B[Ship]\n  A --> C[Wait]',
  },
  COMMENT_DROPPED: {
    what: 'in-body %% comments will not survive structured serialization; the loss is announced, not silent.',
    triggers: 'Comments between statements in a structurally-modeled body: the typed tree does not model them, so <code>serializeMermaid</code> writes the body back without them. The warning carries the count and line numbers.',
    fix: 'Move essential comment content into a label or title before mutating, keep a source-level edit instead of a typed mutation when comments must survive, or accept the loss knowingly.',
    example: 'flowchart LR\n  %% review note that structured serialization drops\n  A[Start] --> B[Done]',
  },
  UNSUPPORTED_SYNTAX: {
    what: 'the source uses syntax or content the local structured model cannot faithfully express.',
    triggers: 'Flowchart <code>click</code>/<code>href</code> directives, edge IDs and edge metadata, v11 <code>@{ shape: … }</code> node metadata, markdown strings, unclosed delimiters that would silently drop content, or <code>syntax: "empty_layout"</code> when content-bearing source lays out to a 0×0 canvas with no nodes, edges, or groups.',
    fix: 'For preserved Mermaid syntax, remove the directive if local rendering fidelity matters, or keep it knowing the local renderer ignores it; edits touching those lines need source-level editing rather than typed mutations. For <code>empty_layout</code>, inspect the warning message and <code>verify.layout</code>, then repair the malformed or unsupported source before accepting the artifact.',
    example: 'flowchart LR\n  A[Start] --> B[Docs]\n  click B "https://example.com"',
  },
  CONTENT_DROPPED_ON_ROUNDTRIP: {
    what: 'a parse → serialize → re-parse cycle lost nodes, edges, or groups by count.',
    triggers: 'A serializer defect on unusual syntax: the faithfulness tally before and after the round trip disagrees. This is a tripwire that guards every verify; it should not fire on supported syntax.',
    fix: 'Do not serialize the typed tree for this diagram — fall back to source-level edits so nothing is lost, and report the source; the before/after counts on the warning pinpoint what vanished.',
  },
  RENDER_FAILED: {
    what: 'the diagram parsed, but rendering to the requested format threw before producing an artifact.',
    triggers: 'A construct that parses but the renderer cannot lay out or rasterize — an unsupported combination reaching the SVG/PNG path, or a size/raster budget hit on a very large diagram. Not reachable from small well-formed source in normal operation.',
    fix: 'Return the structured error and the source rather than a fabricated artifact; simplify or split the diagram, drop the construct named in the message, or fall back to a lighter format (SVG or ASCII before PNG). A reproducible failure on stable source is a renderer bug worth reporting.',
  },
}

// Fold the warning prose into capabilities.warningCodes so capabilities.json is
// a full machine surface (code + tier + severity + what/triggers/fix), matching
// the HTML pages and their .md siblings. Prose is stored as Markdown, not the
// page HTML, so an agent gets clean text.
for (const w of capabilities.warningCodes as Array<Record<string, unknown>>) {
  const d = WARNING_DETAIL[w.code as string]
  if (!d) continue
  w.what = inlineHtmlToMarkdown(d.what)
  w.triggers = inlineHtmlToMarkdown(d.triggers)
  w.fix = inlineHtmlToMarkdown(d.fix)
  if (d.example) w.example = d.example
}
await emitJson('capabilities.json', capabilities)

// Build-time check: emit the firing demo only if the example really fires the
// code against the current engine. A stale example degrades to prose, never to
// a false claim.
function warningDemoHtml(code: string, example: string): string {
  let fired = false
  try { fired = verifyMermaid(example).warnings.some((w: any) => w.code === code) } catch { fired = false }
  if (!fired) return ''
  const editorHash = btoa(unescape(encodeURIComponent(example)))
  return `\n<h2>See it fire</h2>\n<p>This minimal source triggers <code>${code}</code> — checked at build time against the same engine the editor runs.</p>\n<pre><code>${escapeHtml(example)}</code></pre>\n<p><a class="go" href="/editor/#${editorHash}">Open in the editor and watch it clear</a></p>`
}

function warningsIndexHtml() {
  const rows = capabilities.warningCodes.map((w: any) => `<tr data-warning-row data-code="${escapeAttr(w.code)}" data-tier="${escapeAttr(w.tier)}" data-severity="${escapeAttr(w.severity)}"><td data-label="Code"><a href="/warnings/${w.code}/"><code>${w.code}</code></a></td><td data-label="Tier"><span class="tier-badge tier-${w.tier}">${w.tier}</span></td><td data-label="Severity"><span class="sev-badge sev-${w.severity}">${w.severity}</span></td></tr>`).join('')
  return `<div class="warning-guide" aria-label="Warning triage guide">
  <p><strong>Fix structural first.</strong> Structural errors can block safe return. Geometric warnings ask for visual review. Lint warnings usually mean an agent should make a smaller or cleaner edit.</p>
  <p><a class="go" href="/docs/quality/">Read the quality gate</a></p>
</div>
<div class="warning-tools" role="search">
  <label for="warning-filter">Filter warning codes</label>
  <input id="warning-filter" type="search" data-warning-filter placeholder="duplicate, structural, lint">
</div>
<table class="warning-table"><thead><tr><th>Code</th><th>Tier</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table>
<script>
(function () {
  var input = document.querySelector('[data-warning-filter]');
  if (!input) return;
  var rows = Array.from(document.querySelectorAll('[data-warning-row]'));
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    rows.forEach(function (row) {
      var text = [row.getAttribute('data-code'), row.getAttribute('data-tier'), row.getAttribute('data-severity')].join(' ').toLowerCase();
      row.hidden = Boolean(q && text.indexOf(q) === -1);
    });
  });
})();
</script>`
}
await emitShell('warnings/index.html', 'Warnings', 'Warning codes are tiered so agents know whether to fix, retry, or ask.', warningsIndexHtml())
let firingDemos = 0
for (const w of capabilities.warningCodes) {
  const detail = WARNING_DETAIL[w.code]
  const sevNoun = w.severity === 'error' ? 'error' : 'warning'
  const lead = detail
    ? `${w.code} is a ${w.tier} ${sevNoun}: ${detail.what}`
    : `${w.code} is a ${w.tier} ${sevNoun} reported by verify.`
  const demo = detail?.example ? warningDemoHtml(w.code, detail.example) : ''
  if (demo) firingDemos++
  const detailHtml = detail ? `<p><strong>What triggers it.</strong> ${detail.triggers}</p>\n<p><strong>How to fix it.</strong> ${detail.fix}</p>` : ''
  await emitShell(`warnings/${w.code}/index.html`, w.code, lead, `${detailHtml}${demo}
<p>Run <code>am verify diagram.mmd --json</code>, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.</p>
<p class="muted">In the cloned repo, <code>am</code> is <code>bun run bin/am.ts</code>.</p>
<p class="muted">Machine-readable: <a href="/warnings/${w.code}/index.md">this page as Markdown</a>.</p>
<p class="muted">Back to <a href="/warnings/">all warning codes</a>, or <a href="${GENERIC_EDITOR_HREF}">open the editor</a> to watch this warning clear as you edit.</p>`)
  // Markdown sibling: the same triage prose an agent gets from verify, without
  // scraping HTML. Discoverable via the link above and served as text/markdown.
  const md = [`# ${w.code}`, '', `> ${inlineHtmlToMarkdown(lead)}`, '',
    `- **Tier:** ${w.tier}`, `- **Severity:** ${w.severity}`, '']
  if (detail) {
    md.push('## What triggers it', '', inlineHtmlToMarkdown(detail.triggers), '')
    md.push('## How to fix it', '', inlineHtmlToMarkdown(detail.fix), '')
    if (detail.example) md.push('## Example', '', '```mermaid', detail.example, '```', '')
  }
  md.push('Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.', '',
    `Full page: https://agentic-mermaid.dev/warnings/${w.code}/`, '')
  await emit(`warnings/${w.code}/index.md`, md.join('\n'))
}
console.log(`website/build: ${firingDemos}/${capabilities.warningCodes.length} warning pages carry a build-time-verified firing demo`)
// Each error is a distinct recovery path, not a shared boilerplate page:
// `desc` is the one-line for the index, `recover` is the page's guidance, and
// `related` links the verify code(s) that surface the same failure.
const errors: Array<{ id: string; title: string; desc: string; recover: string; related?: string }> = [
  {
    id: 'parse-error', title: 'Parse error',
    desc: 'The source could not be parsed. Preserve the source and point to the line/column when available.',
    recover: 'The source is not valid Mermaid for any known family, so it never became a diagram. Preserve the original text and surface the parser’s line/column; fix the offending line, or return the failure untouched rather than guessing a rewrite that changes intent.',
    related: 'Often pairs with <a href="/warnings/UNSUPPORTED_SYNTAX/">UNSUPPORTED_SYNTAX</a> when syntax parses in mermaid.js but not the structured model.',
  },
  {
    id: 'mutation-error', title: 'Mutation error',
    desc: 'A typed mutation was invalid for the narrowed family or target.',
    recover: 'A typed edit was rejected because it does not apply to the narrowed family or its target does not exist (e.g. <code>set_label</code> on a missing node id). Re-narrow the parsed diagram, confirm the target id against the current model, and fall back to editing the preserved source directly when the construct is not structurally modeled (opaque fallback).',
    related: 'See the <a href="/docs/api/">library API</a> for the typed parse → narrow → mutate → verify surface.',
  },
  {
    id: 'render-error', title: 'Render error',
    desc: 'Rendering failed after parse. Return the error and source; do not fabricate an artifact.',
    recover: 'The diagram parsed but rendering to SVG/PNG/text threw before an artifact existed. Return the error and the source — never a fabricated image; simplify or split the diagram, or retry a lighter format (SVG or ASCII before PNG).',
    related: 'Surfaces as the <a href="/warnings/RENDER_FAILED/">RENDER_FAILED</a> verify code.',
  },
  {
    id: 'verify-failed', title: 'Verify failed',
    desc: 'The diagram parsed but verification returned blocking structural warnings.',
    recover: 'The diagram parsed and rendered, but <code>verify.ok</code> is false because a structural-tier warning is blocking. Inspect <code>verify.warnings</code>, fix the structural codes first, then re-verify before trusting the artifact.',
    related: 'Every code is documented under <a href="/warnings/">warnings</a>; start with the structural tier.',
  },
]
await emitShell('errors/index.html', 'Errors', 'Error pages explain recovery paths for local CLI, library, and MCP use.', `<ul>${errors.map((e) => `<li><a href="/errors/${e.id}/">${e.title}</a> – ${e.desc}</li>`).join('')}</ul>`)
for (const e of errors) {
  await emitShell(`errors/${e.id}/index.html`, e.title, e.desc, `<p>${e.recover}</p>
${e.related ? `<p>${e.related}</p>\n` : ''}<pre><code>am verify diagram.mmd --json</code></pre><p>Return the structured error to the caller when a safe automatic fix is not obvious.</p>
<p class="muted">Machine-readable: <a href="/errors/${e.id}/index.md">this page as Markdown</a>.</p>
<p class="muted">Back to <a href="/errors/">all errors</a>, or <a href="${GENERIC_EDITOR_HREF}">open the editor</a> to reproduce the failure as you type.</p>`)
  // Markdown sibling (item 7): same recovery guidance without scraping HTML.
  const md = [`# ${e.title}`, '', `> ${inlineHtmlToMarkdown(e.desc)}`, '',
    '## How to recover', '', inlineHtmlToMarkdown(e.recover), '']
  if (e.related) md.push('## Related', '', inlineHtmlToMarkdown(e.related), '')
  md.push('```', 'am verify diagram.mmd --json', '```', '',
    `Full page: https://agentic-mermaid.dev/errors/${e.id}/`, '')
  await emit(`errors/${e.id}/index.md`, md.join('\n'))
}

const securityHeaders = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  `  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; form-action 'none'`,
  '',
  '/*.json',
  '  Access-Control-Allow-Origin: *',
  '',
  '/*.md',
  '  Access-Control-Allow-Origin: *',
  '',
  '/*.txt',
  '  Access-Control-Allow-Origin: *',
  '',
].join('\n')
await emit('_headers', securityHeaders)

// Single source of truth for the trailing-slash redirects: every emitted page
// lives at <dir>/index.html, so its clean route is that directory. Derive the
// list from the generated pages instead of hand-maintaining it (which had
// drifted — /about/design was missing a redirect). Per-code warning/error pages
// are covered by the :code / :kind splat rules below, so exclude their subpaths.
const pageRoutes = [...generated.keys()]
  .filter((rel) => rel.endsWith('/index.html'))
  .map((rel) => rel.slice(0, -'/index.html'.length))
  .filter((dir) => dir && !dir.startsWith('warnings/') && !dir.startsWith('errors/'))
  .sort()
const redirectLines = [
  ...pageRoutes.map((r) => `/${r} /${r}/ 308`),
  '/warnings/:code /warnings/:code/ 308', '/errors/:kind /errors/:kind/ 308',
  '',
].join('\n')
await emit('_redirects', redirectLines)

// ---- sitemap.xml -----------------------------------------------------------
// Every page is emitted as <dir>/index.html, so its canonical URL is the clean
// directory path. Derive the sitemap from the `generated` map rather than a
// hand-kept list so new pages are picked up automatically. No <lastmod>: the
// committed build uses buildTime='development', and a per-build timestamp would
// make the bundle non-deterministic and break `website:check`.
const SITE_ORIGIN = 'https://agentic-mermaid.dev'
const sitemapUrls = [...generated.keys()]
  .filter((rel) => rel === 'index.html' || rel.endsWith('/index.html'))
  .map((rel) => SITE_ORIGIN + '/' + rel.replace(/index\.html$/, ''))
  .sort()
const sitemapXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapUrls.map((loc) => `  <url><loc>${loc}</loc></url>`),
  '</urlset>',
  '',
].join('\n')
await emit('sitemap.xml', sitemapXml)

// No repo robots.txt: production serves Cloudflare's managed content-signals
// robots.txt at the edge, which would override an asset here. The sitemap's
// `Sitemap:` line is added via the Cloudflare dashboard instead (TODO DEC-5).

// ---- Worker artifacts (website/src/generated) ------------------------------
// The /mcp Worker needs the Code Mode harness bundled for the dynamic-worker
// isolate, the resvg wasm module, and the DejaVu fonts. They live under
// src/generated (not public/): they are Worker modules, not servable assets.
const SRC_GENERATED = join(import.meta.dir, 'src', 'generated')
const workerGenerated = new Map<string, Buffer>()

async function emitWorkerArtifact(rel: string, content: Buffer) {
  workerGenerated.set(rel, content)
  if (CHECK) return
  const dest = join(SRC_GENERATED, rel)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, content)
}

{
  const harnessBuild = await Bun.build({
    entrypoints: [join(ROOT, 'src', 'mcp', 'dynamic-harness.ts')],
    target: 'browser',
    format: 'esm',
    minify: true,
    // The agent-code module exists only inside the Worker Loader's
    // per-isolate module registry; the import must survive bundling.
    external: ['*user.js'],
  })
  if (!harnessBuild.success || harnessBuild.outputs.length !== 1) {
    throw new Error(`execute-harness bundle failed: ${harnessBuild.logs.join('\n')}`)
  }
  const harness = Buffer.from(await harnessBuild.outputs[0]!.text())
  if (!harness.includes('import("./user.js")')) throw new Error('execute-harness bundle lost the ./user.js import')
  const resvgWasm = Buffer.from(await Bun.file(join(ROOT, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')).arrayBuffer())
  const fontRegular = Buffer.from(await Bun.file(join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf')).arrayBuffer())
  const fontBold = Buffer.from(await Bun.file(join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf')).arrayBuffer())
  await emitWorkerArtifact('execute-harness.js.txt', harness)
  await emitWorkerArtifact('resvg.wasm', resvgWasm)
  await emitWorkerArtifact('DejaVuSans.ttf', fontRegular)
  await emitWorkerArtifact('DejaVuSans-Bold.ttf', fontBold)

  // Full-deploy version for the /mcp response cache. Bundle the worker's own
  // JS closure (transport, hosted-server, PNG path, raster budget, SDK) and
  // hash it together with the harness + wasm + fonts. Unlike the harness-only
  // hash used for Worker Loader isolate IDs, this changes when ANY hosted tool
  // implementation, transport, or asset changes — so a deploy that touches
  // hosted-server.ts / mcp-handler.ts / png-wasm.ts without moving the harness
  // still invalidates cached render_svg/verify/describe/render_png results.
  const workerBuild = await Bun.build({
    entrypoints: [join(import.meta.dir, 'src', 'worker.ts')],
    target: 'browser',
    format: 'esm',
    minify: true,
    // Assets + the generated version constant stay external: the constant is
    // what we are computing, so it must not feed its own hash. (Glob form —
    // bun resolves bare relative specifiers, so a literal path would not match.)
    external: ['*.wasm', '*.ttf', '*.js.txt', '*deploy-version.ts'],
  })
  if (!workerBuild.success || workerBuild.outputs.length < 1) {
    throw new Error(`worker bundle failed: ${workerBuild.logs.join('\n')}`)
  }
  const workerJs = Buffer.from(await workerBuild.outputs[0]!.text())
  if (!workerJs.includes('render_svg') || !workerJs.includes('PNG_RENDER_FAILED')) {
    throw new Error('worker bundle is missing the hosted MCP surface; deploy hash would be blind to it')
  }
  // The main worker's compatibility_date is a deploy-controlled runtime input
  // that lives in config, not in any bundled artifact — the one output-relevant
  // setting the worker JS hash cannot see. Fold it in so a compat-date bump
  // (which can shift workerd JS semantics) also invalidates cached results.
  const wranglerText = await Bun.file(join(import.meta.dir, 'wrangler.jsonc')).text()
  const compatDate = wranglerText.match(/"compatibility_date"\s*:\s*"([^"]+)"/)?.[1] ?? ''
  const deployVersion = computeDeployVersion(packageJson.version, [workerJs, harness, resvgWasm, fontRegular, fontBold, new TextEncoder().encode(compatDate)])
  await emitWorkerArtifact('deploy-version.ts', Buffer.from(
    '// Generated by website/build.ts — do not edit.\n' +
    '// Full-deploy content hash (worker JS closure + harness + wasm + fonts +\n' +
    '// main-worker compatibility_date). Used as the /mcp response-cache version\n' +
    '// so any change to the hosted tool surface, transport, PNG path, SDK, or\n' +
    '// worker runtime semantics invalidates cached tool results.\n' +
    `export const DEPLOY_VERSION = '${deployVersion}'\n`,
  ))
}

function assertNoPlaceholders() {
  const offenders: string[] = []
  for (const [rel, content] of generated) {
    if (!rel.endsWith('.html')) continue
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : content
    if (/href="#"/.test(text)) offenders.push(rel)
  }
  if (offenders.length) throw new Error(`public HTML has placeholder href="#": ${offenders.join(', ')}`)
}
function assertContractShapes() {
  for (const [name, obj] of Object.entries({ capabilities, examples })) {
    if (!(obj as any).generatedFrom) throw new Error(`${name} missing generatedFrom`)
  }
  if (publicLlms.includes('TODO.md') || publicLlms.includes('skill-evals/')) throw new Error('public llms.txt exposes repo-only surfaces')
}
assertNoPlaceholders()
assertContractShapes()

if (CHECK) {
  // website/public is a build artifact (gitignored, rebuilt at deploy and by
  // the test preload), so it is not drift-checked here. Only the worker's
  // committed src/generated inputs — imported by src/worker.ts and needed for
  // typecheck — are pinned against the source.
  const stale: string[] = []
  for (const [rel, expected] of workerGenerated) {
    const file = Bun.file(join(SRC_GENERATED, rel))
    if (!await file.exists()) { stale.push(`src/generated/${rel}`); continue }
    if (!Buffer.from(await file.arrayBuffer()).equals(expected)) stale.push(`src/generated/${rel}`)
  }
  if (stale.length) {
    console.error(`website/build --check: ${stale.length} stale src/generated file(s):\n  ${stale.join('\n  ')}\nRegenerate with \`bun run website\`.`)
    process.exit(1)
  }
  console.log(`website/build --check: ${workerGenerated.size} src/generated file(s) in sync (website/public is a build artifact, not checked).`)
} else {
  console.log(`website/build: wrote ${generated.size} files to website/public`)
}
