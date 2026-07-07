// Reproducible evidence for the style coverage expansion.
//
//   bun run scripts/pr-assets/style-state-space-evidence.ts
//
// Outputs:
// - docs/pr-assets/new-style-gallery.png
// - docs/pr-assets/new-style-palette-gallery.png
// - docs/pr-assets/style-state-space-before.svg/.png
// - docs/pr-assets/style-state-space-after.svg/.png
// - docs/pr-assets/style-state-space-before-after.png

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  join(ROOT, 'assets', 'fonts', 'Caveat.ttf'),
  join(ROOT, 'assets', 'fonts', 'EBGaramond.ttf'),
  join(ROOT, 'assets', 'fonts', 'ArchitectsDaughter.ttf'),
  join(ROOT, 'assets', 'fonts', 'ShareTechMono.ttf'),
].filter(existsSync)

const NEW_STYLES = [
  { name: 'accessible-high-contrast', label: 'Accessible high contrast', note: 'large labels + heavy strokes' },
  { name: 'print-grayscale', label: 'Print grayscale', note: 'monochrome hachure proof' },
  { name: 'status-dashboard', label: 'Status dashboard', note: 'dark operational modules' },
  { name: 'dense-ops-terminal', label: 'Dense ops terminal', note: 'compact mono dark grid' },
  { name: 'chalkboard', label: 'Chalkboard', note: 'chalk strokes on slate' },
  { name: 'risograph', label: 'Risograph', note: 'two-ink poster hachure' },
  { name: 'vellum-architecture', label: 'Vellum architecture', note: 'technical drafting sheet' },
  { name: 'editorial-report', label: 'Editorial report', note: 'polished report figure' },
] as const

const PALETTE_CASES = [
  { key: 'native', label: 'Native colors', styleOf: (name: string): string | string[] => name },
  { key: 'github-light', label: 'GitHub Light', styleOf: (name: string): string | string[] => [name, 'github-light'] },
  { key: 'dracula', label: 'Dracula', styleOf: (name: string): string | string[] => [name, 'dracula'] },
  { key: 'nord-light', label: 'Nord Light', styleOf: (name: string): string | string[] => [name, 'nord-light'] },
] as const

const SAMPLE = `flowchart LR
  subgraph Platform["Runtime platform"]
    Queue["Ingest queue"] --> Parse["Parse + verify"]
    Parse --> Route{"Route?"}
  end
  Route -- clean --> Ship["Ship artifact"]
  Route -- warnings --> Review["Human review"]
  Review --> Parse
  classDef warning fill:#ffe8a3,stroke:#b45309,color:#431407
  class Review warning`

interface Raster {
  b64: string
  width: number
  height: number
}

interface CoveragePoint {
  key: string
  label: string
  before: number
  after: number
  target: number
  coveredNow: string[]
  missing: string[]
}

const COVERAGE: CoveragePoint[] = [
  {
    key: 'palette',
    label: 'Palette',
    before: 4,
    after: 4,
    target: 4,
    coveredNow: ['21 themes, Shiki extraction, CSS vars,', 'style stacks, explicit overrides.'],
    missing: ['Colorblind packs, status/severity', 'systems, brand-kit templates.'],
  },
  {
    key: 'stroke',
    label: 'Stroke',
    before: 2.7,
    after: 3.2,
    target: 4,
    coveredNow: ['Crisp, jittered rough.js, freehand;', 'new chalk, print, riso, terminal dialects.'],
    missing: ['True chalk/brush/calligraphy', 'and halftone line backends.'],
  },
  {
    key: 'fill',
    label: 'Fill',
    before: 2.6,
    after: 3,
    target: 4,
    coveredNow: ['None, solid, hachure, wash;', 'print/riso styles teach hatch hierarchy.'],
    missing: ['Dot shading, contours, material', 'textures, gradient rules.'],
  },
  {
    key: 'page',
    label: 'Page',
    before: 1.8,
    after: 2.4,
    target: 3.5,
    coveredNow: ['Plain, ruled, grid, transparent;', 'vellum/chalk/ops use page context.'],
    missing: ['Notebook/vellum as real backdrops,', 'print profiles, dark host demos.'],
  },
  {
    key: 'type',
    label: 'Type',
    before: 2.1,
    after: 3.2,
    target: 3.5,
    coveredNow: ['Bundled faces plus density, a11y,', 'terminal, report, and drafting presets.'],
    missing: ['Brand typography recipes and', 'thumbnail-size proof pages.'],
  },
  {
    key: 'semantics',
    label: 'Semantics',
    before: 3,
    after: 3.4,
    target: 4,
    coveredNow: ['text/node/edge/group roles;', 'status-dashboard demonstrates intent.'],
    missing: ['Real subroles for status, ownership,', 'confidence, risk, priority.'],
  },
  {
    key: 'families',
    label: 'Families',
    before: 3.5,
    after: 3.7,
    target: 4,
    coveredNow: ['Styled SceneGraph across 12 families;', 'expanded look matrix is baseline-hashed.'],
    missing: ['Educational look x family x stress', 'fixture gallery for humans.'],
  },
  {
    key: 'medium',
    label: 'Medium',
    before: 2.2,
    after: 2.7,
    target: 3.5,
    coveredNow: ['SVG, PNG, strict security, seeds;', 'new print and dense-display styles.'],
    missing: ['Thumbnail proof, print proof,', 'motion/progressive reveal layer.'],
  },
]

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function rasterize(svg: string, width: number, background = '#f7f3ea'): Raster {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render()
  const png = rendered.asPng()
  return { b64: Buffer.from(png).toString('base64'), width: rendered.width, height: rendered.height }
}

function renderStyleCard(style: (typeof NEW_STYLES)[number], width: number): Raster {
  const svg = inlineFontVarForRaster(renderMermaidSVG(SAMPLE, {
    style: style.name,
    seed: 9,
    embedFontImport: false,
    padding: 26,
  }))
  return rasterize(svg, width)
}

function renderPaletteCard(styleName: string, styleInput: string | string[], width: number): Raster {
  const svg = inlineFontVarForRaster(renderMermaidSVG(SAMPLE, {
    style: styleInput,
    seed: 9,
    embedFontImport: false,
    padding: 22,
  }))
  return rasterize(svg, width)
}

function generateStyleGallery(): void {
  const panelW = 650
  const gutter = 44
  const top = 150
  const labelBlockH = 74
  const cards = NEW_STYLES.map(style => ({ style, img: renderStyleCard(style, panelW) }))
  const rowHeights = [0, 1, 2, 3].map(row => Math.max(cards[row * 2]!.img.height, cards[row * 2 + 1]!.img.height) + labelBlockH + 44)
  const width = panelW * 2 + gutter * 3
  const height = top + rowHeights.reduce((a, b) => a + b, 0) + 36
  const bg = '#f7f3ea'
  const fg = '#211f1b'
  const muted = '#686158'
  let y = top
  let body = ''
  for (let row = 0; row < 4; row++) {
    const rowH = rowHeights[row]!
    for (let col = 0; col < 2; col++) {
      const card = cards[row * 2 + col]!
      const x = gutter + col * (panelW + gutter)
      const imageY = y + labelBlockH
      body += `
        <text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="22" font-weight="700" fill="${fg}">${esc(card.style.label)}</text>
        <text x="${x}" y="${y + 26}" font-family="DejaVu Sans" font-size="15" fill="${muted}">${esc(card.style.name)} - ${esc(card.style.note)}</text>
        <rect x="${x - 12}" y="${imageY - 12}" width="${panelW + 24}" height="${card.img.height + 24}" rx="14" fill="#fffaf1" stroke="#d7cdbd" stroke-width="1.5"/>
        <image x="${x}" y="${imageY}" width="${card.img.width}" height="${card.img.height}" href="data:image/png;base64,${card.img.b64}"/>`
    }
    y += rowH
  }

  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${bg}"/>
    <text x="${gutter}" y="58" font-family="DejaVu Sans" font-size="34" font-weight="700" fill="${fg}">Eight new coverage-expanding styles</text>
    <text x="${gutter}" y="91" font-family="DejaVu Sans" font-size="17" fill="${muted}">All render the same source: groups, decision node, edge labels, feedback, and a Mermaid class override.</text>
    ${body}
  </svg>`

  const png = new Resvg(composite, {
    fitTo: { mode: 'width', value: width },
    background: bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, 'new-style-gallery.png'), png)
}

function generatePaletteGallery(): void {
  const panelW = 360
  const gutter = 28
  const left = 46
  const top = 178
  const rowLabelW = 248
  const colHeaderH = 42
  const cards = NEW_STYLES.map(style => ({
    style,
    variants: PALETTE_CASES.map(palette => ({
      palette,
      img: renderPaletteCard(style.name, palette.styleOf(style.name), panelW),
    })),
  }))
  const rowHeights = cards.map(row => Math.max(...row.variants.map(v => v.img.height)) + 30)
  const width = left + rowLabelW + PALETTE_CASES.length * panelW + (PALETTE_CASES.length - 1) * gutter + 46
  const height = top + colHeaderH + rowHeights.reduce((a, b) => a + b, 0) + 44
  const bg = '#f7f3ea'
  const fg = '#211f1b'
  const muted = '#686158'
  const startX = left + rowLabelW
  let body = ''

  for (const [i, palette] of PALETTE_CASES.entries()) {
    const x = startX + i * (panelW + gutter)
    body += `
      <text x="${x + panelW / 2}" y="${top}" text-anchor="middle" font-family="DejaVu Sans" font-size="18" font-weight="700" fill="${fg}">${esc(palette.label)}</text>
      <text x="${x + panelW / 2}" y="${top + 24}" text-anchor="middle" font-family="DejaVu Sans" font-size="12" fill="${muted}">${palette.key === 'native' ? 'style only' : `style + ${esc(palette.key)}`}</text>`
  }

  let y = top + colHeaderH
  for (const row of cards) {
    const rowH = Math.max(...row.variants.map(v => v.img.height))
    body += `
      <text x="${left}" y="${y + 28}" font-family="DejaVu Sans" font-size="19" font-weight="700" fill="${fg}">${esc(row.style.label)}</text>
      <text x="${left}" y="${y + 52}" font-family="DejaVu Sans" font-size="12" fill="${muted}">${esc(row.style.note)}</text>`
    for (const [i, variant] of row.variants.entries()) {
      const x = startX + i * (panelW + gutter)
      body += `
        <rect x="${x - 8}" y="${y - 8}" width="${panelW + 16}" height="${variant.img.height + 16}" rx="10" fill="#fffaf1" stroke="#d7cdbd" stroke-width="1.2"/>
        <image x="${x}" y="${y}" width="${variant.img.width}" height="${variant.img.height}" href="data:image/png;base64,${variant.img.b64}"/>`
    }
    y += rowH + 30
  }

  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${bg}"/>
    <text x="${left}" y="58" font-family="DejaVu Sans" font-size="34" font-weight="700" fill="${fg}">Palette compatibility: new styles × themes</text>
    <text x="${left}" y="91" font-family="DejaVu Sans" font-size="17" fill="${muted}">Theme names are palette-only styles. Stacking a palette after a look should preserve stroke, fill, font, density, and page behavior while replacing colors.</text>
    <text x="${left}" y="122" font-family="DejaVu Sans" font-size="14" fill="${muted}">This grid is a readability probe, not a promise that every arbitrary palette preserves the original design intent.</text>
    ${body}
  </svg>`

  const png = new Resvg(composite, {
    fitTo: { mode: 'width', value: width },
    background: bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, 'new-style-palette-gallery.png'), png)
}

function radarPoint(value: number, index: number): [number, number] {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / COVERAGE.length)
  const r = value * 60
  return [Math.cos(angle) * r, Math.sin(angle) * r]
}

function pointList(values: number[]): string {
  return values.map((value, i) => {
    const [x, y] = radarPoint(value, i)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function coverageSvg(mode: 'before' | 'after'): string {
  const valueKey = mode === 'before' ? 'before' : 'after'
  const title = mode === 'before' ? 'Before: original 7-look catalog' : 'After: 15-look coverage expansion'
  const subtitle = mode === 'before'
    ? 'Strong mechanics, but many categories were only latent in the primitives.'
    : 'Eight added styles turn accessibility, print, operations, physical media, drafting, and report figures into concrete examples.'
  const today = COVERAGE.map(c => c[valueKey])
  const target = COVERAGE.map(c => c.target)

  const rows = COVERAGE.map((c, i) => {
    const y = 246 + i * 62
    const covered = mode === 'before'
      ? (c.key === 'stroke' ? ['Crisp, jittered rough.js,', 'pressure-ribbon freehand.']
        : c.key === 'fill' ? ['None, solid, hachure, wash;', 'semantic fills survive sketching.']
          : c.key === 'page' ? ['Plain, paper-ruled, grid;', 'transparent SVG support.']
            : c.key === 'type' ? ['Inter plus bundled style faces;', 'role sizes, weights, spacing.']
              : c.key === 'semantics' ? ['text/node/edge/group roles,', 'class/linkStyle precedence.']
                : c.key === 'families' ? ['Styled SceneGraph across 12', 'families, baseline hashed.']
                  : c.key === 'medium' ? ['SVG, PNG, strict security,', 'seeded deterministic ink.']
                    : c.coveredNow)
      : c.coveredNow
    return `
      <g transform="translate(750 ${y})">
        <rect x="0" y="0" width="95" height="62" fill="#fbf6ed" stroke="#eadfce"/>
        <rect x="95" y="0" width="295" height="62" fill="#e7f2ea" stroke="#9fbda8"/>
        <rect x="390" y="0" width="300" height="62" fill="#fff0dc" stroke="#d1ad78"/>
        <text x="12" y="27" font-family="DejaVu Sans" font-size="15" fill="#211f1b">${esc(c.label)}</text>
        <text x="110" y="22" font-family="DejaVu Sans" font-size="12" fill="#211f1b">${esc(covered[0]!)}</text>
        <text x="110" y="41" font-family="DejaVu Sans" font-size="12" fill="#211f1b">${esc(covered[1]!)}</text>
        <text x="405" y="22" font-family="DejaVu Sans" font-size="12" fill="#211f1b">${esc(c.missing[0]!)}</text>
        <text x="405" y="41" font-family="DejaVu Sans" font-size="12" fill="#211f1b">${esc(c.missing[1]!)}</text>
      </g>`
  }).join('\n')

  const labels = COVERAGE.map((c, i) => {
    const [x, y] = radarPoint(4.45, i)
    return `<text x="${(365 + x).toFixed(1)}" y="${(475 + y + 5).toFixed(1)}" text-anchor="middle" font-family="DejaVu Sans" font-size="14" fill="#211f1b">${esc(c.label)}</text>`
  }).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 940" width="1500" height="940" role="img">
    <rect width="1500" height="940" fill="#f7f3ea"/>
    <text x="50" y="58" font-family="DejaVu Sans" font-size="30" font-weight="700" fill="#211f1b">${esc(title)}</text>
    <text x="50" y="86" font-family="DejaVu Sans" font-size="15" fill="#686158">${esc(subtitle)}</text>
    <rect x="40" y="120" width="650" height="760" rx="10" fill="#fffaf1" stroke="#d7cdbd" stroke-width="1.2"/>
    <rect x="720" y="120" width="740" height="760" rx="10" fill="#fffaf1" stroke="#d7cdbd" stroke-width="1.2"/>
    <text x="70" y="160" font-family="DejaVu Sans" font-size="17" font-weight="700" fill="#211f1b">Coverage envelope</text>
    <text x="70" y="184" font-family="DejaVu Sans" font-size="12" fill="#686158">0 none -> 1 primitive -> 2 exemplar -> 3 composable/proven -> 4 taught/gallery-ready</text>
    <g transform="translate(365 475)">
      <polygon points="${pointList(Array(8).fill(1))}" fill="none" stroke="#d8cec0"/>
      <polygon points="${pointList(Array(8).fill(2))}" fill="none" stroke="#d8cec0"/>
      <polygon points="${pointList(Array(8).fill(3))}" fill="none" stroke="#d8cec0"/>
      <polygon points="${pointList(Array(8).fill(4))}" fill="none" stroke="#d8cec0"/>
      ${COVERAGE.map((_, i) => {
        const [x, y] = radarPoint(4.15, i)
        return `<line x1="0" y1="0" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#a79b8c" stroke-width="1"/>`
      }).join('\n')}
      <polygon points="${pointList(target)}" fill="#d98a2430" stroke="#b76616" stroke-width="2" stroke-dasharray="7 5"/>
      <polygon points="${pointList(today)}" fill="#1b6e5245" stroke="#1b6e52" stroke-width="3"/>
      ${today.map((value, i) => {
        const [x, y] = radarPoint(value, i)
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5" fill="#1b6e52"/>`
      }).join('\n')}
      <text x="8" y="-60" font-family="DejaVu Sans" font-size="12" fill="#686158">1</text>
      <text x="8" y="-120" font-family="DejaVu Sans" font-size="12" fill="#686158">2</text>
      <text x="8" y="-180" font-family="DejaVu Sans" font-size="12" fill="#686158">3</text>
      <text x="8" y="-240" font-family="DejaVu Sans" font-size="12" fill="#686158">4</text>
    </g>
    ${labels}
    <g transform="translate(78 800)">
      <rect x="0" y="-14" width="18" height="18" fill="#1b6e5245" stroke="#1b6e52" stroke-width="3"/>
      <text x="28" y="0" font-family="DejaVu Sans" font-size="15" fill="#211f1b">${mode === 'before' ? 'original catalog coverage' : 'expanded catalog coverage'}</text>
      <rect x="315" y="-14" width="18" height="18" fill="#d98a2430" stroke="#b76616" stroke-width="2" stroke-dasharray="7 5"/>
      <text x="343" y="0" font-family="DejaVu Sans" font-size="15" fill="#211f1b">useful next frontier</text>
    </g>
    <text x="750" y="160" font-family="DejaVu Sans" font-size="17" font-weight="700" fill="#211f1b">Gap matrix</text>
    <text x="750" y="184" font-family="DejaVu Sans" font-size="12" fill="#686158">Left cells name what exists in this phase; right cells name missing territory worth teaching or building.</text>
    <g transform="translate(750 210)">
      <rect x="0" y="0" width="95" height="36" fill="#efe6d6" stroke="#d7cdbd"/>
      <rect x="95" y="0" width="295" height="36" fill="#e7f2ea" stroke="#d7cdbd"/>
      <rect x="390" y="0" width="300" height="36" fill="#fff0dc" stroke="#d7cdbd"/>
      <text x="12" y="23" font-family="DejaVu Sans" font-size="11" font-weight="700" fill="#211f1b">DIMENSION</text>
      <text x="110" y="23" font-family="DejaVu Sans" font-size="11" font-weight="700" fill="#211f1b">COVERED NOW</text>
      <text x="405" y="23" font-family="DejaVu Sans" font-size="11" font-weight="700" fill="#211f1b">MISSING / UNDER-TAUGHT</text>
    </g>
    ${rows}
  </svg>`
}

function writeCoverageArtifacts(): void {
  for (const mode of ['before', 'after'] as const) {
    const svg = coverageSvg(mode)
    writeFileSync(join(OUT_DIR, `style-state-space-${mode}.svg`), svg)
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1500 },
      background: '#f7f3ea',
      font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
    }).render().asPng()
    writeFileSync(join(OUT_DIR, `style-state-space-${mode}.png`), png)
  }

  const before = rasterize(coverageSvg('before'), 980)
  const after = rasterize(coverageSvg('after'), 980)
  const width = before.width + after.width + 90
  const height = Math.max(before.height, after.height) + 126
  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f7f3ea"/>
    <text x="44" y="56" font-family="DejaVu Sans" font-size="34" font-weight="700" fill="#211f1b">Coverage diagram: before vs after</text>
    <text x="44" y="90" font-family="DejaVu Sans" font-size="17" fill="#686158">The expanded catalog improves concrete coverage most in type, page context, medium, and visual dialects; semantics still needs real subrole primitives.</text>
    <image x="44" y="112" width="${before.width}" height="${before.height}" href="data:image/png;base64,${before.b64}"/>
    <image x="${before.width + 46}" y="112" width="${after.width}" height="${after.height}" href="data:image/png;base64,${after.b64}"/>
  </svg>`
  const png = new Resvg(composite, {
    fitTo: { mode: 'width', value: width },
    background: '#f7f3ea',
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, 'style-state-space-before-after.png'), png)
}

mkdirSync(OUT_DIR, { recursive: true })
generateStyleGallery()
generatePaletteGallery()
writeCoverageArtifacts()
console.log('wrote docs/pr-assets/new-style-gallery.png')
console.log('wrote docs/pr-assets/new-style-palette-gallery.png')
console.log('wrote docs/pr-assets/style-state-space-before.png')
console.log('wrote docs/pr-assets/style-state-space-after.png')
console.log('wrote docs/pr-assets/style-state-space-before-after.png')
