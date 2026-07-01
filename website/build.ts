import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renderMermaidSVG as renderBeautifulMermaidSVG } from 'beautiful-mermaid'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { buildCapabilities } from '../src/cli/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../src/index.ts'
import { namespaceSvgIds } from '../src/renderer.ts'

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
  return html.replace(/<meta name="viewport" content="width=device-width, initial-scale=1"\s*\/?\s*>/, '$&\n<meta name="description" content="Agentic Mermaid renders, verifies, and edits Mermaid diagrams locally, with compact agent instructions for CLI, library, and MCP use.">')
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
  if (route === '/editor/') return '/editor/'
  return ''
}

function setNavCurrent(html: string, currentHref = '') {
  if (!currentHref) return html
  const labels: Record<string, string> = {
    '/examples/': 'Examples',
    '/comparisons/': 'Comparisons',
    '/docs/': 'Docs',
    '/editor/': 'Open editor',
  }
  const label = labels[currentHref]
  if (!label || html.includes(`href="${currentHref}" aria-current="page"`) || html.includes(`aria-current="page" href="${currentHref}"`)) return html
  return html.replace(`<a href="${currentHref}">${label}</a>`, `<a href="${currentHref}" aria-current="page">${label}</a>`)
}

function transformHtml(html: string, currentHref = ''): string {
  return setNavCurrent(ensureMainId(addSkipLink(addAgentDiscoveryLinks(addHeadDescription(rewriteAttrs(html))))), currentHref)
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
    ['/editor/', 'Open editor', 'link-editor'],
  ] as const
  const nav = links.map(([href, label, cls]) => {
    const attrs = [cls ? `class="${cls}"` : '', currentHref === href ? 'aria-current="page"' : ''].filter(Boolean).join(' ')
    return `<a ${attrs ? attrs + ' ' : ''}href="${href}">${label}</a>`
  }).join('')
  return `<header class="masthead"><div class="bar"><a class="brand" href="/"><span class="mark"></span> Agentic&nbsp;Mermaid</a><span class="links">${nav}</span></div><hr></header>`
}

// Single page header contract: h1 + lead, then an optional meta row
// (e.g. "Updated · source · read time") and actions row. The public site is
// deliberately document-first with no breadcrumb chrome (see the website
// contract test — masthead nav is the only wayfinding the shell ships).
function pageShell(title: string, lead: string, body: string, currentHref = '', meta = '', actions = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeAttr(lead)}">
<title>${escapeHtml(title)} – Agentic Mermaid</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
${agentDiscoveryLinks}
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
<footer><div class="footlinks"><a href="/llms.txt">llms.txt</a><span class="sep">&middot;</span><a href="/agent-instructions.md">agent-instructions.md</a><span class="sep">&middot;</span><a href="/capabilities.json">capabilities.json</a><span class="sep">&middot;</span><a href="/examples/index.json">examples.json</a><span class="sep">&middot;</span><a href="/skills/agentic-mermaid-diagram-workflow/SKILL.md">workflow skill</a></div></footer>
<script src="/shader-mark.js"></script>
<script src="/theme.js"></script>
</body>
</html>`
}

function escapeHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

const packageJson = JSON.parse(await Bun.file(join(ROOT, 'package.json')).text())
const rawCapabilities = buildCapabilities()
const generatedFrom = {
  packageVersion: packageJson.version,
  gitSha: process.env.SITE_GIT_SHA ?? 'development',
  buildTime: process.env.SITE_BUILD_TIME ?? 'development',
}
const npmPublished = process.env.SITE_NPM_STATUS === 'published' || process.env.SITE_NPM_PUBLISHED === '1'
const npmChecked = process.env.SITE_NPM_CHECKED ?? 'not checked in local build'
const installCommand = npmPublished
  ? 'npm i agentic-mermaid'
  : 'git clone https://github.com/adewale/beautiful-mermaid && cd beautiful-mermaid && bun install && bun run build'
const installNotice = npmPublished
  ? 'The npm package is marked published for this build.'
  : 'This local build has not verified npm publication, so public install copy uses the source-install path.'

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
    const role = /\brole=/.test(attrs) ? '' : ' role="img"'
    const labelledby = /\baria-labelledby=/.test(attrs) ? '' : ` aria-labelledby="${titleId} ${descId}"`
    return `<svg${attrs}${role}${labelledby}><title id="${titleId}">${escapeHtml(title)}</title><desc id="${descId}">${escapeHtml(desc)}</desc>`
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
function examplesShowcaseHtml(editorExamples: any[]) {
  const groups = new Map<string, any[]>()
  for (const example of editorExamples) {
    const category = example.category ?? 'Examples'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push(example)
  }
  return '<div class="example-showcase">' + Array.from(groups, ([category, examples]) => `
<section class="example-group" aria-labelledby="examples-${escapeAttr(category.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
<h2 id="examples-${escapeAttr(category.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(category)}</h2>
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
</section>`).join('\n') + '\n</div>'
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
function comparisonsHtml() {
  const sections = COMPARISON_CASES.map((c) => {
    const beautiful = comparisonBeautifulRender(c)
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
  </header>${note}
  <div class="comparison-grid">
    ${panels}
  </div>
</section>`
  }).join('')
  return `<div class="comparisons">${sections}
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
<script src="/${mermaidRuntimeRel}"></script>
<script>
if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', deterministicIds: true, deterministicIDSeed: 'agentic-mermaid-comparisons', theme: 'base', themeVariables: { fontFamily: 'Avenir Next, Segoe UI, system-ui, sans-serif' } });
  window.mermaid.run({ querySelector: '.comparison-mermaid' }).catch(function() {});
}
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
      var noteText = section.querySelector('.comparison-note')?.textContent || '';
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
const workflowSource = await readSourceDiagram('workflow.mmd')
function addWorkflowSvgA11y(svg: string) {
  return svg.replace(/^<svg\b([^>]*)>/, (_full, attrs: string) => {
    const role = /\brole=/.test(attrs) ? '' : ' role="img"'
    const label = /\baria-labelledby=/.test(attrs) ? '' : ' aria-labelledby="edit-loop-svg-title edit-loop-svg-desc"'
    return `<svg${attrs}${role}${label}>\n<title id="edit-loop-svg-title">Agentic Mermaid edit loop</title>\n<desc id="edit-loop-svg-desc">Source flows through parse, narrow, mutate, verify, and serialize to render, with warnings routed back for another edit.</desc>`
  })
}
const workflowThemeableSvg = addWorkflowSvgA11y(renderMermaidSVG(workflowSource,
  { bg: 'var(--bg)', fg: 'var(--fg)', accent: 'var(--accent)', transparent: true })
  .replace('--bg:var(--bg);--fg:var(--fg);--accent:var(--accent);', '')
  .split('\n').filter((line) => !line.includes('fonts.googleapis.com')).join('\n'))
function injectWorkflowSvg(html: string) {
  return html.replace(/<div class="plate dia-plate">[\s\S]*?<\/div>|<div class="plate"><div class="dia-wrap">[\s\S]*?<\/div><\/div>/,
    `<div class="plate dia-plate">\n      ${workflowThemeableSvg}\n    </div>`)
}
function injectWorkflowUnicode(html: string) {
  const unicode = renderMermaidASCII(workflowSource, { useAscii: false })
    .split('\n').map((line) => line.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
  return html.replace(/(The same diagram as Unicode text:<\/p>\s*<pre><code>)[\s\S]*?(<\/code><\/pre>)/,
    '$1' + escapeHtml(unicode) + '$2')
}
for (const [source, target] of pageOutputs) {
  const currentHref = topNavHrefForRoute(routeMap[source])
  let html = transformHtml(await readSourcePage(source), currentHref)
  // Source pages can carry hand-baked mastheads that predate newer routes.
  // Swap in the one canonical masthead so every shipped page shares one nav.
  html = html.replace(/<header class="masthead">[\s\S]*?<\/header>/, () => mastheadHtml(currentHref))
  html = injectWorkflowSvg(html)
  if (source === 'home.html') html = injectLoopRail(injectWorkflowUnicode(html))
  if (source === 'docs-article.html') html = injectLoopHeadings(html)
  await emit(target, html)
}
await emit('editor/index.html', await generateEditorHtml())

// Static assets.
for (const asset of ['favicon.svg', 'styles.css', 'theme.js', 'shader-mark.js']) await copySourceAsset(asset)
for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'og-image.png']) await copyFileFrom(join(ROOT, 'public', asset), asset)
await copyDir(SOURCE_DIAGRAMS, 'diagrams')
await emit('diagrams/workflow-themeable.svg', workflowThemeableSvg)

const capabilities = { ...rawCapabilities, generatedFrom }
await emitJson('capabilities.json', capabilities)

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
const publicLlms = `# Agentic Mermaid\n\nAgentic Mermaid renders, verifies, and safely edits Mermaid diagrams locally. Use the package, CLI, or self-hosted MCP; the website is documentation plus a browser-local editor, not a REST render API.\n\nStart here:\n- /agent-instructions.md – compact operating guide for agents\n- /capabilities.json – authoritative family/output/mutation/warning contract\n- /examples/index.json – the same example IDs and sources loaded by the editor\n- /skills/agentic-mermaid-diagram-workflow/SKILL.md – optional workflow skill for skills-capable agents\n\nStop rules:\n- Verify before serialize, render, commit, or return.\n- Do not fabricate ValidDiagram objects. Parse first.\n- Prefer local library, CLI, or self-hosted MCP.\n- Do not call this website as a render API or arbitrary-code execution backend.\n`;
await emit('llms.txt', publicLlms)
await emit('agent-instructions.md', await Bun.file(join(ROOT, 'Instructions_for_agents.md')).text())

// Spec route coverage pages.
const docsIndex = '<hr><h2>Docs index</h2><ul class="doc-index"><li><a href="/docs/getting-started/">Getting started</a></li><li><a href="/docs/families/">Diagram families</a></li><li><a href="/docs/api/">Library API</a></li><li><a href="/docs/cli/">CLI</a></li><li><a href="/docs/mcp/">MCP</a></li><li><a href="/docs/source-level/">Source-level edits</a></li><li><a href="/docs/ascii/">ASCII and Unicode</a></li><li><a href="/docs/theming/">Theming</a></li><li><a href="/docs/config/">Config</a></li><li><a href="/docs/react/">React</a></li><li><a href="/docs/quality/">Quality</a></li><li><a href="/docs/vocabulary/">Vocabulary</a></li><li><a href="/docs/fork-differences/">Fork differences</a></li></ul>'
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
const familiesLead = 'Twelve families share one deterministic layout engine. Each parses from Mermaid text and renders to SVG, PNG, ASCII, Unicode, and layout JSON from the same positioned model.'
function familiesReferenceHtml() {
  const rows = FAMILY_REFERENCE.map(([id, label, draws]) => `<tr id="${id}"><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(draws)}</td></tr>`).join('')
  return `<p>Every family carries a route certificate: a machine-checkable claim about how its edges were routed — orthogonal boxes for class and ER, lifelines for sequence, side-anchored links for architecture. That certificate is what lets <code>verify</code> answer in tiers instead of guessing.</p>
<table>
<thead><tr><th>Family</th><th>What it draws</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>See any of them rendered on the <a href="/examples/">examples</a> page, or open one in the <a href="/editor/">editor</a>.</p>${docsIndex}`
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
<li><strong>Ask an agent for the smallest edit.</strong><p>Copy the homepage prompt, paste your task and source, and require the agent to return Updated Mermaid, Verification, and Trace.</p><a class="go" href="/">Copy the agent prompt</a></li>
<li><strong>Optional: wire local MCP.</strong><pre><code>bun run bin/agentic-mermaid-mcp.ts</code></pre><p>Use stdio MCP from the cloned repo. The hosted Workers site intentionally does not enable Code Mode or a render API.</p></li>
</ol>
${docsIndex}`

const docPages = [
  ['about/index.html', 'About Agentic Mermaid', aboutLead, aboutBody, '/about/'],
  ['docs/getting-started/index.html', 'Getting started', 'From Mermaid source to a verified local render, then to an agent-safe edit loop.', gettingStartedBody, '/docs/'],
  ['docs/families/index.html', 'Diagram families', familiesLead, familiesReferenceHtml(), '/docs/'],
  ['docs/api/index.html', 'Library API', 'Use agentic-mermaid and agentic-mermaid/agent from local JS or TS.', '<p>Import rendering helpers from <code>agentic-mermaid</code> and typed parse/mutate/verify helpers from <code>agentic-mermaid/agent</code>.</p>' + docsIndex],
  ['docs/source-level/index.html', 'Source-level edits', 'When a family or construct cannot be narrowed safely, preserve source deliberately.', '<p>Opaque fallback bodies round-trip losslessly, but they do not expose structured mutation. Edit their preserved source only when the task explicitly asks for source-level changes, then parse and verify before returning artifacts.</p>' + docsIndex],
  ['docs/cli/index.html', 'CLI', 'Use the am CLI for local rendering, verification, batch checks, and Markdown rendering.', '<pre><code>am verify diagram.mmd\nam render diagram.mmd --format svg --output diagram.svg\nam render diagram.mmd --format unicode</code></pre>' + docsIndex],
  ['docs/mcp/index.html', 'MCP', 'Self-host the MCP over stdio; HTTP is explicit opt-in.', '<p>The local MCP tools are <code>execute</code>, <code>render_png</code>, and <code>describe</code>. Multi-step parse/narrow/mutate/verify workflows run inside <code>execute(code)</code>.</p>' + docsIndex],
  ['docs/ascii/index.html', 'ASCII and Unicode', 'Text output is first-class for terminals, PR comments, and agent review.', '<pre><code>am render diagram.mmd --format ascii\nam render diagram.mmd --format unicode</code></pre>' + docsIndex],
  ['docs/theming/index.html', 'Theming', 'Themes derive diagram colours from bg, fg, and accent tokens.', '<p>The browser editor exposes renderer themes; SVG output can also inherit CSS variables for live theming.</p>' + docsIndex],
  ['docs/config/index.html', 'Config', 'Mermaid frontmatter and init directives are normalized before rendering.', '<p>Use checked Mermaid config/frontmatter where supported; unsupported syntax is preserved or reported rather than silently dropped.</p>' + docsIndex],
  ['docs/react/index.html', 'React', 'Render locally in React without using the website as a backend.', '<p>Import the library in your app and render SVG/PNG locally. Keep private diagrams in the browser or your own infrastructure.</p>' + docsIndex],
  ['docs/quality/index.html', 'Quality', 'Determinism, verify warnings, and layout metrics make diagram edits reviewable.', '<p><code>verify.ok</code> is a gate, not a promise of visual perfection. Include SVG/PNG/ASCII artifacts for human review when the change is visual.</p>' + docsIndex],
  ['docs/fork-differences/index.html', 'Fork differences', 'Agentic Mermaid adds typed editing, deterministic verification, CLI, MCP, and more families.', '<p>See the repository docs for the detailed upstream comparison; this public route keeps the product difference discoverable.</p>' + docsIndex],
  ['docs/vocabulary/index.html', 'Vocabulary', 'Shared terms for humans and agents.', '<dl><dt>narrow</dt><dd>Resolve a parsed diagram to a family-specific typed surface.</dd><dt>verify</dt><dd>Return structural, geometric, and lint warnings before artifacts are trusted.</dd><dt>opaque fallback</dt><dd>Preserve unsupported syntax losslessly when structured mutation is unavailable.</dd></dl>' + docsIndex],
  ['security/index.html', 'Security and privacy', 'The site is static/local-first and does not run hosted Code Mode.', '<p>Source stays in the browser for the editor. The preview has no hosted render API; <code>/mcp</code> returns a 501 until a bounded hosted MCP is deliberately implemented.</p>'],
  ['releases/index.html', 'Releases', 'Current package and site build metadata.', `<pre><code>package: ${packageJson.name}@${packageJson.version}\ngit: ${generatedFrom.gitSha}\nbuild: ${generatedFrom.buildTime}</code></pre>`],
  ['evidence/index.html', 'Evidence', 'Quality evidence is curated, not raw private prompts.', '<p>Use CI, generated artifacts, and deterministic metrics to review changes. Private eval prompts and holdbacks are not public site content.</p>'],
  ['examples/index.html', 'Examples', 'Proof that each editor source parses, renders, and carries an agent task you can replay.', examplesShowcaseHtml(EDITOR_EXAMPLES), '/examples/'],
  ['comparisons/index.html', 'Comparisons', 'One source per family, rendered three ways.', comparisonsHtml(), '/comparisons/'],
  ['skills/index.html', 'Skills', 'Optional workflow skill.', '<p>The public skill is <a href="/skills/agentic-mermaid-diagram-workflow/">agentic-mermaid-diagram-workflow</a>. Use it when an agent supports skills; otherwise the homepage prompt and <code>agent-instructions.md</code> are the primary agent context.</p>'],
]
for (const [rel, title, lead, body, currentHref] of docPages) await emit(rel, pageShell(title, lead, body, currentHref || (rel.startsWith('docs/') ? '/docs/' : '')))

await emit('warnings/index.html', pageShell('Warnings', 'Warning codes are tiered so agents know whether to fix, retry, or ask.', `<table class="warning-table"><thead><tr><th>Code</th><th>Tier</th><th>Severity</th></tr></thead><tbody>${capabilities.warningCodes.map((w: any) => `<tr><td data-label="Code"><a href="/warnings/${w.code}/"><code>${w.code}</code></a></td><td data-label="Tier">${w.tier}</td><td data-label="Severity">${w.severity}</td></tr>`).join('')}</tbody></table>`))
for (const w of capabilities.warningCodes) {
  await emit(`warnings/${w.code}/index.html`, pageShell(w.code, `${w.tier} ${w.severity} warning.`, `<p>Run <code>am verify diagram.mmd --json</code>, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.</p>`))
}
const errors = [
  ['parse-error', 'Parse error', 'The source could not be parsed. Preserve the source and point to the line/column when available.'],
  ['mutation-error', 'Mutation error', 'A typed mutation was invalid for the narrowed family or target.'],
  ['render-error', 'Render error', 'Rendering failed after parse. Return the error and source; do not fabricate an artifact.'],
  ['verify-failed', 'Verify failed', 'The diagram parsed but verification returned blocking structural warnings.'],
]
await emit('errors/index.html', pageShell('Errors', 'Error pages explain recovery paths for local CLI, library, and MCP use.', `<ul>${errors.map(([id, title, desc]) => `<li><a href="/errors/${id}/">${title}</a> – ${desc}</li>`).join('')}</ul>`))
for (const [id, title, desc] of errors) await emit(`errors/${id}/index.html`, pageShell(title, desc, '<pre><code>am verify diagram.mmd --json</code></pre><p>Return the structured error to the caller when a safe automatic fix is not obvious.</p>'))

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

const cleanRoutes = ['about', 'editor', 'docs', 'skills', 'skills/agentic-mermaid-diagram-workflow', 'docs/getting-started', 'docs/api', 'docs/families', 'docs/source-level', 'docs/cli', 'docs/mcp', 'docs/ascii', 'docs/theming', 'docs/config', 'docs/react', 'docs/quality', 'docs/fork-differences', 'docs/vocabulary', 'warnings', 'errors', 'examples', 'comparisons', 'evidence', 'security', 'releases']
const redirectLines = [
  ...cleanRoutes.map((r) => `/${r} /${r}/ 308`),
  '/warnings/:code /warnings/:code/ 308', '/errors/:kind /errors/:kind/ 308',
  '/why /about/ 308', '/why/ /about/ 308',
  // Examples absorbed the gallery; Families folded into the docs.
  '/gallery /examples/ 308', '/gallery/ /examples/ 308',
  '/families /docs/families/ 308', '/families/ /docs/families/ 308',
  '',
].join('\n')
await emit('_redirects', redirectLines)

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
  if (publicLlms.includes('TODO.md') || publicLlms.includes('evals/')) throw new Error('public llms.txt exposes repo-only surfaces')
}
assertNoPlaceholders()
assertContractShapes()

if (CHECK) {
  const stale: string[] = []
  for (const [rel, expected] of generated) {
    const file = Bun.file(join(OUT, rel))
    const exists = await file.exists()
    if (!exists) { stale.push(rel); continue }
    const actual = Buffer.from(await file.arrayBuffer())
    const exp = Buffer.isBuffer(expected) ? expected : Buffer.from(expected)
    if (!actual.equals(exp)) stale.push(rel)
  }
  const actual: string[] = []
  async function walk(abs: string, prefix = '') {
    if (!await Bun.file(abs).exists()) return
    for (const ent of await readdir(abs, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name
      const child = join(abs, ent.name)
      if (ent.isDirectory()) await walk(child, rel)
      else actual.push(rel)
    }
  }
  await walk(OUT)
  const unexpected = actual.filter((rel) => !generated.has(rel))
  if (unexpected.length) stale.push(...unexpected.map((f) => `unexpected:${f}`))
  if (stale.length) {
    console.error(`website/build --check: ${stale.length} stale or unexpected file(s):\n  ${stale.join('\n  ')}\nRegenerate with \`bun run website\`.`)
    process.exit(1)
  }
  console.log(`website/build --check: ${generated.size} files in sync.`)
} else {
  console.log(`website/build: wrote ${generated.size} files to website/public`)
}
