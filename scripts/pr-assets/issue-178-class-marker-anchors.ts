/**
 * Before/after evidence for issue #178 — class endpoint marker anchors.
 *
 * Recreates the four Class cells from PR #172's Section B brand-evidence
 * sheet, rendering the same source and StyleSpec records from the referenced
 * commit and the current tree. Each card includes the full diagram plus a
 * route-derived endpoint crop so the aggregation diamond is inspectable.
 *
 *   bun run scripts/pr-assets/issue-178-class-marker-anchors.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG, type StyleSpec } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = 'a133829d0b03ba2cd2a26f05ae63f483db734aa8'

// Exact Class example used by the Section B sheet at BEFORE_SHA.
const SOURCE = `classDiagram
  class Account {
    +id: string
    +close() void
  }
  Account <|-- Savings
  Account "1" o-- "*" Transaction : logs`

interface Variant {
  readonly slug: string
  readonly title: string
  readonly note: string
  readonly style: StyleSpec
}

interface RenderedVariant {
  readonly full: string
  readonly zoom: string
}

// Exact four StyleSpec records used by PR #172's Section B sheet.
const VARIANTS: readonly Variant[] = [
  {
    slug: 'sentinel',
    title: 'Sentinel · every channel distinctive',
    note: 'Purple high-weight sentinel from the first Section B Class cell.',
    style: {
      colors: { bg: '#fffdf7', fg: '#211a33', line: '#5b21b6', accent: '#be123c', muted: '#675d72', surface: '#f5e9ff', border: '#6d28d9' },
      roles: {
        node: { fontSize: 16, fontWeight: 800, paddingX: 30, paddingY: 16, cornerRadius: 12, lineWidth: 3, fillColor: '#f5e9ff', borderColor: '#6d28d9', textColor: '#211a33' },
        edge: { fontSize: 13, fontWeight: 700, lineWidth: 3, bendRadius: 14, strokeColor: '#5b21b6', textColor: '#211a33' },
        group: { fontSize: 14, fontWeight: 800, paddingX: 26, paddingY: 22, cornerRadius: 12, lineWidth: 2, fillColor: '#fff7ed', borderColor: '#be123c', textColor: '#211a33' },
        label: { fontSize: 14, fontWeight: 700, textColor: '#211a33' },
        'pie-slice': { lineWidth: 3 },
      },
      semanticSlots: { selected: { fillColor: '#fda4af', borderColor: '#881337', lineWidth: 4 } },
      bindings: [{ channel: 'category', value: 'Pro', slot: 'selected', role: 'pie-slice' }],
    },
  },
  {
    slug: 'editorial',
    title: 'Holdout · warm editorial',
    note: 'Warm low-radius editorial holdout from the second Class cell.',
    style: {
      colors: { bg: '#fbf7ef', fg: '#29231f', line: '#5f5148', accent: '#a33b20', muted: '#76685f', surface: '#fffaf0', border: '#77655a' },
      font: 'EB Garamond',
      roles: {
        node: { fontSize: 15, fontWeight: 600, paddingX: 25, paddingY: 13, cornerRadius: 2, lineWidth: 1.2 },
        edge: { fontSize: 12, fontWeight: 600, lineWidth: 1.3, bendRadius: 2 },
        group: { fontSize: 13, fontWeight: 700, letterSpacing: 0.06, paddingX: 23, paddingY: 20, cornerRadius: 2, lineWidth: 1.2 },
        label: { fontSize: 13, fontWeight: 600 },
      },
    },
  },
  {
    slug: 'technical',
    title: 'Holdout · light technical',
    note: 'Cyan square-corner technical holdout from the third Class cell.',
    style: {
      colors: { bg: '#f4fbff', fg: '#102a43', line: '#176b87', accent: '#007f73', muted: '#486581', surface: '#e6f6fb', border: '#2287a5' },
      font: 'IBM Plex Sans',
      roles: {
        node: { fontSize: 14, fontWeight: 700, paddingX: 22, paddingY: 12, cornerRadius: 0, lineWidth: 1.8 },
        edge: { fontSize: 11, fontWeight: 600, lineWidth: 1.8, bendRadius: 0 },
        group: { fontSize: 12, fontWeight: 700, letterSpacing: 0.04, paddingX: 20, paddingY: 18, cornerRadius: 0, lineWidth: 1.5 },
        label: { fontSize: 12, fontWeight: 600 },
      },
    },
  },
  {
    slug: 'operations',
    title: 'Holdout · dark operations',
    note: 'Dark uppercase operations holdout from the fourth Class cell.',
    style: {
      colors: { bg: '#07131d', fg: '#e2f2ff', line: '#54a3c7', accent: '#2dd4bf', muted: '#91afc2', surface: '#102638', border: '#3f7791' },
      font: 'Share Tech Mono',
      roles: {
        node: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', paddingX: 18, paddingY: 10, cornerRadius: 4, lineWidth: 2 },
        edge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', lineWidth: 2, bendRadius: 0 },
        group: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', paddingX: 18, paddingY: 18, cornerRadius: 4, lineWidth: 2 },
        label: { fontSize: 12, fontWeight: 700 },
      },
    },
  },
]

const chromePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/opt/pw-browsers/chromium',
].find(existsSync)

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderCurrent(variant: Variant): RenderedVariant {
  const render = (view: 'full' | 'zoom') => renderMermaidSVG(SOURCE, {
    style: variant.style,
    seed: 17,
    security: 'strict',
    embedFontImport: false,
    idPrefix: `issue178-${variant.slug}-${view}-`,
  })
  return { full: render('full'), zoom: render('zoom') }
}

function renderBefore(): RenderedVariant[] {
  const worktree = join(tmpdir(), `agentic-mermaid-issue178-${Date.now()}`)
  rmSync(worktree, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(worktree, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(worktree, 'issue-178-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      const source = ${JSON.stringify(SOURCE)}
      const variants = ${JSON.stringify(VARIANTS)}
      const render = (variant, view) => renderMermaidSVG(source, {
        style: variant.style,
        seed: 17,
        security: 'strict',
        embedFontImport: false,
        idPrefix: \`issue178-\${variant.slug}-\${view}-\`,
      })
      console.log(JSON.stringify(variants.map(variant => ({
        full: render(variant, 'full'),
        zoom: render(variant, 'zoom'),
      }))))
    `)
    return JSON.parse(execFileSync('bun', ['issue-178-probe.ts'], {
      cwd: worktree,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()) as RenderedVariant[]
  } finally {
    execFileSync('git', ['worktree', 'remove', worktree, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function card(variant: Variant, rendered: RenderedVariant): string {
  return `<section class="card" data-variant="${variant.slug}">
    <h2>${esc(variant.title)}</h2>
    <p class="variant-note">${esc(variant.note)}</p>
    <div class="visuals">
      <figure class="full">
        <figcaption>Full PR #172 Class diagram</figcaption>
        <div class="diagram" style="--diagram-bg:${variant.style.colors?.bg ?? '#fff'}">${rendered.full}</div>
      </figure>
      <figure class="zoom">
        <figcaption>Aggregation endpoint · 4× crop</figcaption>
        <div class="zoom-host" style="--diagram-bg:${variant.style.colors?.bg ?? '#fff'}">${rendered.zoom}</div>
        <p><span class="swatch"></span> routed Account boundary</p>
      </figure>
    </div>
  </section>`
}

function sheet(kind: 'before' | 'after', subtitle: string, cardPngs: readonly string[]): string {
  const cards = cardPngs.map((png, index) =>
    `<img class="card-image" src="data:image/png;base64,${png}" alt="${esc(VARIANTS[index]!.title)} ${kind} evidence">`,
  ).join('')
  return `<article class="sheet ${kind}" data-kind="${kind}">
    <header>
      <h1>${kind.toUpperCase()} — PR #172 Class repros</h1>
      <p>${esc(subtitle)}</p>
      <p>Exact Section B Class source and all four StyleSpec variants from <code>${BEFORE_SHA.slice(0, 8)}</code>.</p>
      <pre>${esc(SOURCE)}</pre>
      <p class="fine">The magenta line is computed from the aggregation route endpoint and tangent. The inheritance triangle is an unchanged control.</p>
    </header>
    <div class="grid">${cards}</div>
  </article>`
}

function documentHtml(content: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #e4e4e7; color: #18181b; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { padding: 24px; width: max-content; }
    .sheet { width: 1460px; padding: 34px 38px 42px; background: #f8fafc; }
    header { padding: 0 8px 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.2; letter-spacing: .01em; }
    .before h1 { color: #9a3412; }
    .after h1 { color: #15803d; }
    p { margin: 6px 0; color: #52525b; font-size: 17px; line-height: 1.35; }
    p.fine { font-size: 15px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { display: inline-block; margin: 14px 0 4px; padding: 12px 16px; border: 1px solid #d4d4d8; border-radius: 8px; background: #fff; font-size: 14px; line-height: 1.35; }
    .grid { display: grid; grid-template-columns: repeat(2, 680px); gap: 22px; }
    .card { width: 680px; min-height: 520px; padding: 20px; border: 2px solid #d4d4d8; border-radius: 16px; background: #fff; }
    .card-image { display: block; width: 680px; height: auto; }
    h2 { margin: 0; font-size: 21px; line-height: 1.2; }
    .variant-note { min-height: 24px; font-size: 14px; }
    .visuals { display: grid; grid-template-columns: 330px 1fr; align-items: center; gap: 18px; margin-top: 14px; }
    figure { margin: 0; }
    figcaption { margin-bottom: 7px; color: #3f3f46; font-size: 13px; font-weight: 750; }
    .diagram, .zoom-host { display: grid; place-items: center; overflow: hidden; border: 1px solid #a1a1aa; background: var(--diagram-bg); }
    .diagram { width: 330px; height: 400px; padding: 8px; }
    .diagram > svg { display: block; width: 100%; max-height: 100%; }
    .zoom-host { width: 280px; height: 220px; }
    .zoom-host > svg { display: block; width: 100%; height: 100%; }
    .zoom p { margin-top: 9px; font-size: 13px; }
    .swatch { display: inline-block; width: 22px; margin-right: 6px; border-top: 3px dashed #c026d3; vertical-align: 4px; }
    .evidence-boundary { stroke: #c026d3; stroke-width: 1.4; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
    .evidence-endpoint { fill: #c026d3; stroke: #fff; stroke-width: .8; vector-effect: non-scaling-stroke; }
  </style>
</head>
<body><main>${content}</main></body>
</html>`
}

mkdirSync(OUT_DIR, { recursive: true })
const before = renderBefore()
const after = VARIANTS.map(renderCurrent)
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu'],
  ...(chromePath ? { executablePath: chromePath } : {}),
})
try {
  for (const [kind, subtitle, svgs] of [
    ['before', `referenced PR #172 evidence at ${BEFORE_SHA.slice(0, 8)} — hollow diamonds overlap Account surfaces`, before],
    ['after', 'this branch — each hollow-diamond tip meets Account while its body remains outside', after],
  ] as const) {
    // Render each variant in a separate document. Current renderer SVGs carry
    // document-level theme variables, so combining variants would let the last
    // style contaminate its siblings and produce false visual evidence.
    const cardPngs: string[] = []
    for (const [index, rendered] of svgs.entries()) {
      const variant = VARIANTS[index]!
      const cardPage = await browser.newPage({ viewport: { width: 730, height: 620 }, deviceScaleFactor: 2 })
      await cardPage.setContent(documentHtml(card(variant, rendered)), { waitUntil: 'load' })
      await cardPage.locator('.card').evaluate(card => {
        const namespace = 'http://www.w3.org/2000/svg'
        const decorate = (root: SVGSVGElement | null, zoom: boolean) => {
          const carrier = [...(root?.querySelectorAll<SVGGeometryElement>('.class-marker-overlay') ?? [])]
            .find(element => element.getAttribute('marker-start')?.includes('cls-aggregation'))
          const routeLength = carrier?.getTotalLength() ?? 0
          const endpoint = carrier?.getPointAtLength(0)
          const following = carrier?.getPointAtLength(Math.min(1, routeLength))
          if (!root || !carrier || !endpoint || !following) {
            const overlays = [...(root?.querySelectorAll<SVGGeometryElement>('.class-marker-overlay') ?? [])]
              .map(element => ({ marker: element.getAttribute('marker-start'), geometry: element.outerHTML }))
            throw new Error(`aggregation marker route endpoint is unavailable: ${JSON.stringify({
              variant: card.getAttribute('data-variant'), zoom, root: Boolean(root), overlays,
            })}`)
          }
          // Marker overlays are emitted at the SVG root, so their geometry is
          // already expressed in root viewBox coordinates.
          const dx = following.x - endpoint.x
          const dy = following.y - endpoint.y
          const length = Math.hypot(dx, dy)
          if (length < 0.001) throw new Error('aggregation route has no endpoint tangent')
          const perpendicular = { x: -dy / length, y: dx / length }
          const guide = document.createElementNS(namespace, 'line')
          guide.setAttribute('class', 'evidence-boundary')
          guide.setAttribute('x1', String(endpoint.x - perpendicular.x * 34))
          guide.setAttribute('y1', String(endpoint.y - perpendicular.y * 34))
          guide.setAttribute('x2', String(endpoint.x + perpendicular.x * 34))
          guide.setAttribute('y2', String(endpoint.y + perpendicular.y * 34))
          const dot = document.createElementNS(namespace, 'circle')
          dot.setAttribute('class', 'evidence-endpoint')
          dot.setAttribute('cx', String(endpoint.x))
          dot.setAttribute('cy', String(endpoint.y))
          dot.setAttribute('r', '1.8')
          root.append(guide, dot)
          if (zoom) {
            root.setAttribute('viewBox', `${endpoint.x - 44} ${endpoint.y - 32} 88 64`)
            root.removeAttribute('width')
            root.removeAttribute('height')
          }
        }
        decorate(card.querySelector<SVGSVGElement>('.diagram > svg'), false)
        decorate(card.querySelector<SVGSVGElement>('.zoom-host > svg'), true)
      })
      const cardPng = await cardPage.locator('.card').screenshot({ animations: 'disabled' })
      cardPngs.push(Buffer.from(cardPng).toString('base64'))
      await cardPage.close()
    }

    const page = await browser.newPage({ viewport: { width: 1520, height: 1700 }, deviceScaleFactor: 2 })
    await page.setContent(documentHtml(sheet(kind, subtitle, cardPngs)), { waitUntil: 'load' })
    const output = join(OUT_DIR, `issue-178-class-marker-anchors-${kind}.png`)
    await page.locator(`[data-kind="${kind}"]`).screenshot({ path: output, animations: 'disabled' })
    await page.close()
    console.log(`wrote docs/pr-assets/${output.split('/').at(-1)} (${Math.round(statSync(output).size / 1024)} KB)`)
  }
} finally {
  await browser.close()
}
