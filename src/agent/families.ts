// ============================================================================
// Family descriptor registry.
//
// Provides a registration point so new diagram families can plug in without
// modifying core parse/serialize/verify dispatchers. The registry primarily
// powers universal source-based Tier 1 checks (LABEL_OVERFLOW for opaque
// bodies) and offers a forward path for full per-family ownership.
//
// Identity, detection, discovery metadata and behavioral hooks live in the
// same descriptor. Built-ins are assembled and validated as complete values;
// namespaced extensions register through the same atomic validation boundary.
// ============================================================================

import type { AsciiConfig, AsciiTheme, ColorMode } from '../ascii/types.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import type { FamilyScopedRenderOptionField } from '../render-contract.ts'
import { BUILTIN_RENDER_HOOKS } from '../render-family-hooks.ts'
import { CORE_SCENE_PRIMITIVES, type CoreScenePrimitive, PRIMITIVE_REALIZATIONS, type PrimitiveRealization } from '../scene/capabilities.ts'
import { type SceneDoc, SEMANTIC_CHANNEL_NAMES, type SemanticChannelName } from '../scene/ir.ts'
import { BUILTIN_SCENE_ROLE_TRAITS, type SceneRole } from '../scene/roles.ts'
import type { InternalStyleFace, StyleSpec } from '../scene/style-registry.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { createExtensionIdentity, ExtensionCollisionError, type ExtensionIdentity, parseExtensionId, requireExtensionContractCompatibility } from '../shared/extension-identity.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import type { TerminalConnectorProjection } from '../terminal-style.ts'
import type { DiagramColors } from '../theme.ts'
import type { PositionedDiagram, RenderContext, RenderOptions, ResolvedFamilyRenderContext } from '../types.ts'
import { UPSTREAM_MERMAID_FAMILY_INDEX } from '../upstream-family-index.ts'
import { BUILTIN_AGENT_HOOKS } from './families-builtin.ts'
import type { AnyMutationOp, DiagramBody, DiagramKind, ExternalFamilyId, FamilyId, FamilyParsedBody, LayoutWarning, MutationError, ParseError, RenderedLayout, Result, SourceMap, ValidDiagramMeta, VerifyOptions } from './types.ts'

export { extractLabelsGeneric } from './family-labels.ts'

export interface ExtractedLabel {
  /** The label text, with quotes stripped. */
  text: string
  /** Best-effort target identifier (node id, participant, period, etc.). */
  target: string
}

export interface FamilyLayoutContext extends ResolvedFamilyRenderContext {
  source: NormalizedMermaidSource
}

export interface FamilyLayoutResult<TPositioned extends PositionedDiagram = PositionedDiagram> {
  positioned: TPositioned
  /** False when the family renderer already owns SVG accessibility metadata. */
  injectAccessibility?: boolean
}

/** Inputs available to a descriptor's one request-boundary normalizer. Public
 * source/options/style data remains serializable; the optional internal face is
 * an immutable, already-resolved view and cannot be returned as a new authority. */
export interface FamilyRequestNormalizationContext {
  source: NormalizedMermaidSource
  /** Options after shared security and Style defaults, before the final freeze. */
  renderOptions: RenderOptions
  /** Shared palette resolved exactly once before family projection. */
  colors: Readonly<DiagramColors>
  /** Resolved public Style stack, never a registry name or unresolved input. */
  style?: Readonly<StyleSpec>
  /** Internal face paired with the resolved Style stack. */
  styleFace?: Readonly<InternalStyleFace>
}

export interface FamilyAppearanceNormalization {
  /** Sparse family-specific adjustment merged over the shared palette. */
  colors?: Readonly<Partial<DiagramColors>>
  /** Serializable family-owned visual/config projection shared by layout and renderers. */
  family?: Readonly<Record<string, unknown>>
}

export interface FamilyRequestNormalizationResult {
  /** Geometry/config projection. It must remain a valid public RenderOptions object. */
  renderOptions?: RenderOptions
  /** Serializable family configuration that has no public RenderOptions slot. */
  familyConfig?: Readonly<Record<string, unknown>>
  /** Appearance projection, deliberately separate from geometry options. */
  appearance?: FamilyAppearanceNormalization
}

/**
 * Public, family-neutral view of one already-positioned artifact. The family
 * id is deliberately supplied by the registry caller rather than repeated by
 * every projector, so namespaced extensions can implement this hook while the
 * public layout envelope records their registered family id.
 */
export type FamilyPositionedView = Pick<RenderedLayout, 'version' | 'nodes' | 'edges' | 'groups' | 'certificates' | 'bounds'>

export interface FamilyPositionedProjectionOptions {
  /** Include route/containment proof sidecars when the family supports them. */
  debug?: boolean
}

export interface FamilyPositionedProjectionContext<TPositioned extends PositionedDiagram = PositionedDiagram> {
  /** The exact artifact produced by this descriptor's `layout` hook. */
  positioned: TPositioned
  options: Readonly<FamilyPositionedProjectionOptions>
}

export interface AsciiContext extends ResolvedFamilyRenderContext {
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
export const FAMILY_CAPABILITY_COLUMNS = ['detection', 'source-preservation', 'parse', 'serialize', 'mutation', 'verify', 'layout', 'scene', 'svg', 'terminal'] as const

/** Registration witnesses stay small enough to execute twice synchronously. */
export const FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES = 64 * 1024

export type FamilyCapability = (typeof FAMILY_CAPABILITY_COLUMNS)[number]
export type FamilyCapabilityState = 'native' | 'source-preserved' | 'diagnosed' | 'not-applicable' | 'absent'
export const FAMILY_DESCRIPTOR_CONTRACT_VERSION = 2 as const
export const FAMILY_CONFORMANCE_VERSION = 2 as const

/**
 * Canonical processing contract for a Mermaid family that is recognized by
 * the open parser but has no installed descriptor. The source envelope and
 * its serializer remain lossless; operations that require family semantics
 * fail through the preserved family diagnostic instead of disappearing from
 * discovery as an unaccounted `absent` capability.
 */
export const UNREGISTERED_FAMILY_CAPABILITY_STATES = Object.freeze({
  detection: 'diagnosed',
  'source-preservation': 'source-preserved',
  parse: 'diagnosed',
  serialize: 'source-preserved',
  mutation: 'diagnosed',
  verify: 'diagnosed',
  layout: 'diagnosed',
  scene: 'diagnosed',
  svg: 'diagnosed',
  terminal: 'diagnosed',
} satisfies Readonly<Record<FamilyCapability, Exclude<FamilyCapabilityState, 'absent'>>>)

export interface FamilyCapabilityEvidence {
  capability: FamilyCapability
  state: FamilyCapabilityState
  evidence: readonly string[]
}

/** Executable registration evidence is deliberately separate from a
 * descriptor's declaration. A descriptor says what it intends to support;
 * this report records what its bounded canonical example actually proved. */
export type FamilyConformanceStatus = 'passed' | 'failed' | 'unverified-extension'

export interface FamilyCapabilityConformanceResult {
  capability: FamilyCapability
  declaredState: FamilyCapabilityState
  status: FamilyConformanceStatus
  /** Stable id for the canonical example witness, present for passed checks. */
  witnessId?: string
  /** Required for failed and deliberately-unverified extension cells. */
  diagnostic?: string
}

export interface FamilyConformanceReport {
  readonly version: typeof FAMILY_CONFORMANCE_VERSION
  readonly familyId: FamilyId
  readonly example: string
  readonly passed: boolean
  readonly capabilities: readonly FamilyCapabilityConformanceResult[]
}

export type FamilyScenePrimitiveApplicability = 'applicable' | 'not-applicable'

/** One complete family-role/Scene-primitive contract cell. */
export interface FamilyScenePrimitiveEvidence {
  role: SceneRole
  primitive: CoreScenePrimitive
  applicability: FamilyScenePrimitiveApplicability
  /** `unsupported` is reserved for explicit not-applicable cells. */
  realization: PrimitiveRealization
  evidence: readonly string[]
  /** Required for an explicit negative cell. */
  diagnostic?: string
}

export type FamilyScenePositivePrimitive =
  | CoreScenePrimitive
  | Readonly<{
      primitive: CoreScenePrimitive
      realization: Exclude<PrimitiveRealization, 'unsupported'>
      diagnostic?: string
    }>

/** Compact positive authority; `declareFamilyScenePrimitiveEvidence` derives
 * the complete matrix, including every explicit negative cell. */
export interface FamilySceneRolePrimitiveDeclaration {
  role: SceneRole
  primitives: readonly FamilyScenePositivePrimitive[]
}

export function declareFamilyScenePrimitiveEvidence(familyId: string, declarations: readonly FamilySceneRolePrimitiveDeclaration[], evidence: readonly string[]): readonly FamilyScenePrimitiveEvidence[] {
  const rows: FamilyScenePrimitiveEvidence[] = []
  for (const declaration of declarations) {
    const positive = new Map(
      declaration.primitives.map(item => {
        const entry = typeof item === 'string' ? { primitive: item, realization: 'native' as const } : item
        return [entry.primitive, entry] as const
      }),
    )
    for (const primitive of CORE_SCENE_PRIMITIVES) {
      const entry = positive.get(primitive)
      rows.push(
        entry
          ? {
              role: declaration.role,
              primitive,
              applicability: 'applicable',
              realization: entry.realization,
              evidence,
              ...(entry.diagnostic ? { diagnostic: entry.diagnostic } : {}),
            }
          : {
              role: declaration.role,
              primitive,
              applicability: 'not-applicable',
              realization: 'unsupported',
              evidence,
              diagnostic: `${familyId}/${declaration.role} does not lower to the ${primitive} primitive.`,
            },
      )
    }
  }
  return rows
}

/** Descriptor-owned Mermaid config section contract. */
export interface FamilyConfigContract {
  section: string
  keys: readonly string[]
  noopKeys?: readonly string[]
}

export interface FamilyOperations {
  /**
   * Normalize family config once at the canonical request boundary. Layout and
   * render hooks receive only the frozen result and must not re-read raw Style,
   * theme, or family option authorities.
   */
  normalizeRequest?: (ctx: FamilyRequestNormalizationContext) => FamilyRequestNormalizationResult | void
  /**
   * Source-based label extractor for universal Tier 1 LABEL_OVERFLOW on opaque
   * bodies. Each descriptor should extract everything an agent would consider a
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
  /** Optional: family-specific verify (Tier 1 + Tier 2). Returns warnings only.
   * The hook alone does not make public verification native: verification also
   * consumes the family's executable SVG and positioned-layout projections. */
  verify?: (body: FamilyParsedBody, opts: VerifyOptions) => LayoutWarning[]
  /** Optional: family-specific source-to-positioned layout for graphical output.
   * Public layout JSON additionally requires projectPositioned. */
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
  /** User-facing editor example label and summary. */
  editorLabel: string
  editorDescription: string
  /** Stable id for the representative editor/comparison example. */
  editorExampleId: string
  /** Short glyph used by the editor example picker. */
  editorGlyph: string
  /** Representative source shared by the editor and website comparisons. */
  editorExample: string
  /** Minimal conformance/discovery witness: correct header plus core syntax.
   *  This is intentionally smaller than `editorExample`. Exposed via
   *  `am capabilities` so agents learn each family's dialect from the
   *  discovery envelope instead of error-message trial-and-error (the
   *  onboarding probes burned most of their iterations on exactly this —
   *  architecture-beta headers, quadrant [x, y] brackets). A test pins
   *  every example to parse, verify, and render clean. */
  example: string
}

export interface FamilyDescriptor extends FamilyOperations {
  readonly contractVersion: typeof FAMILY_DESCRIPTOR_CONTRACT_VERSION
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
  /** Family-scoped shared RenderOptions consumed by this implementation.
   * External families opt in explicitly; omission means none. Built-in
   * applicability remains derived from the canonical render-field manifest. */
  readonly applicableRenderOptions?: readonly FamilyScopedRenderOptionField[]
  readonly semanticRoles: readonly string[]
  /** Closed Scene channels this family may populate. Empty is explicit. */
  readonly semanticChannels: readonly SemanticChannelName[]
  /** Complete role x core-primitive matrix. Positive cells name their
   * realization; negative cells are explicit and diagnosed. */
  readonly scenePrimitiveEvidence: readonly FamilyScenePrimitiveEvidence[]
  readonly capabilityEvidence: readonly FamilyCapabilityEvidence[]
  readonly example: string
}

interface BuiltinFamilyDescriptorSeed extends BuiltinFamilyMetadata {
  upstreamId: string
  maturity: FamilyMaturity
  detect: (firstLineLower: string) => boolean
  detectLoose?: (firstLineLower: string) => boolean
  aliases?: readonly string[]
  sceneRoles: readonly FamilySceneRolePrimitiveDeclaration[]
  semanticChannels: readonly SemanticChannelName[]
  config: FamilyConfigContract
}

function builtinFamilyCapabilityEvidence(familyId: BuiltinFamilyId): readonly FamilyCapabilityEvidence[] {
  const executableWitness = ['src/__tests__/section-a-family-descriptor-conformance.test.ts'] as const
  const terminalWitness = familyId === 'flowchart' || familyId === 'state' ? [...executableWitness, 'src/__tests__/characterization-layout.test.ts'] : executableWitness
  return [
    { capability: 'detection', state: 'native', evidence: executableWitness },
    { capability: 'source-preservation', state: 'native', evidence: executableWitness },
    { capability: 'parse', state: 'native', evidence: executableWitness },
    { capability: 'serialize', state: 'native', evidence: executableWitness },
    { capability: 'mutation', state: 'native', evidence: executableWitness },
    { capability: 'verify', state: 'native', evidence: executableWitness },
    { capability: 'layout', state: 'native', evidence: executableWitness },
    { capability: 'scene', state: 'native', evidence: executableWitness },
    { capability: 'svg', state: 'native', evidence: executableWitness },
    { capability: 'terminal', state: 'native', evidence: terminalWitness },
  ]
}

function nativeSceneRole(role: SceneRole, ...primitives: readonly CoreScenePrimitive[]): FamilySceneRolePrimitiveDeclaration {
  return { role, primitives }
}

const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = [
  {
    id: 'flowchart',
    upstreamId: 'flowchart-v2',
    maturity: 'stable',
    label: 'Flowchart',
    headers: ['flowchart', 'graph'],
    narrower: 'asFlowchart',
    editorDiagramType: 'Flowchart',
    editorLabel: 'Flowchart',
    editorDescription: 'Decision flow with labeled branches.',
    editorExampleId: 'flowchart-basic',
    editorGlyph: 'F',
    config: {
      section: 'flowchart',
      keys: ['nodeSpacing', 'rankSpacing', 'wrappingWidth', 'titleTopMargin', 'subGraphTitleMargin', 'arrowMarkerAbsolute', 'diagramPadding', 'htmlLabels', 'curve', 'padding', 'defaultRenderer', 'inheritDir'],
      noopKeys: ['arrowMarkerAbsolute', 'curve', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'inheritDir', 'padding', 'subGraphTitleMargin', 'titleTopMargin'],
    },
    aliases: ['swimlane'],
    semanticChannels: [],
    detect: (line: string) => /^(?:flowchart|graph|swimlane)(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('icon', 'document', 'text'),
    ],
    example: 'flowchart TD\n  A[Start] --> B{Ship?}\n  B -->|yes| C[Deploy]\n  B -->|no| D[Fix]',
    editorExample: `flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`,
  },
  {
    id: 'state',
    upstreamId: 'stateDiagram',
    maturity: 'stable',
    label: 'State',
    headers: ['stateDiagram', 'stateDiagram-v2'],
    narrower: 'asState',
    editorDiagramType: 'State',
    editorLabel: 'State diagram',
    editorDescription: 'Lifecycle using Mermaid stateDiagram-v2 syntax.',
    editorExampleId: 'state-basic',
    editorGlyph: 'S',
    config: {
      section: 'state',
      keys: [
        'arrowMarkerAbsolute',
        'compositTitleSize',
        'defaultRenderer',
        'dividerMargin',
        'edgeLengthFactor',
        'fontSize',
        'fontSizeFactor',
        'forkHeight',
        'forkWidth',
        'labelHeight',
        'miniPadding',
        'nodeSpacing',
        'noteMargin',
        'padding',
        'radius',
        'rankSpacing',
        'sizeUnit',
        'textHeight',
        'titleShift',
        'titleTopMargin',
      ],
    },
    semanticChannels: ['status'],
    detect: (line: string) => /^statediagram(?:-v2)?\s*$/.test(line),
    detectLoose: (line: string) => /^statediagram(?:-v2)?(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> [*] : approve',
    editorExample: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Complete: done
  Processing --> Failed: error
  Failed --> Idle: retry
  Complete --> [*]`,
  },
  {
    id: 'sequence',
    upstreamId: 'sequence',
    maturity: 'stable',
    label: 'Sequence',
    headers: ['sequenceDiagram'],
    narrower: 'asSequence',
    editorDiagramType: 'Sequence',
    editorLabel: 'Sequence',
    editorDescription: 'Request/response messages between participants.',
    editorExampleId: 'sequence-basic',
    editorGlyph: 'Q',
    config: {
      section: 'sequence',
      keys: [
        'actorMargin',
        'width',
        'height',
        'diagramMarginX',
        'diagramMarginY',
        'messageMargin',
        'noteMargin',
        'activationWidth',
        'showSequenceNumbers',
        'boxMargin',
        'boxTextMargin',
        'messageAlign',
        'mirrorActors',
        'bottomMarginAdj',
        'rightAngles',
        'wrap',
        'wrapPadding',
        'labelBoxWidth',
        'labelBoxHeight',
        'hideUnusedParticipants',
        'forceMenus',
        'arrowMarkerAbsolute',
        'noteAlign',
        'actorFontSize',
        'actorFontFamily',
        'actorFontWeight',
        'noteFontSize',
        'noteFontFamily',
        'noteFontWeight',
        'messageFontSize',
        'messageFontFamily',
        'messageFontWeight',
        'useMaxWidth',
        'useWidth',
      ],
      noopKeys: [
        'actorFontFamily',
        'actorFontSize',
        'actorFontWeight',
        'arrowMarkerAbsolute',
        'bottomMarginAdj',
        'boxMargin',
        'boxTextMargin',
        'forceMenus',
        'hideUnusedParticipants',
        'labelBoxHeight',
        'labelBoxWidth',
        'messageAlign',
        'messageFontFamily',
        'messageFontSize',
        'messageFontWeight',
        'mirrorActors',
        'noteAlign',
        'noteFontFamily',
        'noteFontSize',
        'noteFontWeight',
        'rightAngles',
        'useMaxWidth',
        'useWidth',
        'wrap',
        'wrapPadding',
      ],
    },
    semanticChannels: ['category'],
    detect: (line: string) => /^sequencediagram\s*$/.test(line),
    detectLoose: (line: string) => /^sequencediagram(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('actor', 'container', 'shape'),
      nativeSceneRole('lifeline', 'connector'),
      nativeSceneRole('activation', 'shape'),
      nativeSceneRole('message', 'container', 'connector'),
      nativeSceneRole('block', 'container', 'connector', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('icon', 'document', 'text', 'shape'),
    ],
    example: 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: request\n  S-->>U: response',
    editorExample: `sequenceDiagram
  participant User
  participant App
  participant API
  User->>App: Click export
  App->>API: Render SVG
  API-->>App: SVG string
  App-->>User: Download`,
  },
  {
    id: 'timeline',
    upstreamId: 'timeline',
    maturity: 'experimental',
    label: 'Timeline',
    headers: ['timeline'],
    narrower: 'asTimeline',
    editorDiagramType: 'Timeline',
    editorLabel: 'Timeline',
    editorDescription: 'Chronological milestones with sections.',
    editorExampleId: 'timeline-basic',
    editorGlyph: 'T',
    config: {
      section: 'timeline',
      keys: [
        'disableMulticolor',
        'sectionFills',
        'sectionColours',
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'width',
        'height',
        'padding',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'activationWidth',
        'textPlacement',
        'actorColours',
        'useMaxWidth',
        'useWidth',
      ],
      noopKeys: [
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'width',
        'height',
        'padding',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'activationWidth',
        'textPlacement',
        'actorColours',
        'useMaxWidth',
        'useWidth',
      ],
    },
    semanticChannels: ['category'],
    detect: (line: string) => /^timeline(?:\s+(?:td|tb|lr|bt|rl))?\s*$/.test(line),
    detectLoose: (line: string) => /^timeline(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('chrome', 'document'),
      nativeSceneRole('rail', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('section', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('period', 'container', 'shape'),
      nativeSceneRole('event', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'timeline\n  title Roadmap\n  2025 : Alpha : Beta\n  2026 : GA',
    editorExample: `timeline
  title Product roadmap
  section Foundation
  2024 Q1 : Prototype
          : Parser coverage
  section Launch
  2024 Q2 : Public editor
          : SVG export`,
  },
  {
    id: 'class',
    upstreamId: 'classDiagram',
    maturity: 'stable',
    label: 'Class',
    headers: ['classDiagram'],
    narrower: 'asClass',
    editorDiagramType: 'Class',
    editorLabel: 'Class',
    editorDescription: 'Classes with members, inheritance, and composition.',
    editorExampleId: 'class-basic',
    editorGlyph: 'C',
    config: {
      section: 'class',
      keys: ['nodeSpacing', 'rankSpacing', 'titleTopMargin', 'arrowMarkerAbsolute', 'dividerMargin', 'padding', 'textHeight', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'hideEmptyMembersBox', 'hierarchicalNamespaces'],
      noopKeys: ['arrowMarkerAbsolute', 'defaultRenderer', 'diagramPadding', 'dividerMargin', 'hideEmptyMembersBox', 'htmlLabels', 'padding', 'textHeight', 'titleTopMargin'],
    },
    semanticChannels: [],
    detect: (line: string) => /^classdiagram\s*$/.test(line),
    detectLoose: (line: string) => /^classdiagram(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('class-box', 'container', 'shape'),
      nativeSceneRole('member', 'text'),
      nativeSceneRole('relationship', 'connector'),
      nativeSceneRole('cardinality', 'text'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'classDiagram\n  class Account {\n    +id: string\n    +close() void\n  }\n  Account <|-- Savings\n  Account "1" o-- "*" Transaction : logs',
    editorExample: `classDiagram
  class Renderer {
    <<abstract>>
    +render(source) string
  }
  class SVGRenderer {
    +render(source) string
  }
  class RenderPipeline {
    +run(source) string
  }
  Renderer <|-- SVGRenderer
  RenderPipeline *-- SVGRenderer : owns`,
  },
  {
    id: 'er',
    upstreamId: 'er',
    maturity: 'stable',
    label: 'ER',
    headers: ['erDiagram'],
    narrower: 'asEr',
    editorDiagramType: 'ER',
    editorLabel: 'ER diagram',
    editorDescription: 'Entities, attributes, keys, and cardinality markers.',
    editorExampleId: 'er-basic',
    editorGlyph: 'ER',
    config: {
      section: 'er',
      keys: ['layoutDirection', 'nodeSpacing', 'rankSpacing', 'titleTopMargin', 'diagramPadding', 'minEntityWidth', 'minEntityHeight', 'entityPadding', 'stroke', 'fill', 'fontSize'],
      noopKeys: ['diagramPadding', 'entityPadding', 'fill', 'fontSize', 'minEntityHeight', 'minEntityWidth', 'stroke', 'titleTopMargin'],
    },
    semanticChannels: ['category'],
    detect: (line: string) => /^erdiagram(?:\s+subgraph\b.*)?\s*$/.test(line),
    detectLoose: (line: string) => /^erdiagram(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'shape'),
      nativeSceneRole('entity', 'container', 'shape'),
      nativeSceneRole('attribute', 'container', 'text'),
      nativeSceneRole('relationship', 'connector'),
      nativeSceneRole('cardinality', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id\n  }',
    editorExample: `erDiagram
  CUSTOMER {
    string id PK
    string email
  }
  ORDER {
    string id PK
    date created
  }
  LINE_ITEM {
    string id PK
    int quantity
  }
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`,
  },
  {
    id: 'journey',
    upstreamId: 'journey',
    maturity: 'stable',
    label: 'Journey',
    headers: ['journey'],
    narrower: 'asJourney',
    editorDiagramType: 'Journey',
    editorLabel: 'User journey',
    editorDescription: 'Scored user tasks grouped by section.',
    editorExampleId: 'journey-basic',
    editorGlyph: 'J',
    config: {
      section: 'journey',
      keys: [
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'maxLabelWidth',
        'width',
        'height',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'actorColours',
        'sectionFills',
        'sectionColours',
        'titleColor',
        'titleFontFamily',
        'titleFontSize',
        'useMaxWidth',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'activationWidth',
        'textPlacement',
      ],
      noopKeys: ['boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement'],
    },
    semanticChannels: ['value', 'category'],
    detect: (line: string) => /^journey\s*$/.test(line),
    detectLoose: (line: string) => /^journey(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('series', 'connector'),
      nativeSceneRole('grid', 'container', 'connector'),
      nativeSceneRole('axis', 'text'),
      nativeSceneRole('rail', 'connector'),
      nativeSceneRole('legend', 'container', 'text'),
      nativeSceneRole('actor', 'shape'),
      nativeSceneRole('section', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('task', 'container', 'shape', 'data-mark'),
      nativeSceneRole('marker-line', 'connector'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('score', 'container', 'shape', 'data-mark'),
    ],
    example: 'journey\n  title Checkout\n  section Browse\n    Find product: 4: Shopper\n  section Buy\n    Pay: 3: Shopper',
    editorExample: `journey
  title Editor adoption
  section Try
    Open editor: 5: User
    Load example: 4: User, Developer
  section Share
    Copy URL: 5: User
    Export SVG: 4: Developer`,
  },
  {
    id: 'architecture',
    upstreamId: 'architecture',
    maturity: 'stable',
    label: 'Architecture',
    headers: ['architecture', 'architecture-beta'],
    narrower: 'asArchitecture',
    editorDiagramType: 'Architecture',
    editorLabel: 'Architecture',
    editorDescription: 'Services, groups, icons, and routed connections.',
    editorExampleId: 'architecture-basic',
    editorGlyph: 'A',
    config: { section: 'architecture', keys: ['padding', 'iconSize', 'fontSize', 'nodeSeparation', 'idealEdgeLengthMultiplier', 'edgeElasticity', 'numIter', 'seed', 'randomize'], noopKeys: ['edgeElasticity', 'numIter', 'randomize', 'seed'] },
    semanticChannels: [],
    detect: (line: string) => /^architecture(?:-beta)?\s*$/.test(line),
    detectLoose: (line: string) => /^architecture(?:-beta)?(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'shape'),
      nativeSceneRole('icon', 'document'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('service', 'container', 'shape'),
      nativeSceneRole('junction', 'container', 'shape'),
      nativeSceneRole('edge', 'connector'),
    ],
    example: 'architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[Database] in backend\n  service cache(disk)[Cache] in backend\n  api:R --> L:db\n  api:B -[reads]-> T:cache',
    editorExample: `architecture-beta
  group app(cloud)[Application]
  group data(database)[Data]
  service web(server)[Web App] in app
  service api(server)[API] in app
  service db(database)[Postgres] in data
  web:R --> L:api
  api:R --> L:db`,
  },
  {
    id: 'xychart',
    upstreamId: 'xychart',
    maturity: 'stable',
    label: 'XY chart',
    headers: ['xychart', 'xychart-beta'],
    narrower: 'asXyChart',
    editorDiagramType: 'XY Chart',
    editorLabel: 'XY chart',
    editorDescription: 'Bar and line series using xychart syntax.',
    editorExampleId: 'xychart-basic',
    editorGlyph: 'XY',
    config: { section: 'xyChart', keys: ['width', 'height', 'useMaxWidth', 'useWidth', 'titleFontSize', 'titlePadding', 'chartOrientation', 'plotReservedSpacePercent', 'showDataLabel', 'showTitle', 'showLegend', 'legendFontSize', 'legendPadding', 'xAxis', 'yAxis'] },
    semanticChannels: ['value', 'category'],
    detect: (line: string) => /^xychart(?:-beta)?(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document'),
      nativeSceneRole('chrome', 'container', 'document'),
      nativeSceneRole('grid', 'shape'),
      nativeSceneRole('bar', 'shape', 'data-mark'),
      nativeSceneRole('series', 'connector'),
      nativeSceneRole('point', 'shape', 'data-mark'),
      nativeSceneRole('axis', 'text', 'shape'),
      nativeSceneRole('legend', 'container', 'text', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'xychart-beta\n  title "Revenue"\n  x-axis [Q1, Q2, Q3]\n  y-axis "USD" 0 --> 100\n  bar [45, 62, 80]',
    editorExample: `xychart
  title "Weekly renders"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
  },
  {
    id: 'pie',
    upstreamId: 'pie',
    maturity: 'stable',
    label: 'Pie',
    headers: ['pie'],
    narrower: 'asPie',
    editorDiagramType: 'Pie',
    editorLabel: 'Pie chart',
    editorDescription: 'Proportional slices with values shown in the legend.',
    editorExampleId: 'pie-basic',
    editorGlyph: 'P',
    config: { section: 'pie', keys: ['textPosition', 'donutHole', 'legendPosition', 'highlightSlice', 'useMaxWidth', 'useWidth'], noopKeys: ['useMaxWidth', 'useWidth'] },
    semanticChannels: ['value', 'category', 'emphasis'],
    detect: (line: string) => /^pie(?:\s|$)/.test(line),
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('pie-slice', 'shape', 'data-mark'), nativeSceneRole('legend', 'text', 'shape', 'data-mark'), nativeSceneRole('title', 'text'), nativeSceneRole('label', 'text')],
    example: 'pie title Plans\n  "Free" : 60\n  "Pro" : 30\n  "Enterprise" : 10',
    editorExample: `pie showData
  title Export requests by format
  "SVG" : 42
  "PNG" : 28
  "ASCII" : 18
  "Unicode" : 12`,
  },
  {
    id: 'quadrant',
    upstreamId: 'quadrantChart',
    maturity: 'stable',
    label: 'Quadrant',
    headers: ['quadrantChart'],
    narrower: 'asQuadrant',
    editorDiagramType: 'Quadrant',
    editorLabel: 'Quadrant chart',
    editorDescription: 'Two-axis priority map with labeled regions and points.',
    editorExampleId: 'quadrant-basic',
    editorGlyph: '4Q',
    config: {
      section: 'quadrantChart',
      keys: [
        'chartWidth',
        'chartHeight',
        'titleFontSize',
        'titlePadding',
        'quadrantPadding',
        'quadrantLabelFontSize',
        'xAxisLabelFontSize',
        'yAxisLabelFontSize',
        'xAxisLabelPadding',
        'yAxisLabelPadding',
        'pointLabelFontSize',
        'pointRadius',
        'pointTextPadding',
        'quadrantInternalBorderStrokeWidth',
        'quadrantExternalBorderStrokeWidth',
        'useMaxWidth',
        'quadrantTextTopPadding',
        'xAxisPosition',
        'yAxisPosition',
        'useWidth',
      ],
      noopKeys: ['quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth'],
    },
    aliases: ['quadrant'],
    semanticChannels: ['category'],
    detect: (line: string) => /^quadrant(?:chart)?\s*$/.test(line),
    detectLoose: (line: string) => /^quadrant(?:chart)?(?:\s|$)/.test(line),
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('plate', 'shape'), nativeSceneRole('grid', 'shape'), nativeSceneRole('point', 'shape'), nativeSceneRole('axis', 'text'), nativeSceneRole('title', 'text'), nativeSceneRole('label', 'text')],
    example: 'quadrantChart\n  title Prioritize\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  Quick win: [0.2, 0.8]\n  Money pit: [0.8, 0.2]',
    editorExample: `quadrantChart
  title Feature priorities
  x-axis Low impact --> High impact
  y-axis Low effort --> High effort
  quadrant-1 Plan carefully
  quadrant-2 Big bets
  quadrant-3 Defer
  quadrant-4 Quick wins
  SVG export: [0.78, 0.28]
  MCP setup: [0.62, 0.72]
  Palette polish: [0.35, 0.24]`,
  },
  {
    id: 'gantt',
    upstreamId: 'gantt',
    maturity: 'stable',
    label: 'Gantt',
    headers: ['gantt'],
    narrower: 'asGantt',
    editorDiagramType: 'Gantt',
    editorLabel: 'Gantt chart',
    editorDescription: 'Sections, dependencies, status tags, and a milestone.',
    editorExampleId: 'gantt-basic',
    editorGlyph: 'G',
    config: {
      section: 'gantt',
      keys: ['displayMode', 'barHeight', 'topAxis', 'tickInterval', 'axisFormat', 'barGap', 'topPadding', 'leftPadding', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday'],
      noopKeys: ['barGap', 'topPadding', 'leftPadding', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday'],
    },
    semanticChannels: ['status', 'progress', 'emphasis', 'category'],
    detect: (line: string) => /^gantt\s*$/.test(line),
    detectLoose: (line: string) => /^gantt(?:\s|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document'),
      nativeSceneRole('section', 'text', 'shape'),
      nativeSceneRole('grid', 'shape'),
      nativeSceneRole('axis', 'text'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('task', 'shape'),
      nativeSceneRole('milestone', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('marker-line', 'shape'),
      nativeSceneRole('title', 'text'),
    ],
    example: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Implement :a1, 2026-01-05, 5d\n  Review :after a1, 2d',
    editorExample: `gantt
  title Release train
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
    Completed task :done, des1, 2024-01-08, 2024-01-10
    Active task    :active, des2, 2024-01-11, 3d
    Future task    :des3, after des2, 5d
  section Ship
    Crit review    :crit, rev1, after des3, 2d
    Release        :milestone, m1, after rev1, 0d`,
  },
  {
    id: 'mindmap',
    upstreamId: 'mindmap',
    maturity: 'stable',
    label: 'Mindmap',
    headers: ['mindmap'],
    narrower: 'asMindmap',
    editorDiagramType: 'Mindmap',
    editorLabel: 'Mindmap',
    editorDescription: 'A centered, bilateral hierarchy with shapes, Markdown, Unicode, accessibility, and deep quality branches.',
    editorExampleId: 'mindmap-basic',
    editorGlyph: 'M',
    config: { section: 'mindmap', keys: ['padding', 'maxNodeWidth'] },
    semanticChannels: ['importance', 'category'],
    detect: (line: string) => /^mindmap\s*$/.test(line),
    detectLoose: (line: string) => /^mindmap(?:\s|$)/.test(line),
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('edge', 'connector'), nativeSceneRole('node', 'container'), nativeSceneRole('icon', 'document', 'text'), nativeSceneRole('label', 'text')],
    example: 'mindmap\n  root((Product))\n    Research\n      Interviews\n      Evidence\n    Delivery\n      Launch',
    editorExample: `mindmap
  root((Agent-native release))
    discovery[Discovery]
      ::icon(fa fa-book)
      :::urgent large
      evidence["\`**Evidence** across
interviews, benchmarks, and Unicode naïve café\`"]
      constraints{{Constraints}}
        Security
        Determinism
    delivery(Delivery)
      beta))Beta signal((
      launch)Launch cloud(
      quality[Quality gates]
        Parser round-trip
        SVG identity
        Terminal width
    Ecosystem
      Mermaid parity
      Terminal tools`,
  },
  {
    id: 'gitgraph',
    upstreamId: 'gitGraph',
    maturity: 'stable',
    label: 'GitGraph',
    headers: ['gitGraph'],
    narrower: 'asGitGraph',
    editorDiagramType: 'GitGraph',
    editorLabel: 'GitGraph',
    editorDescription: 'Ordered branches, commit types, tags, a semantic merge, and a merge-parent backport.',
    editorExampleId: 'gitgraph-basic',
    editorGlyph: 'Git',
    config: { section: 'gitGraph', keys: ['showBranches', 'showCommitLabel', 'mainBranchName', 'mainBranchOrder', 'parallelCommits', 'rotateCommitLabel'] },
    semanticChannels: ['status', 'category'],
    detect: (line: string) => /^gitgraph(?:\s+(?:lr|tb|bt))?\s*:?\s*$/.test(line),
    detectLoose: (line: string) => /^gitgraph(?:\s|:|$)/.test(line),
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('group', 'container'),
      nativeSceneRole('rail', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('node', 'container'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"\n  checkout main\n  commit id:"release"\n  merge feature id:"merge"',
    editorExample: `---
title: Release train with backport
config:
  gitGraph:
    mainBranchName: main
    mainBranchOrder: 0
    showBranches: true
    showCommitLabel: true
    rotateCommitLabel: true
---
gitGraph LR:
  accTitle: Release history with feature merge and backport
  accDescr: Develop and release branches diverge, main merges develop, and release cherry-picks the merge
  commit id:"ROOT" tag:"v1.0.0" msg:"Foundation"
  branch develop order:2
  commit id:"API" type:HIGHLIGHT tag:"beta" msg:"Build API"
  branch release order:3
  commit id:"RC" type:REVERSE tag:"rc.1" msg:"Cut release candidate"
  checkout develop
  commit id:"UI" msg:"Finish interface"
  checkout main
  commit id:"HOTFIX" type:REVERSE msg:"Patch production"
  merge develop id:"MERGE" tag:"v2.0.0" type:HIGHLIGHT
  checkout release
  cherry-pick id:"MERGE" parent:"UI" tag:"backport"
  commit id:"PATCH" msg:"Verify release"`,
  },
  {
    id: 'radar',
    upstreamId: 'radar',
    maturity: 'experimental',
    label: 'Radar',
    headers: ['radar-beta'],
    narrower: 'asRadar',
    editorDiagramType: 'Radar',
    editorLabel: 'Radar chart',
    editorDescription: 'Multivariate profiles compared across shared axes — the silhouette is the message.',
    editorExampleId: 'radar-basic',
    editorGlyph: 'R',
    config: { section: 'radar', keys: ['width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'axisScaleFactor', 'axisLabelFactor', 'curveTension', 'useMaxWidth', 'tickLabels', 'useWidth'], noopKeys: ['useWidth'] },
    semanticChannels: ['category'],
    detect: (line: string) => /^radar-beta(?:\s|:|$)/.test(line),
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('grid', 'shape'), nativeSceneRole('pie-slice', 'shape'), nativeSceneRole('point', 'shape'), nativeSceneRole('axis', 'text'), nativeSceneRole('legend', 'shape', 'text'), nativeSceneRole('title', 'text')],
    example: 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5',
    editorExample: `radar-beta
  title Model comparison
  axis speed["Speed"], accuracy["Accuracy"], cost["Cost"]
  axis latency["Latency"], context["Context"], safety["Safety"]
  curve a["Model A"]{4, 5, 3, 4, 4, 5}
  curve b["Model B"]{5, 3, 4, 3, 5, 3}
  graticule polygon
  max 5`,
  },
  {
    id: 'sankey',
    upstreamId: 'sankey',
    maturity: 'experimental',
    label: 'Sankey',
    headers: ['sankey', 'sankey-beta'],
    narrower: 'asSankey',
    editorDiagramType: 'Sankey',
    editorLabel: 'Sankey diagram',
    editorDescription: 'Conserved flows between layered stages — ribbon width is the quantity.',
    editorExampleId: 'sankey-basic',
    editorGlyph: 'SK',
    config: { section: 'sankey', keys: ['width', 'height', 'linkColor', 'nodeAlignment', 'showValues', 'prefix', 'suffix', 'labelStyle', 'nodeWidth', 'nodePadding', 'nodeColors', 'useMaxWidth'], noopKeys: ['useMaxWidth'] },
    semanticChannels: ['value', 'category'],
    detect: (line: string) => /^sankey(?:-beta)?\s*$/.test(line),
    detectLoose: (line: string) => /^sankey(?:-beta)?(?:\s|$)/.test(line),
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('edge', 'connector'), nativeSceneRole('bar', 'shape', 'data-mark'), nativeSceneRole('label', 'text'), nativeSceneRole('title', 'text')],
    // Balanced by construction (Electricity grid: in 127.93 = out 71.24 + 56.69):
    // the example agents copy must clear the FLOW_IMBALANCE conservation lint,
    // and stays 4 nodes / 3 edges to match the pinned structural-count fixture.
    example: 'sankey-beta\n  Coal,Electricity grid,127.93\n  Electricity grid,Industry,71.24\n  Electricity grid,Losses,56.69',
    // Balanced (Electricity in 180 = out 180), multi-source so the editor shows
    // ribbon stacking and the categorical palette across several nodes.
    editorExample: `sankey-beta
  Coal,Electricity,60
  Gas,Electricity,80
  Solar,Electricity,40
  Electricity,Homes,120
  Electricity,Industry,60`,
  },
] as const satisfies readonly BuiltinFamilyDescriptorSeed[]

export type BuiltinFamilyId = (typeof BUILTIN_FAMILY_DESCRIPTOR_SEEDS)[number]['id']

function completeBuiltinDescriptor(seed: BuiltinFamilyDescriptorSeed): FamilyDescriptor {
  const { sceneRoles, narrower: _narrower, editorDiagramType: _editorDiagramType, editorLabel: _editorLabel, editorDescription: _editorDescription, editorExampleId: _editorExampleId, editorGlyph: _editorGlyph, editorExample: _editorExample, ...descriptor } = seed
  const semanticRoles = sceneRoles.map(row => row.role)
  return freezeDescriptor({
    ...descriptor,
    ...BUILTIN_AGENT_HOOKS[seed.id],
    ...BUILTIN_RENDER_HOOKS[seed.id],
    contractVersion: FAMILY_DESCRIPTOR_CONTRACT_VERSION,
    identity: createExtensionIdentity({
      id: `family:${seed.id}`,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.2.0' },
      provenance: { owner: 'agentic-mermaid', source: 'built-in' },
    }),
    collisionPriority: 100,
    aliases: seed.aliases ?? [],
    semanticRoles,
    scenePrimitiveEvidence: declareFamilyScenePrimitiveEvidence(seed.id, sceneRoles, ['src/__tests__/section-a-family-descriptor-conformance.test.ts']),
    capabilityEvidence: builtinFamilyCapabilityEvidence(seed.id),
  })
}

export const BUILTIN_FAMILY_METADATA: readonly BuiltinFamilyMetadata[] = Object.freeze(
  BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(({ id, label, headers, narrower, editorDiagramType, editorLabel, editorDescription, editorExampleId, editorGlyph, editorExample, example }) =>
    Object.freeze({ id, label, headers, narrower, editorDiagramType, editorLabel, editorDescription, editorExampleId, editorGlyph, editorExample, example }),
  ),
)

type BuiltinFamilyMetadataCoversDiagramKind = [Exclude<DiagramKind, BuiltinFamilyId>, Exclude<BuiltinFamilyId, DiagramKind>] extends [never, never] ? true : never

export const BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND: BuiltinFamilyMetadataCoversDiagramKind = true

export function builtinFamilyMetadata(kind: DiagramKind): BuiltinFamilyMetadata | undefined {
  return BUILTIN_FAMILY_METADATA.find(f => f.id === kind)
}

const BUILTIN_IDS = new Set<string>(BUILTIN_FAMILY_DESCRIPTOR_SEEDS.map(seed => seed.id))

export function isBuiltinFamilyId(id: string): id is BuiltinFamilyId {
  return BUILTIN_IDS.has(id)
}

export function isExternalFamilyId(id: string): id is ExternalFamilyId {
  return parseExtensionId(id)?.kind === 'family'
}

function normalizedHeader(header: string): string {
  return header.trim().toLowerCase()
}

function validDeclaredHeader(header: unknown): header is string {
  return typeof header === 'string' && header !== '' && header === header.trim() && !/[;\u0000-\u001f\u007f]/.test(header)
}

const UPSTREAM_HEADER_OWNERS = new Map<string, string>(UPSTREAM_MERMAID_FAMILY_INDEX.families.flatMap(family => family.headers.map(header => [normalizedHeader(header.value), family.id] as const)))

const FAMILY_DESCRIPTOR_FIELDS = Object.freeze([
  'contractVersion',
  'identity',
  'id',
  'upstreamId',
  'label',
  'headers',
  'aliases',
  'maturity',
  'collisionPriority',
  'detect',
  'detectLoose',
  'config',
  'applicableRenderOptions',
  'semanticRoles',
  'semanticChannels',
  'scenePrimitiveEvidence',
  'capabilityEvidence',
  'example',
  'normalizeRequest',
  'extractLabels',
  'parse',
  'buildSourceMap',
  'serialize',
  'mutate',
  'verify',
  'layout',
  'projectPositioned',
  'renderSvg',
  'lowerScene',
  'renderAscii',
] as const satisfies readonly (keyof FamilyDescriptor)[])

type UncapturedFamilyDescriptorField = Exclude<keyof FamilyDescriptor, (typeof FAMILY_DESCRIPTOR_FIELDS)[number]>
/** Compile-time tripwire: a future descriptor field must make an explicit
 * snapshot decision before it can participate in registration. */
const ALL_FAMILY_DESCRIPTOR_FIELDS_CAPTURED: UncapturedFamilyDescriptorField extends never ? true : never = true

const MAX_FAMILY_DESCRIPTOR_ARRAY_ITEMS = 100_000

/** Read a fixed record surface once. The returned plain object is the only
 * value that later snapshot/validation code may inspect, so an accessor-backed
 * candidate cannot present one value during validation and another at commit. */
function captureFields(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const source = value as object
  return Object.fromEntries(fields.map(field => [field, Reflect.get(source, field)]))
}

/** Descriptor arrays are declarative dense tuples/lists. Snapshot indices
 * without consulting a caller-provided iterator and reject pathological or
 * sparse containers before validation performs any further walks. */
function snapshotDescriptorArray<T, U>(value: unknown, label: string, project: (item: T, index: number) => U): readonly U[] | unknown {
  if (!Array.isArray(value)) return value
  const length = Reflect.get(value, 'length') as unknown
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw new TypeError(`Family descriptor ${label} must have a non-negative integer length`)
  }
  if ((length as number) > MAX_FAMILY_DESCRIPTOR_ARRAY_ITEMS) {
    throw new RangeError(`Family descriptor ${label} exceeds the ${MAX_FAMILY_DESCRIPTOR_ARRAY_ITEMS}-item limit`)
  }
  const result: U[] = []
  for (let index = 0; index < (length as number); index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`Family descriptor ${label} must not be sparse`)
    }
    result.push(project(Reflect.get(value, String(index)) as T, index))
  }
  return Object.freeze(result)
}

/** Capture an open string-keyed identity record once. Compatibility may carry
 * forward-compatible namespaced contracts, so its key set cannot be closed. */
function snapshotIdentityRecord(value: unknown): Readonly<Record<string, unknown>> | unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  return Object.freeze(Object.fromEntries(Object.entries(value)))
}

function snapshotFamilyIdentity(value: unknown): FamilyDescriptor['identity'] | unknown {
  const captured = captureFields(value, ['id', 'kind', 'version', 'compatibility', 'provenance'])
  if (!captured) return value
  const compatibility = snapshotIdentityRecord(captured.compatibility)
  const provenanceFields = captureFields(captured.provenance, ['owner', 'source', 'reference'])
  const provenance = provenanceFields ? Object.freeze(provenanceFields) : captured.provenance
  return createExtensionIdentity({
    id: captured.id as string,
    kind: captured.kind as 'family',
    version: captured.version as string,
    compatibility: compatibility as ExtensionIdentity<'family'>['compatibility'],
    provenance: provenance as ExtensionIdentity<'family'>['provenance'],
  })
}

function snapshotFamilyConfig(value: unknown): FamilyConfigContract | unknown {
  const captured = captureFields(value, ['section', 'keys', 'noopKeys'])
  if (!captured) return value
  const keys = snapshotDescriptorArray<string, string>(captured.keys, 'config.keys', item => item)
  const noopKeys = captured.noopKeys === undefined ? undefined : snapshotDescriptorArray<string, string>(captured.noopKeys, 'config.noopKeys', item => item)
  return Object.freeze({
    section: captured.section,
    keys,
    ...(noopKeys === undefined ? {} : { noopKeys }),
  }) as unknown as FamilyConfigContract
}

function snapshotScenePrimitiveCell(value: unknown, index: number): FamilyScenePrimitiveEvidence {
  const captured = captureFields(value, ['role', 'primitive', 'applicability', 'realization', 'evidence', 'diagnostic'])
  if (!captured) return value as FamilyScenePrimitiveEvidence
  return Object.freeze({
    role: captured.role,
    primitive: captured.primitive,
    applicability: captured.applicability,
    realization: captured.realization,
    evidence: snapshotDescriptorArray<string, string>(captured.evidence, `scenePrimitiveEvidence[${index}].evidence`, item => item),
    ...(captured.diagnostic === undefined ? {} : { diagnostic: captured.diagnostic }),
  }) as unknown as FamilyScenePrimitiveEvidence
}

function snapshotCapabilityCell(value: unknown, index: number): FamilyCapabilityEvidence {
  const captured = captureFields(value, ['capability', 'state', 'evidence'])
  if (!captured) return value as FamilyCapabilityEvidence
  return Object.freeze({
    capability: captured.capability,
    state: captured.state,
    evidence: snapshotDescriptorArray<string, string>(captured.evidence, `capabilityEvidence[${index}].evidence`, item => item),
  }) as unknown as FamilyCapabilityEvidence
}

/** Materialize the complete public descriptor surface exactly once, then
 * recursively snapshot every declarative nested value used by validation,
 * conformance, routing, discovery, and commit. Executable hooks are captured
 * as references once and thereafter execute from this frozen descriptor. */
function freezeDescriptor(untrusted: FamilyDescriptor): FamilyDescriptor {
  void ALL_FAMILY_DESCRIPTOR_FIELDS_CAPTURED
  const captured = captureFields(untrusted, FAMILY_DESCRIPTOR_FIELDS)
  if (!captured) throw new TypeError('Family descriptor must be an object')
  // Match ordinary object-spread semantics for absent optional fields without
  // returning to the source to distinguish absent from explicitly undefined.
  const defined = Object.fromEntries(Object.entries(captured).filter(([, value]) => value !== undefined))
  return Object.freeze({
    ...defined,
    identity: snapshotFamilyIdentity(captured.identity),
    headers: snapshotDescriptorArray<string, string>(captured.headers, 'headers', item => item),
    aliases: snapshotDescriptorArray<string, string>(captured.aliases, 'aliases', item => item),
    semanticRoles: snapshotDescriptorArray<string, string>(captured.semanticRoles, 'semanticRoles', item => item),
    // Additive compatibility: descriptors registered before the channel census
    // omitted this field and mean "no declared semantic channels".
    semanticChannels: captured.semanticChannels === undefined ? Object.freeze([]) : snapshotDescriptorArray<string, SemanticChannelName>(captured.semanticChannels, 'semanticChannels', item => item as SemanticChannelName),
    scenePrimitiveEvidence: snapshotDescriptorArray<unknown, FamilyScenePrimitiveEvidence>(captured.scenePrimitiveEvidence, 'scenePrimitiveEvidence', snapshotScenePrimitiveCell),
    capabilityEvidence: snapshotDescriptorArray<unknown, FamilyCapabilityEvidence>(captured.capabilityEvidence, 'capabilityEvidence', snapshotCapabilityCell),
    ...(captured.config === undefined ? {} : { config: snapshotFamilyConfig(captured.config) }),
    ...(captured.applicableRenderOptions === undefined
      ? {}
      : {
          applicableRenderOptions: snapshotDescriptorArray<string, string>(captured.applicableRenderOptions, 'applicableRenderOptions', item => item),
        }),
  }) as FamilyDescriptor
}

function detectorClaims(descriptor: FamilyDescriptor, header: string): boolean {
  const normalized = normalizedHeader(header)
  if (!descriptorOwnsDetectionLine(descriptor, normalized)) return false
  return descriptor.detect(normalized) || Boolean(descriptor.detectLoose?.(normalized))
}

const FAMILY_CAPABILITY_STATES = new Set<FamilyCapabilityState>(['native', 'source-preserved', 'diagnosed', 'not-applicable', 'absent'])

function validSceneRoleDeclaration(role: string): boolean {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SCENE_ROLE_TRAITS, role)) return true
  return /^[a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._/-]*$/i.test(role)
}

function hasPublicLayoutProjection(descriptor: FamilyDescriptor): boolean {
  return descriptor.layout !== undefined && descriptor.projectPositioned !== undefined
}

function hasPublicSceneExecution(descriptor: FamilyDescriptor): boolean {
  return descriptor.layout !== undefined && descriptor.lowerScene !== undefined
}

function hasPublicSvgExecution(descriptor: FamilyDescriptor): boolean {
  return descriptor.layout !== undefined && (descriptor.lowerScene !== undefined || descriptor.renderSvg !== undefined)
}

function hasPublicVerificationProjection(descriptor: FamilyDescriptor): boolean {
  return hasPublicLayoutProjection(descriptor) && hasPublicSvgExecution(descriptor)
}

function expectedCapabilityState(descriptor: FamilyDescriptor, capability: FamilyCapability): FamilyCapabilityState {
  switch (capability) {
    case 'detection':
      return 'native'
    case 'source-preservation':
      return descriptor.parse ? 'native' : 'source-preserved'
    case 'parse':
      return descriptor.parse ? 'native' : 'source-preserved'
    case 'serialize':
      return descriptor.serialize ? 'native' : 'source-preserved'
    // Extension mutation verbs remain a closed built-in union. Built-ins, on
    // the other hand, must carry the hook that their native claim advertises.
    case 'mutation':
      return isBuiltinFamilyId(descriptor.id) && descriptor.mutate ? 'native' : 'diagnosed'
    // Built-ins pass through the family-neutral verifier; extensions also need
    // their family hook. Both paths require the same executable SVG + public
    // positioned-layout tuple that verifyMermaid consumes at runtime.
    case 'verify':
      return hasPublicVerificationProjection(descriptor) && (isBuiltinFamilyId(descriptor.id) || descriptor.verify !== undefined) ? 'native' : 'diagnosed'
    // A layout hook can legitimately serve SVG/Scene without exposing layout
    // JSON. That partial tuple is diagnosed rather than advertised as native.
    case 'layout':
      return hasPublicLayoutProjection(descriptor) ? 'native' : descriptor.layout || descriptor.projectPositioned ? 'diagnosed' : 'absent'
    case 'scene':
      return hasPublicSceneExecution(descriptor) ? 'native' : descriptor.lowerScene ? 'diagnosed' : 'absent'
    case 'svg':
      return hasPublicSvgExecution(descriptor) ? 'native' : 'absent'
    case 'terminal':
      return descriptor.renderAscii ? 'native' : 'absent'
  }
}

function validateDescriptor(descriptor: FamilyDescriptor, replacingId?: FamilyId, registry: ReadonlyMap<FamilyId, FamilyDescriptor> = REGISTRY): void {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Family descriptor must be an object')
  if (!isBuiltinFamilyId(descriptor.id) && !isExternalFamilyId(descriptor.id)) {
    throw new Error(`External family id "${descriptor.id}" must use the "family:" namespace`)
  }
  if (!isBuiltinFamilyId(descriptor.id) && (descriptor.id === 'family:unknown' || descriptor.id.startsWith('family:upstream/') || BUILTIN_IDS.has(descriptor.id.slice('family:'.length)))) {
    throw new Error(`External family id "${descriptor.id}" is reserved by the core family/preservation envelope`)
  }
  const expectedIdentityId = isBuiltinFamilyId(descriptor.id) ? `family:${descriptor.id}` : descriptor.id
  if (descriptor.identity?.id !== expectedIdentityId || descriptor.identity.kind !== 'family') {
    throw new Error(`Family descriptor identity must be "${expectedIdentityId}" with kind "family"`)
  }
  if (descriptor.contractVersion !== FAMILY_DESCRIPTOR_CONTRACT_VERSION) {
    throw new Error(`Family "${descriptor.id}" uses an unsupported descriptor contract`)
  }
  createExtensionIdentity({
    id: descriptor.identity.id,
    kind: descriptor.identity.kind,
    version: descriptor.identity.version,
    compatibility: descriptor.identity.compatibility,
    provenance: descriptor.identity.provenance,
  })
  if (!isBuiltinFamilyId(descriptor.id)) {
    // Every extension executes inside the core parse/render/receipt lifecycle,
    // even when it does not lower through Scene. Refuse unversioned core
    // coupling up front so future core changes remain negotiable rather than
    // silently reinterpreting an older extension.
    requireExtensionContractCompatibility(descriptor.identity, 'core')
    if (descriptor.lowerScene) requireExtensionContractCompatibility(descriptor.identity, 'scene')
  }
  if (!descriptor.label) {
    throw new Error(`Family "${descriptor.id}" must declare version, provenance, and label`)
  }
  if (!Array.isArray(descriptor.headers) || descriptor.headers.length === 0 || descriptor.headers.some(header => !validDeclaredHeader(header))) {
    throw new Error(`Family "${descriptor.id}" must declare at least one canonical header without surrounding whitespace, controls, or semicolons`)
  }
  if (typeof descriptor.detect !== 'function') throw new Error(`Family "${descriptor.id}" must declare a detector`)
  if (!Number.isSafeInteger(descriptor.collisionPriority)) throw new Error(`Family "${descriptor.id}" must declare an integer collisionPriority`)

  if (!Array.isArray(descriptor.aliases) || descriptor.aliases.some(alias => !validDeclaredHeader(alias))) {
    throw new Error(`Family "${descriptor.id}" must declare canonical aliases without surrounding whitespace, controls, or semicolons`)
  }
  const claimedHeaders = new Set([...descriptor.headers, ...descriptor.aliases].map(normalizedHeader))
  for (const [id, existing] of registry) {
    if (id === replacingId) continue
    const collision = [...existing.headers, ...existing.aliases].map(normalizedHeader).find(header => claimedHeaders.has(header))
    if (collision) throw new Error(`Family header "${collision}" is already owned by "${id}"`)
  }
  const upstreamAlias = descriptor.aliases.find(alias => UPSTREAM_HEADER_OWNERS.has(normalizedHeader(alias)))
  if (upstreamAlias) {
    throw new Error(`Family "${descriptor.id}" alias "${upstreamAlias}" is an upstream public header and must be declared in headers`)
  }
  const declaredUpstreamFamilies = new Set(descriptor.headers.map(header => UPSTREAM_HEADER_OWNERS.get(normalizedHeader(header))).filter((id): id is string => id !== undefined))
  if (declaredUpstreamFamilies.size > 1) {
    throw new Error(`Family "${descriptor.id}" cannot claim upstream headers from multiple Mermaid families`)
  }
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
  if (!Array.isArray(descriptor.semanticChannels)) throw new Error(`Family "${descriptor.id}" must declare a semanticChannels array`)
  if (!Array.isArray(descriptor.scenePrimitiveEvidence)) throw new Error(`Family "${descriptor.id}" must declare a scenePrimitiveEvidence array`)
  if (!Array.isArray(descriptor.capabilityEvidence)) throw new Error(`Family "${descriptor.id}" must declare a capabilityEvidence array`)
  if (new Set(descriptor.semanticChannels).size !== descriptor.semanticChannels.length) {
    throw new Error(`Family "${descriptor.id}" declares duplicate semantic channels`)
  }
  const invalidChannel = descriptor.semanticChannels.find(channel => !SEMANTIC_CHANNEL_NAMES.includes(channel))
  if (invalidChannel) throw new Error(`Family "${descriptor.id}" declares unknown semantic channel "${String(invalidChannel)}"`)
  if (new Set(descriptor.semanticRoles).size !== descriptor.semanticRoles.length) {
    throw new Error(`Family "${descriptor.id}" declares duplicate Scene roles`)
  }
  const invalidRole = descriptor.semanticRoles.find(role => !validSceneRoleDeclaration(role))
  if (invalidRole) throw new Error(`Family "${descriptor.id}" declares invalid Scene role "${invalidRole}"`)
  if (descriptor.lowerScene && descriptor.renderSvg) {
    throw new Error(`Family "${descriptor.id}" must declare one graphical waist: lowerScene, or renderSvg as an extension fallback, not both`)
  }
  if (descriptor.lowerScene && descriptor.semanticRoles.length === 0) {
    throw new Error(`Family "${descriptor.id}" has a Scene lowering but declares no Scene roles`)
  }
  if (!descriptor.lowerScene && descriptor.semanticRoles.length > 0) {
    throw new Error(`Family "${descriptor.id}" declares Scene roles without a Scene lowering`)
  }

  const sceneCells = new Set<string>()
  for (const cell of descriptor.scenePrimitiveEvidence) {
    if (!descriptor.semanticRoles.includes(cell.role)) {
      throw new Error(`Family "${descriptor.id}" has primitive evidence for undeclared Scene role "${cell.role}"`)
    }
    if (!CORE_SCENE_PRIMITIVES.includes(cell.primitive)) {
      throw new Error(`Family "${descriptor.id}" has evidence for unknown Scene primitive "${String(cell.primitive)}"`)
    }
    const key = `${cell.role}\u0000${cell.primitive}`
    if (sceneCells.has(key)) {
      throw new Error(`Family "${descriptor.id}" repeats primitive evidence for "${cell.role}/${cell.primitive}"`)
    }
    sceneCells.add(key)
    if (cell.applicability !== 'applicable' && cell.applicability !== 'not-applicable') {
      throw new Error(`Family "${descriptor.id}" has invalid applicability for "${cell.role}/${cell.primitive}"`)
    }
    if (!PRIMITIVE_REALIZATIONS.includes(cell.realization)) {
      throw new Error(`Family "${descriptor.id}" has invalid realization for "${cell.role}/${cell.primitive}"`)
    }
    if (!Array.isArray(cell.evidence) || cell.evidence.length === 0 || cell.evidence.some((path: unknown) => typeof path !== 'string' || !path.trim())) {
      throw new Error(`Family "${descriptor.id}" must cite evidence for "${cell.role}/${cell.primitive}"`)
    }
    if (new Set(cell.evidence).size !== cell.evidence.length) {
      throw new Error(`Family "${descriptor.id}" repeats evidence for "${cell.role}/${cell.primitive}"`)
    }
    if (cell.applicability === 'applicable' && cell.realization === 'unsupported') {
      throw new Error(`Family "${descriptor.id}" cannot mark applicable cell "${cell.role}/${cell.primitive}" unsupported`)
    }
    if (cell.applicability === 'not-applicable' && (cell.realization !== 'unsupported' || !cell.diagnostic?.trim())) {
      throw new Error(`Family "${descriptor.id}" must make negative cell "${cell.role}/${cell.primitive}" explicitly unsupported and diagnosed`)
    }
  }
  for (const role of descriptor.semanticRoles) {
    for (const primitive of CORE_SCENE_PRIMITIVES) {
      if (!sceneCells.has(`${role}\u0000${primitive}`)) {
        throw new Error(`Family "${descriptor.id}" lacks primitive evidence for "${role}/${primitive}"`)
      }
    }
  }

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
  if (descriptor.renderSvg && !descriptor.layout) {
    throw new Error(`Family "${descriptor.id}" cannot render SVG without a layout hook`)
  }
  if (descriptor.lowerScene && !descriptor.layout) {
    throw new Error(`Family "${descriptor.id}" cannot lower Scene without a layout hook`)
  }
  for (const capability of FAMILY_CAPABILITY_COLUMNS) {
    const declared = evidenceByCapability.get(capability)!.state
    const expected = expectedCapabilityState(descriptor, capability)
    if (declared !== expected) {
      throw new Error(`Family "${descriptor.id}" capability "${capability}" claims "${declared}" but its hooks require "${expected}"`)
    }
  }
  if (!isBuiltinFamilyId(descriptor.id) && descriptor.capabilityEvidence.some(claim => claim.state === 'native')) {
    if (typeof descriptor.example !== 'string' || descriptor.example.trim() === '') {
      throw new Error(`External family "${descriptor.id}" must declare a canonical example for executable native conformance`)
    }
    if (boundedUtf8ByteLength(descriptor.example, FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES) > FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES) {
      throw new Error(`External family "${descriptor.id}" example exceeds the ${FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES}-byte conformance limit`)
    }
  }
  const ownHeaders = [...descriptor.headers, ...descriptor.aliases].map(normalizedHeader)
  if (new Set(ownHeaders).size !== ownHeaders.length) throw new Error(`Family "${descriptor.id}" declares duplicate headers`)
  const unrecognized = ownHeaders.find(header => !descriptor.detect(header))
  if (unrecognized) throw new Error(`Family detector for "${descriptor.id}" does not recognize its declared header "${unrecognized}"`)
  const looselyUnrecognized = descriptor.detectLoose ? ownHeaders.find(header => !descriptor.detectLoose!(header)) : undefined
  if (looselyUnrecognized) {
    throw new Error(`Family loose detector for "${descriptor.id}" does not recognize its declared header "${looselyUnrecognized}"`)
  }
  const claimed = new Set(ownHeaders)
  for (const [id, existing] of registry) {
    if (id === replacingId) continue
    if (existing.identity.id === descriptor.identity.id) {
      throw new ExtensionCollisionError(descriptor.identity, existing.identity)
    }
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

/** Validate every complete built-in against the same rules used for
 * extensions before exposing any of them through the registry. */
function buildBuiltinRegistry(): Map<FamilyId, FamilyDescriptor> {
  const candidate = new Map<FamilyId, FamilyDescriptor>()
  for (const seed of BUILTIN_FAMILY_DESCRIPTOR_SEEDS) {
    const descriptor = completeBuiltinDescriptor(seed)
    validateDescriptor(descriptor, undefined, candidate)
    candidate.set(descriptor.id, descriptor)
  }
  return candidate
}

/** The only mutable family authority. Built-ins enter it as complete values;
 * later mutations are limited to atomic extension install/uninstall and the
 * explicit test-only replacement seam. */
const REGISTRY = buildBuiltinRegistry()

function freezeFamilyConformanceReport(report: FamilyConformanceReport): FamilyConformanceReport {
  return Object.freeze({
    ...report,
    capabilities: Object.freeze(report.capabilities.map(result => Object.freeze({ ...result }))),
  })
}

function builtinFamilyConformanceReport(descriptor: FamilyDescriptor): FamilyConformanceReport {
  return freezeFamilyConformanceReport({
    version: FAMILY_CONFORMANCE_VERSION,
    familyId: descriptor.id,
    example: descriptor.example,
    passed: true,
    capabilities: FAMILY_CAPABILITY_COLUMNS.map(capability => ({
      capability,
      declaredState: descriptor.capabilityEvidence.find(claim => claim.capability === capability)!.state,
      status: 'passed',
      witnessId: `family-builtin-suite@${FAMILY_CONFORMANCE_VERSION}/${descriptor.id}/${capability}`,
    })),
  })
}

/** Executable proof authority paired with each immutable registry entry. */
const CONFORMANCE = new Map<FamilyId, FamilyConformanceReport>(Array.from(REGISTRY.values(), descriptor => [descriptor.id, builtinFamilyConformanceReport(descriptor)] as const))

/** While a candidate's callbacks execute, no callback may change the registry
 * it is being judged against. This also protects existing unregister tokens
 * and the explicit test replacement seam from detector/hook reentrancy. */
let stagedMutation: { readonly id: FamilyId; readonly token: symbol } | null = null

function assertRegistryMutationAllowed(): void {
  if (stagedMutation) {
    throw new Error(`Family registry mutation is forbidden while candidate "${stagedMutation.id}" is undergoing conformance`)
  }
}

export interface StagedFamilyCandidate {
  readonly descriptor: FamilyDescriptor
  commit(report: FamilyConformanceReport): () => void
  rollback(): void
}

/** @internal Higher-level registration owns executable conformance. This seam
 * only validates, freezes, stages and atomically commits/rolls back a value;
 * importing a renderer here would invert the registry dependency. */
export function stageFamilyCandidateForConformance(descriptor: FamilyDescriptor, validateSnapshot?: (descriptor: FamilyDescriptor) => void): StagedFamilyCandidate {
  assertRegistryMutationAllowed()
  const token = Symbol('family-candidate')
  // Descriptor accessors are caller-owned code too. Enter the mutation guard
  // before the first field read, then replace the placeholder with the one
  // captured id without changing this staging token.
  stagedMutation = { id: 'family:unread-candidate' as ExternalFamilyId, token }
  try {
    // Snapshot before the first field read. Validation, staging, executable
    // conformance, and commit must all observe this exact descriptor value.
    const installed = freezeDescriptor(descriptor)
    const id = installed.id
    stagedMutation = { id, token }
    if (isBuiltinFamilyId(id)) {
      throw new Error(`Built-in family "${id}" already exists; use replaceFamilyForTest explicitly in tests`)
    }
    const existing = REGISTRY.get(id)
    if (existing) throw new ExtensionCollisionError(installed.identity, existing.identity)
    validateSnapshot?.(installed)
    validateDescriptor(installed)
    REGISTRY.set(id, installed)
    let settled = false
    const settle = (): void => {
      if (stagedMutation?.token !== token) throw new Error(`Family candidate "${id}" lost its staging authority`)
      stagedMutation = null
      settled = true
    }
    return Object.freeze({
      descriptor: installed,
      commit(report: FamilyConformanceReport): () => void {
        if (settled) throw new Error(`Family candidate "${id}" is already settled`)
        if (report.familyId !== id) throw new Error(`Family conformance report for "${report.familyId}" cannot commit "${id}"`)
        if (report.capabilities.length !== FAMILY_CAPABILITY_COLUMNS.length || FAMILY_CAPABILITY_COLUMNS.some(capability => !report.capabilities.some(result => result.capability === capability))) {
          throw new Error(`Family conformance report for "${id}" is incomplete`)
        }
        const frozenReport = freezeFamilyConformanceReport(report)
        CONFORMANCE.set(id, frozenReport)
        settle()
        let removed = false
        return () => {
          if (removed) return
          assertRegistryMutationAllowed()
          if (REGISTRY.get(id) === installed) {
            REGISTRY.delete(id)
            CONFORMANCE.delete(id)
          }
          removed = true
        }
      },
      rollback(): void {
        if (settled) return
        if (REGISTRY.get(id) === installed) REGISTRY.delete(id)
        CONFORMANCE.delete(id)
        settle()
      },
    })
  } catch (error) {
    if (stagedMutation?.token === token) stagedMutation = null
    throw error
  }
}

/** Explicit replacement seam for characterization tests; returns an idempotent restore. */
export function replaceFamilyForTest(id: FamilyId, replacement: FamilyDescriptor): () => void {
  assertRegistryMutationAllowed()
  const previous = REGISTRY.get(id)
  if (!previous) throw new Error(`Cannot replace unknown family "${id}"`)
  const token = Symbol(`replace:${id}`)
  stagedMutation = { id, token }
  try {
    const installed = freezeDescriptor(replacement)
    if (installed.id !== id) throw new Error(`Replacement id "${installed.id}" does not match "${id}"`)
    validateDescriptor(installed, id)
    REGISTRY.set(id, installed)
  } catch (error) {
    if (stagedMutation?.token === token) stagedMutation = null
    throw error
  }
  if (stagedMutation?.token !== token) throw new Error(`Family replacement "${id}" lost its mutation authority`)
  stagedMutation = null
  let restored = false
  return () => {
    if (restored) return
    assertRegistryMutationAllowed()
    REGISTRY.set(id, previous)
    restored = true
  }
}

export function getFamily(kind: FamilyId | string): FamilyDescriptor | undefined {
  return REGISTRY.get(kind as FamilyId)
}

/** Immutable executable evidence for one exact registered descriptor. */
export function getFamilyConformanceReport(kind: FamilyId | string): FamilyConformanceReport | undefined {
  return CONFORMANCE.get(kind as FamilyId)
}

/** Report-facing state projection. A declaration alone can never manufacture
 * a native capability; native appears only beside a passed executable cell. */
export function effectiveFamilyCapabilityState(descriptor: FamilyDescriptor, capability: FamilyCapability): FamilyCapabilityState {
  const declared = descriptor.capabilityEvidence.find(claim => claim.capability === capability)?.state ?? 'absent'
  if (declared !== 'native') return declared
  const result = CONFORMANCE.get(descriptor.id)?.capabilities.find(cell => cell.capability === capability)
  return result?.status === 'passed' ? 'native' : 'diagnosed'
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

/** A detector refines the grammar of a declared header; it does not create a
 * second, invisible header authority. The boundary rule admits Mermaid's
 * ordinary header arguments and gitGraph's colon form while preventing a
 * broad extension predicate from swallowing future headers such as
 * `auditDiagramV2` or an unrelated upstream family. */
function descriptorOwnsDetectionLine(descriptor: FamilyDescriptor, line: string): boolean {
  return [...descriptor.headers, ...descriptor.aliases].some(candidate => {
    const header = normalizedHeader(candidate)
    if (!line.startsWith(header)) return false
    const boundary = line[header.length]
    return boundary === undefined || boundary === ':' || /\s/.test(boundary)
  })
}

/** Descriptor-driven routing for built-ins and installed extensions. */
export function detectRegisteredFamilyDescriptorFromFirstLine(firstLine: string, mode: 'strict' | 'loose' = 'strict'): FamilyDescriptor | null {
  const line = normalizeDetectionLine(firstLine)
  const descriptors = Array.from(REGISTRY.values()).sort((a, b) => b.collisionPriority - a.collisionPriority || compareCodePointStrings(a.id, b.id))
  for (const descriptor of descriptors) {
    if (!descriptorOwnsDetectionLine(descriptor, line)) continue
    const detector = mode === 'loose' ? (descriptor.detectLoose ?? descriptor.detect) : descriptor.detect
    // Return the immutable descriptor from this exact registry snapshot. A
    // detector is executable extension code and may mutate registry state; a
    // later id lookup would otherwise switch or lose the request's owner.
    if (detector(line)) return descriptor
  }
  return null
}

export function detectRegisteredFamilyFromFirstLine(firstLine: string, mode: 'strict' | 'loose' = 'strict'): FamilyId | null {
  return detectRegisteredFamilyDescriptorFromFirstLine(firstLine, mode)?.id ?? null
}

export type { ExtensionIdentity } from '../shared/extension-identity.ts'
export type { ExternalFamilyId, FamilyId } from './types.ts'
