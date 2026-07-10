// Brand-primitives probe (PR #148): can three real corporate design systems
// be expressed over the full diagram-family matrix, and which primitives are
// missing? Three probes:
//
//   cupertino   — the registered built-in prototype (declarative path)
//   vercel      — from vercel-labs/beautiful-mermaid's fork defaults + Geist
//                 design language (dark page, hairline borders, radius 6)
//   cf-workers  — from the CF Workers design-system tokens.json (cream/tan
//                 layers, orange accent, mono meta labels, warm borders)
//
// vercel and cf-workers are NOT registered styles: their looks need face-level
// control the public StyleSpec cannot express, so they render through the
// @internal RenderStyleOptions.styleFace hook. That asymmetry is the point —
// it is the measured gap between the declarative alphabet and what brands
// need (see docs/project/brand-primitives-plan.md).
//
// Probe values approximate each brand from public sources; they are not
// gate-audited (the WCAG legibility gates apply to shipping styles, not
// probes). Fonts: Geist and FT Kunst Grotesk are stood in by bundled Inter
// (Geist is SIL OFL 1.1 and could be bundled later; FT Kunst Grotesk is
// commercial); Apercu Mono Pro is stood in by bundled Share Tech Mono.
//
// Writes the committed evidence composite (one flowchart, three brands):
//   bun run scripts/pr-assets/brand-primitives-probe.ts
// Also renders the full 3×12 matrix when given an output dir:
//   bun run scripts/pr-assets/brand-primitives-probe.ts <svg-out-dir>
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'
import type { RenderOptions } from '../../src/types.ts'
import type { InternalStyleFace } from '../../src/scene/style-registry.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const FONT_DIR = join(ROOT, 'assets', 'fonts')

export interface BrandProbe {
  key: string
  label: string
  /** Page color the composite panel should show behind the render. */
  page: string
  options: RenderOptions & { styleFace?: InternalStyleFace }
}

export const BRANDS: BrandProbe[] = [
  {
    key: 'cupertino',
    label: "style: 'cupertino' (registered built-in)",
    page: '#f2f2f7',
    options: { style: 'cupertino', shadow: true },
  },
  {
    key: 'vercel',
    label: 'vercel probe (internal styleFace)',
    page: '#0a0a0a',
    options: {
      style: {
        colors: { bg: '#0a0a0a', fg: '#ededed', line: '#565656', accent: '#0070f3', muted: '#a1a1a1', surface: '#111111', border: '#2e2e2e' },
        font: 'Inter', // Geist stand-in
      },
      styleFace: {
        // Geist language: page-dark cards defined by 1px hairlines, radius 6,
        // medium weights, no shadows — dark elevation via borders.
        node: { fontSize: 13, fontWeight: 500, letterSpacing: 0, textColor: 'var(--fg)', paddingX: 20, paddingY: 11, cornerRadius: 6, lineWidth: 1, fillColor: 'var(--surface)', borderColor: 'var(--border)' },
        edge: { fontSize: 11, fontWeight: 400, letterSpacing: 0, lineWidth: 1, bendRadius: 8, strokeColor: 'var(--line)', textColor: 'var(--muted)' },
        group: { fontSize: 12, fontWeight: 500, letterSpacing: 0.1, textColor: 'var(--muted)', paddingX: 16, paddingY: 16, cornerRadius: 8, lineWidth: 1, fillColor: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' },
      },
    },
  },
  {
    key: 'cf-workers',
    label: 'cf-workers probe (internal styleFace)',
    page: '#f5f1eb',
    options: {
      style: {
        colors: { bg: '#f5f1eb', fg: '#521000', line: '#835446', accent: '#ff4801', muted: '#835446', surface: '#fffbf5', border: '#ebd5c1' },
        font: 'Inter', // FT Kunst Grotesk stand-in
      },
      shadow: true, // tokens.json ships a card shadow (brand-tinted; engine's is neutral — a known gap)
      styleFace: {
        // Cream-on-tan layers, warm 1px borders, radius md/lg, medium-never-
        // bold type, mono uppercase meta labels, orange reserved for intent.
        node: { fontSize: 13, fontWeight: 500, letterSpacing: 0, textColor: 'var(--fg)', paddingX: 22, paddingY: 12, cornerRadius: 8, lineWidth: 1, fillColor: 'var(--surface)', borderColor: 'var(--border)' },
        edge: { fontSize: 11, fontWeight: 400, letterSpacing: 0.1, lineWidth: 1.25, bendRadius: 10, strokeColor: 'var(--line)', textColor: 'var(--muted)' },
        group: { fontFamily: 'Share Tech Mono', fontSize: 11, fontWeight: 400, letterSpacing: 0.6, textTransform: 'uppercase', textColor: 'var(--muted)', paddingX: 18, paddingY: 18, cornerRadius: 12, lineWidth: 1, fillColor: 'rgba(255,72,1,0.04)', headerFillColor: 'rgba(255,72,1,0.08)', borderColor: 'var(--border)' },
      },
    },
  },
]

export const FAMILY_SOURCES: Record<string, string> = {
  flowchart: `flowchart TD
  subgraph Client
    A[Open App] --> B{Signed in?}
  end
  B -- Yes --> C[Load Library]
  B -- No --> D[Show Onboarding]
  D --> E[Create Account]
  E --> C
  subgraph Cloud
    C --> F[(Sync Store)]
    F --> G[Push Changes]
  end`,
  state: `stateDiagram-v2
  [*] --> Idle
  Idle --> Recording : press
  Recording --> Paused : pause
  Paused --> Recording : resume
  Recording --> Processing : stop
  Processing --> Idle : done`,
  sequence: `sequenceDiagram
  participant App
  participant Server
  participant Push
  App->>Server: Register device token
  Server-->>App: Ack
  Server->>Push: Send payload
  Push-->>App: Deliver notification`,
  timeline: `timeline
  title Release Train
  section Spring
    March : Feature freeze
    April : Beta 1 : Beta 2
  section Summer
    June : Announcement
    September : Public release`,
  class: `classDiagram
  class MediaItem {
    +UUID id
    +String title
    +play()
  }
  class Playlist {
    +String name
    +add(item)
  }
  Playlist o-- MediaItem
  MediaItem <|-- Song
  MediaItem <|-- Podcast`,
  er: `erDiagram
  USER ||--o{ SUBSCRIPTION : has
  SUBSCRIPTION }o--|| PLAN : "billed as"
  USER ||--o{ DEVICE : registers
  USER {
    uuid id
    string email
  }`,
  journey: `journey
  title Morning Focus Session
  section Start
    Open Focus app: 5: User
    Pick playlist: 4: User
  section Work
    Deep work block: 3: User
    Break reminder: 4: App
  section Wrap up
    Review summary: 5: User, App`,
  xychart: `xychart-beta
  title "Weekly Active Devices"
  x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  y-axis "Devices (k)" 0 --> 100
  bar [62, 68, 71, 74, 69, 55, 48]
  line [60, 65, 70, 73, 70, 58, 50]`,
  pie: `pie showData
  title Storage Used
  "Photos" : 128
  "Apps" : 64
  "Messages" : 32
  "System" : 24`,
  quadrant: `quadrantChart
  title Feature Prioritization
  x-axis Low Effort --> High Effort
  y-axis Low Impact --> High Impact
  quadrant-1 Plan
  quadrant-2 Do First
  quadrant-3 Skip
  quadrant-4 Reconsider
  Widgets: [0.3, 0.8]
  Live Activities: [0.7, 0.9]
  Themes: [0.2, 0.4]
  Legacy sync: [0.8, 0.3]`,
  architecture: `architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service disk1(disk)[Storage] in api
  service server(server)[Server] in api
  db:L -- R:server
  disk1:T -- B:db`,
  gantt: `gantt
  title App Redesign
  dateFormat YYYY-MM-DD
  section Design
    Audit :a1, 2026-01-05, 10d
    Visual system :a2, after a1, 15d
  section Build
    Components :b1, after a2, 20d
    Migration :b2, after b1, 15d`,
}

export function renderBrand(brand: BrandProbe, family: string, idPrefix = ''): string {
  const source = FAMILY_SOURCES[family]
  if (!source) throw new Error(`unknown family ${family}`)
  return renderMermaidSVG(source, { ...brand.options, embedFontImport: false, idPrefix } as RenderOptions)
}

function rasterize(svg: string, width: number): { b64: string; width: number; height: number } {
  const rendered = new Resvg(inlineFontVarForRaster(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render()
  const png = rendered.asPng()
  return { b64: Buffer.from(png).toString('base64'), width: rendered.width, height: rendered.height }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

if (import.meta.main) {
  if (!existsSync(FONT_DIR)) throw new Error(`bundled fonts not found at ${FONT_DIR}`)

  const svgOutDir = process.argv[2]
  if (svgOutDir) {
    // Full 3 × 12 matrix for the mock gallery.
    mkdirSync(svgOutDir, { recursive: true })
    for (const brand of BRANDS) {
      for (const family of Object.keys(FAMILY_SOURCES)) {
        writeFileSync(join(svgOutDir, `${brand.key}-${family}.svg`), renderBrand(brand, family, `${brand.key}-${family}-`))
      }
    }
    console.log(`wrote ${BRANDS.length * Object.keys(FAMILY_SOURCES).length} SVGs to ${svgOutDir}`)
  }

  // Committed evidence composite: one flowchart, three brands side by side.
  const PANEL_W = 460
  const GUTTER = 44
  const panels = BRANDS.map(b => ({ brand: b, img: rasterize(renderBrand(b, 'flowchart'), PANEL_W) }))
  const panelH = Math.max(...panels.map(p => p.img.height))
  let body = ''
  panels.forEach((p, i) => {
    const x = GUTTER + i * (PANEL_W + GUTTER)
    body += `<text x="${x}" y="150" font-family="Inter" font-size="18" font-weight="600" fill="#66666b">${esc(p.brand.label)}</text>`
    body += `
  <rect x="${x - 12}" y="${168}" width="${PANEL_W + 24}" height="${panelH + 24}" rx="14" fill="${p.brand.page}"/>
  <image x="${x + (PANEL_W - p.img.width) / 2}" y="180" width="${p.img.width}" height="${p.img.height}" href="data:image/png;base64,${p.img.b64}"/>`
  })
  const width = (PANEL_W + GUTTER) * BRANDS.length + GUTTER
  const height = 180 + panelH + 60
  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${GUTTER}" y="64" font-family="Inter" font-size="34" font-weight="700" fill="#111111">Three brands, one source, one renderer</text>
  <text x="${GUTTER}" y="100" font-family="Inter" font-size="19" fill="#66666b">cupertino ships declaratively; vercel and cf-workers need the internal styleFace hook — that gap is what this PR maps.</text>
  ${body}
</svg>`
  mkdirSync(OUT_DIR, { recursive: true })
  const png = new Resvg(composite, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, 'brand-primitives-three-brands.png'), png)
  console.log(`brand-primitives-three-brands.png: ${png.length} bytes`)
}
