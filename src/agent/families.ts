// ============================================================================
// Family plugin registry.
//
// Provides a registration point so new diagram families can plug in without
// modifying core parse/serialize/verify dispatchers. The registry primarily
// powers universal source-based Tier 1 checks (LABEL_OVERFLOW for opaque
// bodies) and offers a forward path for full per-family ownership.
//
// Built-in families register themselves at import time (see ./families-builtin.ts).
// External code can call `registerFamily(plugin)` to add new kinds.
// ============================================================================

import type {
  DiagramKind, DiagramBody, ValidDiagramMeta, ParseError, SourceMap,
  AnyMutationOp, MutationError, LayoutWarning, VerifyOptions, Result,
} from './types.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from '../ascii/types.ts'

export interface ExtractedLabel {
  /** The label text, with quotes stripped. */
  text: string
  /** Best-effort target identifier (node id, participant, period, etc.). */
  target: string
}

export interface FamilyLayoutContext {
  source: NormalizedMermaidSource
  options: RenderOptions
  /** Render options after public-entrypoint normalization, e.g. security/font/config threading. */
  renderOptions: RenderOptions
  colors: DiagramColors
}

export interface FamilyLayoutResult<TPositioned extends PositionedDiagram = PositionedDiagram> {
  positioned: TPositioned
  /** Optional family-specific palette override for rendering/finalization. */
  colors?: DiagramColors
  /** Optional family-specific render options override for RenderContext. */
  options?: RenderOptions
  /** False when the family renderer already owns SVG accessibility metadata. */
  injectAccessibility?: boolean
}

export interface AsciiContext {
  source: NormalizedMermaidSource
  config: AsciiConfig
  colorMode: ColorMode
  theme: AsciiTheme
  options: {
    maxWidth?: number
    ganttToday?: string
  }
}

export interface FamilyPlugin {
  /** The DiagramKind this plugin owns. */
  id: DiagramKind
  /** First-non-blank-line predicate. Lowercase, leading whitespace stripped. */
  detect: (firstLineLower: string) => boolean
  /**
   * Source-based label extractor for universal Tier 1 LABEL_OVERFLOW on opaque
   * bodies. Each plugin should extract everything an agent would consider a
   * label — node text, edge text, message text, axis names, section titles.
   * The generic fallback (extractLabelsGeneric) is used when a family doesn't
   * provide its own.
   */
  extractLabels?: (source: string) => ExtractedLabel[]
  /**
   * Family-specific structured parser. `lines` are the normalized source
   * lines including the header; `opaqueSource` is the original body for
   * lossless fallback; `canonicalSource` is the full normalized text (the
   * legacy flowchart parser consumes it whole). Structured-or-opaque
   * families return ok(structured ?? opaque); error-semantics families
   * (flowchart/state) return err(ParseError[]).
   */
  parse?: (lines: string[], opaqueSource: string, meta: ValidDiagramMeta, canonicalSource: string) => Result<DiagramBody, ParseError[]>
  /**
   * Optional source-map builder, run after a successful parse. Today only
   * flowchart/state index node positions; other families return no map.
   */
  buildSourceMap?: (body: DiagramBody, canonicalSource: string) => SourceMap
  /** Optional: family-specific serializer for a structured body. */
  serialize?: (body: DiagramBody) => string
  /** Optional: family-specific structured mutation. */
  mutate?: (body: DiagramBody, op: AnyMutationOp) => Result<DiagramBody, MutationError>
  /** Optional: family-specific verify (Tier 1 + Tier 2). Returns warnings only. */
  verify?: (body: DiagramBody, opts: VerifyOptions) => LayoutWarning[]
  /** Optional: family-specific source-to-positioned layout for public SVG rendering. */
  layout?: (ctx: FamilyLayoutContext) => FamilyLayoutResult | PositionedDiagram
  /** Optional: family-specific SVG renderer fed by a positioned layout result. */
  renderSvg?: (ctx: RenderContext<PositionedDiagram>) => string
  /** Optional: family-specific ASCII renderer. */
  renderAscii?: (ctx: AsciiContext) => string
}

export interface BuiltinFamilyMetadata {
  /** Built-in DiagramKind exposed by Agentic Mermaid. */
  id: DiagramKind
  /** Human-facing family name used in docs and editor examples. */
  label: string
  /** Mermaid headers routed to this family. */
  headers: readonly string[]
  /** SDK narrower advertised for structured mutation. */
  narrower: `as${string}`
  /** Editor example category label. */
  editorDiagramType: string
  /** Basic editor example that must exist for this family. */
  editorExampleId: string
  /** Short glyph used by the editor example picker. */
  editorGlyph: string
}

export const BUILTIN_FAMILY_METADATA = [
  { id: 'flowchart', label: 'Flowchart', headers: ['flowchart', 'graph'], narrower: 'asFlowchart', editorDiagramType: 'Flowchart', editorExampleId: 'flowchart-basic', editorGlyph: 'F' },
  { id: 'state', label: 'State', headers: ['stateDiagram', 'stateDiagram-v2'], narrower: 'asState', editorDiagramType: 'State', editorExampleId: 'state-basic', editorGlyph: 'S' },
  { id: 'sequence', label: 'Sequence', headers: ['sequenceDiagram'], narrower: 'asSequence', editorDiagramType: 'Sequence', editorExampleId: 'sequence-basic', editorGlyph: 'Q' },
  { id: 'timeline', label: 'Timeline', headers: ['timeline'], narrower: 'asTimeline', editorDiagramType: 'Timeline', editorExampleId: 'timeline-basic', editorGlyph: 'T' },
  { id: 'class', label: 'Class', headers: ['classDiagram'], narrower: 'asClass', editorDiagramType: 'Class', editorExampleId: 'class-basic', editorGlyph: 'C' },
  { id: 'er', label: 'ER', headers: ['erDiagram'], narrower: 'asEr', editorDiagramType: 'ER', editorExampleId: 'er-basic', editorGlyph: 'ER' },
  { id: 'journey', label: 'Journey', headers: ['journey'], narrower: 'asJourney', editorDiagramType: 'Journey', editorExampleId: 'journey-basic', editorGlyph: 'J' },
  { id: 'architecture', label: 'Architecture', headers: ['architecture-beta'], narrower: 'asArchitecture', editorDiagramType: 'Architecture', editorExampleId: 'architecture-basic', editorGlyph: 'A' },
  { id: 'xychart', label: 'XY chart', headers: ['xychart', 'xychart-beta'], narrower: 'asXyChart', editorDiagramType: 'XY Chart', editorExampleId: 'xychart-basic', editorGlyph: 'XY' },
  { id: 'pie', label: 'Pie', headers: ['pie'], narrower: 'asPie', editorDiagramType: 'Pie', editorExampleId: 'pie-basic', editorGlyph: 'P' },
  { id: 'quadrant', label: 'Quadrant', headers: ['quadrantChart'], narrower: 'asQuadrant', editorDiagramType: 'Quadrant', editorExampleId: 'quadrant-basic', editorGlyph: '4Q' },
  { id: 'gantt', label: 'Gantt', headers: ['gantt'], narrower: 'asGantt', editorDiagramType: 'Gantt', editorExampleId: 'gantt-basic', editorGlyph: 'G' },
] as const satisfies readonly BuiltinFamilyMetadata[]

export type BuiltinFamilyId = typeof BUILTIN_FAMILY_METADATA[number]['id']

type BuiltinFamilyMetadataCoversDiagramKind =
  [Exclude<DiagramKind, BuiltinFamilyId>, Exclude<BuiltinFamilyId, DiagramKind>] extends [never, never]
    ? true
    : never

export const BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND: BuiltinFamilyMetadataCoversDiagramKind = true

export function builtinFamilyMetadata(kind: DiagramKind): BuiltinFamilyMetadata | undefined {
  return BUILTIN_FAMILY_METADATA.find(f => f.id === kind)
}

const REGISTRY = new Map<DiagramKind, FamilyPlugin>()

export function registerFamily(plugin: FamilyPlugin): void {
  REGISTRY.set(plugin.id, plugin)
}

export function getFamily(kind: DiagramKind): FamilyPlugin | undefined {
  return REGISTRY.get(kind)
}

export function knownFamilies(): DiagramKind[] {
  const builtinIds = new Set<DiagramKind>(BUILTIN_FAMILY_METADATA.map(f => f.id))
  const builtins = BUILTIN_FAMILY_METADATA
    .map(f => f.id)
    .filter(id => REGISTRY.has(id))
  const external = Array.from(REGISTRY.keys())
    .filter(id => !builtinIds.has(id))
    .sort()
  return [...builtins, ...external]
}

// ---- Generic label extractor ----------------------------------------------
//
// Catches the common Mermaid label idioms used across families:
//   - quoted strings: "Foo", 'Foo'
//   - bracketed text: [Foo], (Foo), {Foo}, [[Foo]], [(Foo)], [/Foo/], etc.
//   - colon-separated text: `A->>B: Foo`, `2020 : Foo`, `title Foo`
//
// Best-effort by design — used as a fallback when a family doesn't ship its
// own extractor. Over-counting (some matches are syntax, not labels) is
// acceptable because LABEL_OVERFLOW only fires on text exceeding the cap.
// ---------------------------------------------------------------------------

export function extractLabelsGeneric(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  let i = 0
  for (const raw of lines) {
    i++
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    // Quoted strings first (highest precedence — they're explicit labels).
    for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g)) {
      const text = m[1] ?? m[2] ?? ''
      if (text) out.push({ text, target: `line${i}` })
    }
    // Bracketed text (square, paren, curly — any nesting depth handled flatly).
    for (const m of line.matchAll(/[\[\(\{]+([^\[\]\(\)\{\}]+?)[\]\)\}]+/g)) {
      const text = (m[1] ?? '').trim()
      if (text && !text.match(/^[A-Za-z_][\w-]*$/)) out.push({ text, target: `line${i}` })
    }
    // Colon-separated suffix (`A->>B: text`, `2020 : text`, `title: text`).
    const colon = line.indexOf(':')
    if (colon >= 0 && colon < line.length - 1) {
      const after = line.slice(colon + 1).trim()
      // Filter: not a CSS-ish value, not another keyword
      if (after && !after.match(/^[\d.]+$/) && after.length >= 2) {
        out.push({ text: after, target: `line${i}` })
      }
    }
  }
  return out
}
