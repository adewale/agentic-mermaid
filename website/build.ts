import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { renderMermaidSVG } from '../src/index.ts'

const ROOT = join(import.meta.dir, '..')
const MOCKUPS = join(ROOT, 'mockups')
const OUT = join(import.meta.dir, 'public')
const CHECK = process.argv.includes('--check')

type FileContent = string | Buffer
const generated = new Map<string, FileContent>()

const routeMap: Record<string, string> = {
  'home.html': '/',
  'editor.html': '/editor/',
  'gallery.html': '/gallery/',
  'families.html': '/families/',
  'docs-article.html': '/docs/',
  'skill-workflow.html': '/skills/agentic-mermaid-diagram-workflow/',
  'llms.txt': '/llms.txt',
  'agent-instructions.md': '/agent-instructions.md',
  'capabilities.json': '/capabilities.json',
  'agent-manifest.json': '/agent-manifest.json',
  'harnesses.json': '/harnesses.json',
}

const pageOutputs: Array<[source: string, target: string]> = [
  ['home.html', 'index.html'],
  ['gallery.html', 'gallery/index.html'],
  ['families.html', 'families/index.html'],
  ['docs-article.html', 'docs/index.html'],
  ['skill-workflow.html', 'skills/agentic-mermaid-diagram-workflow/index.html'],
]

const rootAssets = new Set([
  'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og-image.png',
  'styles.css', 'theme.js', 'shader-mark.js', 'llms.txt', 'agent-instructions.md',
  'capabilities.json', 'agent-manifest.json', 'harnesses.json',
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
  if (path.startsWith('schemas/') || path.startsWith('diagrams/') || path.startsWith('recipes/') || path.startsWith('skills/') || path.startsWith('examples/')) {
    return '/' + path + suffix
  }
  return value
}

const agentDiscoveryLinks = [
  '<link rel="alternate" type="text/plain" href="/llms.txt">',
  '<link rel="alternate" type="application/json" href="/agent-manifest.json">',
  '<link rel="alternate" type="text/markdown" href="/agent-instructions.md">',
].join('\n')

function addHeadDescription(html: string) {
  if (html.includes('name="description"')) return html
  return html.replace(/<meta name="viewport" content="width=device-width, initial-scale=1"\s*\/?\s*>/, '$&\n<meta name="description" content="Agentic Mermaid renders, verifies, and edits Mermaid diagrams locally, with static agent manifests for CLI, library, and MCP setup.">')
}

function addAgentDiscoveryLinks(html: string) {
  if (html.includes('rel="alternate" type="application/json" href="/agent-manifest.json"')) return html
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
  if (route === '/gallery/') return '/gallery/'
  if (route === '/families/') return '/families/'
  if (route === '/docs/' || route.startsWith('/docs/')) return '/docs/'
  if (route === '/editor/') return '/editor/'
  return ''
}

function setNavCurrent(html: string, currentHref = '') {
  if (!currentHref) return html
  const labels: Record<string, string> = {
    '/examples/': 'Examples',
    '/gallery/': 'Gallery',
    '/families/': 'Families',
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

async function readMock(path: string) {
  return await Bun.file(join(MOCKUPS, path)).text()
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

async function copyMockFile(rel: string, destRel = rel) {
  await copyFileFrom(join(MOCKUPS, rel), destRel)
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
    ['/why/', 'Why', ''],
    ['/examples/', 'Examples', ''],
    ['/gallery/', 'Gallery', ''],
    ['/families/', 'Families', ''],
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
<footer><div class="footlinks"><a href="/llms.txt">llms.txt</a><span class="sep">&middot;</span><a href="/agent-instructions.md">agent-instructions.md</a><span class="sep">&middot;</span><a href="/capabilities.json">capabilities.json</a><span class="sep">&middot;</span><a href="/agent-manifest.json">agent-manifest.json</a><span class="sep">&middot;</span><a href="https://github.com/adewale/beautiful-mermaid">GitHub</a></div></footer>
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
const rawCapabilities = JSON.parse(await readMock('capabilities.json'))
const mockHarnesses = JSON.parse(await readMock('harnesses.json'))
const localServer = mockHarnesses.server
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
function renderExampleSvg(example: any) {
  // The editor examples intentionally carry their own options. The public
  // Examples page uses one review theme so cards can be compared side by side;
  // chart palettes still derive from the single site accent above.
  return renderMermaidSVG(example.source, {
    ...WEBSITE_EXAMPLE_THEME,
    interactive: Boolean(example.options?.interactive),
    security: 'strict',
    compact: true,
    embedFontImport: false,
    idPrefix: `example-${example.id}-`,
  }).replace(/[ \t]+$/gm, '')
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
<p class="muted">${category === 'Role style presets' ? 'These load role-style presets in the editor. This page renders them with one fixed review theme so the examples stay visually comparable.' : 'These are the examples exposed by the editor picker for each supported diagram family, rendered with one fixed review theme.'}</p>
${examples.map((example) => `
<article class="example-sample" id="${escapeAttr(example.id)}">
  <header class="example-sample-head">
    <div>
      <p class="example-meta">${escapeHtml(example.diagramType ?? 'Example')}</p>
      <h3>${escapeHtml(example.label)}</h3>
      <p>${escapeHtml(example.description ?? '')}</p>
    </div>
    <a class="go" href="/editor/?example=${encodeURIComponent(example.id)}">Open in editor</a>
  </header>
  <div class="example-sample-grid">
    <section class="example-source" aria-label="${escapeAttr(example.label)} Mermaid source"><pre><code>${escapeHtml(String(example.source ?? '').trim())}</code></pre></section>
    <figure class="example-render"><div class="example-svg">${renderExampleSvg(example)}</div><figcaption>Rendered during the website build from the same source the editor loads.</figcaption></figure>
  </div>
</article>`).join('')}
</section>`).join('\n') + '\n</div>'
}

if (!CHECK) await rm(OUT, { recursive: true, force: true })

// Core mockup-derived pages.
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
for (const [source, target] of pageOutputs) {
  let html = transformHtml(await readMock(source), topNavHrefForRoute(routeMap[source]))
  if (source === 'home.html') html = injectLoopRail(html)
  if (source === 'docs-article.html') html = injectLoopHeadings(html)
  await emit(target, html)
}
await emit('editor/index.html', await generateEditorHtml())

// Static assets.
for (const asset of ['favicon.svg', 'styles.css', 'theme.js', 'shader-mark.js']) await copyMockFile(asset)
for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'og-image.png']) await copyFileFrom(join(ROOT, 'public', asset), asset)
await copyDir(join(MOCKUPS, 'diagrams'), 'diagrams')

const hostedMcp = {
  available: false,
  url: null,
  transport: 'streamable-http',
  auth: 'none',
  recommended: 'self-host',
  execute: false,
  tools: [],
  localToolSurface: ['execute', 'render_png', 'describe'],
  futureHostedConstraint: 'Do not enable execute(code) or arbitrary server-side code without a separate security/auth/rate-limit decision; a bounded future route may expose non-execution render, describe, verify, or structured-edit operations.',
  status: 'not enabled in this static Workers preview',
}

const machineRoutes = {
  llms: '/llms.txt',
  instructions: '/agent-instructions.md',
  capabilities: '/capabilities.json',
  schemas: '/schemas/index.json',
  examples: '/examples/index.json',
  harnesses: '/harnesses.json',
  recipes: '/recipes/index.json',
  skills: '/skills/index.json',
}

const capabilities = { ...rawCapabilities, generatedFrom }
await emitJson('capabilities.json', capabilities)

const manifest = {
  name: 'agentic-mermaid',
  package: {
    name: packageJson.name,
    version: packageJson.version,
    imports: ['agentic-mermaid', 'agentic-mermaid/agent'],
    bins: Object.keys(packageJson.bin ?? {}),
    npmStatus: npmPublished ? 'published' : 'unverified',
    checked: npmChecked,
    install: npmPublished ? { command: 'npm i agentic-mermaid' } : { command: installCommand, note: installNotice },
  },
  repo: packageJson.repository?.url ?? 'https://github.com/adewale/beautiful-mermaid',
  site: { canonical: process.env.SITE_ORIGIN ?? 'https://agenticmermaid.dev', legacyPages: packageJson.homepage },
  description: 'Agent-native Mermaid runtime: parse, verify, mutate, and render diagrams through a typed surface. Deterministic SVG, PNG, ASCII, Unicode, and JSON.',
  outputFormats: capabilities.outputFormats,
  families: capabilities.families.map((f: any) => f.id),
  localMcp: { recommended: true, execute: true, transport: 'stdio', server: localServer, tools: ['execute', 'render_png', 'describe'] },
  hostedExecution: { codeMode: false, renderApi: false, mcp: hostedMcp },
  machineRoutes,
  skills: [{ id: 'agentic-mermaid-diagram-workflow', scope: 'consumer', landing: '/skills/agentic-mermaid-diagram-workflow/', entrypoint: '/skills/agentic-mermaid-diagram-workflow/SKILL.md', capabilitiesAuthority: '/capabilities.json' }],
  stopRules: [
    'Verify before serialize, render, commit, or return a diagram artifact.',
    'Do not fabricate ValidDiagram objects; parse first and preserve opaque source when narrowing is unavailable.',
    'Prefer local library, CLI, or self-hosted MCP; treat any hosted MCP as an optional bounded fallback only.',
    'Do not call the website as a REST render API or arbitrary-code execution backend.',
    'When a family is source-level-only for the requested edit, source-edit deliberately or stop and ask for review.',
  ],
  generatedFrom,
}
await emitJson('agent-manifest.json', manifest)

const harnesses = {
  ...mockHarnesses,
  recommended: 'self-hosted',
  localMcpTools: ['execute', 'render_png', 'describe'],
  localWorkflow: 'Use execute(code) for parse/narrow/mutate/verify/serialize workflows; render_png and describe are helper tools.',
  hostedMcp,
  machineRoutes: { manifest: '/agent-manifest.json', capabilities: '/capabilities.json' },
  generatedFrom,
}
await emitJson('harnesses.json', harnesses)

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
      galleryUrl: `/gallery/#${family.id}`,
      editorUrl: `/editor/?example=${example.id}`,
      outputs: capabilities.outputFormats,
      docs: `/families/#${family.id}`,
    }
  }),
}
await emitJson('examples/index.json', examples)

const recipes = [
  { id: 'new-diagram', title: 'New diagram', command: 'am verify diagram.mmd && am render diagram.mmd --format svg --output diagram.svg', body: 'Author Mermaid source directly, verify it locally, then render the reviewed artifact.' },
  { id: 'existing-structured-edit', title: 'Existing structured edit', command: 'Use parseMermaid → asFlowchart/asState/… → mutate → verifyMermaid → serializeMermaid.', body: 'For modeled families, narrow before mutating so an agent changes only the intended node, edge, task, relation, or event.' },
  { id: 'source-level-only', title: 'Source-level-only fallback', command: 'am verify diagram.mmd', body: 'If a narrower returns null, preserve opaque source and edit text deliberately; stop for human review when semantics are unclear.' },
  { id: 'artifacts', title: 'Review artifacts', command: 'am render diagram.mmd --format png --output diagram.png', body: 'Produce SVG/PNG for visual review and ASCII/Unicode for terminal or PR comments.' },
  { id: 'batch-repo', title: 'Batch a repository', command: 'find docs -name "*.mmd" | am batch --jsonl', body: 'Use JSONL batch checks when an agent needs to verify many diagrams and report warnings without stopping at the first failure.' },
  { id: 'markdown', title: 'Render Markdown', command: 'am render-markdown README.md --output README.rendered.md', body: 'Render Mermaid blocks embedded in Markdown as local review artifacts.' },
  { id: 'quality-review', title: 'Quality review', command: 'am verify diagram.mmd --json', body: 'Inspect warning tiers, layout metrics, screenshots, and human-visible artifacts; verify.ok is necessary but not visual perfection.' },
  { id: 'local-mcp', title: 'Local MCP', command: npmPublished ? 'npx agentic-mermaid-mcp' : 'bun run bin/agentic-mermaid-mcp.ts', body: 'Self-host the stdio MCP. Multi-step edits go through execute(code); render_png and describe are helper tools.' },
] as const
await emitJson('recipes/index.json', { generatedFrom, recipes: recipes.map(({ id, title }) => ({ id, title, url: `/recipes/${id}.md` })) })
for (const r of recipes) {
  await emit(`recipes/${r.id}.md`, `# ${r.title}\n\n${r.body}\n\n\`\`\`bash\n${r.command}\n\`\`\`\n\nLocal-first rule: use the package, CLI, or self-hosted MCP. This website is not a REST render API and does not run hosted Code Mode \`execute(code)\`.\n`)
}

const skillText = await Bun.file(join(ROOT, 'skills/agentic-mermaid-diagram-workflow/SKILL.md')).text()
const skillFiles = ['SKILL.md', 'references/cli.md', 'references/code-mode.md', 'references/flowchart.md', 'references/sequence.md', 'references/timeline.md']
const rawFiles = []
for (const file of skillFiles) {
  const text = await Bun.file(join(ROOT, 'skills/agentic-mermaid-diagram-workflow', file)).text()
  rawFiles.push({ path: file, url: `/skills/agentic-mermaid-diagram-workflow/${file}`, sha256: sha256(text) })
  await emit(`skills/agentic-mermaid-diagram-workflow/${file}`, text)
}
await emitJson('skills/index.json', {
  generatedFrom,
  skills: [{
    id: 'agentic-mermaid-diagram-workflow',
    name: 'agentic-mermaid-diagram-workflow',
    scope: 'consumer',
    description: 'Guided workflow for authoring, editing, verifying, serializing, and rendering Agentic Mermaid diagrams.',
    landing: '/skills/agentic-mermaid-diagram-workflow/',
    entrypoint: '/skills/agentic-mermaid-diagram-workflow/SKILL.md',
    rawFiles,
    requiredReferences: rawFiles.filter((f) => f.path.startsWith('references/')).map((f) => f.url),
    optionalReferences: [],
    capabilitiesAuthority: '/capabilities.json',
    supportedLocalChannels: ['library', 'cli', 'local-mcp', 'skills-capable-harnesses'],
    warning: 'Capabilities.json is authoritative; upstream Mermaid syntax references are authoring references, not render-support claims.',
  }],
})

// Public llms.txt must not expose repo-only backlog/eval/contributor surfaces.
const publicLlms = `# Agentic Mermaid\n\nAgentic Mermaid renders, verifies, and safely edits Mermaid diagrams locally. Use the package, CLI, or self-hosted MCP; the website is documentation plus a browser-local editor, not a REST render API.\n\nStart here:\n- /agent-instructions.md – short operating guide for agents\n- /agent-manifest.json – package, routes, stop rules, and hosted-execution posture\n- /capabilities.json – authoritative family/output/mutation/warning contract\n- /examples/index.json – the same example IDs and sources loaded by the editor\n- /recipes/index.json – local CLI/library/MCP recipes\n- /skills/index.json – public consumer skill catalog\n\nStop rules:\n- Verify before serialize, render, commit, or return.\n- Do not fabricate ValidDiagram objects. Parse first.\n- Prefer local library, CLI, or self-hosted MCP.\n- Do not call this website as a render API or arbitrary-code execution backend.\n`;
await emit('llms.txt', publicLlms)
await emit('agent-instructions.md', await Bun.file(join(ROOT, 'Instructions_for_agents.md')).text())

const schemaEntries = [
  { name: 'capabilities', schema: '/schemas/capabilities.schema.json' },
  { name: 'agent-manifest', schema: '/schemas/agent-manifest.schema.json' },
  { name: 'harnesses', schema: '/schemas/harnesses.schema.json' },
  { name: 'skills', schema: '/schemas/skills.schema.json' },
  { name: 'recipes', schema: '/schemas/recipes.schema.json' },
  { name: 'examples', schema: '/schemas/examples.schema.json' },
]
type JsonSchema = Record<string, unknown>
const objectSchema = (title: string, required: string[], properties: Record<string, JsonSchema>, extra: JsonSchema = {}) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema', title, type: 'object', required, properties, additionalProperties: false, ...extra,
})
const generatedFromSchema = objectSchema('Generated from', ['packageVersion', 'gitSha', 'buildTime'], {
  packageVersion: { type: 'string' }, gitSha: { type: 'string' }, buildTime: { type: 'string' },
})
const stringArray = { type: 'array', items: { type: 'string' } }
const mcpToolNames = ['execute', 'render_png', 'describe']
const hostedMcpSchema = objectSchema('Hosted MCP posture', ['available', 'url', 'transport', 'auth', 'recommended', 'execute', 'tools', 'localToolSurface', 'futureHostedConstraint', 'status'], {
  available: { const: false }, url: { type: 'null' }, transport: { const: 'streamable-http' }, auth: { const: 'none' }, recommended: { const: 'self-host' }, execute: { const: false }, tools: { type: 'array', maxItems: 0 }, localToolSurface: { type: 'array', items: { enum: mcpToolNames } }, futureHostedConstraint: { type: 'string' }, status: { type: 'string' },
})
const machineRoutesSchema = objectSchema('Machine routes', ['llms', 'instructions', 'capabilities', 'schemas', 'examples', 'harnesses', 'recipes', 'skills'], {
  llms: { const: '/llms.txt' }, instructions: { const: '/agent-instructions.md' }, capabilities: { const: '/capabilities.json' }, schemas: { const: '/schemas/index.json' }, examples: { const: '/examples/index.json' }, harnesses: { const: '/harnesses.json' }, recipes: { const: '/recipes/index.json' }, skills: { const: '/skills/index.json' },
})
const familyIdEnum = BUILTIN_FAMILY_METADATA.map((f) => f.id)
const outputFormatEnum = capabilities.outputFormats
await emitJson('schemas/capabilities.schema.json', objectSchema('Agentic Mermaid capabilities', ['sdkVersion', 'families', 'warningCodes', 'outputFormats', 'generatedFrom'], {
  sdkVersion: { type: 'string' },
  families: {
    type: 'array', minItems: BUILTIN_FAMILY_METADATA.length,
    items: objectSchema('Family capability', ['id', 'hasParse', 'hasSerialize', 'hasMutate', 'hasVerify', 'hasExtractLabels', 'mutationOps', 'editPolicy'], {
      id: { enum: familyIdEnum }, hasParse: { type: 'boolean' }, hasSerialize: { type: 'boolean' }, hasMutate: { type: 'boolean' }, hasVerify: { type: 'boolean' }, hasExtractLabels: { type: 'boolean' }, mutationOps: stringArray, editPolicy: { type: 'string' },
    }),
  },
  warningCodes: {
    type: 'array', minItems: capabilities.warningCodes.length,
    items: objectSchema('Warning code', ['code', 'tier', 'severity'], { code: { type: 'string' }, tier: { enum: ['structural', 'geometric', 'lint'] }, severity: { enum: ['error', 'warning'] } }),
  },
  outputFormats: { type: 'array', items: { enum: outputFormatEnum } },
  generatedFrom: generatedFromSchema,
}))
await emitJson('schemas/agent-manifest.schema.json', objectSchema('Agentic Mermaid agent manifest', ['name', 'package', 'repo', 'site', 'description', 'outputFormats', 'families', 'localMcp', 'hostedExecution', 'machineRoutes', 'skills', 'stopRules', 'generatedFrom'], {
  name: { const: 'agentic-mermaid' },
  package: objectSchema('Package', ['name', 'version', 'imports', 'bins', 'npmStatus', 'checked', 'install'], { name: { const: packageJson.name }, version: { type: 'string' }, imports: stringArray, bins: stringArray, npmStatus: { enum: ['published', 'unverified'] }, checked: { type: 'string' }, install: { type: 'object' } }),
  repo: { type: 'string' },
  site: objectSchema('Site', ['canonical', 'legacyPages'], { canonical: { type: 'string' }, legacyPages: { type: 'string' } }),
  description: { type: 'string' }, outputFormats: { type: 'array', items: { enum: outputFormatEnum } }, families: { type: 'array', items: { enum: familyIdEnum } },
  localMcp: objectSchema('Local MCP', ['recommended', 'execute', 'transport', 'server', 'tools'], { recommended: { const: true }, execute: { const: true }, transport: { const: 'stdio' }, server: { type: 'object' }, tools: { type: 'array', items: { enum: mcpToolNames } } }),
  hostedExecution: objectSchema('Hosted execution posture', ['codeMode', 'renderApi', 'mcp'], { codeMode: { const: false }, renderApi: { const: false }, mcp: hostedMcpSchema }),
  machineRoutes: machineRoutesSchema,
  skills: { type: 'array', items: objectSchema('Skill manifest entry', ['id', 'scope', 'landing', 'entrypoint', 'capabilitiesAuthority'], { id: { type: 'string' }, scope: { type: 'string' }, landing: { type: 'string' }, entrypoint: { type: 'string' }, capabilitiesAuthority: { const: '/capabilities.json' } }) },
  stopRules: { type: 'array', items: { type: 'string' } }, generatedFrom: generatedFromSchema,
}))
await emitJson('schemas/harnesses.schema.json', objectSchema('Agentic Mermaid harnesses', ['default', 'recommended', 'server', 'clients', 'localMcpTools', 'localWorkflow', 'hostedMcp', 'machineRoutes', 'generatedFrom'], {
  default: { const: 'stdio' }, recommended: { const: 'self-hosted' },
  server: objectSchema('Server command', ['command', 'args', 'transport'], { command: { type: 'string' }, args: stringArray, transport: { const: 'stdio' } }),
  clients: { type: 'array', items: objectSchema('MCP client', ['id', 'name'], { id: { type: 'string' }, name: { type: 'string' }, register: { type: 'string' }, config: { type: 'string' } }) },
  localMcpTools: { type: 'array', items: { enum: mcpToolNames } }, localWorkflow: { type: 'string' }, hostedMcp: hostedMcpSchema, machineRoutes: { type: 'object' }, generatedFrom: generatedFromSchema,
}))
await emitJson('schemas/skills.schema.json', objectSchema('Agentic Mermaid skills catalog', ['generatedFrom', 'skills'], {
  generatedFrom: generatedFromSchema,
  skills: { type: 'array', items: objectSchema('Skill catalog entry', ['id', 'name', 'scope', 'description', 'landing', 'entrypoint', 'rawFiles', 'requiredReferences', 'optionalReferences', 'capabilitiesAuthority', 'supportedLocalChannels', 'warning'], { id: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string' }, description: { type: 'string' }, landing: { type: 'string' }, entrypoint: { type: 'string' }, rawFiles: { type: 'array', items: objectSchema('Skill raw file', ['path', 'url', 'sha256'], { path: { type: 'string' }, url: { type: 'string' }, sha256: { type: 'string' } }) }, requiredReferences: stringArray, optionalReferences: stringArray, capabilitiesAuthority: { const: '/capabilities.json' }, supportedLocalChannels: stringArray, warning: { type: 'string' } }) },
}))
await emitJson('schemas/recipes.schema.json', objectSchema('Agentic Mermaid recipes catalog', ['generatedFrom', 'recipes'], {
  generatedFrom: generatedFromSchema,
  recipes: { type: 'array', items: objectSchema('Recipe entry', ['id', 'title', 'url'], { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string', pattern: '^/recipes/[^/]+\\.md$' } }) },
}))
await emitJson('schemas/examples.schema.json', objectSchema('Agentic Mermaid examples catalog', ['generatedFrom', 'examples'], {
  generatedFrom: generatedFromSchema,
  examples: { type: 'array', items: objectSchema('Example entry', ['id', 'family', 'label', 'description', 'headers', 'source', 'galleryUrl', 'editorUrl', 'outputs', 'docs'], { id: { type: 'string' }, family: { enum: familyIdEnum }, label: { type: 'string' }, description: { type: 'string' }, headers: stringArray, source: { type: 'string' }, galleryUrl: { type: 'string' }, editorUrl: { type: 'string' }, outputs: { type: 'array', items: { enum: outputFormatEnum } }, docs: { type: 'string' } }) },
}))
const toolIndex = JSON.parse(await readMock('schemas/index.json'))
for (const t of toolIndex.tools ?? []) await copyMockFile(t.schema, t.schema)
await emitJson('schemas/index.json', { generatedFrom, schemas: schemaEntries, mcpTools: (toolIndex.tools ?? []).map((t: any) => ({ ...t, schema: '/' + t.schema })) })

// Spec route coverage pages.
const docsIndex = '<hr><h2>Docs index</h2><ul class="doc-index"><li><a href="/docs/api/">Library API</a></li><li><a href="/docs/cli/">CLI</a></li><li><a href="/docs/mcp/">MCP</a></li><li><a href="/docs/source-level/">Source-level edits</a></li><li><a href="/docs/ascii/">ASCII and Unicode</a></li><li><a href="/docs/theming/">Theming</a></li><li><a href="/docs/config/">Config</a></li><li><a href="/docs/react/">React</a></li><li><a href="/docs/quality/">Quality</a></li><li><a href="/docs/vocabulary/">Vocabulary</a></li><li><a href="/docs/fork-differences/">Fork differences</a></li></ul>'
const whyLead = 'Agentic Mermaid is a fork of beautiful-mermaid, aimed at a job the original did not have: programs that draw and check diagrams with no person watching. It renders without a browser, reports its own layout errors, and edits diagrams as a typed tree.'
const whyBody = `
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
`
const docPages = [
  ['why/index.html', 'Why Agentic Mermaid exists', whyLead, whyBody, '/why/'],
  ['docs/api/index.html', 'Library API', 'Use agentic-mermaid and agentic-mermaid/agent from local JS or TS.', '<p>Import rendering helpers from <code>agentic-mermaid</code> and typed parse/mutate/verify helpers from <code>agentic-mermaid/agent</code>.</p>' + docsIndex],
  ['docs/source-level/index.html', 'Source-level edits', 'When a family or construct cannot be narrowed safely, preserve source deliberately.', '<p>Opaque fallback bodies round-trip losslessly, but they do not expose structured mutation. Edit their preserved source only when the task explicitly asks for source-level changes, then parse and verify before returning artifacts.</p>' + docsIndex],
  ['docs/cli/index.html', 'CLI', 'Use the am CLI for local rendering, verification, batch checks, and Markdown rendering.', '<pre><code>am verify diagram.mmd\nam render diagram.mmd --format svg --output diagram.svg\nam render diagram.mmd --format unicode</code></pre>' + docsIndex],
  ['docs/mcp/index.html', 'MCP', 'Self-host the MCP over stdio; HTTP is explicit opt-in.', '<p>The local MCP tools are <code>execute</code>, <code>render_png</code>, and <code>describe</code>. Multi-step parse/narrow/mutate/verify workflows run inside <code>execute(code)</code>.</p>' + docsIndex],
  ['docs/ascii/index.html', 'ASCII and Unicode', 'Text output is first-class for terminals, PR comments, and agent review.', '<pre><code>am render diagram.mmd --format ascii\nam render diagram.mmd --format unicode</code></pre>' + docsIndex],
  ['docs/theming/index.html', 'Theming', 'Themes derive diagram colours from bg, fg, and accent tokens.', '<p>The browser editor and gallery expose renderer themes; SVG output can also inherit CSS variables for live theming.</p>' + docsIndex],
  ['docs/config/index.html', 'Config', 'Mermaid frontmatter and init directives are normalized before rendering.', '<p>Use checked Mermaid config/frontmatter where supported; unsupported syntax is preserved or reported rather than silently dropped.</p>' + docsIndex],
  ['docs/react/index.html', 'React', 'Render locally in React without using the website as a backend.', '<p>Import the library in your app and render SVG/PNG locally. Keep private diagrams in the browser or your own infrastructure.</p>' + docsIndex],
  ['docs/quality/index.html', 'Quality', 'Determinism, verify warnings, and layout metrics make diagram edits reviewable.', '<p><code>verify.ok</code> is a gate, not a promise of visual perfection. Include SVG/PNG/ASCII artifacts for human review when the change is visual.</p>' + docsIndex],
  ['docs/fork-differences/index.html', 'Fork differences', 'Agentic Mermaid adds typed editing, deterministic verification, CLI, MCP, and more families.', '<p>See the repository docs for the detailed upstream comparison; this public route keeps the product difference discoverable.</p>' + docsIndex],
  ['docs/vocabulary/index.html', 'Vocabulary', 'Shared terms for humans and agents.', '<dl><dt>narrow</dt><dd>Resolve a parsed diagram to a family-specific typed surface.</dd><dt>verify</dt><dd>Return structural, geometric, and lint warnings before artifacts are trusted.</dd><dt>opaque fallback</dt><dd>Preserve unsupported syntax losslessly when structured mutation is unavailable.</dd></dl>' + docsIndex],
  ['security/index.html', 'Security and privacy', 'The site is static/local-first and does not run hosted Code Mode.', '<p>Source stays in the browser for the editor. The preview has no hosted render API; <code>/mcp</code> returns a 501 until a bounded hosted MCP is deliberately implemented.</p>'],
  ['releases/index.html', 'Releases', 'Current package and site build metadata.', `<pre><code>package: ${packageJson.name}@${packageJson.version}\ngit: ${generatedFrom.gitSha}\nbuild: ${generatedFrom.buildTime}</code></pre>`],
  ['evidence/index.html', 'Evidence', 'Quality evidence is curated, not raw private prompts.', '<p>Use CI, generated artifacts, and deterministic metrics to review changes. Private eval prompts and holdbacks are not public site content.</p>'],
  ['examples/index.html', 'Examples', 'Every example the editor can load, rendered from the same source list.', examplesShowcaseHtml(EDITOR_EXAMPLES), '/examples/'],
  ['skills/index.html', 'Skills', 'Public consumer skill catalog.', '<p>The public skill is <a href="/skills/agentic-mermaid-diagram-workflow/">agentic-mermaid-diagram-workflow</a>. Capabilities.json is authoritative for renderer support.</p>'],
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
  '  Cache-Control: public, max-age=0, must-revalidate',
  '',
  '/*.css',
  '  Cache-Control: public, max-age=3600',
  '',
  '/*.js',
  '  Cache-Control: public, max-age=3600',
  '',
  '/editor/*.js',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*.svg',
  '  Cache-Control: public, max-age=3600',
  '',
  '/*.json',
  '  Access-Control-Allow-Origin: *',
  '  Cache-Control: public, max-age=300',
  '',
  '/*.md',
  '  Access-Control-Allow-Origin: *',
  '  Cache-Control: public, max-age=300',
  '',
  '/*.txt',
  '  Access-Control-Allow-Origin: *',
  '  Cache-Control: public, max-age=300',
  '',
].join('\n')
await emit('_headers', securityHeaders)

const cleanRoutes = ['why', 'editor', 'gallery', 'families', 'docs', 'skills', 'skills/agentic-mermaid-diagram-workflow', 'docs/api', 'docs/source-level', 'docs/cli', 'docs/mcp', 'docs/ascii', 'docs/theming', 'docs/config', 'docs/react', 'docs/quality', 'docs/fork-differences', 'docs/vocabulary', 'warnings', 'errors', 'examples', 'evidence', 'security', 'releases']
const redirectLines = [
  ...cleanRoutes.map((r) => `/${r} /${r}/ 308`),
  '/warnings/:code /warnings/:code/ 308', '/errors/:kind /errors/:kind/ 308',
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
  for (const [name, obj] of Object.entries({ capabilities, manifest, harnesses, examples })) {
    if (!(obj as any).generatedFrom) throw new Error(`${name} missing generatedFrom`)
  }
  if (manifest.localMcp.tools.join(',') !== 'execute,render_png,describe') throw new Error('manifest local MCP tools drifted from shipped server')
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
