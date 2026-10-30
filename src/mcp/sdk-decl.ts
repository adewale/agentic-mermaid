import { SDK_COMMON_DECLARATIONS, SDK_MODEL_DECLARATIONS, SDK_TEXT_DECLARATIONS } from './generated/sdk-types.ts'
import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyMetadata } from '../agent/families.ts'
import { architectureVisualOverridesTypeScriptDeclaration, RENDER_CONTRACT_VERSION, RENDER_OUTPUT_DESCRIPTORS, sharedRenderOptionsTypeScriptDeclaration } from '../render-contract.ts'
import { styleSpecTypeScriptDeclaration } from '../scene/style-spec.ts'
import { FAMILY_NARROWING_NOTE, NEW_DIAGRAM_POLICY } from '../shared/agent-workflow.ts'
import { terminalOutputOptionsTypeScriptFields, terminalOutputPolicyTypeScriptDeclaration } from '../terminal-contract.ts'

function sdkFamilyTypeStem(family: BuiltinFamilyMetadata): string {
  return family.narrower.slice(2)
}

function sdkFamilyBodyType(family: BuiltinFamilyMetadata): string {
  return family.id === 'flowchart' ? `{ kind: 'flowchart'; graph: FlowchartGraph }` : `${sdkFamilyTypeStem(family)}Body`
}

const SDK_DIAGRAM_KIND_DECLARATION = `type DiagramKind = ${BUILTIN_FAMILY_METADATA.map(family => `'${family.id}'`).join(' | ')}`

const SDK_DIAGRAM_BODY_MEMBERS = BUILTIN_FAMILY_METADATA.map(family => `    | ${sdkFamilyBodyType(family)}`).join('\n')

const SDK_VALID_DIAGRAM_ALIASES = BUILTIN_FAMILY_METADATA.map(family => `type ${sdkFamilyTypeStem(family)}ValidDiagram = ValidDiagram & { body: ${sdkFamilyBodyType(family)} }`).join('\n')

const SDK_NARROWER_METHOD_DECLARATIONS = BUILTIN_FAMILY_METADATA.map(family => `  ${family.narrower}(d: ParsedDiagram): ${sdkFamilyTypeStem(family)}ValidDiagram | null`).join('\n')

const SDK_MUTATE_METHOD_DECLARATIONS = BUILTIN_FAMILY_METADATA.map(family => {
  const stem = sdkFamilyTypeStem(family)
  return `  mutate(d: ${stem}ValidDiagram, op: ${stem}MutationOp): Result<${stem}ValidDiagram, { code: string; message: string }>`
}).join('\n')

const SDK_FAMILY_CONVENTION = `// 3. mutate works on ${BUILTIN_FAMILY_METADATA.map(family => family.id).join(', ')}. Narrow via\n//    ${BUILTIN_FAMILY_METADATA.map(family => family.narrower).join('/')}.\n//    ${FAMILY_NARROWING_NOTE}`

function codeModeRenderMethodDeclarations(): string {
  const methods = new Map<
    string,
    {
      optionsType: string
      returnType: string
      outputs: string[]
    }
  >()
  for (const descriptor of RENDER_OUTPUT_DESCRIPTORS) {
    const transport = descriptor.transports.codeMode
    if (transport.availability !== 'direct' && transport.availability !== 'projected') continue
    const output = `${descriptor.id}: ${transport.selector ?? transport.availability}`
    const existing = methods.get(transport.method)
    if (existing) {
      if (existing.optionsType !== transport.optionsType || existing.returnType !== transport.returnType) {
        throw new Error(`Code Mode render contract for ${transport.method} has incompatible signatures`)
      }
      existing.outputs.push(output)
    } else {
      methods.set(transport.method, {
        optionsType: transport.optionsType,
        returnType: transport.returnType,
        outputs: [output],
      })
    }
  }
  return [...methods].map(([method, declaration]) => `  // ${declaration.outputs.join('; ')}\n  ${method}(input: ParsedDiagram | string, opts?: ${declaration.optionsType}): ${declaration.returnType}`).join('\n')
}

/** Generated once from the canonical render-option descriptors and embedded in
 * both the compact tools/list declaration and the full SDK reference. */
export const CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION = sharedRenderOptionsTypeScriptDeclaration()

const CODE_MODE_OUTPUT_RENDER_OPTION_DECLARATIONS = `interface ConfigDiagnostic { code: 'INEFFECTIVE_CONFIG'; field: string; message: string }
interface TerminalProjectionDiagnostic { code: string; feature: string; message: string; cell?: { column: number; row: number } }

interface SvgRenderOptions extends SharedRenderOptions {
  onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void
}

interface AsciiRenderOptions extends SharedRenderOptions {
${terminalOutputOptionsTypeScriptFields()}
  onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void
  onProjectionDiagnostic?: (diagnostic: TerminalProjectionDiagnostic) => void
}

interface LayoutRenderOptions extends SharedRenderOptions {
  debug?: boolean
  regions?: boolean
  actions?: boolean
  onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void
}`

const CODE_MODE_RENDER_RECEIPT_DECLARATIONS = `interface RenderArtifactDiagnostic { code: string; message?: string; reference?: string; feature?: string; input?: string; canonicalId?: string; removal?: { release: string; date: string } }
interface CapabilityResolution { readonly id: \`\${string}:\${string}\`; readonly range: string; readonly level: 'required' | 'preferred' | 'optional'; readonly status: 'selected' | 'unsupported' | 'incompatible'; readonly version?: string }
type CapabilityDecision = Readonly<{ version: 1; accepted: boolean; resolutions: readonly CapabilityResolution[] }>
interface RenderExecutionDecision {
  readonly family: { readonly id: string; readonly version: string }
  readonly backend: { readonly mode: 'scene'; readonly requestedId: string; readonly selectedId: string; readonly version: string; readonly hostPolicy: boolean } | { readonly mode: 'family-svg' }
  readonly digest: string
}
type GraphLayoutDecision = Readonly<{ requested: 'elk' | 'agentic'; fallback: 'none' | 'elk'; selected: 'elk' | 'agentic'; reason?: string; attempts: readonly Readonly<{ backend: 'elk' | 'agentic'; outcome: 'selected' | 'unsupported' | 'candidate-rejected'; reason?: string }>[]; implementation: string; role?: 'primary' | 'companion' }>
interface RenderRequestReceipt { version: ${RENDER_CONTRACT_VERSION}; output: 'svg' | 'png' | 'ascii' | 'unicode' | 'html' | 'layout'; sharedRequestDigest: string; requestDigest: string; appearanceDigest: string; capabilityDecision: CapabilityDecision; diagnostics?: readonly RenderArtifactDiagnostic[]; graphicalProjectionDigest?: string; executionDecision?: RenderExecutionDecision; layoutDecisions?: readonly GraphLayoutDecision[] }`

/** Lossless whitespace projection for the tools/list context budget. Every
 * member remains generated by the same declarations used in the full SDK. */
function compactInterfaceDeclarations(declaration: string): string {
  let compact = ''
  for (const sourceLine of declaration.split('\n')) {
    const line = sourceLine.trim()
    if (!line) continue
    if (line.startsWith('interface ') && line.endsWith('}')) {
      compact += `${line}\n`
    } else if (line.endsWith('{')) {
      compact += `${line} `
    } else if (line === '}') {
      compact += `}\n`
    } else {
      compact += `${line.replaceAll('?: ', '?:')};`
    }
  }
  return compact.trimEnd()
}

/** Preserve literals and line separators while dropping optional type-syntax
 * whitespace from the progressive-disclosure prompt. */
export function compactSdkDeclaration(source: string): string {
  return source.replace(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\s+/g, (text, literal: string | undefined, offset: number) => {
    if (literal) return literal
    if (text.includes('\n')) return '\n'
    return /[\w$]/.test(source[offset - 1] ?? '') && /[\w$]/.test(source[offset + text.length] ?? '') ? ' ' : ''
  })
}

const CODE_MODE_CORE_SHARED_RENDER_OPTIONS_DECLARATION = compactInterfaceDeclarations(CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION)
const CODE_MODE_CORE_OUTPUT_RENDER_OPTION_DECLARATIONS = compactInterfaceDeclarations(CODE_MODE_OUTPUT_RENDER_OPTION_DECLARATIONS)
const CODE_MODE_CORE_RENDER_RECEIPT_DECLARATIONS = compactInterfaceDeclarations(CODE_MODE_RENDER_RECEIPT_DECLARATIONS)

export const CODE_MODE_RENDER_OPTION_DECLARATIONS = `${SDK_TEXT_DECLARATIONS}

${styleSpecTypeScriptDeclaration()}

${architectureVisualOverridesTypeScriptDeclaration()}

${CODE_MODE_SHARED_RENDER_OPTIONS_DECLARATION}

${CODE_MODE_OUTPUT_RENDER_OPTION_DECLARATIONS}

${CODE_MODE_RENDER_RECEIPT_DECLARATIONS}

interface TerminalConnectorProjection {
  id: string
  role: string
  realization: 'native' | 'emulated' | 'projected' | 'lossy' | 'unsupported'
  topology: 'line' | 'polyline' | 'path'
  direction: 'forward' | 'reverse' | 'bidirectional' | 'undirected' | 'self'
  relationship: string
  markers: { start?: { id: string; shape: string }; mid: readonly { id: string; shape: string }[]; end?: { id: string; shape: string } }
  labels: readonly { id?: string; text: string; textContent?: LabelContent }[]
  lineStyle: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
  strokeLosses: readonly string[]
  diagnostics: readonly string[]
}
interface ResolvedTerminalStyle {
  version: 1
  colorMode: 'none' | 'ansi16' | 'ansi256' | 'truecolor' | 'html'
  theme: Readonly<{ fg: string; border: string; line: string; arrow: string; accent?: string; bg?: string; corner?: string; junction?: string }>
  diagnostics: readonly TerminalProjectionDiagnostic[]
  connectorProjection: { evidence: 'scene' | 'unavailable' | 'not-evaluated'; count: number; topologies: Readonly<Record<'line' | 'polyline' | 'path', number>>; realizations: Readonly<Record<string, number>>; relationships: readonly string[]; directions: readonly string[]; markerPositions: Readonly<{ start: number; mid: number; end: number }>; labelCount: number; connectors: readonly TerminalConnectorProjection[]; digest: string }
  digest: string
}
${terminalOutputPolicyTypeScriptDeclaration()}
interface RenderedSvg { svg: string; receipt: RenderRequestReceipt }
interface RenderedAscii { text: string; receipt: RenderRequestReceipt; terminalStyle: ResolvedTerminalStyle; outputPolicy: ResolvedTerminalOutputPolicy }
interface RenderedLayoutArtifact { layout: VerifyResult['layout']; receipt: RenderRequestReceipt }`

/** Compact tools/list projection. It shares the exact generated public option
 * fields, output-option interfaces, and receipt contract with the full SDK,
 * while intentionally summarizing the full terminal evidence records. */
const CODE_MODE_CORE_STYLE_SPEC_DECLARATION = styleSpecTypeScriptDeclaration({ compact: true }).replaceAll(' | ', '|').replaceAll(', ', ',')

export const CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS = compactSdkDeclaration(`${CODE_MODE_CORE_STYLE_SPEC_DECLARATION}
type ArchitectureVisualOverrides = Readonly<Record<string, unknown>>

${CODE_MODE_CORE_SHARED_RENDER_OPTIONS_DECLARATION}

${CODE_MODE_CORE_OUTPUT_RENDER_OPTION_DECLARATIONS}

${CODE_MODE_CORE_RENDER_RECEIPT_DECLARATIONS}

interface RenderedSvg { svg: string; receipt: RenderRequestReceipt }
interface RenderedAscii { text: string; receipt: RenderRequestReceipt; terminalStyle: Record<string, unknown>; outputPolicy: Record<string, unknown> }
interface RenderedLayoutArtifact { layout: VerifyResult['layout']; receipt: RenderRequestReceipt }`.replace(/; +/g, ';').replace(/: +/g, ':'))

export const CODE_MODE_LAYOUT_SUMMARY_DECLARATION = `interface RenderedLayout { version: 1; kind: DiagramKind | ExternalFamilyId; nodes: unknown[]; edges: unknown[]; groups: unknown[]; labels?: Array<{ id: string; text: string; bounds?: LayoutRect; container?: LayoutRect; visibility?: 'visible' | 'hidden' | 'semantic' }>; regions?: RenderedRegion[]; actions?: DiagramActionRecord[]; bounds: { w: number; h: number } }`

const CODE_MODE_RENDER_METHOD_DECLARATIONS = codeModeRenderMethodDeclarations()

export const SDK_DECLARATION = `// Mermaid agent SDK available as the global \`mermaid\`. All calls are
// synchronous and pure. Compose multi-step edits in one execute() call.
// Code Mode is synchronous: async/await, Promise jobs, and dynamic import are not supported.

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
// fields: a nested record's own fields (e.g. xychart set_y_axis axis.range).
interface OpFieldDoc { name: string; required: boolean; type: string; note?: string; fields?: OpFieldDoc[] }
type MermaidConfigScalar = string | number | boolean | null
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | { [key: string]: MermaidConfigValue | undefined }
type MermaidRuntimeConfig = {
  [key: string]: MermaidConfigValue | undefined
  theme?: string
  fontFamily?: string
  themeVariables?: { [key: string]: MermaidConfigValue | undefined; fontFamily?: string }
  timeline?: { [key: string]: MermaidConfigValue | undefined; disableMulticolor?: boolean; sectionFills?: string[]; sectionColours?: string[] }
  journey?: { [key: string]: MermaidConfigValue | undefined; diagramMarginX?: number; diagramMarginY?: number; leftMargin?: number; maxLabelWidth?: number; taskMargin?: number; actorColours?: string[]; sectionFills?: string[]; sectionColours?: string[]; useMaxWidth?: boolean }
  flowchart?: { [key: string]: MermaidConfigValue | undefined; nodeSpacing?: number; rankSpacing?: number; wrappingWidth?: number }
  // State geometry consumes the faithful ELK/measured-text equivalents;
  // legacy Dagre calibration keys remain typed and emit INEFFECTIVE_CONFIG.
  state?: { [key: string]: MermaidConfigValue | undefined; titleTopMargin?: number; arrowMarkerAbsolute?: boolean; dividerMargin?: number; sizeUnit?: number; padding?: number; textHeight?: number; titleShift?: number; noteMargin?: number; nodeSpacing?: number; rankSpacing?: number; forkWidth?: number; forkHeight?: number; miniPadding?: number; fontSizeFactor?: number; fontSize?: number; labelHeight?: number; edgeLengthFactor?: string; compositTitleSize?: number; radius?: number; defaultRenderer?: 'dagre-d3' | 'dagre-wrapper' | 'elk'; layout?: string; look?: string; minNodeWidth?: number; theme?: string; wrappingWidth?: number }
  class?: { [key: string]: MermaidConfigValue | undefined; nodeSpacing?: number; rankSpacing?: number }
  er?: { [key: string]: MermaidConfigValue | undefined; layoutDirection?: string; nodeSpacing?: number; rankSpacing?: number }
  architecture?: { [key: string]: MermaidConfigValue | undefined; padding?: number; iconSize?: number; fontSize?: number; nodeSeparation?: number; idealEdgeLengthMultiplier?: number }
  xyChart?: { [key: string]: MermaidConfigValue | undefined }
  pie?: { [key: string]: MermaidConfigValue | undefined; textPosition?: number; donutHole?: number; legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'center' }
  quadrantChart?: { [key: string]: MermaidConfigValue | undefined; chartWidth?: number; chartHeight?: number; pointRadius?: number; useMaxWidth?: boolean }
  gantt?: { [key: string]: MermaidConfigValue | undefined; displayMode?: string }
  mindmap?: { [key: string]: MermaidConfigValue | undefined; padding?: number; maxNodeWidth?: number }
  gitGraph?: { [key: string]: MermaidConfigValue | undefined; showBranches?: boolean; showCommitLabel?: boolean; mainBranchName?: string; mainBranchOrder?: number; parallelCommits?: boolean; rotateCommitLabel?: boolean }
  radar?: { [key: string]: MermaidConfigValue | undefined; width?: number; height?: number; marginTop?: number; marginRight?: number; marginBottom?: number; marginLeft?: number; axisScaleFactor?: number; axisLabelFactor?: number; curveTension?: number; useMaxWidth?: boolean; tickLabels?: boolean }
  c4?: { [key: string]: MermaidConfigValue | undefined; maxWidth?: number; compact?: boolean; typeLegend?: boolean; diagramMarginX?: number; diagramMarginY?: number; c4ShapeMargin?: number; c4ShapePadding?: number; width?: number; height?: number; c4ShapeInRow?: number; c4BoundaryInRow?: number; useMaxWidth?: boolean }
  sankey?: { [key: string]: MermaidConfigValue | undefined; width?: number; height?: number; linkColor?: string; nodeAlignment?: 'justify' | 'center' | 'left' | 'right'; showValues?: boolean; prefix?: string; suffix?: string; labelStyle?: 'legacy' | 'outlined'; nodeWidth?: number; nodePadding?: number; nodeColors?: Record<string, string>; useMaxWidth?: boolean }
  // Wired sequence keys (unlisted documented keys are accepted and named by
  // verify's INEFFECTIVE_CONFIG lint — see src/sequence/config.ts).
  sequence?: { [key: string]: MermaidConfigValue | undefined; actorMargin?: number; width?: number; height?: number; diagramMarginX?: number; diagramMarginY?: number; messageMargin?: number; noteMargin?: number; activationWidth?: number; showSequenceNumbers?: boolean }
  useMaxWidth?: boolean
  useWidth?: number
  /** Recognized for upstream accounting but public renderers reject raw CSS; use StyleSpec. */
  themeCSS?: string
}

${CODE_MODE_RENDER_OPTION_DECLARATIONS}

${SDK_DIAGRAM_KIND_DECLARATION}
${SDK_COMMON_DECLARATIONS}

interface ValidDiagram {
  readonly kind: DiagramKind
  readonly source: SourceMap
  readonly meta: {
    frontmatter?: Record<string, unknown>
    initDirectives: { raw: string; parsed: Record<string, unknown> }[]
    comments: { text: string; line: number }[]
    wrapperSource?: string   // exact bytes before the family header; parsed diagrams always set it, even as ''
    droppedComments?: { text: string; line: number }[]   // line indexes the artifact the loss happened in, not canonicalSource
    accessibility: { title?: string; descr?: string }
  }
  readonly body:
${SDK_DIAGRAM_BODY_MEMBERS}
    | { kind: 'opaque'; family: DiagramKind; source: string }
  readonly canonicalSource: string   // normalized renderer input; opaque fidelity uses body.source
}

interface ExtensionDiagramBody {
  readonly kind: 'extension'
  readonly family: ExternalFamilyId
  readonly source: string
  readonly data?: unknown
}

interface ExtensionValidDiagram {
  readonly kind: ExternalFamilyId
  readonly descriptorIdentity: ExtensionIdentity<'family'>
  readonly meta: ValidDiagram['meta']
  readonly body: ExtensionDiagramBody
  readonly source: SourceMap
  readonly canonicalSource: string
}

interface PreservedValidDiagram {
  readonly kind: ExternalFamilyId
  readonly meta: ValidDiagram['meta']
  readonly body: {
    readonly kind: 'preserved'
    readonly representation: 'opaque' | 'unknown'
    readonly source: string
    readonly preservation: SourcePreservationReceipt
    readonly spans: PreservedSourceSpans
    readonly diagnostic: {
      readonly code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH'
      readonly message: string
      readonly help: string
    }
  }
  readonly source: SourceMap
  readonly canonicalSource: string
}

type ParsedDiagram = ValidDiagram | ExtensionValidDiagram | PreservedValidDiagram

${SDK_MODEL_DECLARATIONS}

${SDK_VALID_DIAGRAM_ALIASES}

// Tier 1 (structural, reliable): EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS,
//   GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW (rendered-line char count:
//   <br> splits lines, XML entities decode to one char),
//   UNRESOLVABLE_SCHEDULE (gantt: parses but schedule cannot resolve; render would fail),
//   RENDER_FAILED (the strict render parser, layout, or theme colors rejected the source
//   or its configuration; origin: 'source' | 'config'),
//   INTERNAL_ERROR (an Agentic Mermaid defect, not the source; defaultRender:
//   'succeeds-unchecked' | 'fails' says whether an ordinary render still produces output;
//   do not rewrite the diagram to work around it).
// Tier 2 (geometric): CONTENT_OCCLUDED is an error; LAYOUT_LIMIT_EXCEEDED,
// NODE_OVERLAP, ROUTE_SELF_CROSS and the following tripwires are advisory.
// route-contract tripwires ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND,
// ROUTE_LABEL_ON_SHARED_TRUNK, ROUTE_SELF_LOOP_OCCUPANCY, ROUTE_CONTAINER_MISANCHOR,
// ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE.
// Tier 3 (lint, advisory): DUPLICATE_EDGE, UNREACHABLE_NODE,
// DECISION_BRANCH_UNLABELED, FLOW_IMBALANCE, COMMENT_DROPPED, UNSUPPORTED_SYNTAX,
// CONTENT_DROPPED_ON_ROUNDTRIP, INEFFECTIVE_CONFIG, LOW_CONTRAST, LABELS_HIDDEN,
// SCALE_RANGE_EXCLUDES_ZERO, BAR_RANGE_EXCLUDES_ZERO, VALUES_OUTSIDE_RANGE, BRAND_CONSTRAINT_WARNING. BRAND_CONSTRAINT_ERROR is inspect-only policy
// selected explicitly by a Style constraint with action "error".
${CODE_MODE_LAYOUT_SUMMARY_DECLARATION}

type WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH'
  | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'UNRESOLVABLE_SCHEDULE' | 'RENDER_FAILED' | 'INTERNAL_ERROR'
  | 'NODE_OVERLAP' | 'CONTENT_OCCLUDED' | 'LAYOUT_LIMIT_EXCEEDED' | 'ROUTE_SELF_CROSS' | 'ROUTE_HITCH'
  | 'ROUTE_UNEXPLAINED_BEND' | 'ROUTE_LABEL_ON_SHARED_TRUNK' | 'ROUTE_SELF_LOOP_OCCUPANCY' | 'ROUTE_CONTAINER_MISANCHOR'
  | 'ROUTE_SHAPE_MISANCHOR' | 'ROUTE_STALE_AFTER_NODE_MOVE'
  | 'DUPLICATE_EDGE' | 'UNREACHABLE_NODE' | 'DECISION_BRANCH_UNLABELED' | 'FLOW_IMBALANCE' | 'COMMENT_DROPPED' | 'UNSUPPORTED_SYNTAX'
  | 'CONTENT_DROPPED_ON_ROUNDTRIP' | 'EVENT_SOURCE_TYPE' | 'INEFFECTIVE_CONFIG' | 'LOW_CONTRAST' | 'LABELS_HIDDEN' | 'BAR_RANGE_EXCLUDES_ZERO'
  | 'SCALE_RANGE_EXCLUDES_ZERO' | 'VALUES_OUTSIDE_RANGE'
  | 'BRAND_CONSTRAINT_WARNING' | 'BRAND_CONSTRAINT_ERROR'

interface VerifyResult {
  checks?: { renderability: 'passed' | 'failed' | 'not-checked'; sourceLoss: 'detected' | 'not-detected'; taskCorrectness: 'not-checked' }
  ok: boolean
  warnings: { code: WarningCode; [field: string]: unknown }[]
  layout: RenderedLayout
}

interface DiagramAnalysis {
  kind: DiagramKind | ExternalFamilyId
  feedbackEdges: Array<{ edgeIndex: number; from: string; to: string; label?: string; routeClass: string }>
  actions: Array<{ id?: string; regionId?: string; family: DiagramKind; target: string; action: 'href' | 'call' | 'callback'; raw: string; line?: number; href?: string; tooltip?: string; security: 'safe' | 'unsafe' | 'source-only' | 'unsupported'; executable: false; message?: string }>
  gantt?: { criticalPathTaskIds: string[]; slackByTaskId: Record<string, number>; projectStart: number; projectEnd: number; entryTaskIds: string[]; sinkTaskIds: string[] }
}


declare const mermaid: {
  parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>
  // Blank-slate authoring: createMermaid returns an empty structured diagram
  // for any DiagramKind (already narrowed — pass it straight to mutate).
  // buildMermaid folds a typed op list over that empty diagram; on failure the
  // error carries opIndex of the op that failed. direction applies to
  // flowchart/state only.
  createMermaid(kind: DiagramKind, opts?: CreateMermaidOptions): ValidDiagram
  buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts?: CreateMermaidOptions): Result<ValidDiagram, { code: string; message: string; opIndex: number }>
${SDK_NARROWER_METHOD_DECLARATIONS}
${SDK_MUTATE_METHOD_DECLARATIONS}
  verifyMermaid(input: ParsedDiagram | string, opts?: { suppress?: WarningCode[]; labelCharCap?: number; renderOptions?: SharedRenderOptions }): VerifyResult
  analyzeMermaid(d: ValidDiagram): DiagramAnalysis
  analyzeMermaidSource(source: string): Result<DiagramAnalysis, { code: string; message: string }[]>
  describeMermaidFacts(d: ValidDiagram): string[]
  describeMermaidFactsSource(source: string): Result<string[], { code: string; message: string }[]>
  checkMermaid(d: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult
  checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult, { code: string; message: string }[]>
  serializeMermaid(d: ParsedDiagram): string
  // Compatibility conveniences return only bytes/text; use the receipt-aware
  // methods below for transport parity and projection/security evidence.
  renderMermaidSVG(input: ParsedDiagram | string, opts?: SvgRenderOptions): string
  renderMermaidASCII(input: ParsedDiagram | string, opts?: AsciiRenderOptions): string
${CODE_MODE_RENDER_METHOD_DECLARATIONS}
  // Op discovery — look up exact op shapes at runtime instead of guessing.
  // describeOps returns every op's field names, required-ness, inlined enum
  // values, and constraint/default notes (e.g. score "finite number 1..5", shape
  // "default: rectangle"); opSignatures returns compact one-liners like
  // "add_point(label, x, y)". Read these before authoring an unfamiliar op.
  describeOps(family: DiagramKind): Record<string, OpFieldDoc[]>
  opSignatures(family: DiagramKind): string[]
  // Opaque Class: add_member/remove_member; Flowchart: set_label/rename_node.
  // Save value.source exactly; verify value.diagram. Ambiguous ownership and
  // unsupported dependencies refuse; portability diagnostics remain present.
  mutatePreservingSource(d: ParsedDiagram, op: AnyMutationOp): Result<{ source: string; diagram: ParsedDiagram }, { code: string; message: string }>
}

// Conventions:
// 1. ${NEW_DIAGRAM_POLICY}
// 2. For existing structured diagrams, use mutate() + verify + serializeMermaid();
//    do not regenerate/concatenate source when a typed op exists.
${SDK_FAMILY_CONVENTION}
//    State owns a dedicated body (BUILD-19); asFlowchart returns null on it.
//    Gantt bodies are segment-preserving: directives/click/comment lines ride
//    along verbatim as opaque-block segments and are edited as source only.
//    Opaque-fallback
//    bodies (unmodeled syntax) are source-level only; if explicitly edited as
//    text, re-parse and verify before returning.
// 4. verify.ok means no unsuppressed error was detected (including content occlusion), not a visual-quality score; inspect warnings/layout and render artifacts.
//    For semantic task correctness, read back deterministic facts or check them:
//    checkMermaid(d, ['edge Processing -> [*] : done', 'member Duck +quack()']).
// 5. Layout is deterministic and never seeded. The render option seed only
//    re-rolls stochastic ink of styled looks (render option style: a name,
//    an inline style record, or a stack merged left-to-right; a colors-only
//    style is a theme); geometry is identical for identical input. Gantt
//    never reads the wall clock; pass render option ganttToday to draw a
//    deterministic today marker.
`
