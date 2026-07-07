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
import type { PositionedDiagram, RenderOptions } from '../types.ts'
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

const AUDIT_OPTIONS: RenderOptions = {
  bg: TOKENS.bg,
  fg: TOKENS.fg,
  embedFontImport: false,
  style: {
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
  },
}

const FAMILY_AUDIT_CASES: Record<BuiltinFamilyId, string> = {
  flowchart: `flowchart TD
  subgraph backend [Backend]
    A[Parse] -->|ok| B{Route?}
    B -->|ship| C[Deploy]
  end`,
  state: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> [*] : approve`,
  sequence: `sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: request
  S-->>U: response`,
  timeline: `timeline
  title Roadmap
  2025 : Alpha : Beta
  2026 : GA`,
  class: `classDiagram
  class Account {
    +id: string
    +close() void
  }
  Account <|-- Savings
  Account "1" o-- "*" Transaction : logs`,
  er: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string id PK
  }
  ORDER {
    string id
  }`,
  journey: `journey
  title Checkout
  section Browse
    Find product: 4: Shopper
  section Buy
    Pay: 3: Shopper`,
  architecture: `architecture-beta
  group backend(cloud)[Backend]
  service api(server)[API] in backend
  service db(database)[Database] in backend
  service cache(disk)[Cache] in backend
  api:R -[reads]-> L:db
  api:B --> T:cache`,
  xychart: `xychart-beta
  title "Revenue"
  x-axis [Q1, Q2, Q3]
  y-axis "USD" 0 --> 100
  bar [45, 62, 80]`,
  pie: `pie title Plans
  "Free" : 60
  "Pro" : 30
  "Enterprise" : 10`,
  quadrant: `quadrantChart
  title Prioritize
  x-axis Low Effort --> High Effort
  y-axis Low Value --> High Value
  quadrant-1 Plan
  quadrant-2 Invest
  quadrant-3 Ignore
  quadrant-4 Monitor
  Quick win: [0.2, 0.8]
  Money pit: [0.8, 0.2]`,
  gantt: `gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Build
  Implement :a1, 2026-01-05, 5d
  Review :after a1, 2d`,
}

interface LoweredCase {
  family: BuiltinFamilyId
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
}

interface PaintExpectation {
  field: 'fill' | 'stroke'
  expected: string
  background: string
  minContrast: number
  label: string
  exact?: boolean
}

function lowerAuditCase(family: BuiltinFamilyId, source: string): LoweredCase {
  const text = decodeXML(source)
  const normalizedSource = normalizeMermaidSource(text, AUDIT_OPTIONS.mermaidConfig ?? {})
  const font = AUDIT_OPTIONS.font
    ?? normalizedSource.config.fontFamily
    ?? readThemeValue(normalizedSource.config.themeVariables, 'fontFamily')
    ?? 'Inter'
  const colors = resolveDiagramColors(AUDIT_OPTIONS, normalizedSource.config, font)
  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'
  const plugin = getFamily(diagramType as DiagramKind)
  if (!plugin?.layout || !plugin.lowerScene) throw new Error(`No lowered renderer for ${family}`)

  const renderOptions: RenderOptions = { ...AUDIT_OPTIONS, mermaidConfig: normalizedSource.config }
  const layoutResult = plugin.layout({ source: normalizedSource, options: AUDIT_OPTIONS, renderOptions, colors })
  const layout: FamilyLayoutResult = 'positioned' in layoutResult
    ? layoutResult as FamilyLayoutResult
    : { positioned: layoutResult as PositionedDiagram }
  const ctx = {
    positioned: layout.positioned,
    colors: layout.colors ?? colors,
    options: layout.options ?? renderOptions,
  }

  return {
    family,
    doc: plugin.lowerScene(ctx),
    svg: renderMermaidSVG(source, AUDIT_OPTIONS),
    colors: ctx.colors,
  }
}

function collectMarks(node: SceneNode, out: AuditedMark[] = []): AuditedMark[] {
  if (node.kind === 'shape' || node.kind === 'connector' || node.kind === 'text') {
    out.push({ kind: node.kind, role: node.role, id: node.id, paint: node.paint })
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
      ? [{ field: 'stroke', expected: TOKENS.nodeStroke, background: TOKENS.bg, minContrast: WCAG_NON_TEXT, label: 'data-mark border' }]
      : []
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
        problems.push(`${entry.family}:${mark.id}: ${expectation.label} has unresolved ${expectation.field}=${mark.paint[expectation.field] ?? '(missing)'}`)
        continue
      }
      if (expectation.exact !== false && actual !== expected) {
        problems.push(`${entry.family}:${mark.id}: ${expectation.label} expected ${expectation.field} ${expected}, got ${actual}`)
      }
      const ratio = contrast(actual, background)
      if (ratio < expectation.minContrast) {
        problems.push(`${entry.family}:${mark.id}: ${expectation.label} contrast ${ratio.toFixed(2)} < ${expectation.minContrast}:1 (${actual} on ${background})`)
      }
    }
  }
  return problems
}

describe('style role propagation and contrast audit', () => {
  test('audit cases cover every built-in diagram family', () => {
    expect(Object.keys(FAMILY_AUDIT_CASES).sort()).toEqual(BUILTIN_FAMILY_METADATA.map(f => f.id).sort())
  })

  test('role tokens propagate to every audited scene element with contrast floors', () => {
    const problems = BUILTIN_FAMILY_METADATA.flatMap(({ id }) => auditCase(lowerAuditCase(id, FAMILY_AUDIT_CASES[id])))
    if (problems.length > 0) {
      throw new Error(`style role audit failed (${problems.length}):\n${problems.slice(0, 80).join('\n')}`)
    }
  })
})
