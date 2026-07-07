import { describe, expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyId, type FamilyLayoutResult } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { readThemeValue, resolveDiagramColors } from '../color-resolver.ts'
import { renderMermaidSVG } from '../index.ts'
import { detectDiagramTypeFromFirstLine, normalizeMermaidSource } from '../mermaid-source.ts'
import { getFamily } from '../render-family-hooks.ts'
import type { MarkPaint, SceneDoc, SceneNode } from '../scene/ir.ts'
import type { DiagramColors } from '../theme.ts'
import { resolveColors } from '../theme.ts'
import type { DiagramStyleOptions, PositionedDiagram, RenderOptions } from '../types.ts'
import { isHexColor, mixHex } from '../shared/color-math.ts'

const WCAG_TEXT_AA = 4.5
const WCAG_NON_TEXT = 3

const TOKENS = {
  bg: '#ffffff',
  fg: '#111827',
  nodeFill: '#fff7ed',
  nodeStroke: '#7f1d1d',
  nodeText: '#111827',
  edgeStroke: '#1d4ed8',
  edgeText: '#1e3a8a',
  groupFill: '#ecfdf5',
  groupHeader: '#bbf7d0',
  groupStroke: '#14532d',
  groupText: '#052e16',
} as const

const AUDIT_STYLE: DiagramStyleOptions = {
  node: {
    fillColor: TOKENS.nodeFill,
    borderColor: TOKENS.nodeStroke,
    textColor: TOKENS.nodeText,
    lineWidth: 2,
  },
  edge: {
    strokeColor: TOKENS.edgeStroke,
    textColor: TOKENS.edgeText,
    lineWidth: 3,
  },
  group: {
    fillColor: TOKENS.groupFill,
    headerFillColor: TOKENS.groupHeader,
    borderColor: TOKENS.groupStroke,
    textColor: TOKENS.groupText,
    lineWidth: 2,
  },
}

const AUDIT_OPTIONS: RenderOptions = {
  bg: TOKENS.bg,
  fg: TOKENS.fg,
  embedFontImport: false,
  style: AUDIT_STYLE,
}

const TRANSFORM_AUDIT_OPTIONS: RenderOptions = {
  ...AUDIT_OPTIONS,
  style: {
    ...AUDIT_STYLE,
    text: { textTransform: 'uppercase' },
  },
}

interface FamilyAuditFixture {
  name: string
  source: string
  options?: Partial<RenderOptions>
}

const FAMILY_AUDIT_FIXTURES: Record<BuiltinFamilyId, FamilyAuditFixture[]> = {
  flowchart: [{
    name: 'groups, shapes, labels, and edge styles',
    source: `flowchart TD
  subgraph backend [Backend]
    A[Parse] -->|ok| B{Route?}
    B -.->|retry| C[(Cache)]
    B ==> D[[Deploy]]
  end`,
  }],
  state: [{
    name: 'composite state, start/end, and transition labels',
    source: `stateDiagram-v2
  [*] --> Draft
  state Review {
    [*] --> Check
    Check --> Done : approve
  }
  Draft --> Review : submit
  Review --> [*] : done`,
  }],
  sequence: [{
    name: 'actors, activations, notes, blocks, dividers, and messages',
    source: `sequenceDiagram
  actor U as User
  participant S as Server
  participant DB as Database
  U->>+S: request
  S-->>-U: response
  Note over S,DB: cached note
  alt hit
    S->>DB: read
  else miss
    S->>DB: write
  end
  S->>S: self check`,
  }],
  timeline: [{
    name: 'title, sections, periods, rail, markers, and events',
    source: `timeline
  title Roadmap
  section Releases
  2025 : Alpha : Beta
  section Growth
  2026 : GA : Scale`,
  }],
  class: [{
    name: 'class boxes, members, relationships, labels, and cardinalities',
    source: `classDiagram
  class Account {
    +id: string
    +close() void
  }
  class Transaction {
    +amount: number
  }
  Account <|-- Savings
  Account "1" o-- "*" Transaction : logs
  Account ..> Transaction : audits`,
  }],
  er: [{
    name: 'entities, attributes, key badges, relationships, and cardinalities',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||..|{ LINE_ITEM : contains
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    string id
  }
  LINE_ITEM {
    int qty
  }`,
  }],
  journey: [{
    name: 'title, sections, task cards, scores, and actor pills',
    source: `journey
  title Checkout
  section Browse
    Find product: 4: Shopper, Guest
  section Buy
    Pay: 3: Shopper`,
  }],
  architecture: [{
    name: 'nested groups, services, junctions, and labeled edges',
    source: `architecture-beta
  group edge(cloud)[Edge Layer]
  group app(cloud)[Application] in edge
  service api(server)[Public API] in app
  service db(database)[Primary DB] in app
  service bus(disk)[Event Bus] in edge
  junction queue in edge
  api:R -[async fan-out]-> L:bus
  bus:B --> T:queue
  queue:R --> L:db`,
  }],
  xychart: [{
    name: 'title, axes, grid, bars, series, ticks, and axis titles',
    source: `xychart-beta
  title "Revenue"
  x-axis "Quarter" [Q1, Q2, Q3]
  y-axis "USD" 0 --> 100
  bar [45, 62, 80]
  line [20, 70, 50]`,
  }],
  pie: [{
    name: 'title, slices, legend swatches, labels, and raw values',
    source: `pie showData title Plans
  "Free" : 60
  "Pro" : 30
  "Enterprise" : 10`,
  }],
  quadrant: [{
    name: 'plates, dividers, axes, quadrant labels, points, and title',
    source: `quadrantChart
  title Prioritize
  x-axis Low Effort --> High Effort
  y-axis Low Value --> High Value
  quadrant-1 Plan
  quadrant-2 Invest
  quadrant-3 Ignore
  quadrant-4 Monitor
  Quick win: [0.2, 0.8]
  Money pit: [0.8, 0.2]`,
  }],
  gantt: [{
    name: 'title, section, tasks, milestone, vert, today marker, and top/bottom axes',
    source: `gantt
  title Plan
  dateFormat YYYY-MM-DD
  topAxis
  todayMarker stroke-width:2px
  section Build
  Implement :active, a1, 2026-01-05, 5d
  Review :crit, after a1, 2d
  Ship :milestone, m1, after a1, 0d
  Cutover :vert, v1, 2026-01-08, 0d`,
    options: { ganttToday: '2026-01-08' },
  }],
}

const EXPECTED_ROLE_COVERAGE: Record<BuiltinFamilyId, string[]> = {
  flowchart: ['connector:edge', 'shape:chrome', 'shape:group', 'shape:group-header', 'shape:node', 'text:group-header', 'text:label'],
  state: ['connector:edge', 'shape:chrome', 'shape:group', 'shape:group-header', 'shape:node', 'text:group-header', 'text:label'],
  sequence: ['connector:block', 'connector:lifeline', 'connector:message', 'shape:activation', 'shape:actor', 'shape:block', 'shape:note', 'text:label'],
  timeline: ['shape:event', 'shape:group-header', 'shape:period', 'shape:rail', 'shape:section', 'text:group-header', 'text:label', 'text:title'],
  class: ['connector:relationship', 'shape:chrome', 'shape:class-box', 'shape:group-header', 'text:cardinality', 'text:label', 'text:member'],
  er: ['connector:relationship', 'shape:cardinality', 'shape:chrome', 'shape:entity', 'shape:group-header', 'text:attribute', 'text:label'],
  journey: ['shape:actor-pill', 'shape:group-header', 'shape:score', 'shape:section', 'shape:task', 'text:actor-pill', 'text:group-header', 'text:label', 'text:title'],
  architecture: ['connector:edge', 'shape:chrome', 'shape:group', 'shape:group-header', 'shape:junction', 'shape:service', 'text:label'],
  xychart: ['connector:series', 'shape:axis', 'shape:bar', 'shape:grid', 'text:axis', 'text:title'],
  pie: ['shape:legend', 'shape:pie-slice', 'text:legend', 'text:title'],
  quadrant: ['shape:chrome', 'shape:grid', 'shape:plate', 'shape:point', 'text:axis', 'text:label', 'text:title'],
  gantt: ['shape:grid', 'shape:marker-line', 'shape:milestone', 'shape:section', 'shape:task', 'text:axis', 'text:label', 'text:section', 'text:title'],
}

interface LoweredCase {
  family: BuiltinFamilyId
  fixture: string
  doc: SceneDoc
  svg: string
  colors: DiagramColors
}

type RoleBucket = 'node' | 'edge' | 'group'

interface AuditedMark {
  kind: 'shape' | 'connector' | 'text'
  role: string
  id: string
  paint: MarkPaint
  text?: string
}

interface PaintExpectation {
  field: 'fill' | 'stroke'
  expected: string
  background: string
  minContrast: number
  label: string
  exact?: boolean
}

function mergeAuditOptions(options: RenderOptions, fixture: FamilyAuditFixture): RenderOptions {
  return { ...options, ...fixture.options }
}

function lowerAuditCase(
  family: BuiltinFamilyId,
  fixture: FamilyAuditFixture,
  options: RenderOptions = AUDIT_OPTIONS,
): LoweredCase {
  const renderOptions = mergeAuditOptions(options, fixture)
  const text = decodeXML(fixture.source)
  const normalizedSource = normalizeMermaidSource(text, renderOptions.mermaidConfig ?? {})
  const font = renderOptions.font
    ?? normalizedSource.config.fontFamily
    ?? readThemeValue(normalizedSource.config.themeVariables, 'fontFamily')
    ?? 'Inter'
  const colors = resolveDiagramColors(renderOptions, normalizedSource.config, font)
  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'
  const plugin = getFamily(diagramType as DiagramKind)
  if (!plugin?.layout || !plugin.lowerScene) throw new Error(`No lowered renderer for ${family}`)

  const normalizedRenderOptions: RenderOptions = { ...renderOptions, mermaidConfig: normalizedSource.config }
  const layoutResult = plugin.layout({ source: normalizedSource, options: normalizedRenderOptions, renderOptions: normalizedRenderOptions, colors })
  const layout: FamilyLayoutResult = 'positioned' in layoutResult
    ? layoutResult as FamilyLayoutResult
    : { positioned: layoutResult as PositionedDiagram }
  const ctx = {
    positioned: layout.positioned,
    colors: layout.colors ?? colors,
    options: layout.options ?? normalizedRenderOptions,
  }

  return {
    family,
    fixture: fixture.name,
    doc: plugin.lowerScene(ctx),
    svg: renderMermaidSVG(fixture.source, normalizedRenderOptions),
    colors: ctx.colors,
  }
}

function collectMarks(node: SceneNode, out: AuditedMark[] = []): AuditedMark[] {
  if (node.kind === 'shape' || node.kind === 'connector' || node.kind === 'text') {
    out.push({ kind: node.kind, role: node.role, id: node.id, paint: node.paint, text: node.kind === 'text' ? node.text : undefined })
  } else if (node.kind === 'group') {
    for (const child of node.children) collectMarks(child.node, out)
  }
  return out
}

function sceneMarks(doc: SceneDoc): AuditedMark[] {
  return doc.parts.flatMap(part => collectMarks(part))
}

function colorVars(svg: string, colors: DiagramColors): Map<string, string> {
  const resolved = resolveColors(colors)
  const vars = new Map<string, string>([
    ['bg', resolved.bg],
    ['fg', resolved.fg],
    ['_text', resolved.text],
    ['_text-sec', resolved.textSec],
    ['_text-muted', resolved.textMuted],
    ['_text-faint', resolved.textFaint],
    ['_line', resolved.line],
    ['_arrow', resolved.arrow],
    ['_node-fill', resolved.nodeFill],
    ['_node-stroke', resolved.nodeStroke],
    ['_group-fill', resolved.groupFill],
    ['_group-hdr', resolved.groupHdr],
    ['_inner-stroke', resolved.innerStroke],
    ['_key-badge', resolved.keyBadge],
  ])
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string' && isHexColor(value)) vars.set(key, value)
  }
  for (const match of svg.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;?/g)) {
    vars.set(match[1]!, match[2]!)
  }
  return vars
}

function resolvePaintColor(value: string | undefined, vars: Map<string, string>): string | undefined {
  if (!value || value === 'none') return undefined
  let text = value.trim()
  for (let pass = 0; pass < 12; pass++) {
    const prev = text
    text = text.replace(/var\(--([\w-]+),\s*([^()]+)\)/g, (_m, name, fallback) =>
      vars.get(name) ?? String(fallback).trim())
    text = text.replace(/var\(--([\w-]+)\)/g, (match, name) => vars.get(name) ?? match)
    text = text.replace(
      /color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,8})\s+(\d+(?:\.\d+)?)%,\s*(#[0-9a-fA-F]{3,8}|transparent)\)/g,
      (_m, fg, pct, bg) => mixHex(fg, bg === 'transparent' ? TOKENS.bg : bg, Number.parseFloat(pct)),
    )
    if (text === prev) break
  }
  const hex = text.match(/#[0-9a-fA-F]{6}/)?.[0]
  return hex?.toLowerCase()
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function textBucket(mark: AuditedMark): RoleBucket {
  if (mark.id.startsWith('block:') && mark.id.includes(':divider')) return 'edge'
  if (mark.id.startsWith('block:')) return 'group'
  if (
    mark.role === 'actor-pill' ||
    mark.role === 'group-header' ||
    mark.role === 'section' ||
    mark.role === 'title' ||
    mark.id.startsWith('group-label:') ||
    mark.id.startsWith('quadrant-label:')
  ) return 'group'
  if (mark.id.match(/^axis:[xy]:label:/)) return 'node'
  if (mark.role === 'axis' || mark.role === 'cardinality') return 'edge'
  if (mark.id.startsWith('edge-label:') || mark.id.startsWith('message:') || mark.id.startsWith('rel-label:')) return 'edge'
  if (mark.id.includes(':label') && (mark.id.startsWith('period-') || mark.id.startsWith('event:'))) return 'node'
  return 'node'
}

function textExpectation(mark: AuditedMark): PaintExpectation {
  const bucket = textBucket(mark)
  if (bucket === 'edge') {
    return { field: 'fill', expected: TOKENS.edgeText, background: TOKENS.bg, minContrast: WCAG_TEXT_AA, label: 'edge text' }
  }
  if (bucket === 'group') {
    return { field: 'fill', expected: TOKENS.groupText, background: TOKENS.groupHeader, minContrast: WCAG_TEXT_AA, label: 'group text' }
  }
  return { field: 'fill', expected: TOKENS.nodeText, background: TOKENS.nodeFill, minContrast: WCAG_TEXT_AA, label: 'node text' }
}

function shapeExpectations(mark: AuditedMark): PaintExpectation[] {
  if (mark.role === 'chrome') return []
  if (mark.role === 'grid' || mark.role === 'rail' || mark.role === 'marker-line') {
    return [{ field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'edge/grid stroke' }]
  }
  if (mark.role === 'period' && (mark.id.includes('-stem:') || mark.id.includes('-marker-'))) {
    if (mark.paint.fill && mark.paint.fill !== 'none' && mark.id.includes('-marker-core:')) {
      return [{ field: 'fill', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'edge marker fill' }]
    }
    if (mark.paint.stroke && mark.paint.stroke !== 'none') {
      return [{ field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'edge marker stroke' }]
    }
    return []
  }
  if (mark.role === 'axis') {
    const expected = mark.id.includes(':tick:') ? TOKENS.groupText : TOKENS.edgeStroke
    return [{ field: 'stroke', expected, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'axis stroke' }]
  }
  if (mark.role === 'block') {
    return [
      {
        field: 'fill',
        expected: mark.id.endsWith(':tab') ? TOKENS.groupHeader : TOKENS.groupFill,
        background: TOKENS.bg,
        minContrast: 1,
        label: 'sequence block fill',
      },
      { field: 'stroke', expected: TOKENS.groupStroke, background: TOKENS.groupFill, minContrast: WCAG_NON_TEXT, label: 'sequence block border' },
    ]
  }
  if (mark.role === 'plate') {
    return [{ field: 'fill', expected: TOKENS.groupFill, background: TOKENS.bg, minContrast: 1, label: 'group fill', exact: false }]
  }
  if (mark.role === 'group' || mark.role === 'section' || mark.role === 'plate') {
    return mark.paint.stroke && mark.paint.stroke !== 'none'
      ? [{ field: 'stroke', expected: TOKENS.groupStroke, background: TOKENS.groupFill, minContrast: WCAG_NON_TEXT, label: 'group border' }]
      : [{ field: 'fill', expected: TOKENS.groupFill, background: TOKENS.bg, minContrast: 1, label: 'group fill' }]
  }
  if (mark.role === 'group-header') {
    return [{ field: 'fill', expected: TOKENS.groupHeader, background: TOKENS.bg, minContrast: 1, label: 'group header fill' }]
  }
  if (mark.role === 'score') {
    return mark.paint.fill === TOKENS.edgeStroke
      ? [{ field: 'fill', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'score fill' }]
      : []
  }
  if (mark.role === 'cardinality') {
    return [{ field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'edge cardinality stroke' }]
  }
  if (mark.role === 'pie-slice' || mark.role === 'bar' || mark.role === 'series' || mark.role === 'legend') {
    return mark.paint.stroke
      ? [{ field: 'stroke', expected: TOKENS.nodeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'data-mark border', exact: false }]
      : []
  }
  if (mark.role === 'junction') {
    return [{ field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'junction stroke' }]
  }
  if (mark.role === 'actor-pill') return []
  if (mark.role === 'node' && mark.id.includes('_')) return []
  const out: PaintExpectation[] = []
  if (mark.paint.fill && mark.paint.fill !== 'none') {
    out.push({ field: 'fill', expected: TOKENS.nodeFill, background: TOKENS.bg, minContrast: 1, label: 'node fill' })
  }
  if (mark.paint.stroke && mark.paint.stroke !== 'none') {
    out.push({ field: 'stroke', expected: TOKENS.nodeStroke, background: TOKENS.nodeFill, minContrast: WCAG_NON_TEXT, label: 'node border' })
  }
  return out
}

function connectorExpectation(mark: AuditedMark): PaintExpectation {
  if (mark.role === 'series') {
    return { field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'data series stroke', exact: false }
  }
  return { field: 'stroke', expected: TOKENS.edgeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: `${mark.role} stroke` }
}

function expectationsFor(mark: AuditedMark): PaintExpectation[] {
  if (mark.kind === 'text') return [textExpectation(mark)]
  if (mark.kind === 'connector') return [connectorExpectation(mark)]
  return shapeExpectations(mark)
}

function auditCase(entry: LoweredCase): string[] {
  const vars = colorVars(entry.svg, entry.colors)
  const problems: string[] = []
  const marks = sceneMarks(entry.doc)
  if (marks.length === 0) problems.push(`${entry.family}: produced no auditable scene marks`)

  for (const mark of marks) {
    for (const expectation of expectationsFor(mark)) {
      const actual = resolvePaintColor(mark.paint[expectation.field], vars)
      const expected = resolvePaintColor(expectation.expected, vars)
      const background = resolvePaintColor(expectation.background, vars)
      if (!actual || !expected || !background) {
        problems.push(`${entry.family}/${entry.fixture}:${mark.id}: ${expectation.label} has unresolved ${expectation.field}=${mark.paint[expectation.field] ?? '(missing)'}`)
        continue
      }
      if (expectation.exact !== false && actual !== expected) {
        problems.push(`${entry.family}/${entry.fixture}:${mark.id}: ${expectation.label} expected ${expectation.field} ${expected}, got ${actual}`)
      }
      const ratio = contrast(actual, background)
      if (ratio < expectation.minContrast) {
        problems.push(`${entry.family}/${entry.fixture}:${mark.id}: ${expectation.label} contrast ${ratio.toFixed(2)} < ${expectation.minContrast}:1 (${actual} on ${background})`)
      }
    }
  }
  return problems
}

function allAuditCases(options: RenderOptions = AUDIT_OPTIONS): LoweredCase[] {
  return BUILTIN_FAMILY_METADATA.flatMap(({ id }) =>
    FAMILY_AUDIT_FIXTURES[id].map(fixture => lowerAuditCase(id, fixture, options)))
}

function roleCoverage(entries: LoweredCase[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {}
  for (const entry of entries) {
    const bucket = out[entry.family] ?? new Set<string>()
    for (const mark of sceneMarks(entry.doc)) bucket.add(`${mark.kind}:${mark.role}`)
    out[entry.family] = bucket
  }
  return Object.fromEntries(Object.entries(out).map(([family, roles]) => [family, [...roles].sort()]))
}

function shouldAuditTextTransform(mark: AuditedMark): mark is AuditedMark & { kind: 'text'; text: string } {
  if (mark.kind !== 'text' || !mark.text) return false
  if (mark.role === 'member' || mark.role === 'attribute' || mark.role === 'cardinality') return false
  return /[a-z]/.test(mark.text)
}

function auditTextTransforms(entry: LoweredCase): string[] {
  const problems: string[] = []
  for (const mark of sceneMarks(entry.doc)) {
    if (!shouldAuditTextTransform(mark)) continue
    if (mark.text !== mark.text.toUpperCase()) {
      problems.push(`${entry.family}/${entry.fixture}:${mark.id}: textTransform did not uppercase visible text "${mark.text}"`)
    }
  }
  return problems
}

describe('style role propagation and contrast audit', () => {
  test('audit fixtures and role contracts cover every built-in diagram family', () => {
    const families = BUILTIN_FAMILY_METADATA.map(f => f.id).sort()
    expect(Object.keys(FAMILY_AUDIT_FIXTURES).sort()).toEqual(families)
    expect(Object.keys(EXPECTED_ROLE_COVERAGE).sort()).toEqual(families)
    for (const family of families) {
      expect(FAMILY_AUDIT_FIXTURES[family].length, `${family} has audit fixtures`).toBeGreaterThan(0)
    }
  })

  test('audit fixtures exercise the expected SceneGraph roles for each family', () => {
    const coverage = roleCoverage(allAuditCases())
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      expect(coverage[id], `${id} role coverage`).toEqual([...EXPECTED_ROLE_COVERAGE[id]].sort())
    }
  })

  test('role tokens propagate to every audited scene element with contrast floors', () => {
    const problems = allAuditCases().flatMap(auditCase)
    if (problems.length > 0) {
      throw new Error(`style role audit failed (${problems.length}):\n${problems.slice(0, 80).join('\n')}`)
    }
  })

  test('text transforms reach every audited label-like text mark', () => {
    const problems = allAuditCases(TRANSFORM_AUDIT_OPTIONS).flatMap(auditTextTransforms)
    if (problems.length > 0) {
      throw new Error(`style text transform audit failed (${problems.length}):\n${problems.slice(0, 80).join('\n')}`)
    }
  })
})
