import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renderMermaidSVG as renderBeautifulMermaidSVG } from 'beautiful-mermaid'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { verifyMermaid } from '../src/agent/index.ts'
import { buildCapabilities } from '../src/cli/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../src/index.ts'
import { getStyle, knownStyles, styleKind } from '../src/scene/style-registry.ts'
import { HOSTED_FONT_FILES, hostedFontFaceCss } from '../src/font-manifest.ts'
import { namespaceSvgIds } from '../src/renderer.ts'
import { HOSTED_MCP_SERVER_NAME, HOSTED_TOOLS } from '../src/mcp/hosted-server.ts'
import { MCP_SERVER_VERSION } from '../src/mcp/tool-surface.ts'
import { computeDeployVersion } from './src/deploy-hash.ts'
import { CLEAN_PAGE_ROUTES, DYNAMIC_CLEAN_REDIRECT_LINES, staticRedirectLines } from './src/site-routes.ts'
import { HOMEPAGE_AGENT_POINTER } from '../eval/agent-usage/homepage-prompt.ts'
import { EDITOR_EXAMPLES } from '../editor/examples.ts'
import { samples as RICH_EXAMPLES } from '../scripts/site/samples-data.ts'

const ROOT = join(import.meta.dir, '..')
const SOURCE = join(import.meta.dir, 'source')
const SOURCE_PAGES = join(SOURCE, 'pages')
const SOURCE_ASSETS = join(SOURCE, 'assets')
const SOURCE_DIAGRAMS = join(SOURCE, 'diagrams')
const OUT = join(import.meta.dir, 'public')
const CHECK = process.argv.includes('--check')
const PUBLIC_ONLY = process.argv.includes('--public-only')

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
  'start.md': '/start.md',

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
  '<link rel="alternate" type="text/markdown" href="/index.md">',
  '<link rel="alternate" type="text/plain" href="/llms.txt">',
  '<link rel="alternate" type="application/json" href="/capabilities.json">',
  '<link rel="alternate" type="text/markdown" href="/agent-instructions.md">',
  '<link rel="alternate" type="application/json" href="/.well-known/mcp.json">',
  '<link rel="mcp-server" type="application/mcp-server-card+json" href="/.well-known/mcp/server-card.json">',
  '<link rel="ai-catalog" type="application/json" href="/.well-known/ai-catalog.json">',
].join('\n')

function addHeadDescription(html: string) {
  if (html.includes('name="description"')) return html
  // Match any viewport tag variant (the editor emits `initial-scale=1.0` with
  // a self-closing slash) so every shipped page gets a meta description.
  return html.replace(/<meta name="viewport"[^>]*>/, '$&\n<meta name="description" content="Agentic Mermaid renders, verifies, and edits Mermaid diagrams locally, with compact agent instructions for CLI, library, and MCP use.">')
}

// Social/canonical metadata. Keep the canonical public origin as the default so
// local builds and production both ship complete entity-resolution metadata.
const siteOrigin = process.env.SITE_ORIGIN ?? 'https://agentic-mermaid.dev'
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

function jsonLdScript(data: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

function decodeHtmlLite(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function structuredDataTags(title = 'Agentic Mermaid', description = packageJson.description, route = '/') {
  const pageUrl = siteOrigin + (route || '/')
  const homeUrl = `${siteOrigin}/`
  const logoUrl = `${siteOrigin}/og-image.png`
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${homeUrl}#organization`,
        name: 'Agentic Mermaid',
        url: homeUrl,
        logo: logoUrl,
        description: 'Open-source Mermaid rendering, verification, and structured editing for coding agents.',
        sameAs: ['https://github.com/adewale/agentic-mermaid'],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'technical support',
          url: 'https://github.com/adewale/agentic-mermaid/issues',
        },
        address: {
          '@type': 'PostalAddress',
          addressCountry: 'US',
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${homeUrl}#website`,
        name: 'Agentic Mermaid',
        url: homeUrl,
        description: packageJson.description,
        publisher: { '@id': `${homeUrl}#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${homeUrl}#software`,
        name: 'Agentic Mermaid',
        url: homeUrl,
        description: packageJson.description,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Diagramming, MCP server, CLI, and library',
        operatingSystem: 'Cross-platform',
        softwareVersion: packageJson.version,
        codeRepository: 'https://github.com/adewale/agentic-mermaid',
        programmingLanguage: ['TypeScript', 'JavaScript'],
        runtimePlatform: ['Node.js', 'Bun', 'Cloudflare Workers'],
        isAccessibleForFree: true,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        featureList: [
          'Parse, verify, mutate, serialize, and render Mermaid diagrams',
          'Deterministic SVG, PNG, ASCII, Unicode, and JSON layout output',
          'Hosted and self-hosted MCP tools for agent workflows',
          'Structured mutation operations for supported Mermaid families',
        ],
        provider: { '@id': `${homeUrl}#organization` },
        sameAs: ['https://github.com/adewale/agentic-mermaid'],
      },
      {
        '@type': 'Service',
        '@id': `${homeUrl}#hosted-mcp`,
        name: 'Agentic Mermaid hosted MCP',
        serviceType: 'Model Context Protocol server',
        url: `${siteOrigin}/mcp`,
        description: 'Stateless Streamable HTTP MCP endpoint for rendering, verifying, describing, mutating, and building Mermaid diagrams.',
        provider: { '@id': `${homeUrl}#organization` },
        isRelatedTo: { '@id': `${homeUrl}#software` },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: title,
        description,
        isPartOf: { '@id': `${homeUrl}#website` },
        primaryImageOfPage: logoUrl,
        about: { '@id': `${homeUrl}#software` },
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', '.lead', '.agent-entrypoints'],
        },
      },
      // FAQPage markup is scoped to /about/ (the page whose visible FAQ section
      // it describes): Google's guideline requires the Q&A to be visible on the
      // page carrying the markup, and stamping it site-wide risks it being
      // ignored as duplicate structured data.
      ...(route === '/about/' ? [{
        '@type': 'FAQPage',
        '@id': `${homeUrl}#faq`,
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is Agentic Mermaid?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Agentic Mermaid is an open-source Mermaid runtime for agents. It parses, verifies, mutates, serializes, and renders diagrams without a browser.',
            },
          },
          {
            '@type': 'Question',
            name: 'How should an agent use Agentic Mermaid?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Use the local library, CLI, or MCP server. Parse source first, narrow to the diagram family, apply structured mutations when available, verify, then serialize or render.',
            },
          },
          {
            '@type': 'Question',
            name: 'Where is the hosted MCP endpoint?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'The hosted stateless Streamable HTTP MCP endpoint is https://agentic-mermaid.dev/mcp, with a standard discovery alias at https://agentic-mermaid.dev/.well-known/mcp.',
            },
          },
        ],
      }] : []),
    ],
  })
}

function addStructuredData(html: string, route = '') {
  if (html.includes('"@id":"https://agentic-mermaid.dev/#software"')) return html
  const title = decodeHtmlLite((html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Agentic Mermaid').trim())
  const description = decodeHtmlLite(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? packageJson.description)
  return html.replace('</head>', structuredDataTags(title, description, route || '/') + '\n</head>')
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

// Code blocks scroll horizontally on narrow screens; a scrollable region must
// be keyboard-focusable (WCAG 2.1.1 / axe scrollable-region-focusable).
function makePreFocusable(html: string) {
  return html.replace(/<pre(?![^>]*\btabindex)((?:\s[^>]*)?)>/g, '<pre tabindex="0"$1>')
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
  const transformed = setNavCurrent(ensureMainId(addSkipLink(addFooter(addAgentDiscoveryLinks(addStructuredData(addSocialMeta(addHeadDescription(rewriteAttrs(html)), route), route))))), currentHref)
  return makePreFocusable(transformed)
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

// Latin-subset woff2 companions (committed under source/assets/fonts, built
// once with pyftsubset) for the display faces the styled site SVGs actually
// use. Browsers pick the woff2 source, cutting ~1.34MB of render-competing TTF
// transfer to ~255KB; the full TTFs still ship for the editor's export
// embedding and any glyph outside the subset's fallback chain.
const SUBSET_FONT_FILES = ['Caveat', 'EBGaramond', 'ShareTechMono', 'ArchitectsDaughter']
async function emitStylesheet() {
  const css = await Bun.file(join(SOURCE_ASSETS, 'styles.css')).text()
  let fontFace = hostedFontFaceCss('/fonts/')
  for (const name of SUBSET_FONT_FILES) {
    fontFace = fontFace.replace(
      `src: url('/fonts/${name}.ttf') format('truetype');`,
      `src: url('/fonts/${name}.subset.woff2') format('woff2'), url('/fonts/${name}.ttf') format('truetype');`,
    )
  }
  await emit('styles.css', fontFace + '\n' + css)
}

async function emitThemeScript() {
  const [copyFeedback, theme] = await Promise.all([
    Bun.file(join(ROOT, 'shared', 'browser', 'copy-feedback.js')).text(),
    Bun.file(join(SOURCE_ASSETS, 'theme.js')).text(),
  ])
  await emit('theme.js', copyFeedback + '\n' + theme)
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

async function generateEditorHtml() {
  const result = Bun.spawnSync(['bun', 'run', 'scripts/site/editor.ts'], {
    cwd: ROOT,
    env: { ...process.env, AM_EDITOR_FONT_PREFIX: '/fonts/' },
  })
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
  // The bundle is the editor's whole app; let the preload scanner fetch it
  // before the parser reaches the end-of-body script tag.
  transformed = transformed.replace('</head>', `<link rel="modulepreload" href="/${scriptRel}">\n</head>`)
  return transformed
}

function mastheadHtml(currentHref = '') {
  const links = [
    ['/about/', 'About', ''],
    ['/examples/', 'Examples', ''],
    ['/comparisons/', 'Comparisons', ''],
    ['/docs/', 'Docs', ''],
    ['https://github.com/adewale/agentic-mermaid', 'GitHub', ''],
    [GENERIC_EDITOR_HREF, 'Open editor', 'link-editor'],
  ] as const
  const nav = links.map(([href, label, cls]) => {
    const attrs = [cls ? `class="${cls}"` : '', currentHref === href ? 'aria-current="page"' : ''].filter(Boolean).join(' ')
    return `<a ${attrs ? attrs + ' ' : ''}href="${href}">${label}</a>`
  }).join('')
  return `<header class="masthead"><div class="bar"><a class="brand" href="/"><span class="mark"></span> Agentic&nbsp;Mermaid</a><span class="links">${nav}</span></div><hr></header>`
}

// One quiet footer on every document page: the trust signals an evaluating
// engineer looks for (version, license, where to report a problem) plus the
// pages that otherwise have no inbound link (design language). The editor is
// app chrome and carries its own report-issue affordance instead.
function siteFooterHtml() {
  return `<footer class="site-footer"><hr><div class="bar"><p>Agentic Mermaid v${packageJson.version} · <a href="https://github.com/adewale/agentic-mermaid/blob/main/LICENSE">MIT</a> · <a href="https://github.com/adewale/agentic-mermaid">GitHub</a> · <a href="https://github.com/adewale/agentic-mermaid/issues">Report an issue</a> · <a href="https://github.com/adewale/agentic-mermaid/blob/main/CHANGELOG.md">Changelog</a> · <a href="/about/design/">Design language</a> · <a href="/llms.txt">llms.txt</a></p></div></footer>`
}

function addFooter(html: string) {
  if (html.includes('class="site-footer"')) return html
  return html.replace('</main>', '</main>\n' + siteFooterHtml())
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
${structuredDataTags(fullTitle, lead, route || '/')}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${mastheadHtml(currentHref)}
<main id="main" class="doc">
<section class="page-header">
<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${meta ? `<p class="page-meta">${meta}</p>\n` : ''}${actions ? `<div class="page-actions">${actions}</div>\n` : ''}</section>
${makePreFocusable(body)}
</main>
${siteFooterHtml()}
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
const npmPublished = process.env.SITE_NPM_STATUS === 'source'
  ? false
  : process.env.SITE_NPM_STATUS === 'published' || process.env.SITE_NPM_PUBLISHED !== '0'
const installCommand = npmPublished
  ? 'npm i agentic-mermaid'
  : 'git clone https://github.com/adewale/agentic-mermaid && cd agentic-mermaid && bun install && bun run build'
const installNotice = npmPublished
  ? 'Install the published npm package.'
  : 'The npm package is not yet published; install from source.'

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

function exampleSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function richExampleId(sample: { title: string }, index: number) {
  return `rich-${index + 1}-${exampleSlug(sample.title)}`
}

function renderRichExampleSvg(sample: any, id: string) {
  const svg = renderMermaidSVG(sample.source, {
    ...(sample.options ?? {}),
    security: 'strict',
    compact: true,
    embedFontImport: false,
    idPrefix: `example-${id}-`,
  }).replace(/[ \t]+$/gm, '')
  return addSvgAccessibleName(
    svg,
    `example-${id}`,
    `${sample.title} diagram`,
    `Build-time render of the shared ${sample.category ?? 'Mermaid'} corpus example.`,
  )
}

function encodeEditorStateHash(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
}

function editorStateHref(state: Record<string, unknown>) {
  return `/editor/#${encodeEditorStateHash(state)}`
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
// the redirect. Other examples keep their own id.
function exampleAnchor(example: any) {
  const family = familyForExample(example)
  return example.category === 'Supported diagrams' && family ? family.id : example.id
}
function exampleCategoryId(category: string) {
  return 'examples-' + category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
function exampleCategoryLabel(category: string) {
  return category === 'Supported diagrams' ? 'Diagram examples' : category
}
function exampleFamilyDescription(familyId: string, fallback: string) {
  return FAMILY_REFERENCE.find(([id]) => id === familyId)?.[2] ?? fallback
}

const STYLE_THEME_PAIR_BY_FAMILY: Record<string, { look: string; theme: string; seed: number }> = {
  flowchart: { look: 'watercolor', theme: 'paper', seed: 4 },
  state: { look: 'chalkboard', theme: 'dusk', seed: 2 },
  architecture: { look: 'blueprint', theme: 'nord', seed: 1 },
  sequence: { look: 'publication-figure', theme: 'github-light', seed: 0 },
  class: { look: 'patent-drawing', theme: 'paper', seed: 6 },
  er: { look: 'risograph', theme: 'salmon', seed: 5 },
  timeline: { look: 'hand-drawn', theme: 'catppuccin-latte', seed: 3 },
  journey: { look: 'status-dashboard', theme: 'github-dark', seed: 0 },
  xychart: { look: 'accessible-high-contrast', theme: 'zinc-light', seed: 0 },
  pie: { look: 'pen-and-ink', theme: 'tufte', seed: 7 },
  quadrant: { look: 'ops-schematic', theme: 'nord-light', seed: 8 },
  gantt: { look: 'architectural-plan', theme: 'solarized-light', seed: 9 },
}

const STYLE_THEME_LABELS: Record<string, string> = {
  'accessible-high-contrast': 'Accessible Contrast',
  'architectural-plan': 'Plan Drafting',
  'catppuccin-latte': 'Catppuccin Latte',
  'github-dark': 'GitHub Dark',
  'github-light': 'GitHub Light',
  'hand-drawn': 'Hand-drawn',
  'ops-schematic': 'Compact Trace Map',
  'patent-drawing': 'Patent Hatching',
  'pen-and-ink': 'Pen & ink',
  'publication-figure': 'Report Figure',
  'risograph': 'Riso Print',
  'solarized-light': 'Solarized Light',
  'status-dashboard': 'Dark Ops Dashboard',
  'zinc-light': 'Zinc Light',
}

function displayStyleName(name: string) {
  return STYLE_THEME_LABELS[name] ?? name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function styleThemeExamples(editorExamples: any[]) {
  const byFamily = new Map<string, any>()
  for (const example of editorExamples) {
    const family = familyForExample(example)
    if (example.category === 'Supported diagrams' && family) byFamily.set(family.id, example)
  }
  return BUILTIN_FAMILY_METADATA.map((family) => {
    const example = byFamily.get(family.id)
    const pair = STYLE_THEME_PAIR_BY_FAMILY[family.id]
    if (!example || !pair) throw new Error(`missing style/theme example wiring for ${family.id}`)
    return { ...pair, family, example, id: `style-palette-${family.id}` }
  })
}

function renderStyleThemeSvg(combo: ReturnType<typeof styleThemeExamples>[number]) {
  const svg = renderMermaidSVG(combo.example.source, {
    style: [combo.look, combo.theme],
    seed: combo.seed,
    interactive: Boolean(combo.example.options?.interactive),
    security: 'strict',
    compact: true,
    embedFontImport: false,
    idPrefix: `example-${combo.id}-`,
  }).replace(/[ \t]+$/gm, '')
  return addSvgAccessibleName(
    svg,
    `example-${combo.id}`,
    `${combo.family.editorDiagramType} ${displayStyleName(combo.look)} ${displayStyleName(combo.theme)} diagram`,
    `Build-time render of ${combo.family.editorDiagramType} with ${combo.look} style and ${combo.theme} palette.`,
  )
}
// Examples is now the family-discovery surface: jump cards replace the removed
// Diagram families page and the old search box.
function exampleJumpCard(example: any, description: string) {
  return `<a class="example-jump-card" href="#${escapeAttr(exampleAnchor(example))}"><strong>${escapeHtml(example.label)}</strong><span>${escapeHtml(description)}</span></a>`
}
function examplesJumpHtml(groups: Map<string, any[]>, styleThemeCombos: ReturnType<typeof styleThemeExamples>, richExamples = RICH_EXAMPLES) {
  const sections: string[] = []
  const familyExamples = groups.get('Supported diagrams') ?? []
  if (familyExamples.length) {
    const cards = familyExamples.map((example) => {
      const family = familyForExample(example)
      const description = family ? exampleFamilyDescription(family.id, example.description ?? example.label) : (example.description ?? example.label)
      return exampleJumpCard(example, description)
    }).join('')
    sections.push(`<section class="example-jump-section" aria-labelledby="example-jump-families"><p class="example-jump-title" id="example-jump-families">Jump to a diagram family</p><div class="example-jump-grid">${cards}</div></section>`)
  }
  for (const [category, examples] of groups) {
    if (category === 'Supported diagrams') continue
    const cards = examples.map((example) => exampleJumpCard(example, example.description ?? example.label)).join('')
    sections.push(`<section class="example-jump-section" aria-labelledby="${escapeAttr(exampleCategoryId(category))}-jump"><p class="example-jump-title" id="${escapeAttr(exampleCategoryId(category))}-jump">${escapeHtml(exampleCategoryLabel(category))}</p><div class="example-jump-grid">${cards}</div></section>`)
  }
  const styleThemeCards = styleThemeCombos.map((combo) => `<a class="example-jump-card" href="#${escapeAttr(combo.id)}"><strong>${escapeHtml(combo.family.editorDiagramType)}</strong><span>${escapeHtml(`${displayStyleName(combo.look)} × ${displayStyleName(combo.theme)}`)}</span></a>`).join('')
  sections.push(`<section class="example-jump-section" aria-labelledby="examples-style-palette-combinations-jump"><p class="example-jump-title" id="examples-style-palette-combinations-jump">Style × palette combinations</p><div class="example-jump-grid">${styleThemeCards}</div></section>`)
  const richCategories = Array.from(new Set(richExamples.map((sample) => sample.category ?? 'Examples')))
  const richCards = richCategories.map((category) => `<a class="example-jump-card" href="#rich-${escapeAttr(exampleSlug(category))}"><strong>${escapeHtml(category)}</strong><span>${escapeHtml(String(richExamples.filter((sample) => (sample.category ?? 'Examples') === category).length))} shared examples</span></a>`).join('')
  sections.push(`<section class="example-jump-section" aria-labelledby="examples-rich-gallery-jump"><p class="example-jump-title" id="examples-rich-gallery-jump">Rich shared example gallery</p><div class="example-jump-grid">${richCards}</div></section>`)
  return `<nav class="example-jump" aria-label="Jump to examples">${sections.join('\n')}</nav>`
}

function richExamplesHtml(richExamples = RICH_EXAMPLES) {
  const groups = new Map<string, Array<{ sample: any; id: string }>>()
  richExamples.forEach((sample, index) => {
    const category = sample.category ?? 'Examples'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push({ sample, id: richExampleId(sample, index) })
  })
  return `<section class="example-group" aria-labelledby="examples-rich-gallery">
<h2 id="examples-rich-gallery">Rich shared example gallery</h2>
<p class="muted">These examples are reused by benchmark and layout-evaluation tooling, then rendered here at build time. They cover feature syntax, larger real-world shapes, and Style + Palette combinations beyond the small editor starters.</p>
${Array.from(groups, ([category, entries]) => `
<section class="example-rich-group" aria-labelledby="rich-${escapeAttr(exampleSlug(category))}">
<h3 id="rich-${escapeAttr(exampleSlug(category))}">${escapeHtml(category)}</h3>
${entries.map(({ sample, id }) => `
<article class="example-sample" id="${escapeAttr(id)}">
  <header class="example-sample-head">
    <div>
      <p class="example-meta">${escapeHtml(category)}</p>
      <h4>${escapeHtml(sample.title)}</h4>
      <p>${escapeHtml(sample.description ?? '')}</p>
    </div>
    <a class="go" href="${escapeAttr(editorStateHref({ source: sample.source, config: sample.options ?? {} }))}">Open in editor</a>
  </header>
  <div class="example-sample-grid">
    <section class="example-source" aria-label="${escapeAttr(sample.title)} Mermaid source"><pre><code>${escapeHtml(String(sample.source ?? '').trim())}</code></pre></section>
    <figure class="example-render"><div class="example-svg">${renderRichExampleSvg(sample, id)}</div><figcaption>Build-time proof from the shared examples corpus.</figcaption></figure>
  </div>
</article>`).join('')}
</section>`).join('')}
</section>`
}

function styleThemeExamplesHtml(combos: ReturnType<typeof styleThemeExamples>) {
  return `<section class="example-group" aria-labelledby="examples-style-palette-combinations">
<h2 id="examples-style-palette-combinations">Style × palette combinations</h2>
<p class="muted">Each card uses one supported family, one named style, and one palette. Agents pass this as render options; they do not edit Mermaid source just to change appearance.</p>
${combos.map((combo) => {
  const look = displayStyleName(combo.look)
  const theme = displayStyleName(combo.theme)
  const styleCode = `style: ['${combo.look}', '${combo.theme}'], seed: ${combo.seed}`
  return `
<article class="example-sample" id="${escapeAttr(combo.id)}">
  <header class="example-sample-head">
    <div>
      <p class="example-meta">${escapeHtml(combo.family.editorDiagramType)}</p>
      <h3>${escapeHtml(`${combo.family.editorDiagramType}: ${look} × ${theme}`)}</h3>
      <p>${escapeHtml(`The Mermaid source stays the same; the render call supplies ${combo.look} as the style and ${combo.theme} as the palette.`)}</p>
      <p class="example-trace"><span>Render options</span> <code>${escapeHtml(styleCode)}</code></p>
    </div>
    <a class="go" href="${escapeAttr(editorStateHref({ source: combo.example.source, style: combo.look, theme: combo.theme, seed: combo.seed }))}">Open styled</a>
  </header>
  <div class="example-sample-grid">
    <section class="example-source" aria-label="${escapeAttr(combo.family.editorDiagramType)} Mermaid source"><pre><code>${escapeHtml(String(combo.example.source ?? '').trim())}</code></pre></section>
    <figure class="example-render"><div class="example-svg">${renderStyleThemeSvg(combo)}</div><figcaption>Build-time proof: same source, render options <code>${escapeHtml(styleCode)}</code>.</figcaption></figure>
  </div>
</article>`
}).join('')}
</section>`
}

function examplesShowcaseHtml(editorExamples: any[]) {
  const groups = new Map<string, any[]>()
  for (const example of editorExamples) {
    const category = example.category ?? 'Examples'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push(example)
  }
  const combos = styleThemeExamples(editorExamples)
  return '<div class="example-showcase">' + examplesJumpHtml(groups, combos, RICH_EXAMPLES) + Array.from(groups, ([category, examples]) => `
<section class="example-group" aria-labelledby="${escapeAttr(exampleCategoryId(category))}">
<h2 id="${escapeAttr(exampleCategoryId(category))}">${escapeHtml(exampleCategoryLabel(category))}</h2>
<p class="muted">One proof per diagram family: the exact editor source, an agent task, the trace before return, and a build-time render from that same source.</p>
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
</section>`).join('\n') + '\n' + styleThemeExamplesHtml(combos) + '\n' + richExamplesHtml(RICH_EXAMPLES) + '\n</div>'
}

const mermaidRuntimeBytes = Buffer.from(await Bun.file(join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js')).arrayBuffer())
const mermaidRuntimeRel = `vendor/mermaid-${sha256(mermaidRuntimeBytes).slice(0, 12)}.min.js`

type ComparisonCase = { id: string; family: string; source: string }
const COMPARISON_CASES: ComparisonCase[] = [
  { id: 'flowchart', family: 'Flowchart', source: `flowchart LR
  Source([Source]) --> Parse[Parse]
  Parse --> Verify{Warnings?}
  Verify -->|none| Render[Render]
  Verify -->|repair| Mutate[Mutate]
  Mutate --> Parse
  Render --> Cache[(Cache)]
  Render --> Ship([Ship])` },
  { id: 'state', family: 'State', source: `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Running: start
  state Running {
    direction LR
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
  group app(cloud)[Application]
  group data(database)[Data]
  service web(server)[Web App] in app
  service api(server)[API] in app
  service queue(server)[Queue] in app
  service db(database)[Postgres] in data
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
function comparisonPanel(engine: string, label: string, body: string) {
  return `<div class="comparison-panel" data-comparison-engine="${escapeAttr(engine)}"><h3>${escapeHtml(label)}</h3><div class="comparison-render">${body}</div></div>`
}
function comparisonEditorHref(source: string) {
  return `/editor/#${btoa(unescape(encodeURIComponent(source)))}`
}
const COMPARISON_TAKEAWAYS: Record<string, string> = {
  flowchart: 'Compare edge routing, label stability, and whether dense fan-out still reads without browser-dependent drift.',
  state: 'Check nested-state containment and transition labels that remain readable as the lifecycle grows.',
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
const COMPARISON_STYLE_DEMO_SOURCE = `flowchart LR
  Draft[Draft source] --> Verify{Verify}
  Verify -->|ok| Publish[Publish]
  Verify -->|warnings| Revise[Revise]
  Revise --> Verify`
const COMPARISON_STYLE_ROWS = [
  {
    tool: 'Mermaid',
    surface: 'Host-owned runtime config',
    visible: 'The page or CLI wrapper owns colors and CSS; the Mermaid source stays structural, but the style contract lives beside the renderer.',
    handoff: 'Source plus host config such as mermaid.initialize({ themeVariables }).',
  },
  {
    tool: 'Beautiful Mermaid',
    surface: 'Render-call palette options',
    visible: 'A synchronous browserless renderer applies colors, fonts, and CSS variables for supported families; it is still render-only.',
    handoff: 'Source plus render options; no typed edit/verify sequence is part of the handoff.',
  },
  {
    tool: 'Agentic Mermaid',
    surface: 'Composable style stack',
    visible: 'The same render call can stack renderer treatment, palette, custom JSON roles, and seed after the agent verifies source.',
    handoff: 'Typed edit → verify → render with style: [\'watercolor\', \'paper\'], seed: 4.',
  },
] as const
function comparisonStyleBeautifulSvg() {
  return comparisonSvg(renderBeautifulMermaidSVG(COMPARISON_STYLE_DEMO_SOURCE, {
    bg: '#F8FAF8', fg: '#16382B', accent: '#1A7351', line: '#8B9791', surface: '#FFFFFF', border: '#C7D5CE', font: 'Avenir Next', embedFontImport: false,
  } as any), 'comparison-style-beautiful', 'Beautiful Mermaid', 'Style palette demo')
}
function comparisonStyleAgenticSvg() {
  return comparisonSvg(renderMermaidSVG(COMPARISON_STYLE_DEMO_SOURCE, {
    style: ['watercolor', 'paper'], seed: 4, compact: true, security: 'strict', embedFontImport: false, idPrefix: 'comparison-style-agentic-',
  }), 'comparison-style-agentic', 'Agentic Mermaid', 'Style palette demo')
}
function comparisonStyleSupportHtml() {
  const mermaidConfig = `mermaid.initialize({\n  theme: 'base',\n  themeVariables: {\n    primaryColor: '#f8faf8',\n    primaryTextColor: '#16382b'\n  }\n})`
  const beautifulConfig = `renderMermaidSVG(source, {\n  bg: '#F8FAF8',\n  fg: '#16382B',\n  accent: '#1A7351'\n})`
  const agenticConfig = `renderMermaidSVG(source, {\n  style: [\n    'watercolor',\n    'paper'\n  ],\n  seed: 4\n})`
  return `<section class="comparison-style-matrix" aria-labelledby="comparison-style-matrix-title">
<h2 id="comparison-style-matrix-title">Style and palette support</h2>
<p>The render rows above compare one source family by family. This section uses one small source and shows where each renderer expects appearance controls to live.</p>
<div class="comparison-style-demo-grid">
  <article class="comparison-style-demo-card">
    <h3>Mermaid</h3>
    <p>Appearance belongs to the host runtime or page CSS. The diagram source is the same, but the styling contract is outside the Mermaid text.</p>
    <pre><code>${escapeHtml(mermaidConfig)}</code></pre>
    <div class="comparison-style-demo-render"><pre class="mermaid comparison-mermaid" id="comparison-style-demo-mermaid">${escapeHtml(COMPARISON_STYLE_DEMO_SOURCE)}</pre></div>
  </article>
  <article class="comparison-style-demo-card">
    <h3>Beautiful Mermaid</h3>
    <p>Appearance is render-call data for supported families: colors, fonts, and CSS-variable SVG output, without an edit/verify loop.</p>
    <pre><code>${escapeHtml(beautifulConfig)}</code></pre>
    <div class="comparison-style-demo-render">${comparisonStyleBeautifulSvg()}</div>
  </article>
  <article class="comparison-style-demo-card comparison-style-demo-card-agentic">
    <h3>Agentic Mermaid</h3>
    <p>Appearance is a style stack passed after source verification. Styles can change stroke character and typography; palettes change color.</p>
    <pre><code>${escapeHtml(agenticConfig)}</code></pre>
    <div class="comparison-style-demo-render">${comparisonStyleAgenticSvg()}</div>
  </article>
</div>
<div class="table-scroll"><table class="comparison-style-table">
<thead><tr><th>Tool</th><th>Where controls live</th><th>What changes visually</th><th>Agent handoff</th></tr></thead>
<tbody>
${COMPARISON_STYLE_ROWS.map((row) => `<tr><th scope="row">${escapeHtml(row.tool)}</th><td>${escapeHtml(row.surface)}</td><td>${escapeHtml(row.visible)}</td><td>${escapeHtml(row.handoff)}</td></tr>`).join('\n')}
</tbody>
</table></div>
<p class="muted">Summary: Mermaid leaves appearance with the host renderer, Beautiful Mermaid accepts render-call palettes for supported families, and Agentic Mermaid keeps the safe sequence together: edit typed source, verify it, then pass style and palette render options.</p>
</section>`
}
function comparisonsHtml() {
  const sections = COMPARISON_CASES.map((c) => {
    const beautiful = comparisonBeautifulRender(c)
    const takeaway = COMPARISON_TAKEAWAYS[c.id] ?? 'Compare deterministic local rendering against the browser/runtime render.'
    const panels = [
      comparisonPanel('mermaid', 'Mermaid', `<pre class="mermaid comparison-mermaid" id="comparison-mermaid-${escapeAttr(c.id)}">${escapeHtml(c.source)}</pre>`),
      beautiful.supported ? comparisonPanel('beautiful', 'Beautiful Mermaid', beautiful.html) : '',
      comparisonPanel('agentic', 'Agentic Mermaid', comparisonAgenticSvg(c)),
    ].filter(Boolean).join('\n    ')
    const note = beautiful.supported ? '' : '\n  <p class="comparison-note">Beautiful Mermaid does not render this family; only Mermaid and Agentic Mermaid are shown.</p>'
    return `
<section class="comparison-case${beautiful.supported ? '' : ' comparison-case-omits-beautiful'}" id="${escapeAttr(c.id)}" aria-labelledby="comparison-${escapeAttr(c.id)}-title" data-comparison-editor-href="${escapeAttr(comparisonEditorHref(c.source))}">
  <header class="comparison-case-head">
    <h2 id="comparison-${escapeAttr(c.id)}-title">${escapeHtml(c.family)}</h2>
    <button class="comparison-open" type="button" data-comparison-open>Open larger comparison</button>
  </header>
  <p class="comparison-takeaway"><strong>Review focus.</strong> ${escapeHtml(takeaway)}</p>${note}
  <div class="comparison-grid" data-comparison-lightbox-panel>
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
${comparisonStyleSupportHtml()}
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
  // Render panels one at a time as they approach the viewport, yielding
  // between panels. The previous idle-callback batch parsed the 3.5MB runtime
  // and rendered all 12 panels in one synchronous task (~7.6s of main-thread
  // block at 6x CPU throttle) for every visitor, scrolled or not.
  var initialized = false;
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) return;
    draining = true;
    loadMermaidRuntime().then(function (mermaid) {
      if (!mermaid) { draining = false; return; }
      if (!initialized) {
        initialized = true;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', deterministicIds: true, deterministicIDSeed: 'agentic-mermaid-comparisons', theme: 'base', themeVariables: { fontFamily: 'Avenir Next, Segoe UI, system-ui, sans-serif' } });
      }
      function step() {
        var panel = queue.shift();
        if (!panel) { draining = false; return; }
        mermaid.run({ nodes: [panel] }).catch(function () {}).then(function () {
          setTimeout(step, 0);
        });
      }
      step();
    }).catch(function () { draining = false; });
  }
  function enqueue(panel) {
    if (panel.getAttribute('data-mermaid-queued')) return;
    panel.setAttribute('data-mermaid-queued', '1');
    queue.push(panel);
    drainQueue();
  }
  var panels = Array.prototype.slice.call(document.querySelectorAll('.comparison-mermaid'));
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        enqueue(entry.target);
      });
    }, { rootMargin: '500px 0px' });
    panels.forEach(function (panel) { observer.observe(panel); });
  } else {
    panels.forEach(enqueue);
  }
  // The lightbox clones a section's grid; make sure its live panels are queued
  // even if the observer has not reached them yet.
  document.addEventListener('am:render-comparison-panels', function (event) {
    var scope = event.target && event.target.querySelectorAll ? event.target : document;
    Array.prototype.slice.call(scope.querySelectorAll('.comparison-mermaid')).forEach(enqueue);
  });
})();
(function () {
  var dialog = document.querySelector('[data-comparison-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var body = dialog.querySelector('[data-comparison-dialog-body]');
  var title = dialog.querySelector('#comparison-dialog-title');
  var note = dialog.querySelector('[data-comparison-dialog-note]');
  var current = null;
  var ENGINES = {
    agentic: 'Agentic Mermaid',
    mermaid: 'Mermaid',
    beautiful: 'Beautiful Mermaid'
  };
  var PAIRS = [
    { value: 'agentic-mermaid', label: 'AM vs Mermaid', engines: ['agentic', 'mermaid'] },
    { value: 'agentic-beautiful', label: 'AM vs BM', engines: ['agentic', 'beautiful'] },
    { value: 'mermaid-beautiful', label: 'Mermaid vs BM', engines: ['mermaid', 'beautiful'] }
  ];
  function makeButton(text, attrs) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    Object.keys(attrs || {}).forEach(function (key) { button.setAttribute(key, attrs[key]); });
    return button;
  }
  function buildControls() {
    var controls = document.createElement('div');
    controls.className = 'comparison-detail-controls';

    var pairField = document.createElement('fieldset');
    pairField.className = 'comparison-pair-control';
    var legend = document.createElement('legend');
    legend.textContent = 'Pair';
    pairField.appendChild(legend);
    var pairOptions = document.createElement('div');
    pairOptions.className = 'comparison-pair-options';
    PAIRS.forEach(function (pair) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'comparison-pair';
      input.value = pair.value;
      label.appendChild(input);
      var span = document.createElement('span');
      span.textContent = pair.label;
      label.appendChild(span);
      pairOptions.appendChild(label);
    });
    pairField.appendChild(pairOptions);

    var tabs = document.createElement('div');
    tabs.className = 'comparison-detail-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Detail view');
    tabs.appendChild(makeButton('Side by side', { role: 'tab', 'aria-selected': 'true', 'data-detail-tab': 'compare' }));
    tabs.appendChild(makeButton('First', { role: 'tab', 'aria-selected': 'false', 'data-detail-tab': 'first' }));
    tabs.appendChild(makeButton('Second', { role: 'tab', 'aria-selected': 'false', 'data-detail-tab': 'second' }));

    var zoom = document.createElement('div');
    zoom.className = 'comparison-zoom-control';
    var zoomLabel = document.createElement('label');
    zoomLabel.setAttribute('for', 'comparison-detail-zoom');
    zoomLabel.textContent = 'Zoom';
    var zoomRow = document.createElement('div');
    zoomRow.className = 'comparison-zoom-row';
    zoomRow.appendChild(makeButton('-', { 'aria-label': 'Zoom out', 'data-zoom-step': '-0.25' }));
    var zoomInput = document.createElement('input');
    zoomInput.id = 'comparison-detail-zoom';
    zoomInput.type = 'range';
    zoomInput.min = '0.5';
    zoomInput.max = '3';
    zoomInput.step = '0.25';
    zoomInput.value = '1';
    zoomInput.setAttribute('data-comparison-zoom', '');
    zoomRow.appendChild(zoomInput);
    zoomRow.appendChild(makeButton('+', { 'aria-label': 'Zoom in', 'data-zoom-step': '0.25' }));
    var zoomValue = document.createElement('span');
    zoomValue.className = 'comparison-zoom-value';
    zoomValue.setAttribute('data-comparison-zoom-value', '');
    zoomValue.textContent = '100%';
    zoomRow.appendChild(zoomValue);
    zoomRow.appendChild(makeButton('Reset', { 'aria-label': 'Reset zoom', 'data-zoom-reset': '' }));
    zoom.appendChild(zoomLabel);
    zoom.appendChild(zoomRow);

    var sourceTools = document.createElement('div');
    sourceTools.className = 'comparison-source-tools';
    sourceTools.setAttribute('data-comparison-source-tools', '');
    var sourceLink = document.createElement('a');
    sourceLink.className = 'comparison-source-action';
    sourceLink.textContent = 'Open in Editor';
    sourceLink.setAttribute('data-comparison-source-editor', '');
    sourceLink.href = '#';
    sourceTools.appendChild(sourceLink);

    controls.appendChild(pairField);
    controls.appendChild(tabs);
    controls.appendChild(sourceTools);
    controls.appendChild(zoom);
    return controls;
  }
  function panelFor(grid, engine) {
    return grid.querySelector('[data-comparison-engine="' + engine + '"]');
  }
  function pairAvailable(grid, pair) {
    return pair.engines.every(function (engine) { return !!panelFor(grid, engine); });
  }
  function selectedPair(grid, requested) {
    var found = PAIRS.find(function (pair) { return pair.value === requested && pairAvailable(grid, pair); });
    return found || PAIRS.find(function (pair) { return pairAvailable(grid, pair); }) || PAIRS[0];
  }
  function updatePairInputs(controls, grid, activePair) {
    controls.querySelectorAll('input[name="comparison-pair"]').forEach(function (input) {
      var pair = PAIRS.find(function (candidate) { return candidate.value === input.value; });
      var available = !!pair && pairAvailable(grid, pair);
      input.disabled = !available;
      input.checked = activePair.value === input.value;
      input.parentElement.toggleAttribute('data-unavailable', !available);
    });
  }
  function updateTabs(controls, pair, view) {
    controls.querySelectorAll('[data-detail-tab]').forEach(function (tab) {
      var tabView = tab.getAttribute('data-detail-tab');
      if (tabView === 'first') tab.textContent = ENGINES[pair.engines[0]];
      if (tabView === 'second') tab.textContent = ENGINES[pair.engines[1]];
      tab.setAttribute('aria-selected', String(tabView === view));
    });
  }
  function clampZoom(value) {
    var zoom = Number(value);
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(3, Math.max(0.5, Math.round(zoom * 4) / 4));
  }
  function panelAspect(panel) {
    var svg = panel && panel.querySelector('svg');
    if (!svg) return 1;
    var viewBox = svg.getAttribute('viewBox');
    var parts = viewBox ? viewBox.trim().split(/\\s+/).map(Number) : [];
    var width = parts[2];
    var height = parts[3];
    if (width > 0 && height > 0) return width / height;
    var box = svg.getBoundingClientRect();
    return box.height > 0 ? box.width / box.height : 1;
  }
  function fitWidthForPanel(panel) {
    var render = panel && panel.querySelector('.comparison-render');
    var renderBox = render && render.getBoundingClientRect();
    var renderWidth = renderBox ? renderBox.width : 0;
    var renderHeight = renderBox ? renderBox.height : 0;
    if (!renderWidth || !renderHeight) return 100;
    var aspect = panelAspect(panel);
    var singleView = current && current.grid.getAttribute('data-detail-view') !== 'compare';
    var shortLandscape = window.innerHeight < 480 && window.innerWidth > window.innerHeight;
    var minTargetHeight = shortLandscape ? (singleView ? 220 : 160) : (singleView ? 360 : 260);
    var targetHeight = Math.max(minTargetHeight, renderHeight * (singleView ? 0.82 : 0.74));
    var widthPx = targetHeight * aspect;
    return Math.min(6400, Math.max(renderWidth, widthPx));
  }
  function applyZoom() {
    if (!current) return;
    current.zoom = clampZoom(current.zoom);
    var percent = Math.round(current.zoom * 100);
    current.grid.setAttribute('data-comparison-zoom', String(current.zoom));
    current.grid.querySelectorAll('.comparison-panel').forEach(function (panel) {
      var fit = panel.hidden ? 0 : fitWidthForPanel(panel);
      if (fit) panel.style.setProperty('--comparison-panel-zoom-width', Math.round(fit * current.zoom) + 'px');
      else panel.style.removeProperty('--comparison-panel-zoom-width');
    });
    var zoomInput = current.controls.querySelector('[data-comparison-zoom]');
    var zoomValue = current.controls.querySelector('[data-comparison-zoom-value]');
    if (zoomInput) zoomInput.value = String(current.zoom);
    if (zoomValue) zoomValue.textContent = percent + '%';
  }
  function refreshFit() {
    if (!current) return;
    applyZoom();
  }
  function editorHrefForSection(section) {
    return section ? section.getAttribute('data-comparison-editor-href') || '/editor/' : '/editor/';
  }
  function updateSourceControls() {
    if (!current) return;
    var link = current.controls.querySelector('[data-comparison-source-editor]');
    if (link) {
      link.href = current.editorHref || '/editor/';
      link.setAttribute('aria-label', 'Open ' + current.family + ' Mermaid source in the editor');
    }
  }
  function applyDetailState() {
    if (!current) return;
    current.pair = selectedPair(current.grid, current.pair && current.pair.value);
    current.view = current.view || 'compare';
    updatePairInputs(current.controls, current.grid, current.pair);
    updateTabs(current.controls, current.pair, current.view);
    current.grid.setAttribute('data-comparison-pair', current.pair.value);
    current.grid.setAttribute('data-detail-view', current.view);
    current.grid.querySelectorAll('.comparison-panel').forEach(function (panel) {
      var engine = panel.getAttribute('data-comparison-engine');
      var slot = current.pair.engines.indexOf(engine);
      var visible = slot !== -1 && (current.view === 'compare' || (current.view === 'first' && slot === 0) || (current.view === 'second' && slot === 1));
      panel.hidden = !visible;
      if (slot === 0) panel.setAttribute('data-comparison-slot', 'first');
      else if (slot === 1) panel.setAttribute('data-comparison-slot', 'second');
      else panel.removeAttribute('data-comparison-slot');
    });
    applyZoom();
  }
  function resetGrid(grid) {
    grid.removeAttribute('data-comparison-pair');
    grid.removeAttribute('data-detail-view');
    grid.removeAttribute('data-comparison-zoom');
    grid.querySelectorAll('.comparison-panel').forEach(function (panel) {
      panel.hidden = false;
      panel.removeAttribute('data-comparison-slot');
      panel.style.removeProperty('--comparison-panel-zoom-width');
    });
  }
  function lightboxOpenLabel(group) {
    var section = group.closest('.comparison-case');
    var family = section && section.querySelector('h2') ? section.querySelector('h2').textContent : 'comparison';
    return 'Open ' + family + ' comparison lightbox';
  }
  function setLightboxTriggers(section, enabled) {
    if (!section) return;
    var group = section.querySelector('[data-comparison-lightbox-panel]');
    if (!group) return;
    // Pointer-only affordance: role="button" on the grid put headings and
    // rendered diagrams inside a button accname (WCAG nesting violation).
    // Keyboard and AT users open the dialog via the real "Open larger
    // comparison" button each section already carries.
    if (enabled) {
      group.setAttribute('data-comparison-clickable', '1');
    } else {
      group.removeAttribute('data-comparison-clickable');
    }
  }
  function restore() {
    if (!current) return;
    document.documentElement.style.overflow = current.previousOverflow || '';
    resetGrid(current.grid);
    body.textContent = '';
    current.marker.parentNode.replaceChild(current.grid, current.marker);
    setLightboxTriggers(current.section, true);
    current = null;
  }
  function openComparison(section) {
    restore();
    var grid = section && section.querySelector('.comparison-grid');
    if (!section || !grid || !body) return;
    section.dispatchEvent(new CustomEvent('am:render-comparison-panels', { bubbles: true }));
    setLightboxTriggers(section, false);
    var marker = document.createComment('comparison-grid');
    grid.parentNode.insertBefore(marker, grid);
    var controls = buildControls();
    body.appendChild(controls);
    body.appendChild(grid);
    var family = section.querySelector('h2').textContent;
    title.textContent = family;
    var noteText = section.querySelector('.comparison-note')?.textContent || section.querySelector('.comparison-takeaway')?.textContent || '';
    note.textContent = noteText;
    note.hidden = !noteText;
    current = { section: section, grid: grid, marker: marker, controls: controls, family: family, editorHref: editorHrefForSection(section), pair: null, view: 'compare', zoom: 1, previousOverflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    controls.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.matches || !target.matches('[data-comparison-zoom]')) return;
      current.zoom = clampZoom(target.value);
      applyZoom();
    });
    controls.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || target.name !== 'comparison-pair') return;
      current.pair = selectedPair(current.grid, target.value);
      current.view = 'compare';
      current.zoom = 1;
      applyDetailState();
    });
    controls.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var zoomStep = target.closest('[data-zoom-step]');
      if (zoomStep) {
        current.zoom = clampZoom((current.zoom || 1) + Number(zoomStep.getAttribute('data-zoom-step')));
        applyZoom();
        return;
      }
      var zoomReset = target.closest('[data-zoom-reset]');
      if (zoomReset) {
        current.zoom = 1;
        refreshFit();
        return;
      }
      var tab = target.closest('[data-detail-tab]');
      if (!tab) return;
      current.view = tab.getAttribute('data-detail-tab') || 'compare';
      applyDetailState();
    });
    dialog.showModal();
    updateSourceControls();
    applyDetailState();
    setTimeout(refreshFit, 80);
    setTimeout(refreshFit, 400);
    setTimeout(refreshFit, 1200);
  }
  document.querySelectorAll('.comparison-case').forEach(function (section) {
    setLightboxTriggers(section, true);
  });
  document.querySelectorAll('[data-comparison-open]').forEach(function (button) {
    button.addEventListener('click', function () {
      openComparison(button.closest('.comparison-case'));
    });
  });
  document.querySelectorAll('[data-comparison-lightbox-panel]').forEach(function (group) {
    group.addEventListener('click', function () {
      if (group.closest('[data-comparison-dialog]')) return;
      openComparison(group.closest('.comparison-case'));
    });
    group.addEventListener('keydown', function (event) {
      if (group.closest('[data-comparison-dialog]')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openComparison(group.closest('.comparison-case'));
    });
  });
  window.addEventListener('resize', refreshFit);
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
// #9 — single source of truth for the parse->serialize loop in the docs manual.
// The homepage now leads with the creator workflow (prompt, style, verify), while
// the manual keeps the lower-level typed-edit sequence in sync from here.
const LOOP_STEPS = [
  { label: 'Parse', short: 'Read the source into a typed model; unmodeled syntax round-trips as preserved source.' },
  { label: 'Narrow', short: 'Resolve the one node or edge the edit touches via the matching family surface (<code>asFlowchart</code>, <code>asSequence</code>, …).' },
  { label: 'Mutate', short: 'Change the requested node, edge, task, relation, or event while preserving unmodeled syntax.' },
  { label: 'Verify', short: 'Read structural, geometric, and lint warnings before serializing or rendering artifacts.' },
  { label: 'Serialize', short: 'Write the typed model back to Mermaid source, then render only when an artifact is needed.' },
] as const
function injectLoopHeadings(html: string) {
  return LOOP_STEPS.reduce((h, s, i) => h.replace(new RegExp(`<h2>${i + 1} &middot; [^<]*</h2>`), `<h2>${i + 1} &middot; ${s.label}</h2>`), html)
}
// One canonical docs index. Generated docs pages append it (as `docsIndex`,
// with a leading rule) and the docs article gets it injected at build time —
// same single-source pattern as the loop rail — so the source page's
// hand-baked list can never drift from the pages that actually ship.
const docsIndexBody = '<h2>Docs index</h2><ul class="doc-index doc-index-grouped"><li><strong>Start</strong><ul><li><a href="/docs/getting-started/">Getting started</a></li><li><a href="/examples/">Examples</a></li></ul></li><li><strong>Use locally</strong><ul><li><a href="/docs/api/">Library API</a></li><li><a href="/docs/cli/">CLI</a></li><li><a href="/docs/mcp/">MCP</a></li></ul></li><li><strong>Debug</strong><ul><li><a href="/warnings/">Warnings</a></li><li><a href="/errors/">Errors</a></li><li><a href="/docs/quality/">Quality</a></li></ul></li><li><strong>Reference</strong><ul><li><a href="/docs/ascii/">ASCII and Unicode</a></li><li><a href="/docs/theming/">Styles and palettes</a></li><li><a href="/docs/custom-styles/">Custom styles</a></li><li><a href="/docs/fork-differences/">Fork differences</a></li></ul></li></ul>'
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
// artwork, never this shell"). Bake the terracotta diagram ink while using the
// shell ground for transparent label halos.
const workflowPaperSvg = addWorkflowSvgA11y(renderMermaidSVG(workflowSource,
  { bg: '#F8F4F0', fg: '#221E16', accent: '#9A4A24', transparent: true, security: 'strict', embedFontImport: false }))
// Hero: the headline claim is "beautiful diagrams", so the first thing on the
// page is a realistic diagram rendered beautifully — one source, three style
// stacks, switchable chips (theme.js initTabs provides the tab behavior; the
// markup reads stacked without JS). The plain shell-palette workflow diagram
// moved down to the quick-start section where "here's the loop" is the message.
const HERO_SOURCE = `flowchart LR
  subgraph client[Client]
    UI[Web app] --> GW[API gateway]
  end
  subgraph services[Services]
    GW --> Auth[Auth]
    GW --> Cat[Catalog]
    GW --> Ord[Orders]
    Ord --> Q[Queue]
    Q --> W[Fulfilment worker]
  end
  subgraph data[Data]
    Auth --> S[(Sessions)]
    Cat --> C[(Cache)]
    Cat --> DB[(Postgres)]
    Ord --> DB
    W --> DB
  end`
// Gallery slides: the first three cycle ONE source (the checkout architecture)
// through three style stacks — flipping between them shows layout invariance —
// then six pre-chosen family showcases reuse the same curated pairs the
// Examples page renders (STYLE_THEME_PAIR_BY_FAMILY), so "prettiest combo per
// family" has exactly one home. No autoplay: a click (or arrow key) advances.
const HERO_GALLERY_FAMILIES = ['class', 'er', 'timeline', 'journey', 'gantt', 'quadrant'] as const
function heroGallerySlides() {
  const heroStacks = [
    { look: 'watercolor', theme: 'paper', seed: 4 },
    { look: 'publication-figure', theme: 'github-light', seed: 0 },
    { look: 'ops-schematic', theme: 'tokyo-night', seed: 8 },
  ]
  const sameSource = heroStacks.map((stack, i) => ({
    key: `arch-${stack.look}`,
    source: HERO_SOURCE,
    subject: 'Checkout service — same source as the previous slide',
    subjectShort: 'Flowchart',
    ...stack,
  }))
  const showcases = styleThemeExamples(EDITOR_EXAMPLES)
    .filter((combo) => (HERO_GALLERY_FAMILIES as readonly string[]).includes(combo.family.id))
    .map((combo) => ({
      key: `family-${combo.family.id}`,
      source: String(combo.example.source),
      subject: `${combo.family.editorDiagramType} — ${String(combo.example.label ?? combo.example.id)}`,
      subjectShort: String(combo.family.editorDiagramType),
      look: combo.look,
      theme: combo.theme,
      seed: combo.seed,
    }))
  return [...sameSource, ...showcases]
}
function heroStyleFigureHtml() {
  const slides = heroGallerySlides()
  const panels = slides.map((slide, i) => {
    const svg = addSvgAccessibleName(
      renderMermaidSVG(slide.source, {
        style: [slide.look, slide.theme], seed: slide.seed,
        security: 'strict', compact: true, embedFontImport: false, idPrefix: `hero-${slide.key}-`,
      }).replace(/[ \t]+$/gm, ''),
      `hero-${slide.key}`,
      `${slide.subjectShort} in ${displayStyleName(slide.look)} and ${displayStyleName(slide.theme)}`,
      `Build-time render: ${slide.subject}, style ${slide.look}, palette ${slide.theme}, seed ${slide.seed}.`,
    )
    const label = `${slide.look} · ${slide.theme}`
    return `<div class="gallery-panel hero-style-panel" data-gallery-panel data-gallery-label="${escapeAttr(`${label} — ${slide.subjectShort}`)}" data-gallery-editor="${escapeAttr(editorStateHref({ source: slide.source, style: slide.look, theme: slide.theme, seed: slide.seed }))}"${i === 0 ? '' : ' hidden'}>
      <p class="meta-label gallery-panel-label">${escapeHtml(`${label} — ${slide.subjectShort}`)}</p>
      <div class="plate dia-plate hero-plate">${svg}</div>
    </div>`
  }).join('\n')
  const firstLabel = `${slides[0]!.look} · ${slides[0]!.theme} — ${slides[0]!.subjectShort}`
  return `<figure class="hero-style-figure">
    <div class="hero-style-card" data-gallery>
      <div class="gallery-bar">
        <button type="button" class="gallery-nav" data-gallery-prev aria-label="Previous style combination">‹</button>
        <p class="gallery-status"><span data-gallery-status aria-live="polite">${escapeHtml(firstLabel)} (1/${slides.length})</span></p>
        <button type="button" class="gallery-nav" data-gallery-next aria-label="Next style combination">›</button>
        <a class="go gallery-editor-link" data-gallery-editor-link href="${escapeAttr(editorStateHref({ source: slides[0]!.source, style: slides[0]!.look, theme: slides[0]!.theme, seed: slides[0]!.seed }))}">Open in editor</a>
      </div>
      ${panels}
    </div>
    <figcaption>${slides.length} pre-chosen style × palette × family combinations, drawn at build time by the same renderer your agent calls. Slides 1–3 are one identical source — the layout never moves; only style and palette change.</figcaption>
  </figure>`
}
function injectHeroStyleFigure(html: string) {
  return html.replace('{{HERO_STYLE_FIGURE}}', heroStyleFigureHtml())
}
// Fact-strip counts derived from the registries so the published numbers cannot
// drift (the strip previously hard-coded "21 palettes" against 20 real ones).
const STYLE_LOOK_COUNT = knownStyles().filter((name) => name !== 'crisp' && styleKind(getStyle(name)!) === 'look').length
const STYLE_THEME_COUNT = knownStyles().filter((name) => name !== 'crisp' && styleKind(getStyle(name)!) === 'theme').length
// Human-readable reference for the product's headline feature: every style and
// palette, with both the display name (what the editor menus show) and the API
// id (what docs, CLI, and render options take) — the two vocabularies had no
// visible mapping anywhere. Generated from the registry so it cannot drift.
function themingReferenceHtml() {
  const looks = knownStyles().filter((n) => n !== 'crisp' && styleKind(getStyle(n)!) === 'look')
  const themes = knownStyles().filter((n) => n !== 'crisp' && styleKind(getStyle(n)!) === 'theme')
  const lookRows = looks.map((n) => `<tr><td>${escapeHtml(displayStyleName(n))}</td><td><code>${escapeHtml(n)}</code></td><td>${escapeHtml(getStyle(n)!.blurb ?? '')}</td></tr>`).join('')
  const themeCells = themes.map((n) => `<li><code>${escapeHtml(n)}</code></li>`).join('')
  return `<h2>Built-in styles</h2>
<p>The editor menus show the display name; render options, the CLI, and MCP tools take the <code>id</code>. Stack a style with a palette: <code>--style ${escapeHtml(looks[0] ?? 'watercolor')},${escapeHtml(themes[0] ?? 'paper')}</code>.</p>
<table class="warning-table styles-table"><thead><tr><th>Name</th><th>id</th><th>Best for</th></tr></thead><tbody>${lookRows}</tbody></table>
<h2>Palettes</h2>
<p>A palette is a colors-only style: pass its id alone for recoloring, or after a style id to recolor that style.</p>
<ul class="palette-list">${themeCells}</ul>`
}
function injectFactStrip(html: string) {
  return html
    .replaceAll('{{FACT_FAMILIES}}', String(BUILTIN_FAMILY_METADATA.length))
    .replaceAll('{{FACT_STYLES}}', String(STYLE_LOOK_COUNT))
    .replaceAll('{{FACT_PALETTES}}', String(STYLE_THEME_COUNT))
    .replaceAll('{{FACT_OUTPUTS}}', String(rawCapabilities.outputFormats.length))
}
// Quick-start figure: the shell-palette edit-loop diagram, small, where the
// loop is being explained (formerly the hero).
function workflowFigureHtml() {
  return `<figure class="workflow-figure">
    <div class="plate dia-plate">${workflowPaperSvg}</div>
    <figcaption>The loop the agent runs: parse, narrow, mutate, verify, serialize.</figcaption>
  </figure>`
}
const HOME_STYLE_SHOWCASE_SOURCE = `flowchart TD
  PR[Pull request] --> CI{CI green?}
  CI -- yes --> Stage[Deploy to staging]
  CI -- no --> Fix[Agent fixes tests]
  Fix --> PR
  Stage --> QA[Smoke checks]
  QA --> Prod[Release]`
const HOME_STYLE_SHOWCASE_COMBOS = [
  { label: 'Sketch note', look: 'watercolor', theme: 'paper', seed: 4, blurb: 'For whiteboards, docs drafts, and agent working notes.' },
  { label: 'Report figure', look: 'publication-figure', theme: 'github-light', seed: 0, blurb: 'For specs, READMEs, and reviewable product documents.' },
  { label: 'Ops map', look: 'ops-schematic', theme: 'nord-light', seed: 8, blurb: 'For traces, runbooks, and compact engineering diagrams.' },
] as const
function renderHomeStyleShowcaseSvg(combo: (typeof HOME_STYLE_SHOWCASE_COMBOS)[number]) {
  const svg = renderMermaidSVG(HOME_STYLE_SHOWCASE_SOURCE, {
    style: [combo.look, combo.theme],
    seed: combo.seed,
    security: 'strict',
    compact: true,
    embedFontImport: false,
    idPrefix: `home-style-${combo.look}-`,
  }).replace(/[ \t]+$/gm, '')
  return addSvgAccessibleName(
    svg,
    `home-style-${combo.look}`,
    `${combo.label} diagram in ${displayStyleName(combo.look)} and ${displayStyleName(combo.theme)}`,
    `The same Mermaid source rendered with ${combo.look}, ${combo.theme}, and seed ${combo.seed}.`,
  )
}
function homeStyleShowcaseHtml() {
  return `<div class="home-style-showcase-grid">
${HOME_STYLE_SHOWCASE_COMBOS.map((combo) => {
  return `<article class="home-style-card">
  <div class="home-style-render">${renderHomeStyleShowcaseSvg(combo)}</div>
  <div class="home-style-card-body">
    <h3>${escapeHtml(combo.label)}</h3>
    <p>${escapeHtml(combo.blurb)}</p>
    <ul class="home-style-meta" aria-label="${escapeAttr(combo.label)} render options">
      <li><span>Style</span><code>${escapeHtml(combo.look)}</code></li>
      <li><span>Palette</span><code>${escapeHtml(combo.theme)}</code></li>
      <li><span>Seed</span><code>${combo.seed}</code></li>
    </ul>
    <a class="go" href="${escapeAttr(editorStateHref({ source: HOME_STYLE_SHOWCASE_SOURCE, style: combo.look, theme: combo.theme, seed: combo.seed }))}">Open this style</a>
  </div>
</article>`
}).join('\n')}
</div>`
}
function injectHomeStyleShowcase(html: string) {
  return html.replace('{{HOME_STYLE_SHOWCASE}}', homeStyleShowcaseHtml())
}
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
  let raw = await readSourcePage(source)
  // Fact tokens live in the head description too, so resolve them before the
  // transforms that lift the description into og:/JSON-LD metadata.
  if (source === 'home.html') raw = injectFactStrip(raw)
  let html = transformHtml(raw, currentHref, routeMap[source])
  // Source pages can carry hand-baked mastheads that predate newer routes.
  // Swap in the one canonical masthead so every shipped page shares one nav.
  html = html.replace(/<header class="masthead">[\s\S]*?<\/header>/, () => mastheadHtml(currentHref))
  // Source pages can carry hand-baked footers that predate the footerless shell.
  html = html.replace(/<footer>[\s\S]*?<\/footer>/, '')
  // The homepage hero is the styled tab figure; its workflow diagram lives in
  // the quick-start section via its own token, so the generic dia-plate swap
  // must not run there (it would clobber the first hero panel).
  if (source !== 'home.html') html = injectWorkflowSvg(html)
  if (source === 'home.html') {
    // The agent pointer (primary CTA) is intentionally a single fetch instruction;
    // start.md stays the canonical protocol instead of being duplicated inline.
    html = html.replace('{{AGENT_POINTER}}', escapeAttr(HOMEPAGE_AGENT_POINTER))
    html = injectHeroStyleFigure(html)
    html = html.replace('{{WORKFLOW_FIGURE}}', workflowFigureHtml())
    html = injectHomeStyleShowcase(html)
    html = injectWorkflowUnicode(html)
  }
  if (source === 'docs-article.html') html = injectDocsIndex(injectLoopHeadings(html))
  await emit(target, html)
}
await emit('editor/index.html', await generateEditorHtml())

// Static assets.
await emitStylesheet()
await emitThemeScript()
for (const asset of ['favicon.svg', 'shader-mark.js']) await copySourceAsset(asset)
for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'og-image.png']) await copyFileFrom(join(ROOT, 'public', asset), asset)
for (const font of HOSTED_FONT_FILES) await copyFileFrom(join(ROOT, 'assets', 'fonts', font), `fonts/${font}`)
for (const name of SUBSET_FONT_FILES) await copyFileFrom(join(SOURCE_ASSETS, 'fonts', `${name}.subset.woff2`), `fonts/${name}.subset.woff2`)
await copyDir(SOURCE_DIAGRAMS, 'diagrams')
await copyFileFrom(join(ROOT, 'docs', 'schemas', 'style-spec.schema.json'), 'schemas/style-spec.schema.json')
await copyDir(join(ROOT, 'docs', 'assets', 'style-cookbook'), 'docs/assets/style-cookbook')
await copyDir(join(ROOT, 'examples', 'styles'), 'examples/styles')
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
      docs: `/examples/#${family.id}`,
    }
  }),
  richExamples: RICH_EXAMPLES.map((sample, index) => ({
    id: richExampleId(sample, index),
    category: sample.category ?? 'Examples',
    title: sample.title,
    description: sample.description,
    source: String(sample.source ?? '').trim(),
    options: sample.options ?? {},
    renderUrl: `/examples/#${richExampleId(sample, index)}`,
    editorUrl: editorStateHref({ source: sample.source, config: sample.options ?? {} }),
  })),
}
await emitJson('examples/index.json', examples)

function compactToolDescription(description: string) {
  const text = description.split('SDK declaration:')[0]!.replace(/\s+/g, ' ').trim()
  return text.length > 700 ? text.slice(0, 697) + '...' : text
}

function parametersFromSchema(schema: Record<string, unknown>) {
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  return Object.fromEntries(Object.entries(properties).map(([name, shape]) => [
    name,
    { ...shape, required: required.has(name) },
  ]))
}

const hostedToolCards = HOSTED_TOOLS.map((tool) => ({
  name: tool.name,
  description: compactToolDescription(tool.description),
  annotations: tool.annotations,
  inputSchema: tool.inputSchema,
  parameters: parametersFromSchema(tool.inputSchema),
}))

const mcpServerCard = {
  name: HOSTED_MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  kind: 'product',
  displayName: 'Agentic Mermaid MCP',
  description: 'Render, verify, describe, mutate, and build Mermaid diagrams through a stateless Streamable HTTP MCP server.',
  icon: `${siteOrigin}/favicon.svg`,
  url: `${siteOrigin}/mcp`,
  serverUrl: `${siteOrigin}/mcp`,
  wellKnownUrl: `${siteOrigin}/.well-known/mcp`,
  transport: 'streamable-http',
  protocolVersions: ['2024-11-05', '2025-03-26', '2025-06-18'],
  instructions: 'Use Agentic Mermaid for Mermaid diagram workflows. Prefer verify, describe, render_svg, render_ascii, render_png, mutate, and build for direct work; reserve execute for synchronous Code Mode logic that the declarative tools do not express.',
  capabilities: {
    tools: true,
    resources: false,
  },
  tools: hostedToolCards,
  links: {
    homepage: `${siteOrigin}/`,
    llms: `${siteOrigin}/llms.txt`,
    documentation: `${siteOrigin}/docs/mcp/`,
    capabilities: `${siteOrigin}/capabilities.json`,
    examples: `${siteOrigin}/examples/index.json`,
    repository: 'https://github.com/adewale/agentic-mermaid',
  },
  generatedFrom,
}

const mcpManifest = {
  name: HOSTED_MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  kind: 'product',
  description: mcpServerCard.description,
  icon: mcpServerCard.icon,
  url: mcpServerCard.url,
  serverUrl: mcpServerCard.serverUrl,
  transport: mcpServerCard.transport,
  capabilities: mcpServerCard.capabilities,
  tools: hostedToolCards.map(({ inputSchema: _inputSchema, ...tool }) => tool),
  generatedFrom,
}

const aiCatalog = {
  specVersion: '1.0',
  host: {
    displayName: 'Agentic Mermaid',
    identifier: 'did:web:agentic-mermaid.dev',
    documentationUrl: `${siteOrigin}/docs/`,
  },
  entries: [
    {
      identifier: 'urn:air:agentic-mermaid.dev:mcp:agentic-mermaid',
      displayName: 'Agentic Mermaid hosted MCP server',
      type: 'application/mcp-server-card+json',
      url: `${siteOrigin}/.well-known/mcp/server-card.json`,
      description: mcpServerCard.description,
      tags: ['mermaid', 'diagramming', 'mcp', 'rendering', 'verification', 'agents'],
      capabilities: hostedToolCards.map(tool => tool.name),
      representativeQueries: [
        'verify this Mermaid diagram',
        'render this diagram to SVG',
        'add an edge to this flowchart and verify it',
        'build a Mermaid sequence diagram from structured operations',
      ],
      trustManifest: {
        identity: 'did:web:agentic-mermaid.dev',
        identityType: 'did',
      },
    },
    {
      identifier: 'urn:air:agentic-mermaid.dev:llms',
      displayName: 'Agentic Mermaid llms.txt',
      type: 'text/markdown',
      url: `${siteOrigin}/llms.txt`,
      description: 'Navigation index for agents using Agentic Mermaid.',
      tags: ['llms.txt', 'agent-docs', 'mermaid'],
      representativeQueries: ['how should an agent use Agentic Mermaid'],
      trustManifest: {
        identity: 'did:web:agentic-mermaid.dev',
        identityType: 'did',
      },
    },
    {
      identifier: 'urn:air:agentic-mermaid.dev:skill:diagram-workflow',
      displayName: 'Agentic Mermaid diagram workflow skill',
      type: 'application/ai-skill+md',
      url: `${siteOrigin}/skills/agentic-mermaid-diagram-workflow/SKILL.md`,
      description: 'Progressively disclosed workflow skill for authoring and editing Mermaid diagrams with Agentic Mermaid.',
      tags: ['skill', 'mermaid', 'diagram-workflow'],
      representativeQueries: ['create or edit a Mermaid diagram safely'],
      trustManifest: {
        identity: 'did:web:agentic-mermaid.dev',
        identityType: 'did',
      },
    },
  ],
  generatedFrom,
}

await emitJson('.well-known/mcp/server-card.json', mcpServerCard)
await emitJson('.well-known/mcp.json', mcpManifest)
await emitJson('.well-known/ai-catalog.json', aiCatalog)

const skillFiles = ['SKILL.md', 'references/cli.md', 'references/code-mode.md', 'references/flowchart.md', 'references/sequence.md', 'references/timeline.md']
// The deploy ships only the files above, so repo-relative references the bundle
// does not include (references/upstream/*, docs/*) must point at GitHub in the
// served copy — an agent following a served 404 wastes a turn.
const SKILL_REPO_BLOB = 'https://github.com/adewale/agentic-mermaid/blob/main'
function rewriteServedSkillRefs(text: string) {
  return text
    .replaceAll('`references/upstream/gantt.md`', `[references/upstream/gantt.md](${SKILL_REPO_BLOB}/skills/agentic-mermaid-diagram-workflow/references/upstream/gantt.md)`)
    .replaceAll('`docs/agent-api-cookbook.md`', `[docs/agent-api-cookbook.md](${SKILL_REPO_BLOB}/docs/agent-api-cookbook.md)`)
    .replaceAll('`references/upstream/`', `[references/upstream/](${SKILL_REPO_BLOB}/skills/agentic-mermaid-diagram-workflow/references/upstream/)`)
}
for (const file of skillFiles) {
  const text = await Bun.file(join(ROOT, 'skills/agentic-mermaid-diagram-workflow', file)).text()
  await emit(`skills/agentic-mermaid-diagram-workflow/${file}`, file === 'SKILL.md' ? rewriteServedSkillRefs(text) : text)
}

// Public llms.txt must not expose repo-only backlog/eval/contributor surfaces.
const publicLlms = `# Agentic Mermaid

> Agent-native Mermaid runtime: parse, verify, mutate, and render diagrams through a TypeScript library, CLI, self-hosted MCP, or hosted Streamable HTTP MCP. The website is documentation plus a browser-local editor, not a REST render API.

Use Agentic Mermaid when an agent needs to create, edit, verify, describe, or render Mermaid diagrams without depending on a browser. It is strongest for deterministic CI checks, structured diagram edits, read-back of semantic facts, and SVG/PNG/ASCII output from the same source.

Do not use the hosted MCP for private diagrams that must stay local; use the library, CLI, or self-hosted stdio MCP instead. Do not call the website as a REST render API; /mcp speaks MCP JSON-RPC only.

Safe loop:
- Verify before serialize, render, commit, or return.
- For task-critical meaning, read back facts with am describe --format facts, hosted describe format="facts", or checkMermaid.
- Do not fabricate ValidDiagram objects. Parse first.
- Prefer the local library, CLI, or MCP. The hosted /mcp endpoint covers the same core tools with 64KB input caps.
- For straightforward edits, prefer mutate/build over execute. Reserve execute for logic the declarative ops do not express.

Styling: every render accepts style (a renderer treatment like hand-drawn, watercolor, or blueprint; a palette name; an inline JSON record; or a stack merged left-to-right) plus seed to re-roll styled ink. Layout never moves. A colors-only style is a palette.

## Start Here

- [Agent bootstrap](https://agentic-mermaid.dev/start.md): copy-and-follow workflow for one diagram task.
- [Hosted MCP endpoint](https://agentic-mermaid.dev/mcp): stateless Streamable HTTP JSON-RPC with execute, render_svg, render_ascii, render_png, verify, describe, mutate, and build.
- [MCP server card](https://agentic-mermaid.dev/.well-known/mcp/server-card.json): pre-connection metadata for the hosted MCP server.
- [MCP manifest](https://agentic-mermaid.dev/.well-known/mcp.json): compact tool manifest for agents and scanners.
- [AI catalog](https://agentic-mermaid.dev/.well-known/ai-catalog.json): discovery index for the agent-facing resources on this domain.
- [Agent instructions](https://agentic-mermaid.dev/agent-instructions.md): compact operating guide for agents.
- [Capabilities](https://agentic-mermaid.dev/capabilities.json): authoritative family, output, mutation, and warning-code contract.
- [Examples](https://agentic-mermaid.dev/examples/index.json): the same example IDs and sources loaded by the editor.
- [Workflow skill](https://agentic-mermaid.dev/skills/agentic-mermaid-diagram-workflow/SKILL.md): optional skill for skills-capable agents.

## Optional

- [Documentation](https://agentic-mermaid.dev/docs/): human-readable docs for install, CLI, MCP, diagram families, and styling.
- [Editor](https://agentic-mermaid.dev/editor/?empty=1): browser-local editor for interactive diagram authoring.
- [GitHub repository](https://github.com/adewale/agentic-mermaid): source code, issues, and release history.
`;
await emit('llms.txt', publicLlms)
await emit('llms.md', publicLlms)
await emit('.well-known/llms.txt', publicLlms)
await emit('agent-instructions.md', await Bun.file(join(ROOT, 'Instructions_for_agents.md')).text())
await emit('start.md', await Bun.file(join(SOURCE, 'start.md')).text())
await emit('index.md', await Bun.file(join(SOURCE, 'index.md')).text())

// Spec route coverage pages.
const aboutLead = 'Beautiful diagrams, made with your agent. Agentic Mermaid turns Mermaid source into styled SVG, PNG, ASCII, and Unicode, with layout JSON available for tools that need coordinates.'
// About-page diagrams use the shell ground for transparent label halos and the
// terracotta Paper ink for diagram accents. Hex-resolve the tokens so inlined SVG
// never depends on page-level CSS variable inheritance.
const ABOUT_DIAGRAM_THEME = { bg: '#F8F4F0', fg: '#221E16', accent: '#9A4A24' }
function aboutDiagram(source: string, id: string) {
  // Drawn by the engine at build time — a page about a Mermaid renderer, rendered
  // by it. Transparent canvas so the diagram floats on the page; halos resolve to
  // Paper bg and disappear into it.
  const svg = renderMermaidSVG(source, { ...ABOUT_DIAGRAM_THEME, transparent: true, security: 'strict', compact: true, embedFontImport: false, idPrefix: `about-${id}-` })
  return `<figure class="about-diagram">${svg}</figure>`
}
const aboutBody = `
<h2>A diagram should be ready when the agent returns it</h2>
<p>Ask for an architecture map, a launch timeline, or a product flow and the agent should return source you can keep editing plus an artifact you can use. Agentic Mermaid gives that agent the diagram language, style controls, renderer, and verification step in one workflow: SVG or PNG for pages and decks, ASCII or Unicode for text review, and layout JSON when a tool needs coordinates.</p>

<h2>The same source can wear your brand</h2>
<p>Styles are data: a named style, a palette-only style, a JSON record, or a stack of those pieces. Text, nodes, edges, groups, fills, strokes, and typography can follow your house style without touching the diagram's meaning. Render twice and the geometry is byte-identical; change the palette and the boxes stay put.</p>
<pre><code>am render diagram.mmd --format svg > a.svg
am render diagram.mmd --format svg > b.svg
diff a.svg b.svg        # no output: identical bytes, every run, no browser</code></pre>

<h2>Verify before you serialize</h2>
<p><code>verifyMermaid</code> reads a parsed diagram and sorts its warnings into three tiers. Structural warnings mean the diagram is wrong: an edge anchored to nothing (<code>EDGE_MISANCHORED</code>), a node off the canvas (<code>OFF_CANVAS</code>), content that escaped its group (<code>GROUP_BREACH</code>). Geometric warnings mean it reads but the routing is poor: overlapping nodes (<code>NODE_OVERLAP</code>), a path that crosses itself (<code>ROUTE_SELF_CROSS</code>). Lint warnings cover cleanliness and round-trip loss. Every warning carries a stable code and a severity — errors block, warnings come back with <code>ok: true</code> for you to judge — so an agent runs verify the way it runs a test: check, read the code, fix, check again. The editor shows the same three tiers as you type, <code>am verify</code> prints them, and the MCP server returns them.</p>
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

<h2>One source, human artifacts, and tool coordinates</h2>
<p>The same parsed diagram serializes to SVG for a web page, PNG for a deck or document, and ASCII or Unicode for a terminal. The CLI and library can also emit layout JSON — node boxes, edge points, groups, bounds, and optional route certificates — when a test, agent, or integration needs geometry instead of a picture. The text forms are the ones agents actually use: an agent reading a pull request or a CI log sees the diagram as box-drawing characters it can parse, where an image tag would be a dead link. The editor renders the visual and text tabs from the same source in the box on the left.</p>
<pre><code>am render flow.mmd --format svg    > flow.svg
am render flow.mmd --format png    > flow.png
am render flow.mmd --format ascii          # box-drawing, into the terminal</code></pre>

<h2>The loop</h2>
<p>These are one loop. An agent writes or parses the source, narrows it when an edit is typed, applies the requested change, verifies the result, and renders with the chosen style. Because verification runs before rendering, you can ask for a branded diagram without accepting a silent source rewrite.</p>
${aboutDiagram('flowchart LR\n  Parse --> Narrow\n  Narrow --> Mutate\n  Mutate --> Verify\n  Verify -- ok --> Serialize\n  Verify -- warnings --> Narrow', 'loop')}
<p class="muted">The loop itself, drawn by Agentic Mermaid at build time from six lines of Mermaid.</p>

<h2>Where it comes from</h2>
<p><a href="https://mermaid.js.org">Mermaid</a> is the text syntax these diagrams are written in; its own renderer draws them in a browser. Drawing that text without a browser has been tried before — <a href="https://github.com/AlexanderGrooff/mermaid-ascii">mermaid-ascii</a> renders Mermaid graphs as ASCII straight in a terminal. <a href="https://github.com/lukilabs/beautiful-mermaid">Beautiful Mermaid</a>, from the team at Craft, is a zero-dependency TypeScript renderer that outputs both SVG and ASCII, with its ASCII engine ported from mermaid-ascii's Go. Agentic Mermaid forks Beautiful Mermaid and adds the typed editing and deterministic verification above it, so an agent can change a diagram and check it, where the renderers before it could only draw one.</p>
${aboutDiagram('flowchart TD\n  M[Mermaid] --> BM[Beautiful Mermaid]\n  MA[mermaid-ascii] --> BM\n  BM --> AM[Agentic Mermaid]', 'lineage')}

<h2 id="faq">Frequently asked questions</h2>
<dl class="faq-list">
<dt>What is Agentic Mermaid?</dt>
<dd>Agentic Mermaid is an open-source Mermaid runtime for agents. It parses, verifies, mutates, serializes, and renders diagrams without a browser.</dd>
<dt>How should an agent use Agentic Mermaid?</dt>
<dd>Use the local library, CLI, or MCP server. Parse source first, narrow to the diagram family, apply structured mutations when available, verify, then serialize or render.</dd>
<dt>Where is the hosted MCP endpoint?</dt>
<dd>The hosted stateless Streamable HTTP MCP endpoint is <a href="/mcp">https://agentic-mermaid.dev/mcp</a>, with a standard discovery alias at <code>/.well-known/mcp</code>.</dd>
</dl>
`
// Example-jump descriptions. This replaces the removed Diagram families page:
// users choose a concrete example instead of landing on a second reference list.
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
// Number-word for the family count, derived from the registry so published
// prose cannot drift from BUILTIN_FAMILY_METADATA.
const FAMILY_COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const familyCountWord = FAMILY_COUNT_WORDS[BUILTIN_FAMILY_METADATA.length] ?? String(BUILTIN_FAMILY_METADATA.length)
const examplesLead = `${familyCountWord.charAt(0).toUpperCase()}${familyCountWord.slice(1)} diagram families with agent tasks, Style + Palette combinations, and the richer shared examples corpus used by project tooling.`
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
const gettingStartedBody = `<p>Use this page to install the tool and render once yourself. When you hand work to an agent, do not copy a long prompt from this page. Give it three things: your task, the Mermaid source, and one bootstrap line that tells it to fetch the maintained instructions.</p>
<ol class="start-rail">
<li><strong>Install Agentic Mermaid.</strong><p>${escapeHtml(installNotice)}</p><pre><code>${escapeHtml(installCommand)}</code></pre></li>
<li><strong>Create a diagram.</strong><p>This first pass uses source directly. Add <code>--style watercolor</code>, <code>--style blueprint</code>, or a JSON style file when you render.</p><pre><code>cat > diagram.mmd &lt;&lt;'MMD'
flowchart LR
  Idea[Idea] --&gt; Draft[Draft]
  Draft --&gt; Review{Review}
  Review --&gt;|ok| Ship[Ship]
MMD</code></pre></li>
<li><strong>Verify, then render.</strong><pre><code>bun run bin/am.ts verify diagram.mmd --json
bun run bin/am.ts render diagram.mmd --format svg --style publication-figure --output diagram.svg
bun run bin/am.ts render diagram.mmd --format unicode</code></pre></li>
<li><strong>Hand the edit to an agent.</strong><p>Paste the task, paste the Mermaid source, then add this line:</p><pre><code>${escapeHtml(HOMEPAGE_AGENT_POINTER)}</code></pre><p>That line is the only prompt to copy from this page. The fetched file tells the agent how to choose library, CLI, or MCP and verify before returning, so this page does not duplicate the protocol.</p><a class="go" href="/">Copy this line on the homepage</a></li>
<li><strong>Optional: wire MCP.</strong><p>Self-hosting over stdio is the default path; a hosted MCP endpoint is also available at <code>https://agentic-mermaid.dev/mcp</code> (streamable HTTP).</p>
${mcpConfigCardHtml('getting-started')}
<pre><code>bun run bin/agentic-mermaid-mcp.ts</code></pre><p>Use stdio MCP from the cloned repo, or point an MCP client at the hosted endpoint.</p></li>
</ol>
<h2>Agent style/palette recipe</h2>
<p>Keep appearance out of the Mermaid source. Ask the agent to edit structure with typed ops, verify the result, and pass style and palette as render options.</p>
<pre><code>// Library or Code Mode
renderMermaidSVG(source, {
  style: ['ops-schematic', 'nord-light'],
  seed: 0,
  security: 'strict'
})</code></pre>
<pre><code># CLI
bun run bin/am.ts styles --json
bun run bin/am.ts render diagram.mmd --format svg --style ops-schematic,nord-light --output diagram.svg</code></pre>
<pre><code>// Hosted MCP render_svg arguments
{
  "source": "flowchart TD\\n  A --> B",
  "style": ["ops-schematic", "nord-light"],
  "seed": 0
}</code></pre>
<p>A style name chooses stroke, fill, typography, and renderer treatment. A palette-only style such as <code>nord-light</code> supplies colors. In the editor those controls are Style and Palette; in API, CLI, and MCP calls, agents can send the stack directly.</p>
<h2>Vocabulary</h2>
<p>Shared terms for humans and agents, used across these docs.</p>
<dl><dt>narrow</dt><dd>Resolve a parsed diagram to a family-specific typed surface.</dd><dt>verify</dt><dd>Return structural, geometric, and lint warnings before artifacts are trusted.</dd><dt>opaque fallback</dt><dd>Preserve unsupported syntax losslessly when structured mutation is unavailable.</dd></dl>
${docsIndex}`

// /about/design — the design-language reference. Specimens read the live CSS
// tokens (var(--…)) rather than repeating hex, so the page cannot drift from
// the stylesheet it documents; hex appears only as the label under a swatch.
const designLead = 'The tokens, type, and motion the site and editor share — documented with the same variables that render this page. Diagram palettes are deliberately absent: they colour the artwork, never this shell.'
const designBody = `
<h2>Three layers, one seam</h2>
<p>The stylesheet separates <strong>brand</strong> (the mark, the grain, the type — constants no palette may set), <strong>palette</strong> (a <code>--bg</code>/<code>--fg</code>/<code>--accent</code> triplet everything else derives from), and <strong>scheme</strong> (light/dark polarity). The seam means a renderer palette can restyle a diagram plate without touching the logo or the shell — the same isolation the editor uses when its palette dropdown changes render output but never the app chrome.</p>

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
<p>The pine accent carries links, buttons, and focus. It sits in the hue region no diagram palette's accent occupies (the renderer accents cluster warm at 21–58° and cool at 217–318°), so chrome and artwork never read as one palette. The brand chip is its own token pair — <code>--brand-pine</code>/<code>--brand-on</code> — outside the palette layer entirely.</p>
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
<p class="muted">Diagram styles and palettes (hand-drawn, watercolor, paper, dusk, tokyo-night, …) are documented in <a href="/docs/theming/">Styles and palettes</a>; they style rendered diagrams and stay out of this shell by construction.</p>`

const customStylesBody = [
  '<p>Custom styles are plain JSON files passed to <code>--style</code>. Keep them in source control, add a <code>seed</code> when the style uses sketch variation, and validate the file before using it from an untrusted source.</p>',
  '<pre><code>am render diagram.mmd --format png --style examples/styles/transit-route-map.style.json --seed 11 --output diagram.png</code></pre>',
  '<p>Use the public schema at <a href="/schemas/style-spec.schema.json"><code>/schemas/style-spec.schema.json</code></a>. The same file is exported from the npm package as <code>agentic-mermaid/style-spec.schema.json</code>, so editors can map either the hosted URL or the package export.</p>',
  '<h2>Cookbook examples</h2>',
  '<p>The package ships complete JSON files under <code>examples/styles/</code>. These three examples cover the uncovered clusters that work with the current StyleSpec: route-map semantics, retro editorial palettes, and page/backdrop treatments.</p>',
  '<figure><div class="plate"><img src="/docs/assets/style-cookbook/transit-route-map.png" alt="Transit route map custom style screenshot"></div><figcaption><a href="/examples/styles/transit-route-map.style.json"><code>transit-route-map.style.json</code></a> stresses thick connectors, rounded bends, compact station labels, and group labels.</figcaption></figure>',
  '<figure><div class="plate"><img src="/docs/assets/style-cookbook/mid-century-report.png" alt="Mid-century report custom style screenshot"></div><figcaption><a href="/examples/styles/mid-century-report.style.json"><code>mid-century-report.style.json</code></a> uses palette, solid fills, typography, corners, and section bands without a custom renderer.</figcaption></figure>',
  '<figure><div class="plate"><img src="/docs/assets/style-cookbook/star-chart-atlas.png" alt="Star chart atlas custom style screenshot"></div><figcaption><a href="/examples/styles/star-chart-atlas.style.json"><code>star-chart-atlas.style.json</code></a> tests dark-page tokens, grid backdrop, pale strokes, and serif labels.</figcaption></figure>',
  '<h2>Custom fonts</h2>',
  '<p>A Style\'s <code>font</code> field names a CSS family or stack; it does not load a font file. SVG declares the family, while local PNG rendering resolves bundled faces plus caller-provided directories. Use <code>--security strict</code> for an SVG with no external font request, or pass <code>--font-dirs</code> when rendering an unbundled family to PNG.</p>',
  '<pre><code>am render diagram.mmd --format svg --style brand.style.json --security strict --output diagram.svg\nam render diagram.mmd --format png --style brand.style.json --font-dirs ./fonts --output diagram.png</code></pre>',
  '<p>Library callers use <code>renderMermaidPNG(source, { style, fontDirs: [\'./fonts\'] })</code>; <code>loadSystemFonts: true</code> opts into OS-installed faces at the cost of machine-dependent output. MCP <code>render_png</code> tools do not accept font directories, so use the library or CLI when a custom filesystem face is required.</p>',
  '<h2>Validation</h2>',
  '<p>The schema catches file shape in editors. Runtime code should still call <code>validateStyleSpec(json)</code>; the CLI does this for <code>.json</code> files passed through <code>--style</code>.</p>',
].join('\n')

const docPages = [
  ['about/index.html', 'About Agentic Mermaid', aboutLead, aboutBody, '/about/'],
  ['about/design/index.html', 'Design language', designLead, designBody, '/about/'],
  ['docs/getting-started/index.html', 'Getting started', 'From a prompt and style choice to a verified local render, then to an agent-safe edit loop.', gettingStartedBody, '/docs/'],
  ['docs/api/index.html', 'Library API', 'Use agentic-mermaid and agentic-mermaid/agent from local JS or TS.', '<p>Import rendering helpers from <code>agentic-mermaid</code> and typed parse/mutate/verify helpers from <code>agentic-mermaid/agent</code>. Everything runs locally with no network.</p>\n<pre><code>import { renderMermaidSVG, renderMermaidASCII } from \'agentic-mermaid\'\nimport { parseMermaid, verifyMermaid } from \'agentic-mermaid/agent\'\n\nconst src = \'flowchart LR\\n  A[Idea] --&gt; B[Ship]\'\nconst svg = renderMermaidSVG(src)           // also renderMermaidASCII / unicode\nconst { ok, warnings } = verifyMermaid(src) // structured, tiered warnings</code></pre>\n<p>Render helpers return strings (SVG, ASCII, Unicode); the agent surface returns typed diagrams plus structured verify warnings. <strong>In React</strong>, call the same helpers in your component and inject the SVG — private diagrams never leave the browser or your own infrastructure. <strong>Config:</strong> supported Mermaid frontmatter and <code>init</code> directives are normalized before rendering; unsupported syntax is preserved or reported, never silently dropped.</p>' + docsIndex],
  ['docs/cli/index.html', 'CLI', 'Use the am CLI for local rendering, verification, batch checks, and Markdown rendering.', '<p>The <code>am</code> CLI wraps the library for local rendering, verification, and batch checks. In the cloned repo, <code>am</code> is <code>bun run bin/am.ts</code>.</p>\n<pre><code>am verify diagram.mmd                # structural + geometric + lint warnings\nam verify diagram.mmd --json         # machine-readable for agents\nam render diagram.mmd --format svg --output diagram.svg\nam render diagram.mmd --format png --output diagram.png\nam render diagram.mmd --format ascii # or --format unicode</code></pre>\n<p>Prefer <code>--json</code> in agent loops so you can branch on <code>verify.ok</code> and the stable warning codes instead of parsing prose.</p>' + docsIndex],
  ['docs/mcp/index.html', 'MCP', 'Hosted MCP at /mcp, plus a local stdio server.', '<p>The hosted MCP endpoint is <code>https://agentic-mermaid.dev/mcp</code>: stateless streamable HTTP (JSON-RPC over POST, no sessions). Hosted tools: <code>execute</code>, <code>render_svg</code>, <code>render_ascii</code>, <code>render_png</code>, <code>verify</code>, <code>describe</code>, <code>mutate</code>, and <code>build</code>. Pass <code>format: &quot;facts&quot;</code> to <code>describe</code> for deterministic semantic read-back. Deterministic responses are edge-cached, inputs are capped at 64KB, and Code Mode <code>execute</code> runs in an isolated on-demand Worker with network access disabled and a CPU budget.</p><p>The local MCP tools are <code>execute</code>, <code>render_png</code>, and <code>describe</code>. Multi-step parse/narrow/mutate/verify workflows run inside <code>execute(code)</code>; local <code>describe</code> also supports <code>format: &quot;facts&quot;</code>. For file/URL PNG artifacts, diagrams beyond the hosted caps, or offline use, run the stdio server from the repo: <code>bun run bin/agentic-mermaid-mcp.ts</code>.</p><p><strong>Privacy:</strong> every hosted tool call sends your diagram source (or Code Mode code) to this site\u2019s server, and successful responses are edge-cached for up to a day. For diagrams that must not leave your machine, use the library, the CLI, or the local stdio server \u2014 the pipeline is fully local and needs no network.</p><p><strong>Response framing:</strong> the hosted <code>/mcp</code> endpoint always replies with plain <code>application/json</code> \u2014 no SSE <code>data:</code> framing \u2014 so scripts can parse the body directly. The local HTTP transport\u2019s <code>/sse</code> + <code>/message</code> pair delivers responses as SSE events on the open stream; script writers who want unframed JSON should POST to its <code>/rpc</code> endpoint instead.</p>' + docsIndex],
  ['docs/ascii/index.html', 'ASCII and Unicode', 'Text output is first-class for terminals, PR comments, and agent review.', '<p>Text output is first-class, not a fallback: ASCII (portable 7-bit) and Unicode (box-drawing) renders drop straight into terminals, PR comments, commit messages, and agent transcripts where an SVG cannot go.</p>\n<pre><code>am render diagram.mmd --format ascii    # portable, 7-bit\nam render diagram.mmd --format unicode  # sharper box-drawing glyphs</code></pre>\n<p>The text path is deterministic like the SVG path, so the same source always yields the same characters — reviewable in a plain diff. The ASCII engine is ported from mermaid-ascii; see <a href="/about/">About</a> for the lineage.</p>' + docsIndex],
  ['docs/theming/index.html', 'Styles and palettes', 'A style describes diagram rendering; a colors-only style is a palette.', '<p>One primitive covers visual rendering: a <strong>style</strong> is a partial, composable description of palette, typography, stroke character, and fills. A style that only sets colours is a palette. Styles such as <code>hand-drawn</code>, <code>watercolor</code>, and <code>blueprint</code> also change renderer treatment. Styles stack left \u2192 right (<code>{ style: [\'hand-drawn\', \'dracula\'] }</code> gives hand-drawn geometry with the dracula palette), the optional <code>seed</code> re-rolls styled ink without moving layout, and custom styles are plain JSON records. Use <a href="/docs/custom-styles/">Custom styles</a> for schema, complete JSON examples, and screenshots. The browser editor exposes both pickers: Style chooses renderer treatment; Palette chooses colors. SVG output can also inherit CSS variables for live palette swaps.</p>' + themingReferenceHtml() + docsIndex],
  ['docs/custom-styles/index.html', 'Custom styles', 'Author JSON style files, validate them with the schema, and compare cookbook screenshots.', customStylesBody + docsIndex],
  ['docs/quality/index.html', 'Quality', 'Determinism, verify warnings, and layout metrics make diagram edits reviewable.', '<p><code>verify.ok</code> is a gate, not a promise of visual perfection. Include SVG/PNG/ASCII artifacts for human review when the change is visual.</p>\n<p><strong>Warnings are tiered</strong> so an agent knows how to react: <em>structural</em> problems can block a safe return and should be fixed first; <em>geometric</em> warnings ask for visual review; <em>lint</em> warnings mean a smaller or cleaner edit. Every code has a page under <a href="/warnings/">warnings</a> with what triggers it and how to clear it.</p>\n<p><strong>Evidence is curated, not raw private prompts:</strong> rely on CI, deterministic layout metrics, and generated artifacts to review a change. Private eval prompts and holdbacks are not public site content.</p>' + docsIndex],
  ['docs/fork-differences/index.html', 'Fork differences', 'Agentic Mermaid adds styled rendering, typed editing, deterministic verification, CLI, MCP, and more families.', '<p>Agentic Mermaid (<code>agentic-mermaid</code>) forks <a href="https://github.com/lukilabs/beautiful-mermaid">beautiful-mermaid</a> for a job the render-only original did not have: agents creating polished, branded diagrams that stay editable as Mermaid source.</p>\n<ul>\n<li><strong>Typed agent surface.</strong> A render-only library forces an agent to regenerate a whole diagram to change one node. Here new diagrams are authored as source then parsed/verified/rendered, and existing diagrams go parse → narrow → mutate → verify → serialize via <code>agentic-mermaid/agent</code>. All twelve families are structured-when-narrowed; unmodeled syntax still round-trips losslessly as opaque fallback.</li>\n<li><strong>Deterministic, verifiable layout.</strong> Layout is byte-identical across processes, and <code>verifyMermaid</code> returns structured warnings in three tiers (structural, geometric, lint) plus perceptual quality metrics.</li>\n<li><strong>More families.</strong> Adds timeline, journey, architecture, pie, quadrant, and Gantt on top of the upstream six (flowchart, state, sequence, class, ER, and XY chart) — twelve in all.</li>\n<li><strong>Tools.</strong> An <code>am</code> CLI, an <code>agentic-mermaid-mcp</code> Code Mode MCP server (stdio + opt-in HTTP/SSE), and a hosted MCP endpoint at <code>/mcp</code>. There is no REST render API.</li>\n<li><strong>Style + Palette rendering.</strong> Named looks and palette stacks keep appearance outside Mermaid source while preserving deterministic geometry.</li>\n</ul>\n<p>See <a href="/examples/">examples</a> for the family list and rendered source, and <a href="/about/">About</a> for the lineage.</p>' + docsIndex],
  ['examples/index.html', 'Examples', examplesLead, examplesShowcaseHtml(EDITOR_EXAMPLES), '/examples/'],
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
  return `\n<h2>Minimal reproducer</h2>\n<p>This source triggers <code>${code}</code> — checked at build time against the same engine the editor runs.</p>\n<pre><code>${escapeHtml(example)}</code></pre>\n<p><a class="go" href="/editor/#${editorHash}">Open this reproducer in the editor</a></p>`
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
  // `what` is authored as inline HTML for detail bodies; the lead is rendered
  // through pageShell's escapeHtml, so convert to plain Markdown-ish text here
  // or literal <code> tags leak into the page (seen live on LABEL_OVERFLOW).
  const lead = detail
    ? `${w.code} is a ${w.tier} ${sevNoun}: ${inlineHtmlToMarkdown(detail.what)}`
    : `${w.code} is a ${w.tier} ${sevNoun} reported by verify.`
  const demo = detail?.example ? warningDemoHtml(w.code, detail.example) : ''
  if (demo) firingDemos++
  const detailHtml = detail ? `<p><strong>What triggers it.</strong> ${detail.triggers}</p>\n<p><strong>How to fix it.</strong> ${detail.fix}</p>` : ''
  await emitShell(`warnings/${w.code}/index.html`, w.code, lead, `${detailHtml}${demo}
<p>Run <code>am verify diagram.mmd --json</code>, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.</p>
<p class="muted">In the cloned repo, <code>am</code> is <code>bun run bin/am.ts</code>.</p>
<p class="muted">Machine-readable: <a href="/warnings/${w.code}/index.md">this page as Markdown</a>.</p>
<p class="muted">Back to <a href="/warnings/">all warning codes</a>, or <a href="${GENERIC_EDITOR_HREF}">open a blank editor</a> to try a fix.</p>`)
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
<p class="muted">Back to <a href="/errors/">all errors</a>, or <a href="${GENERIC_EDITOR_HREF}">open a blank editor</a> to test a source file.</p>`)
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

// ---- 404 page ---------------------------------------------------------------
// Served by the Static Assets binding for unknown paths (not_found_handling:
// "404-page" in wrangler.jsonc). Emitted as 404.html, which the sitemap filter
// (index.html-only) automatically excludes; noindex belts-and-braces on top.
const notFoundDiagram = addSvgAccessibleName(
  renderMermaidSVG('flowchart LR\n  You[You] --> Nf{404}\n  Nf -- home --> Home[Homepage]\n  Nf -- browse --> Ex[Examples]\n  Nf -- read --> Docs[Docs]', {
    style: ['watercolor', 'paper'], seed: 4, security: 'strict', compact: true, embedFontImport: false, idPrefix: 'notfound-',
  }).replace(/[ \t]+$/gm, ''),
  'notfound', 'Page not found', 'A small flowchart routing you from 404 back to the homepage, examples, or docs.')
await emit('404.html', pageShell(
  'Page not found', 'This path does not exist — the diagram below knows the way out.',
  `<figure><div class="plate dia-plate">${notFoundDiagram}</div></figure>
<ul>
<li><a href="/">Homepage</a> — what Agentic Mermaid is and how agents use it.</li>
<li><a href="/examples/">Examples</a> — every diagram family, styled and plain.</li>
<li><a href="/docs/">Docs</a> — install, render, verify, and edit.</li>
<li><a href="${GENERIC_EDITOR_HREF}">Editor</a> — try a diagram in the browser.</li>
</ul>
<p class="muted">If a link on this site brought you here, <a href="https://github.com/adewale/agentic-mermaid/issues">report it</a> — broken links are bugs.</p>`,
).replace('<meta name="description"', '<meta name="robots" content="noindex">\n<meta name="description"'))

// Shared route manifest: the Worker and the generated _redirects file use the
// same clean-route list. Assert the manifest only names pages that this build
// actually emitted (root index excluded because it has no clean-route redirect).
for (const route of CLEAN_PAGE_ROUTES) {
  if (!generated.has(`${route}/index.html`)) throw new Error(`route manifest names missing page: ${route}/index.html`)
}
const redirectLines = [
  ...staticRedirectLines(),
  ...DYNAMIC_CLEAN_REDIRECT_LINES,
  '',
].join('\n')
await emit('_redirects', redirectLines)

// ---- sitemap.xml -----------------------------------------------------------
// Every page is emitted as <dir>/index.html, so its canonical URL is the clean
// directory path. Derive the sitemap from the `generated` map rather than a
// hand-kept list so new pages are picked up automatically. No <lastmod>: the
// committed build uses buildTime='development', and a per-build timestamp would
// make the bundle non-deterministic and break `website:check`.
const sitemapUrls = [...generated.keys()]
  .filter((rel) => rel === 'index.html' || rel.endsWith('/index.html'))
  .map((rel) => siteOrigin + '/' + rel.replace(/index\.html$/, ''))
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
// isolate, the resvg wasm module, and the bundled PNG fonts. They live under
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

if (!PUBLIC_ONLY) {
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
  const harness = Buffer.from((await harnessBuild.outputs[0]!.text()).replace(/[ \t]+$/gm, ''))
  if (!harness.includes('import("./user.js")')) throw new Error('execute-harness bundle lost the ./user.js import')
  const resvgWasm = Buffer.from(await Bun.file(join(ROOT, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')).arrayBuffer())
  const hostedFonts = await Promise.all(
    HOSTED_FONT_FILES.map(async name => ({
      name,
      bytes: Buffer.from(await Bun.file(join(ROOT, 'assets', 'fonts', name)).arrayBuffer()),
    })),
  )
  await emitWorkerArtifact('execute-harness.js.txt', harness)
  await emitWorkerArtifact('resvg.wasm', resvgWasm)
  for (const font of hostedFonts) await emitWorkerArtifact(font.name, font.bytes)

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
  const deployVersion = computeDeployVersion(packageJson.version, [
    workerJs,
    harness,
    resvgWasm,
    ...hostedFonts.map(font => font.bytes),
    new TextEncoder().encode(compatDate),
  ])
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
  for (const [name, obj] of Object.entries({ capabilities, examples, mcpServerCard, mcpManifest, aiCatalog })) {
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
  console.log(`website/build: wrote ${generated.size} files to website/public${PUBLIC_ONLY ? ' (public only)' : ''}`)
}
