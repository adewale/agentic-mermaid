// ============================================================================
// Visual-quality characterization generator.
//
// Produces docs/layout-characterization/visual-quality.md plus one SVG snapshot
// per renderer family. This is an approval artifact: it records visual
// fingerprints and graph-drawing quality metrics (crossings, bends, area fill,
// label overlap risk) without pretending those metrics are correctness laws.
//
// It changes NO implementation code -- it only reads public renderer APIs.
// ============================================================================

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { QualityMetrics, RenderedLayout } from '../../src/agent/index.ts'
import { layoutMermaid, measureQuality, parseRegisteredMermaid as parseMermaid, renderMermaidPNG, renderMermaidSVG } from '../../src/agent/index.ts'
import { decodedSvgAttributeValue, type SvgStartTagToken, scanSvgStartTags } from '../../src/svg-structure.ts'

interface VisualCase {
  family: string
  title: string
  source: string
  labelFitApplicable?: boolean
}

export interface VisualQualityRow {
  family: string
  title: string
  source: string
  labelFitApplicable?: boolean
  svg: string
  svgHash: string
  pngHash: string
  pngBytes: number
  svgSize: { width: number; height: number }
  bounds: { width: number; height: number }
  metrics: QualityMetrics
  bends: number
  routeLength: number
  labelOverlaps: number
}

export const DOC_DIR = join(import.meta.dir, '..', '..', 'docs', 'layout-characterization')
export const OUTPUT_PATH = join(DOC_DIR, 'visual-quality.md')
export const SNAPSHOT_DIR = join(DOC_DIR, 'visual-snapshots')

const CASES: VisualCase[] = [
  {
    family: 'flowchart',
    title: 'Flowchart',
    source: 'graph TD\n  Start[Start] --> Check{Check}\n  Check -->|yes| Done[Done]\n  Check -->|no| Retry[Retry]\n  Retry --> Check',
  },
  {
    family: 'state',
    title: 'State diagram',
    source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> Failed\n  Failed --> Idle\n  Running --> [*]',
  },
  {
    family: 'sequence',
    title: 'Sequence diagram',
    source: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  participant DB\n  Alice->>Bob: Request\n  Bob->>DB: Query\n  DB-->>Bob: Rows\n  Bob-->>Alice: Response',
  },
  {
    family: 'class',
    title: 'Class diagram',
    source: 'classDiagram\n  class Animal\n  class Dog\n  class Cat\n  Animal <|-- Dog\n  Animal <|-- Cat',
  },
  {
    family: 'er',
    title: 'ER diagram',
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains',
  },
  {
    family: 'timeline',
    title: 'Timeline',
    source: 'timeline\n  title Release Plan\n  section Build\n    2025 : Prototype\n    2026 : Launch',
  },
  {
    family: 'gantt',
    title: 'Gantt chart',
    source:
      'gantt\n  title Launch plan\n  dateFormat YYYY-MM-DD\n  axisFormat %b %d\n  excludes weekends\n  section Build\n    Spec :done, spec, 2024-01-01, 2d\n    Implement :active, impl, after spec, 3d\n  section Ship\n    QA :crit, qa, after impl, 2d\n    Launch :milestone, launch, after qa, 0d\n    Release line :vert, release, 2024-01-10, 0d',
  },
  {
    family: 'journey',
    title: 'User journey',
    source: 'journey\n  title Checkout\n  section Cart\n    Review basket: 4: Shopper\n    Pay: 5: Shopper',
  },
  {
    family: 'xychart',
    title: 'XY chart',
    source: 'xychart\n  title Sales\n  x-axis [Jan, Feb, Mar]\n  y-axis Revenue 0 --> 10\n  bar [3, 7, 5]\n  line [2, 6, 8]',
  },
  {
    family: 'pie',
    title: 'Pie chart',
    source: 'pie title Pets\n  "Cats" : 4\n  "Dogs" : 6\n  "Birds" : 2',
  },
  {
    family: 'quadrant',
    title: 'Quadrant chart',
    source: 'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Risk --> Reward\n  quadrant-1 Invest\n  A: [0.7, 0.8]\n  B: [0.3, 0.4]',
  },
  {
    family: 'mindmap',
    title: 'Mindmap',
    source: 'mindmap\n  root((Product))\n    Research\n      Interviews\n      Evidence\n    Delivery',
  },
  {
    family: 'gitgraph',
    title: 'GitGraph',
    source: 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"\n  checkout main\n  commit id:"release"\n  merge feature id:"merge"',
    // Commit labels are intentionally external/rotated annotations, not text
    // contained by the 20px commit glyph measured by the generic fit metric.
    labelFitApplicable: false,
  },
  {
    family: 'architecture',
    title: 'Architecture diagram',
    source: 'architecture-beta\n  group api(cloud)[API]\n  service app(server)[App] in api\n  service db(database)[DB]\n  app:R --> L:db',
  },
  {
    family: 'radar',
    title: 'Radar chart',
    source: 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5',
  },
  {
    family: 'sankey',
    title: 'Sankey diagram',
    source: 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,151.89\n  Electricity,Industry,207.93\n  Electricity,Homes,71.89',
  },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function shortHash(hash: string): string {
  return hash.slice(0, 12)
}

function normalizeSvg(svg: string): string {
  return (
    svg
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trim() + '\n'
  )
}

function parseSvgSize(svg: string): { width: number; height: number } {
  const svgTag = svg.match(/<svg\b[^>]*>/)?.[0] ?? ''
  const width = svgTag.match(/(?:^|\s)width="([0-9.]+)"/)?.[1]
  const height = svgTag.match(/(?:^|\s)height="([0-9.]+)"/)?.[1]
  if (width && height) return { width: Number(width), height: Number(height) }
  const viewBox = svgTag.match(/\bviewBox="[-0-9.]+ [-0-9.]+ ([0-9.]+) ([0-9.]+)"/)
  return { width: Number(viewBox?.[1] ?? 0), height: Number(viewBox?.[2] ?? 0) }
}

function direction(a: [number, number], b: [number, number]): string | null {
  const dx = Math.sign(b[0] - a[0])
  const dy = Math.sign(b[1] - a[1])
  if (dx === 0 && dy === 0) return null
  return `${dx},${dy}`
}

function countBends(layout: RenderedLayout): number {
  let bends = 0
  for (const edge of layout.edges) {
    let previous: string | null = null
    for (let i = 0; i < edge.path.length - 1; i++) {
      const current = direction(edge.path[i]!, edge.path[i + 1]!)
      if (!current) continue
      if (previous && previous !== current) bends++
      previous = current
    }
  }
  return bends
}

function routeLength(layout: RenderedLayout): number {
  let length = 0
  for (const edge of layout.edges) {
    for (let i = 0; i < edge.path.length - 1; i++) {
      const a = edge.path[i]!
      const b = edge.path[i + 1]!
      length += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
  }
  return Math.round(length)
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function countLabelOverlaps(layout: RenderedLayout): number {
  const CHAR_PX = 7
  const LABEL_H = 14
  let overlaps = 0
  for (const edge of layout.edges) {
    if (!edge.label) continue
    const w = Math.max(CHAR_PX, edge.label.text.length * CHAR_PX)
    const label = { x: edge.label.x - w / 2, y: edge.label.y - LABEL_H / 2, w, h: LABEL_H }
    for (const node of layout.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue
      if (rectsOverlap(label, node)) overlaps++
    }
  }
  return overlaps
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  return String(Math.round(n))
}

function artifactPath(fileName: string): string {
  return join(SNAPSHOT_DIR, fileName)
}

function declarations(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const part of text.split(';')) {
    const colon = part.indexOf(':')
    if (colon > 0) result.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
  }
  return result
}

function renderedTextPairs(svg: string): Array<{ foreground: string; background: string }> {
  const variables = new Map<string, string>()
  const classPaints = new Map<string, Map<string, string>>()
  for (const style of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const variable of style[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) variables.set(variable[1]!, variable[2]!.trim())
    for (const rule of style[1]!.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const paint = declarations(rule[2]!)
      for (const name of rule[1]!.matchAll(/\.([\w-]+)/g)) classPaints.set(name[1]!, paint)
    }
  }
  const resolve = (paint: string | undefined, fallback: string): string => {
    let value = paint?.trim() || fallback
    for (let depth = 0; depth < 8; depth++) {
      const variable = value.match(/^var\((--[\w-]+)(?:,\s*([^\)]+))?\)$/)
      if (!variable) break
      value = variables.get(variable[1]!) ?? variable[2]?.trim() ?? fallback
    }
    return value
  }
  const paintOf = (tag: SvgStartTagToken, property: string, fallback: string): string => {
    const direct = decodedSvgAttributeValue(tag, property)
    if (direct) return resolve(direct, fallback)
    const inline = declarations(decodedSvgAttributeValue(tag, 'style') ?? '').get(property)
    if (inline) return resolve(inline, fallback)
    const classes = (decodedSvgAttributeValue(tag, 'class') ?? '').split(/\s+/)
    for (const cls of classes) {
      const value = classPaints.get(cls)?.get(property)
      if (value) return resolve(value, fallback)
    }
    return fallback
  }

  const canvas = resolve(variables.get('--_bg') ?? variables.get('--background'), '#FFFFFF')
  const defaultText = resolve(variables.get('--_text') ?? variables.get('--foreground'), '#27272A')
  const starts = new Map(scanSvgStartTags(svg).map(tag => [tag.start, tag]))
  interface PaintedShape {
    fill: string
    contains: (x: number, y: number) => boolean
  }
  const groups: Array<{ shapes: PaintedShape[] }> = []
  const pieSurfaces: string[] = []
  let pieLabelIndex = 0
  const pairs: Array<{ foreground: string; background: string }> = []
  const numberAttr = (tag: SvgStartTagToken, name: string): number | undefined => {
    const value = Number(decodedSvgAttributeValue(tag, name))
    return Number.isFinite(value) ? value : undefined
  }
  const polygonContains = (polygon: readonly [number, number][], px: number, py: number): boolean => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]!,
        [xj, yj] = polygon[j]!
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const straightPathPolygon = (path: string): [number, number][] | undefined => {
    const tokenPattern = /[MLHVZmlhvz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g
    const tokens = path.match(tokenPattern)
    if (!tokens || path.replace(tokenPattern, '').replace(/[\s,]+/g, '') !== '') return undefined
    const points: [number, number][] = []
    let command = ''
    let x = 0
    let y = 0
    let index = 0
    while (index < tokens.length) {
      if (/^[MLHVZmlhvz]$/.test(tokens[index]!)) {
        command = tokens[index++]!
        if (command.toLowerCase() === 'z') {
          command = ''
          continue
        }
      }
      if (!command) return undefined
      const relative = command === command.toLowerCase()
      const kind = command.toLowerCase()
      if (kind === 'm' || kind === 'l') {
        const nextX = Number(tokens[index++])
        const nextY = Number(tokens[index++])
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return undefined
        if (kind === 'm' && points.length > 0) return undefined
        x = relative ? x + nextX : nextX
        y = relative ? y + nextY : nextY
        points.push([x, y])
        if (kind === 'm') command = relative ? 'l' : 'L'
      } else if (kind === 'h') {
        const nextX = Number(tokens[index++])
        if (!Number.isFinite(nextX)) return undefined
        x = relative ? x + nextX : nextX
        points.push([x, y])
      } else if (kind === 'v') {
        const nextY = Number(tokens[index++])
        if (!Number.isFinite(nextY)) return undefined
        y = relative ? y + nextY : nextY
        points.push([x, y])
      } else {
        return undefined
      }
    }
    return points.length >= 3 ? points : undefined
  }
  const paintedShape = (tag: SvgStartTagToken, name: string, fill: string): PaintedShape | undefined => {
    if (name === 'rect') {
      const x = numberAttr(tag, 'x'),
        y = numberAttr(tag, 'y'),
        w = numberAttr(tag, 'width'),
        h = numberAttr(tag, 'height')
      if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
        return { fill, contains: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h }
      }
    }
    if (name === 'circle') {
      const cx = numberAttr(tag, 'cx'),
        cy = numberAttr(tag, 'cy'),
        r = numberAttr(tag, 'r')
      if (cx !== undefined && cy !== undefined && r !== undefined) {
        return { fill, contains: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2 }
      }
    }
    if (name === 'ellipse') {
      const cx = numberAttr(tag, 'cx'),
        cy = numberAttr(tag, 'cy'),
        rx = numberAttr(tag, 'rx'),
        ry = numberAttr(tag, 'ry')
      if (cx !== undefined && cy !== undefined && rx && ry) {
        return { fill, contains: (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1 }
      }
    }
    if (name === 'polygon') {
      const points = (decodedSvgAttributeValue(tag, 'points') ?? '')
        .trim()
        .split(/\s+/)
        .map(pair => pair.split(',').map(Number))
      if (points.length >= 3 && points.every(point => point.length === 2 && point.every(Number.isFinite))) {
        const polygon = points as [number, number][]
        return { fill, contains: (px, py) => polygonContains(polygon, px, py) }
      }
    }
    if (name === 'path') {
      const polygon = straightPathPolygon(decodedSvgAttributeValue(tag, 'd') ?? '')
      if (polygon) return { fill, contains: (px, py) => polygonContains(polygon, px, py) }
    }
    return undefined
  }
  const token = /<\/?([A-Za-z][\w:.-]*)\b[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = token.exec(svg)) !== null) {
    const closing = svg[match.index + 1] === '/'
    const name = match[1]!.toLowerCase()
    if (closing) {
      if (name === 'g') groups.pop()
      continue
    }
    const tag = starts.get(match.index)
    if (!tag) continue
    if (name === 'g') {
      groups.push({ shapes: [] })
      continue
    }
    const classes = (decodedSvgAttributeValue(tag, 'class') ?? '').split(/\s+/)
    if (['rect', 'circle', 'ellipse', 'polygon', 'path'].includes(name)) {
      const fill = paintOf(tag, 'fill', 'none')
      if (classes.includes('pie-slice')) pieSurfaces.push(fill)
      const shape = fill === 'none' ? undefined : paintedShape(tag, name, fill)
      if (shape && groups.length > 0) groups.at(-1)!.shapes.push(shape)
      continue
    }
    if (name !== 'text') continue
    const foreground = paintOf(tag, 'fill', defaultText)
    const textX = numberAttr(tag, 'x')
    const textY = numberAttr(tag, 'y')
    const containingSurface =
      textX === undefined || textY === undefined
        ? undefined
        : [...groups]
            .reverse()
            .flatMap(group => [...group.shapes].reverse())
            .find(shape => shape.contains(textX, textY))?.fill
    const background = classes.includes('pie-slice-label') ? (pieSurfaces[pieLabelIndex++] ?? canvas) : (containingSurface ?? canvas)
    pairs.push({ foreground, background })
  }
  return pairs.length > 0 ? pairs : [{ foreground: defaultText, background: canvas }]
}

export function collectVisualQualityRows(): VisualQualityRow[] {
  return CASES.map(c => {
    const svg = normalizeSvg(renderMermaidSVG(c.source, { embedFontImport: false, idPrefix: `char-${c.family}-` }))
    const png = renderMermaidPNG(c.source, { scale: 1 })
    const parsed = parseMermaid(c.source)
    if (!parsed.ok) throw new Error(`could not parse ${c.family}: ${JSON.stringify(parsed.error)}`)
    const layout = layoutMermaid(parsed.value)
    return {
      ...c,
      svg,
      svgHash: sha256(svg),
      pngHash: sha256(png),
      pngBytes: png.length,
      svgSize: parseSvgSize(svg),
      bounds: { width: layout.bounds.w, height: layout.bounds.h },
      metrics: measureQuality(layout, { textPairs: renderedTextPairs(svg) }),
      bends: countBends(layout),
      routeLength: routeLength(layout),
      labelOverlaps: countLabelOverlaps(layout),
    }
  })
}

function buildReport(rows: VisualQualityRow[]): string {
  const out: string[] = []
  out.push('# Visual quality characterisation')
  out.push('')
  out.push('> Generated by `scripts/characterization/visual-quality.ts`. Do not edit by hand.')
  out.push('')
  out.push('This is the approval layer for visual/layout quality. The SVG files are')
  out.push('human-inspectable snapshots; the hashes fingerprint the SVG and PNG surfaces;')
  out.push('the metrics are graph-drawing review signals (crossings, bends, canvas area,')
  out.push('label fit, spacing, density, contrast, and label-overlap risk), not standalone correctness laws.')
  out.push('`Label fit` is `n/a` for GitGraph because commit labels are external/rotated')
  out.push('annotations rather than text intended to fit inside the 20px commit glyph;')
  out.push('GitGraph label/canvas containment is gated separately by its layout tests.')
  out.push("For graph-projected route correctness, pair this report with PR 30's hard")
  out.push('gates: `src/__tests__/contact-sheet.test.ts`,')
  out.push('`src/__tests__/layout-rubric.test.ts`, and `bun run track`.')
  out.push('')
  out.push('| Family | SVG snapshot | SVG SHA | PNG SHA | PNG bytes | SVG size | Layout bounds | Nodes/edges | Crossings | Bends | Route px | Area fill | Label fit | Label overlaps | Edge-label clearance | Min spacing | Density | Contrast | Aspect |')
  out.push('|--------|--------------|---------|---------|----------:|----------|---------------|-------------|----------:|------:|---------:|----------:|----------:|---------------:|---------------------:|------------:|--------:|---------:|-------:|')
  for (const row of rows) {
    const snapshot = `./visual-snapshots/${row.family}.svg`
    const contrast = row.metrics.minimumTextContrast === null ? 'n/a' : `${row.metrics.minimumTextContrast.toFixed(2)}:1`
    out.push(
      `| ${row.title} | [${row.family}.svg](${snapshot}) | \`${shortHash(row.svgHash)}\` | \`${shortHash(row.pngHash)}\` | ${row.pngBytes} | ${row.svgSize.width}x${row.svgSize.height} | ${row.bounds.width}x${row.bounds.height} | ${row.metrics.nodeCount}/${row.metrics.edgeCount} | ${row.metrics.edgeCrossings} | ${row.bends} | ${row.routeLength} | ${fmtPct(row.metrics.whitespaceBalance)} | ${row.labelFitApplicable === false ? 'n/a' : fmtPct(row.metrics.labelLegibility)} | ${row.labelOverlaps} | ${fmtNumber(row.metrics.labelEdgeProximity)} | ${fmtNumber(row.metrics.minimumNodeSpacing)} | ${row.metrics.elementDensity.toFixed(2)} | ${contrast} | ${row.metrics.aspectRatio.toFixed(2)} |`,
    )
  }
  out.push('')
  out.push('## Sources')
  out.push('')
  for (const row of rows) {
    out.push(`### ${row.title}`)
    out.push('')
    out.push('```mermaid')
    out.push(row.source)
    out.push('```')
    out.push('')
  }
  return out.join('\n')
}

export function build(): string {
  return buildReport(collectVisualQualityRows())
}

export function buildArtifacts(): Map<string, string> {
  const rows = collectVisualQualityRows()
  const artifacts = new Map<string, string>()
  artifacts.set(OUTPUT_PATH, buildReport(rows))
  for (const row of rows) {
    artifacts.set(artifactPath(`${row.family}.svg`), row.svg)
  }
  return artifacts
}

function writeOrCheck(): void {
  const artifacts = buildArtifacts()
  const check = process.argv.includes('--check')
  const stale: string[] = []

  for (const [path, content] of artifacts) {
    if (check) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
      if (current !== content) stale.push(relative(DOC_DIR, path))
      continue
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  if (check) {
    if (stale.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`visual characterization artifacts are out of date: ${stale.join(', ')}`)
      process.exitCode = 1
      return
    }
    // eslint-disable-next-line no-console
    console.log(`checked ${artifacts.size} visual characterization artifacts`)
    return
  }

  // eslint-disable-next-line no-console
  console.log(`wrote ${artifacts.size} visual characterization artifacts`)
}

if (import.meta.main) writeOrCheck()
