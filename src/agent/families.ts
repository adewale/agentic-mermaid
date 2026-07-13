// ============================================================================
// Family descriptor registry.
//
// Provides a registration point so new diagram families can plug in without
// modifying core parse/serialize/verify dispatchers. The registry primarily
// powers universal source-based Tier 1 checks (LABEL_OVERFLOW for opaque
// bodies) and offers a forward path for full per-family ownership.
//
// Identity, detection, discovery metadata and behavioral hooks live in the
// same descriptor. Built-in modules augment their seeded descriptors at import
// time (see ./families-builtin.ts); namespaced extensions register atomically.
// ============================================================================

import type {
  DiagramKind, DiagramBody, FamilyParsedBody, ValidDiagramMeta, ParseError, SourceMap, FamilyId, ExternalFamilyId,
  AnyMutationOp, MutationError, LayoutWarning, VerifyOptions, Result, RenderedLayout,
} from './types.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { BUILTIN_SCENE_ROLE_TRAITS, type SceneRole } from '../scene/roles.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from '../ascii/types.ts'
import type { TerminalConnectorProjection } from '../terminal-style.ts'
import {
  ExtensionCollisionError,
  createExtensionIdentity,
  parseExtensionId,
  type ExtensionIdentity,
} from '../shared/extension-identity.ts'

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

/**
 * Public, family-neutral view of one already-positioned artifact. The family
 * id is deliberately supplied by the registry caller rather than repeated by
 * every projector, so namespaced extensions can implement this hook while the
 * public layout envelope records their registered family id.
 */
export type FamilyPositionedView = Pick<
  RenderedLayout,
  'version' | 'nodes' | 'edges' | 'groups' | 'certificates' | 'bounds'
>

export interface FamilyPositionedProjectionOptions {
  /** Include route/containment proof sidecars when the family supports them. */
  debug?: boolean
}

export interface FamilyPositionedProjectionContext<
  TPositioned extends PositionedDiagram = PositionedDiagram,
> {
  /** The exact artifact produced by this descriptor's `layout` hook. */
  positioned: TPositioned
  options: Readonly<FamilyPositionedProjectionOptions>
}

export interface AsciiContext {
  source: NormalizedMermaidSource
  config: AsciiConfig
  colorMode: ColorMode
  theme: AsciiTheme
  /** Connector semantics derived from the exact positioned Scene artifact.
   * Family terminal renderers receive this projection beside their source
   * view so output and receipts share one semantic contract. */
  connectorProjection: readonly TerminalConnectorProjection[]
  options: {
    maxWidth?: number
    targetWidth?: number
    ganttToday?: string
  }
}

/** One normalized source envelope shared by every family parser. */
export interface FamilyParseContext {
  source: NormalizedMermaidSource
  /** Family grammar view: header included, universal accessibility removed. */
  lines: readonly string[]
  /** Full normalized logical lines for compatibility parsers that still model accessibility. */
  envelopeLines: readonly string[]
  /** Original post-wrapper body for lossless opaque preservation. */
  opaqueSource: string
  meta: ValidDiagramMeta
  canonicalSource: string
}

export type FamilyMaturity = 'stable' | 'beta' | 'experimental'

/** Capability columns are owned by the descriptor contract. Reports and
 * discovery surfaces project this vocabulary instead of maintaining a second
 * hook-inference table. */
export const FAMILY_CAPABILITY_COLUMNS = [
  'detection',
  'source-preservation',
  'parse',
  'serialize',
  'mutation',
  'verify',
  'layout',
  'scene',
  'svg',
  'terminal',
] as const

export type FamilyCapability = (typeof FAMILY_CAPABILITY_COLUMNS)[number]
export type FamilyCapabilityState = 'native' | 'source-preserved' | 'diagnosed' | 'not-applicable' | 'absent'

export interface FamilyCapabilityEvidence {
  capability: FamilyCapability
  state: FamilyCapabilityState
  evidence: readonly string[]
}

/** Descriptor-owned Mermaid config section contract. */
export interface FamilyConfigContract {
  section: string
  keys: readonly string[]
  noopKeys?: readonly string[]
}

export interface FamilyOperations {
  /**
   * Source-based label extractor for universal Tier 1 LABEL_OVERFLOW on opaque
   * bodies. Each plugin should extract everything an agent would consider a
   * label — node text, edge text, message text, axis names, section titles.
   * The generic fallback (extractLabelsGeneric) is used when a family doesn't
   * provide its own.
   */
  extractLabels?: (source: string) => ExtractedLabel[]
  /**
   * Family-specific structured parser. The context carries one normalized
   * source envelope: `lines` is the family grammar view (header included,
   * universal accessibility removed), `envelopeLines` retains those universal
   * lines, and `opaqueSource` is the original post-wrapper body for lossless
   * fallback. Structured-or-opaque
   * families return ok(structured ?? opaque); error-semantics families
   * (flowchart/state) return err(ParseError[]).
   */
  parse?: (ctx: FamilyParseContext) => Result<FamilyParsedBody, ParseError[]>
  /**
   * Optional source-map builder, run after a successful parse. Today only
   * flowchart/state index node positions; other families return no map.
   */
  buildSourceMap?: (body: DiagramBody, canonicalSource: string) => SourceMap
  /** Optional: family-specific serializer for a structured body. */
  serialize?: (body: FamilyParsedBody) => string
  /** Optional: family-specific structured mutation. */
  mutate?: (body: DiagramBody, op: AnyMutationOp) => Result<DiagramBody, MutationError>
  /** Optional: family-specific verify (Tier 1 + Tier 2). Returns warnings only. */
  verify?: (body: FamilyParsedBody, opts: VerifyOptions) => LayoutWarning[]
  /** Optional: family-specific source-to-positioned layout for public SVG rendering. */
  layout?: (ctx: FamilyLayoutContext) => FamilyLayoutResult | PositionedDiagram
  /**
   * Optional typed projection of that same positioned artifact for layout
   * JSON, verification, route certificates, and quality metrics. This is a
   * view, not a second layout path: implementations must not parse or lay out
   * source again.
   */
  projectPositioned?: (ctx: FamilyPositionedProjectionContext) => FamilyPositionedView
  /** Optional extension fallback for descriptors that cannot lower SceneDoc.
   * Built-ins use lowerScene exclusively so graphical behavior has one waist. */
  renderSvg?: (ctx: RenderContext<PositionedDiagram>) => string
  /**
   * Optional: family-specific SceneGraph lowering (SPEC §3.1). Produces the
   * semantic render-mark tree that style backends consume. Lowered families
   * serialize exclusively through a registered backend.
   */
  lowerScene?: (ctx: RenderContext<PositionedDiagram>) => SceneDoc
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
  /** Minimal canonical source: correct header + core syntax. Exposed via
   *  `am capabilities` so agents learn each family's dialect from the
   *  discovery envelope instead of error-message trial-and-error (the
   *  onboarding probes burned most of their iterations on exactly this —
   *  architecture-beta headers, quadrant [x, y] brackets). A test pins
   *  every example to parse, verify, and render clean. */
  example: string
}

export interface FamilyDescriptor extends FamilyOperations {
  readonly contractVersion: 1
  readonly identity: ExtensionIdentity<'family'>
  readonly id: FamilyId
  readonly upstreamId?: string
  readonly label: string
  /** Canonical authored headers owned by this descriptor. */
  readonly headers: readonly string[]
  /** Supported compatibility headers that are not upstream public-family claims. */
  readonly aliases: readonly string[]
  readonly maturity: FamilyMaturity
  /** Higher priorities are consulted first; equal priorities sort by id. */
  readonly collisionPriority: number
  /** Strict public-renderer detector over one normalized logical line. */
  readonly detect: (firstLineLower: string) => boolean
  /** Agent parser detector for malformed-but-recognizable native headers. */
  readonly detectLoose?: (firstLineLower: string) => boolean
  readonly config?: FamilyConfigContract
  readonly semanticRoles: readonly string[]
  readonly capabilityEvidence: readonly FamilyCapabilityEvidence[]
  /** Built-in-only compatibility/discovery projection fields. */
  readonly narrower?: `as${string}`
  readonly editorDiagramType?: string
  readonly editorExampleId?: string
  readonly editorGlyph?: string
  readonly example?: string
}

/** Compatibility name retained while callers migrate to FamilyDescriptor. */
export type FamilyPlugin = FamilyDescriptor

interface BuiltinFamilyDescriptorSeed extends BuiltinFamilyMetadata {
  upstreamId: string
  maturity: FamilyMaturity
  detect: (firstLineLower: string) => boolean
  detectLoose?: (firstLineLower: string) => boolean
  aliases?: readonly string[]
  semanticRoles: readonly SceneRole[]
  config: FamilyConfigContract
}

function builtinFamilyCapabilityEvidence(): readonly FamilyCapabilityEvidence[] {
  const lifecycleEvidence = ['src/__tests__/property-all-families-fuzz.test.ts'] as const
  return [
    { capability: 'detection', state: 'native', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
    { capability: 'source-preservation', state: 'native', evidence: lifecycleEvidence },
    { capability: 'parse', state: 'native', evidence: lifecycleEvidence },
    { capability: 'serialize', state: 'native', evidence: lifecycleEvidence },
    { capability: 'mutation', state: 'native', evidence: lifecycleEvidence },
    { capability: 'verify', state: 'native', evidence: lifecycleEvidence },
    { capability: 'layout', state: 'native', evidence: ['src/__tests__/positioned-artifact-convergence.test.ts'] },
    { capability: 'scene', state: 'native', evidence: ['src/__tests__/section-a-family-descriptor-conformance.test.ts'] },
    { capability: 'svg', state: 'native', evidence: ['src/__tests__/svg-equivalence.test.ts'] },
    { capability: 'terminal', state: 'native', evidence: ['src/__tests__/render-family-hooks.test.ts'] },
  ]
}

const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = [
  { id: 'flowchart', upstreamId: 'flowchart-v2', maturity: 'stable', label: 'Flowchart', headers: ['flowchart', 'graph'], narrower: 'asFlowchart', editorDiagramType: 'Flowchart', editorExampleId: 'flowchart-basic', editorGlyph: 'F',
    config: { section: 'flowchart', keys: ['nodeSpacing', 'rankSpacing', 'wrappingWidth', 'titleTopMargin', 'subGraphTitleMargin', 'arrowMarkerAbsolute', 'diagramPadding', 'htmlLabels', 'curve', 'padding', 'defaultRenderer', 'inheritDir'], noopKeys: ['arrowMarkerAbsolute', 'curve', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'inheritDir', 'padding', 'subGraphTitleMargin', 'titleTopMargin'] },
    aliases: ['swimlane'],
    detect: (line: string) => /^(?:flowchart|graph|swimlane)(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'group', 'group-header', 'edge', 'edge-label', 'node', 'note', 'label', 'icon'],
    example: 'flowchart TD\n  A[Start] --> B{Ship?}\n  B -->|yes| C[Deploy]\n  B -->|no| D[Fix]' },
  { id: 'state', upstreamId: 'stateDiagram', maturity: 'stable', label: 'State', headers: ['stateDiagram', 'stateDiagram-v2'], narrower: 'asState', editorDiagramType: 'State', editorExampleId: 'state-basic', editorGlyph: 'S',
    config: { section: 'state', keys: ['arrowMarkerAbsolute', 'compositTitleSize', 'defaultRenderer', 'dividerMargin', 'edgeLengthFactor', 'fontSize', 'fontSizeFactor', 'forkHeight', 'forkWidth', 'labelHeight', 'miniPadding', 'nodeSpacing', 'noteMargin', 'padding', 'radius', 'rankSpacing', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin'] },
    detect: (line: string) => /^statediagram(?:-v2)?\s*$/.test(line),
    detectLoose: (line: string) => /^statediagram(?:-v2)?(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'group', 'group-header', 'edge', 'edge-label', 'node', 'note', 'label', 'icon'],
    example: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> [*] : approve' },
  { id: 'sequence', upstreamId: 'sequence', maturity: 'stable', label: 'Sequence', headers: ['sequenceDiagram'], narrower: 'asSequence', editorDiagramType: 'Sequence', editorExampleId: 'sequence-basic', editorGlyph: 'Q',
    config: { section: 'sequence', keys: ['actorMargin', 'width', 'height', 'diagramMarginX', 'diagramMarginY', 'messageMargin', 'noteMargin', 'activationWidth', 'showSequenceNumbers', 'boxMargin', 'boxTextMargin', 'messageAlign', 'mirrorActors', 'bottomMarginAdj', 'rightAngles', 'wrap', 'wrapPadding', 'labelBoxWidth', 'labelBoxHeight', 'hideUnusedParticipants', 'forceMenus', 'arrowMarkerAbsolute', 'noteAlign', 'actorFontSize', 'actorFontFamily', 'actorFontWeight', 'noteFontSize', 'noteFontFamily', 'noteFontWeight', 'messageFontSize', 'messageFontFamily', 'messageFontWeight', 'useMaxWidth', 'useWidth'], noopKeys: ['actorFontFamily', 'actorFontSize', 'actorFontWeight', 'arrowMarkerAbsolute', 'bottomMarginAdj', 'boxMargin', 'boxTextMargin', 'forceMenus', 'hideUnusedParticipants', 'labelBoxHeight', 'labelBoxWidth', 'messageAlign', 'messageFontFamily', 'messageFontSize', 'messageFontWeight', 'mirrorActors', 'noteAlign', 'noteFontFamily', 'noteFontSize', 'noteFontWeight', 'rightAngles', 'useMaxWidth', 'useWidth', 'wrap', 'wrapPadding'] },
    detect: (line: string) => /^sequencediagram\s*$/.test(line),
    detectLoose: (line: string) => /^sequencediagram(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'actor', 'lifeline', 'activation', 'message', 'block', 'group', 'note', 'label', 'icon'],
    example: 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: request\n  S-->>U: response' },
  { id: 'timeline', upstreamId: 'timeline', maturity: 'experimental', label: 'Timeline', headers: ['timeline'], narrower: 'asTimeline', editorDiagramType: 'Timeline', editorExampleId: 'timeline-basic', editorGlyph: 'T',
    config: { section: 'timeline', keys: ['disableMulticolor', 'sectionFills', 'sectionColours', 'diagramMarginX', 'diagramMarginY', 'leftMargin', 'width', 'height', 'padding', 'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'taskFontSize', 'taskFontFamily', 'taskMargin', 'activationWidth', 'textPlacement', 'actorColours', 'useMaxWidth', 'useWidth'], noopKeys: ['diagramMarginX', 'diagramMarginY', 'leftMargin', 'width', 'height', 'padding', 'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'taskFontSize', 'taskFontFamily', 'taskMargin', 'activationWidth', 'textPlacement', 'actorColours', 'useMaxWidth', 'useWidth'] },
    detect: (line: string) => /^timeline(?:\s+(?:td|tb|lr|bt|rl))?\s*$/.test(line),
    detectLoose: (line: string) => /^timeline(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'chrome', 'rail', 'title', 'section', 'group-header', 'period', 'event', 'label'],
    example: 'timeline\n  title Roadmap\n  2025 : Alpha : Beta\n  2026 : GA' },
  { id: 'class', upstreamId: 'classDiagram', maturity: 'stable', label: 'Class', headers: ['classDiagram'], narrower: 'asClass', editorDiagramType: 'Class', editorExampleId: 'class-basic', editorGlyph: 'C',
    config: { section: 'class', keys: ['nodeSpacing', 'rankSpacing', 'titleTopMargin', 'arrowMarkerAbsolute', 'dividerMargin', 'padding', 'textHeight', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'hideEmptyMembersBox', 'hierarchicalNamespaces'], noopKeys: ['arrowMarkerAbsolute', 'defaultRenderer', 'diagramPadding', 'dividerMargin', 'hideEmptyMembersBox', 'htmlLabels', 'padding', 'textHeight', 'titleTopMargin'] },
    detect: (line: string) => /^classdiagram\s*$/.test(line),
    detectLoose: (line: string) => /^classdiagram(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'group', 'group-header', 'class-box', 'member', 'relationship', 'cardinality', 'note', 'label'],
    example: 'classDiagram\n  class Account {\n    +id: string\n    +close() void\n  }\n  Account <|-- Savings\n  Account "1" o-- "*" Transaction : logs' },
  { id: 'er', upstreamId: 'er', maturity: 'stable', label: 'ER', headers: ['erDiagram'], narrower: 'asEr', editorDiagramType: 'ER', editorExampleId: 'er-basic', editorGlyph: 'ER',
    config: { section: 'er', keys: ['layoutDirection', 'nodeSpacing', 'rankSpacing', 'titleTopMargin', 'diagramPadding', 'minEntityWidth', 'minEntityHeight', 'entityPadding', 'stroke', 'fill', 'fontSize'], noopKeys: ['diagramPadding', 'entityPadding', 'fill', 'fontSize', 'minEntityHeight', 'minEntityWidth', 'stroke', 'titleTopMargin'] },
    detect: (line: string) => /^erdiagram(?:\s+subgraph\b.*)?\s*$/.test(line),
    detectLoose: (line: string) => /^erdiagram(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'group', 'group-header', 'entity', 'attribute', 'relationship', 'cardinality', 'label'],
    example: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id\n  }' },
  { id: 'journey', upstreamId: 'journey', maturity: 'stable', label: 'Journey', headers: ['journey'], narrower: 'asJourney', editorDiagramType: 'Journey', editorExampleId: 'journey-basic', editorGlyph: 'J',
    config: { section: 'journey', keys: ['diagramMarginX', 'diagramMarginY', 'leftMargin', 'maxLabelWidth', 'width', 'height', 'taskFontSize', 'taskFontFamily', 'taskMargin', 'actorColours', 'sectionFills', 'sectionColours', 'titleColor', 'titleFontFamily', 'titleFontSize', 'useMaxWidth', 'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement'], noopKeys: ['boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement'] },
    detect: (line: string) => /^journey\s*$/.test(line),
    detectLoose: (line: string) => /^journey(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'title', 'series', 'grid', 'axis', 'rail', 'legend', 'actor', 'section', 'group-header', 'task', 'marker-line', 'label', 'score'],
    example: 'journey\n  title Checkout\n  section Browse\n    Find product: 4: Shopper\n  section Buy\n    Pay: 3: Shopper' },
  { id: 'architecture', upstreamId: 'architecture', maturity: 'stable', label: 'Architecture', headers: ['architecture-beta'], narrower: 'asArchitecture', editorDiagramType: 'Architecture', editorExampleId: 'architecture-basic', editorGlyph: 'A',
    config: { section: 'architecture', keys: ['padding', 'iconSize', 'fontSize', 'nodeSeparation', 'idealEdgeLengthMultiplier', 'edgeElasticity', 'numIter', 'seed', 'randomize'], noopKeys: ['edgeElasticity', 'numIter', 'randomize', 'seed'] },
    aliases: ['architecture'],
    detect: (line: string) => /^architecture(?:-beta)?\s*$/.test(line),
    detectLoose: (line: string) => /^architecture(?:-beta)?(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'title', 'group', 'group-header', 'icon', 'label', 'service', 'junction', 'edge'],
    example: 'architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[Database] in backend\n  service cache(disk)[Cache] in backend\n  api:R --> L:db\n  api:B -[reads]-> T:cache' },
  { id: 'xychart', upstreamId: 'xychart', maturity: 'stable', label: 'XY chart', headers: ['xychart', 'xychart-beta'], narrower: 'asXyChart', editorDiagramType: 'XY Chart', editorExampleId: 'xychart-basic', editorGlyph: 'XY',
    config: { section: 'xyChart', keys: ['width', 'height', 'useMaxWidth', 'useWidth', 'titleFontSize', 'titlePadding', 'chartOrientation', 'plotReservedSpacePercent', 'showDataLabel', 'showTitle', 'showLegend', 'legendFontSize', 'legendPadding', 'xAxis', 'yAxis'] },
    detect: (line: string) => /^xychart(?:-beta)?(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'grid', 'bar', 'series', 'point', 'axis', 'legend', 'title', 'label'],
    example: 'xychart-beta\n  title "Revenue"\n  x-axis [Q1, Q2, Q3]\n  y-axis "USD" 0 --> 100\n  bar [45, 62, 80]' },
  { id: 'pie', upstreamId: 'pie', maturity: 'stable', label: 'Pie', headers: ['pie'], narrower: 'asPie', editorDiagramType: 'Pie', editorExampleId: 'pie-basic', editorGlyph: 'P',
    config: { section: 'pie', keys: ['textPosition', 'donutHole', 'legendPosition', 'highlightSlice', 'useMaxWidth', 'useWidth'], noopKeys: ['useMaxWidth', 'useWidth'] },
    detect: (line: string) => /^pie(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'chrome', 'pie-slice', 'legend', 'title', 'label'],
    example: 'pie title Plans\n  "Free" : 60\n  "Pro" : 30\n  "Enterprise" : 10' },
  { id: 'quadrant', upstreamId: 'quadrantChart', maturity: 'stable', label: 'Quadrant', headers: ['quadrantChart'], narrower: 'asQuadrant', editorDiagramType: 'Quadrant', editorExampleId: 'quadrant-basic', editorGlyph: '4Q',
    config: { section: 'quadrantChart', keys: ['chartWidth', 'chartHeight', 'titleFontSize', 'titlePadding', 'quadrantPadding', 'quadrantLabelFontSize', 'xAxisLabelFontSize', 'yAxisLabelFontSize', 'xAxisLabelPadding', 'yAxisLabelPadding', 'pointLabelFontSize', 'pointRadius', 'pointTextPadding', 'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth', 'useMaxWidth', 'quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth'], noopKeys: ['quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth'] },
    aliases: ['quadrant'],
    detect: (line: string) => /^quadrant(?:chart)?\s*$/.test(line),
    detectLoose: (line: string) => /^quadrant(?:chart)?(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'chrome', 'plate', 'grid', 'point', 'axis', 'title', 'label'],
    example: 'quadrantChart\n  title Prioritize\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  Quick win: [0.2, 0.8]\n  Money pit: [0.8, 0.2]' },
  { id: 'gantt', upstreamId: 'gantt', maturity: 'stable', label: 'Gantt', headers: ['gantt'], narrower: 'asGantt', editorDiagramType: 'Gantt', editorExampleId: 'gantt-basic', editorGlyph: 'G',
    config: { section: 'gantt', keys: ['displayMode', 'barHeight', 'topAxis', 'tickInterval', 'axisFormat', 'barGap', 'topPadding', 'leftPadding', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday'], noopKeys: ['barGap', 'topPadding', 'leftPadding', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday'] },
    detect: (line: string) => /^gantt\s*$/.test(line),
    detectLoose: (line: string) => /^gantt(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'defs', 'chrome', 'section', 'grid', 'axis', 'label', 'task', 'milestone', 'edge', 'marker-line', 'title'],
    example: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Implement :a1, 2026-01-05, 5d\n  Review :after a1, 2d' },
  { id: 'mindmap', upstreamId: 'mindmap', maturity: 'stable', label: 'Mindmap', headers: ['mindmap'], narrower: 'asMindmap', editorDiagramType: 'Mindmap', editorExampleId: 'mindmap-basic', editorGlyph: 'M',
    config: { section: 'mindmap', keys: ['padding', 'maxNodeWidth'] },
    detect: (line: string) => /^mindmap\s*$/.test(line),
    detectLoose: (line: string) => /^mindmap(?:\s|$)/.test(line),
    semanticRoles: ['prelude', 'chrome', 'edge', 'node', 'icon', 'label'],
    example: 'mindmap\n  root((Product))\n    Research\n      Interviews\n      Evidence\n    Delivery\n      Launch' },
  { id: 'gitgraph', upstreamId: 'gitGraph', maturity: 'stable', label: 'GitGraph', headers: ['gitGraph'], narrower: 'asGitGraph', editorDiagramType: 'GitGraph', editorExampleId: 'gitgraph-basic', editorGlyph: 'Git',
    config: { section: 'gitGraph', keys: ['showBranches', 'showCommitLabel', 'mainBranchName', 'mainBranchOrder', 'parallelCommits', 'rotateCommitLabel'] },
    detect: (line: string) => /^gitgraph(?:\s+(?:lr|tb|bt))?\s*:?\s*$/.test(line),
    detectLoose: (line: string) => /^gitgraph(?:\s|:|$)/.test(line),
    semanticRoles: ['prelude', 'chrome', 'title', 'group', 'rail', 'edge', 'node', 'label'],
    example: 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"\n  checkout main\n  commit id:"release"\n  merge feature id:"merge"' },
] as const satisfies readonly BuiltinFamilyDescriptorSeed[]

export type BuiltinFamilyId = typeof BUILTIN_FAMILY_DESCRIPTOR_SEEDS[number]['id']

function seedBuiltinDescriptor(seed: BuiltinFamilyDescriptorSeed): FamilyDescriptor {
  return freezeDescriptor({
    ...seed,
    contractVersion: 1 as const,
    identity: createExtensionIdentity({
      id: `family:${seed.id}`,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: 'family-descriptor@1' },
      provenance: { owner: 'agentic-mermaid', source: 'built-in' },
    }),
    collisionPriority: 100,
    aliases: seed.aliases ?? [],
    semanticRoles: seed.semanticRoles,
    capabilityEvidence: builtinFamilyCapabilityEvidence(),
  })
}

/** The only mutable family authority; metadata below is a compatibility view. */
const REGISTRY = new Map<FamilyId, FamilyDescriptor>(
  BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(seed => [seed.id, seedBuiltinDescriptor(seed)]),
)

export const BUILTIN_FAMILY_METADATA: readonly BuiltinFamilyMetadata[] = Object.freeze(
  BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(({ id, label, headers, narrower, editorDiagramType, editorExampleId, editorGlyph, example }) =>
    Object.freeze({ id, label, headers, narrower, editorDiagramType, editorExampleId, editorGlyph, example })),
)

type BuiltinFamilyMetadataCoversDiagramKind =
  [Exclude<DiagramKind, BuiltinFamilyId>, Exclude<BuiltinFamilyId, DiagramKind>] extends [never, never]
    ? true
    : never

export const BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND: BuiltinFamilyMetadataCoversDiagramKind = true

export function builtinFamilyMetadata(kind: DiagramKind): BuiltinFamilyMetadata | undefined {
  return BUILTIN_FAMILY_METADATA.find(f => f.id === kind)
}

const BUILTIN_IDS = new Set<string>(BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(seed => seed.id))
const OPERATION_KEYS = new Set<keyof FamilyOperations>([
  'extractLabels', 'parse', 'buildSourceMap', 'serialize', 'mutate', 'verify',
  'layout', 'projectPositioned', 'renderSvg', 'lowerScene', 'renderAscii',
])

export function isBuiltinFamilyId(id: string): id is BuiltinFamilyId {
  return BUILTIN_IDS.has(id)
}

export function isExternalFamilyId(id: string): id is ExternalFamilyId {
  return parseExtensionId(id)?.kind === 'family'
}

function normalizedHeader(header: string): string {
  return header.trim().toLowerCase()
}

function freezeDescriptor(descriptor: FamilyDescriptor): FamilyDescriptor {
  return Object.freeze({
    ...descriptor,
    identity: createExtensionIdentity({
      id: descriptor.identity.id,
      kind: descriptor.identity.kind,
      version: descriptor.identity.version,
      compatibility: descriptor.identity.compatibility,
      provenance: descriptor.identity.provenance,
    }),
    headers: Object.freeze([...descriptor.headers]),
    aliases: Object.freeze([...descriptor.aliases]),
    semanticRoles: Object.freeze([...descriptor.semanticRoles]),
    capabilityEvidence: Object.freeze(descriptor.capabilityEvidence.map(item => Object.freeze({
      ...item,
      evidence: Object.freeze([...item.evidence]),
    }))),
    ...(descriptor.config
      ? { config: Object.freeze({
          ...descriptor.config,
          keys: Object.freeze([...descriptor.config.keys]),
          ...(descriptor.config.noopKeys ? { noopKeys: Object.freeze([...descriptor.config.noopKeys]) } : {}),
        }) }
      : {}),
  })
}

function detectorClaims(descriptor: FamilyDescriptor, header: string): boolean {
  const normalized = normalizedHeader(header)
  return descriptor.detect(normalized) || Boolean(descriptor.detectLoose?.(normalized))
}

const FAMILY_CAPABILITY_STATES = new Set<FamilyCapabilityState>([
  'native', 'source-preserved', 'diagnosed', 'not-applicable', 'absent',
])

function validSceneRoleDeclaration(role: string): boolean {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SCENE_ROLE_TRAITS, role)) return true
  return /^[a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._/-]*$/i.test(role)
}

function expectedExtensionCapabilityState(
  descriptor: FamilyDescriptor,
  capability: FamilyCapability,
): FamilyCapabilityState {
  switch (capability) {
    case 'detection': return 'native'
    case 'source-preservation': return descriptor.parse ? 'native' : 'source-preserved'
    case 'parse': return descriptor.parse ? 'native' : 'source-preserved'
    case 'serialize': return descriptor.serialize ? 'native' : 'source-preserved'
    // The public mutation verbs remain a closed, built-in-only union. Merely
    // registering a callback cannot make an extension mutation reachable.
    case 'mutation': return 'diagnosed'
    case 'verify': return descriptor.verify ? 'native' : 'diagnosed'
    case 'layout': return descriptor.layout ? 'native' : 'absent'
    case 'scene': return descriptor.lowerScene ? 'native' : 'absent'
    case 'svg': return descriptor.layout && (descriptor.lowerScene || descriptor.renderSvg) ? 'native' : 'absent'
    case 'terminal': return descriptor.renderAscii ? 'native' : 'absent'
  }
}

function validateDescriptor(descriptor: FamilyDescriptor, replacingId?: FamilyId): void {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Family descriptor must be an object')
  if (!isBuiltinFamilyId(descriptor.id) && !isExternalFamilyId(descriptor.id)) {
    throw new Error(`External family id "${descriptor.id}" must use the "family:" namespace`)
  }
  const expectedIdentityId = isBuiltinFamilyId(descriptor.id) ? `family:${descriptor.id}` : descriptor.id
  if (descriptor.identity?.id !== expectedIdentityId || descriptor.identity.kind !== 'family') {
    throw new Error(`Family descriptor identity must be "${expectedIdentityId}" with kind "family"`)
  }
  if (descriptor.contractVersion !== 1 || descriptor.identity.compatibility.core !== 'family-descriptor@1') {
    throw new Error(`Family "${descriptor.id}" uses an unsupported descriptor contract`)
  }
  createExtensionIdentity({
    id: descriptor.identity.id,
    kind: descriptor.identity.kind,
    version: descriptor.identity.version,
    compatibility: descriptor.identity.compatibility,
    provenance: descriptor.identity.provenance,
  })
  if (!descriptor.label) {
    throw new Error(`Family "${descriptor.id}" must declare version, provenance, and label`)
  }
  if (!Array.isArray(descriptor.headers) || descriptor.headers.length === 0 || descriptor.headers.some(header => !normalizedHeader(header))) {
    throw new Error(`Family "${descriptor.id}" must declare at least one non-empty header`)
  }
  if (typeof descriptor.detect !== 'function') throw new Error(`Family "${descriptor.id}" must declare a detector`)
  if (!Number.isSafeInteger(descriptor.collisionPriority)) throw new Error(`Family "${descriptor.id}" must declare an integer collisionPriority`)

  if (!Array.isArray(descriptor.aliases)) throw new Error(`Family "${descriptor.id}" must declare an aliases array`)
  if (descriptor.config) {
    if (!descriptor.config.section.trim()) throw new Error(`Family "${descriptor.id}" config contract requires a section`)
    if (!Array.isArray(descriptor.config.keys) || descriptor.config.keys.some(key => typeof key !== 'string' || !key.trim())) {
      throw new Error(`Family "${descriptor.id}" config contract requires non-empty keys`)
    }
    if (new Set(descriptor.config.keys).size !== descriptor.config.keys.length) {
      throw new Error(`Family "${descriptor.id}" config contract repeats a key`)
    }
    if (descriptor.config.noopKeys) {
      if (new Set(descriptor.config.noopKeys).size !== descriptor.config.noopKeys.length || descriptor.config.noopKeys.some(key => !descriptor.config!.keys.includes(key))) {
        throw new Error(`Family "${descriptor.id}" config noopKeys must be unique members of keys`)
      }
    }
  }
  if (!Array.isArray(descriptor.semanticRoles)) throw new Error(`Family "${descriptor.id}" must declare a semanticRoles array`)
  if (!Array.isArray(descriptor.capabilityEvidence)) throw new Error(`Family "${descriptor.id}" must declare a capabilityEvidence array`)
  if (new Set(descriptor.semanticRoles).size !== descriptor.semanticRoles.length) {
    throw new Error(`Family "${descriptor.id}" declares duplicate Scene roles`)
  }
  const invalidRole = descriptor.semanticRoles.find(role => !validSceneRoleDeclaration(role))
  if (invalidRole) throw new Error(`Family "${descriptor.id}" declares invalid Scene role "${invalidRole}"`)

  const evidenceByCapability = new Map<FamilyCapability, FamilyCapabilityEvidence>()
  for (const claim of descriptor.capabilityEvidence) {
    if (!FAMILY_CAPABILITY_COLUMNS.includes(claim.capability)) {
      throw new Error(`Family "${descriptor.id}" declares unknown capability "${String(claim.capability)}"`)
    }
    if (evidenceByCapability.has(claim.capability)) {
      throw new Error(`Family "${descriptor.id}" declares duplicate evidence for capability "${claim.capability}"`)
    }
    if (!FAMILY_CAPABILITY_STATES.has(claim.state)) {
      throw new Error(`Family "${descriptor.id}" declares invalid state "${String(claim.state)}" for capability "${claim.capability}"`)
    }
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0 || claim.evidence.some((path: unknown) => typeof path !== 'string' || path.trim() === '')) {
      throw new Error(`Family "${descriptor.id}" capability "${claim.capability}" must cite at least one evidence path`)
    }
    if (new Set(claim.evidence).size !== claim.evidence.length) {
      throw new Error(`Family "${descriptor.id}" capability "${claim.capability}" repeats an evidence path`)
    }
    evidenceByCapability.set(claim.capability, claim)
  }
  const missingCapability = FAMILY_CAPABILITY_COLUMNS.find(capability => !evidenceByCapability.has(capability))
  if (missingCapability) throw new Error(`Family "${descriptor.id}" lacks evidence for capability "${missingCapability}"`)
  if (descriptor.projectPositioned && !descriptor.layout) {
    throw new Error(`Family "${descriptor.id}" cannot project a positioned artifact without a layout hook`)
  }
  if (descriptor.lowerScene && descriptor.renderSvg) {
    throw new Error(`Family "${descriptor.id}" must declare one graphical waist: lowerScene, or renderSvg as an extension fallback, not both`)
  }
  if (isExternalFamilyId(descriptor.id)) {
    for (const capability of FAMILY_CAPABILITY_COLUMNS) {
      const declared = evidenceByCapability.get(capability)!.state
      const expected = expectedExtensionCapabilityState(descriptor, capability)
      if (declared !== expected) {
        throw new Error(`Family "${descriptor.id}" capability "${capability}" claims "${declared}" but its hooks require "${expected}"`)
      }
    }
    if (descriptor.lowerScene && descriptor.semanticRoles.length === 0) {
      throw new Error(`Family "${descriptor.id}" has a Scene lowering but declares no Scene roles`)
    }
    if (!descriptor.lowerScene && descriptor.semanticRoles.length > 0) {
      throw new Error(`Family "${descriptor.id}" declares Scene roles without a Scene lowering`)
    }
  }
  const ownHeaders = [...descriptor.headers, ...descriptor.aliases].map(normalizedHeader)
  if (new Set(ownHeaders).size !== ownHeaders.length) throw new Error(`Family "${descriptor.id}" declares duplicate headers`)
  const unrecognized = ownHeaders.find(header => !descriptor.detect(header))
  if (unrecognized) throw new Error(`Family detector for "${descriptor.id}" does not recognize its declared header "${unrecognized}"`)
  const claimed = new Set(ownHeaders)
  for (const [id, existing] of REGISTRY) {
    if (id === replacingId) continue
    const existingHeaders = [...existing.headers, ...existing.aliases].map(normalizedHeader)
    const collision = existingHeaders.find(header => claimed.has(header))
    if (collision) throw new Error(`Family header "${collision}" is already owned by "${id}"`)
    const incomingOverlap = existingHeaders.find(header => detectorClaims(descriptor, header))
    if (incomingOverlap) {
      throw new Error(`Family detector for "${descriptor.id}" overlaps header "${incomingOverlap}" owned by "${id}"`)
    }
    const existingOverlap = ownHeaders.find(header => detectorClaims(existing, header))
    if (existingOverlap) {
      throw new Error(`Family header "${existingOverlap}" overlaps the detector owned by "${id}"`)
    }
  }
}

/** Register a new namespaced extension. Validation completes before mutation. */
export function registerFamily(descriptor: FamilyDescriptor): () => void {
  if (isBuiltinFamilyId(descriptor.id)) {
    throw new Error(`Built-in family "${descriptor.id}" already exists; use augmentFamily or replaceFamilyForTest explicitly`)
  }
  const id = descriptor.id
  const existing = REGISTRY.get(id)
  if (existing) throw new ExtensionCollisionError(descriptor.identity, existing.identity)
  validateDescriptor(descriptor)
  const installed = freezeDescriptor(descriptor)
  REGISTRY.set(id, installed)
  let removed = false
  return () => {
    if (removed) return
    if (REGISTRY.get(id) === installed) REGISTRY.delete(id)
    removed = true
  }
}

export type FamilyAugmentation = Partial<FamilyOperations>

/** Add or replace only behavioral hooks; identity and routing stay immutable. */
export function augmentFamily(id: FamilyId, operations: FamilyAugmentation): void {
  const current = REGISTRY.get(id)
  if (!current) throw new Error(`Cannot augment unknown family "${id}"`)
  for (const key of Object.keys(operations)) {
    if (!OPERATION_KEYS.has(key as keyof FamilyOperations)) throw new Error(`Cannot augment family descriptor field "${key}"`)
  }
  const next = { ...current, ...operations }
  validateDescriptor(next, id)
  REGISTRY.set(id, freezeDescriptor(next))
}

/** Explicit replacement seam for characterization tests; returns an idempotent restore. */
export function replaceFamilyForTest(id: FamilyId, replacement: FamilyDescriptor): () => void {
  const previous = REGISTRY.get(id)
  if (!previous) throw new Error(`Cannot replace unknown family "${id}"`)
  if (replacement.id !== id) throw new Error(`Replacement id "${replacement.id}" does not match "${id}"`)
  validateDescriptor(replacement, id)
  REGISTRY.set(id, freezeDescriptor(replacement))
  let restored = false
  return () => {
    if (restored) return
    REGISTRY.set(id, previous)
    restored = true
  }
}

export function getFamily(kind: FamilyId | string): FamilyDescriptor | undefined {
  return REGISTRY.get(kind as FamilyId)
}

export function knownFamilies(): FamilyId[] {
  const builtins = BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(f => f.id).filter(id => REGISTRY.has(id))
  const external = Array.from(REGISTRY.keys())
    .filter(id => !isBuiltinFamilyId(id))
    .sort()
  return [...builtins, ...external]
}

export function knownBuiltinFamilies(): BuiltinFamilyId[] {
  return BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(seed => seed.id)
}

function normalizeDetectionLine(firstLine: string): string {
  return (firstLine.split(';')[0] ?? '').trim().toLowerCase()
}

/** Descriptor-driven routing for built-ins and installed extensions. */
export function detectRegisteredFamilyFromFirstLine(firstLine: string, mode: 'strict' | 'loose' = 'strict'): FamilyId | null {
  const line = normalizeDetectionLine(firstLine)
  const descriptors = Array.from(REGISTRY.values()).sort((a, b) =>
    b.collisionPriority - a.collisionPriority || a.id.localeCompare(b.id))
  for (const descriptor of descriptors) {
    const detector = mode === 'loose' ? descriptor.detectLoose ?? descriptor.detect : descriptor.detect
    if (detector(line)) return descriptor.id
  }
  return null
}

export type { FamilyId, ExternalFamilyId } from './types.ts'
export type { ExtensionIdentity } from '../shared/extension-identity.ts'

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
