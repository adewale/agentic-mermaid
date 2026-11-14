import { WeightedLru } from './experimental/weighted-lru.ts'
import { parserObservationActive } from './shared/parser-observation.ts'
import { familyRoutingRevision } from './agent/family-router.ts'
// ============================================================================
// Canonical render-request waist.
//
// Public adapters may have output-specific controls, but every renderer first
// enters through this module. Source/config/style/color/font/security are
// normalized exactly once and the immutable result is what layout, Scene
// lowering, graphical backends, rasterization, and terminal projection share.
// ============================================================================

import { validateJsonSchema } from './shared/schema-validation.ts'
import type { ConfigDiagnostic, RenderOptions, ResolvedFamilyRenderContext } from './types.ts'
import type { ArchitectureVisualConfig } from './architecture/config.ts'
import type { DiagramColors } from './theme.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import { normalizeMermaidRenderSource } from './mermaid-source.ts'
import { admitParsedModelHandoff, type ParsedRenderModelHandoff } from './agent/owned-render-model.ts'
import { observeCache } from './performance-observations.ts'
import { CHANNEL_THEME_KEYS, readThemeValue, resolveDiagramColors } from './color-resolver.ts'
import { checkArchitectureRenderOptionColors, checkFamilyConfigColors, checkThemeVariableColors } from './theme-color-admission.ts'
import {
  inferBackend,
  isStyledSpec,
  resolveStyleReference,
  resolveStyleStack,
  resolveStyleStackWithFace,
  styleRegistryRevision,
  type InternalStyleFace,
  type StyleSpec,
} from './scene/style-registry.ts'
import { safeCssColor, safeCssPaint } from './shared/css-color.ts'
import { safeCssFontFamily } from './shared/css-font.ts'
import { assertJsonConfigAdmission, isForbiddenJsonConfigKey, JSON_CONFIG_ADMISSION_LIMITS } from './shared/json-config-admission.ts'
import { validateRawThemeCss } from './output-security.ts'
import { negotiateRenderCapabilityTuple, type CapabilityDecision } from './capability-negotiation.ts'
import type {
  CapabilityId,
  CapabilityOffer,
  CapabilityRequirement,
  CapabilityResolution,
} from './capability-negotiation.ts'
import type {
  FamilyAppearanceNormalization,
  FamilyDescriptor,
  FamilyRequestNormalizationResult,
} from './agent/families.ts'
import type { DiagramKind, FamilyId } from './agent/types.ts'
import { classifyMermaidFamilyDescriptorFromFirstLine, familyDetectionDiagnostic, MermaidFamilyDetectionError } from './family-detection.ts'
import { getBackendDescriptor } from './scene/backend.ts'
import { FIRST_PARTY_DRAWING_CONSUMER, type FirstPartyDrawingConsumer } from './scene/default-drawing-consumer.ts'
import { isOwnedFamily } from './experimental/owned-family.ts'
import { nativeDrawingOf, originalNativeDrawingOf, preferSceneDrawing } from './scene/drawing.ts'
import type { BackendDescriptor, HostBackendPolicy } from './scene/backend.ts'
import {
  ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES,
  type EssentialScenePrimitiveCapability,
} from './scene/capabilities.ts'
import { RENDER_OUTPUTS, type RenderOutput } from './render-outputs.ts'
import { explicitFamilyConfigDiagnostics } from './shared/family-config-diagnostics.ts'
import { isPlainRecord } from './shared/plain-data.ts'
import { graphLayoutDecisionsOf, type GraphLayoutDecision } from './layout/backend.ts'
import { bundledInterMetrics } from './builtin-font-metrics.ts'
import { layoutOptimization, type LayoutOptimizationEvidence } from './layout/optimization-context.ts'
import { assertDiagramWorkLimit, DiagramWorkLimitError } from './shared/diagram-limits.ts'
import {
  createTextMeasurementExecution,
  type TextMeasurementExecution,
  type TextMeasurementProfile,
  type TextMeasurementProfileIdentity,
} from './text-measurement-profile.ts'
export { RENDER_OUTPUTS } from './render-outputs.ts'
export type { RenderOutput } from './render-outputs.ts'

import { RENDER_CONTRACT_VERSION } from './render-output-metadata.ts'
export * from './render-output-metadata.ts'

import { NON_SERIALIZABLE_RENDER_OPTION_FIELDS, SHARED_RENDER_OPTION_FIELD_DESCRIPTORS, type SharedRenderOptionField, SHARED_RENDER_OPTION_FIELDS, type FamilyScopedRenderOptionField, FAMILY_SCOPED_RENDER_OPTION_FIELDS, renderSchemaProblems, validateSerializableRenderOptions } from './render-option-contract.ts'
import { JSON_VALUE_SCHEMA, renderOptionsAdmissionMessages, type JsonSchemaNode } from './render-option-contract.ts'
export {
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  type TerminalFieldApplicability,
  type SharedRenderOptionFieldDescriptor,
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  type SharedRenderOptionField,
  SHARED_RENDER_OPTION_FIELDS,
  type FamilyScopedRenderOptionField,
  FAMILY_SCOPED_RENDER_OPTION_FIELDS,
  assertFamilyScopedRenderOptionDeclaration,
  applicableFamilyScopedRenderOptions,
  ALL_RENDER_FIELDS_ACCOUNTED_FOR,
  sharedRenderOptionsTypeScriptDeclaration,
  architectureVisualOverridesTypeScriptDeclaration,
  renderSchemaProblems,
  validateSerializableRenderOptions,
  sharedRenderOptionsJsonSchema,
  renderOptionsSchemaDefinitions,
  misplacedRenderOptionHint,
  styleInputJsonSchema,
} from './render-option-contract.ts'

export interface ResolvedAppearance {
  readonly version: typeof RENDER_CONTRACT_VERSION
  readonly colors: Readonly<DiagramColors>
  readonly font: string
  /** Resolved left-to-right Style stack, never an unresolved public input. */
  readonly style?: Readonly<StyleSpec>
  readonly face?: Readonly<InternalStyleFace>
  readonly styled: boolean
  readonly inferredBackend: string
  /** Canonical identities for named stack entries. */
  readonly styleReferences: readonly ResolvedStyleReference[]
  /** Raw Mermaid theme keys rejected during the sole boundary resolution. */
  readonly unsafeThemeColorKeys?: readonly string[]
  /** Family-owned, serializable visual/config projection resolved at the same
   * boundary as the shared palette. It is data, never an executable registry. */
  readonly family?: Readonly<Record<string, unknown>>
  readonly digest: string
}

export interface ResolvedStyleReference {
  readonly input: string
  readonly canonicalId: string
}

export interface ResolvedRenderRequest {
  readonly version: typeof RENDER_CONTRACT_VERSION
  readonly output: RenderOutput
  readonly source: Readonly<NormalizedMermaidSource>
  /** Canonical normalized options consumed by family code. */
  readonly renderOptions: Readonly<RenderOptions>
  readonly appearance: ResolvedAppearance
  /** Family-owned normalized geometry/config data, kept separate from appearance. */
  readonly familyConfig?: Readonly<Record<string, unknown>>
  /** Version/range decisions made at the request boundary. */
  readonly capabilityDecision: CapabilityDecision
  /** Authored public fields, retained so output projections diagnose only user intent. */
  readonly explicitOptionFields: readonly SharedRenderOptionField[]
  /** Stable diagnostics produced while resolving the shared request boundary. */
  readonly resolutionDiagnostics?: readonly RenderArtifactDiagnostic[]
  /** Output-agnostic digest used for transport-parity comparisons. */
  readonly sharedRequestDigest: string
  /** Full digest including output adapter and normalized output-only controls. */
  readonly requestDigest: string
}

export interface RenderRequestReceipt {
  /** Actual graph geometry decisions, retained outside caller-owned metadata. */
  layoutDecisions?: readonly GraphLayoutDecision[]
  /** Bounded evidence from the actual pixel or terminal-cell projection. */
  layoutCertification?: import('./scene/paint-certification.ts').PaintLayoutCertification | import('./ascii/terminal-certification.ts').TerminalLayoutCertification
  version: typeof RENDER_CONTRACT_VERSION
  output: RenderOutput
  sharedRequestDigest: string
  requestDigest: string
  appearanceDigest: string
  capabilityDecision: CapabilityDecision
  /** Request-resolution and output-policy decisions. */
  diagnostics?: readonly RenderArtifactDiagnostic[]
  /** Digest of the secured graphical projection emitted by this execution. */
  graphicalProjectionDigest?: string
  /** Family/backend selected at execution, including trusted host policy. */
  executionDecision?: RenderExecutionDecision
  /** Pixel metrics used by graphical outputs; contains no executable host inputs. */
  textMeasurement?: TextMeasurementProfileIdentity
  /** Actual bounded optional layout work, separate from mandatory fallbacks. */
  layoutOptimization?: LayoutOptimizationEvidence
}

export interface RenderExecutionDecision {
  readonly family: { readonly id: string; readonly version: string }
  readonly backend:
    | { readonly mode: 'scene'; readonly requestedId: string; readonly selectedId: string; readonly version: string; readonly hostPolicy: boolean }
    | { readonly mode: 'family-svg' }
  readonly digest: string
  readonly textMeasurement?: TextMeasurementProfileIdentity
}

/** Trusted, non-serializable inputs used while freezing an execution plan. */
export interface RenderExecutionResolutionOptions {
  /** Private source-only consumer; this is not a SceneBackend descriptor. */
  readonly drawingConsumer?: FirstPartyDrawingConsumer
  readonly backendPolicy?: HostBackendPolicy
  readonly textMeasurement?: TextMeasurementProfile
  /** Internal identity assertion carried by ParsedDiagram adapters. */
  readonly expectedFamilyId?: FamilyId
  /** Internal source-bound custody from native parsing; public objects cannot forge it. */
  readonly parsedModelHandoff?: ParsedRenderModelHandoff
  /** Internal browser-lazy seam: one already-classified, already-loaded family. */
  readonly familyDescriptor?: FamilyDescriptor
}

/** A ParsedDiagram serializer must reproduce source for that same family. */
export class ParsedDiagramFamilyMismatchError extends Error {
  readonly name = 'ParsedDiagramFamilyMismatchError'
  readonly code = 'PARSED_DIAGRAM_FAMILY_MISMATCH'

  constructor(
    readonly expectedFamilyId: FamilyId,
    readonly detectedFamilyId: FamilyId,
  ) {
    super(`Parsed Mermaid family "${expectedFamilyId}" serialized as family "${detectedFamilyId}"`)
  }
}

/**
 * Exact references selected at request resolution. This plan is deliberately
 * kept in a WeakMap instead of the public request value: descriptors contain
 * executable hooks and host policy must never become serializable payload.
 */
export interface InternalRenderExecutionPlan {
  readonly output: RenderOutput
  readonly mode: 'scene' | 'family-svg' | 'terminal' | 'layout'
  readonly family: FamilyDescriptor
  readonly backend?: BackendDescriptor
  readonly consumer: FirstPartyDrawingConsumer | { readonly kind: 'scene-backend' } | undefined
  readonly requestedBackendId?: string
  /** Immutable diagnostics computed from the exact admitted pre-normalization
   * config while this family execution plan is captured. */
  readonly configDiagnostics?: readonly ConfigDiagnostic[]
  /** Captured separately from the serializable request. The callback is a
   * trusted in-process observer, never receipt or family-normalizer data. */
  readonly onConfigDiagnostic?: NonNullable<RenderOptions['onConfigDiagnostic']>
  readonly capabilityDecision: CapabilityDecision
  readonly executionDecision?: RenderExecutionDecision
  readonly textMeasurement?: TextMeasurementExecution
}

/** Structured preflight failure for hosts that need more than an error string. */
export class RenderCapabilityError extends Error {
  readonly name = 'RenderCapabilityError'
  readonly code = 'UNSATISFIED_RENDER_CAPABILITIES'
  readonly output: RenderOutput
  readonly family: { readonly id: string; readonly version: string }
  readonly decision: CapabilityDecision

  constructor(
    message: string,
    output: RenderOutput,
    family: FamilyDescriptor,
    decision: CapabilityDecision,
  ) {
    super(message)
    this.output = output
    this.family = Object.freeze({ id: family.identity.id, version: family.identity.version })
    this.decision = decision
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      output: this.output,
      family: this.family,
      decision: this.decision,
    }
  }
}

/** Configuration the request waist refuses: invalid RenderOptions, or Mermaid
 * config the selected security mode or layout safety forbids. It stays a
 * TypeError, as these refusals always were, but is typed so verify attributes
 * it to configuration rather than to an engine defect. */
export class RenderConfigError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'RenderConfigError'
  }
}

const EXECUTION_PLAN_BY_REQUEST = new WeakMap<ResolvedRenderRequest, InternalRenderExecutionPlan>()

/** Internal consumer seam for layout/render adapters. Not re-exported by a
 * public package barrel. */
export function resolvedRenderExecutionPlanOf(
  request: ResolvedRenderRequest,
): InternalRenderExecutionPlan {
  const plan = EXECUTION_PLAN_BY_REQUEST.get(request)
  if (!plan) throw new Error('Resolved render request has no internal execution plan')
  return plan
}

export interface RenderArtifactDiagnostic {
  readonly code: string
  readonly message?: string
  readonly reference?: string
  readonly feature?: string
}

function renderOptionApplicabilityDiagnostics(
  family: FamilyDescriptor,
  explicitOptionFields: readonly SharedRenderOptionField[],
): readonly RenderArtifactDiagnostic[] {
  if (family.id.startsWith('family:')) {
    const applicable = new Set(family.applicableRenderOptions ?? [])
    return Object.freeze(explicitOptionFields.flatMap(field => {
      if (!FAMILY_SCOPED_RENDER_OPTION_FIELDS.includes(field as FamilyScopedRenderOptionField)
        || applicable.has(field as FamilyScopedRenderOptionField)) return []
      return [Object.freeze({
        code: 'RENDER_OPTION_NOT_APPLICABLE',
        feature: `render-option:${field}`,
        message: `Render option "${field}" does not apply to extension family "${family.id}". Its FamilyDescriptor does not list the field in applicableRenderOptions.`,
      } satisfies RenderArtifactDiagnostic)]
    }))
  }
  const builtInFamily = family.id as DiagramKind
  return Object.freeze(explicitOptionFields.flatMap(field => {
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
    if (!('applicableBuiltinFamilies' in descriptor)) return []
    const applicableBuiltinFamilies: readonly DiagramKind[] = descriptor.applicableBuiltinFamilies
    if (applicableBuiltinFamilies.includes(builtInFamily)) return []
    const applicability = applicableBuiltinFamilies.length === 0
      ? 'No built-in family currently consumes this option.'
      : `Applicable built-in families: ${applicableBuiltinFamilies.join(', ')}.`
    return [Object.freeze({
      code: 'RENDER_OPTION_NOT_APPLICABLE',
      feature: `render-option:${field}`,
      message: `Render option "${field}" does not apply to built-in Mermaid family "${builtInFamily}". ${applicability}`,
    } satisfies RenderArtifactDiagnostic)]
  }))
}

function receiptDiagnostics(
  request: ResolvedRenderRequest,
  diagnostics: readonly RenderArtifactDiagnostic[],
): readonly RenderArtifactDiagnostic[] {
  const seen = new Set<string>()
  return Object.freeze([
    ...(Object.hasOwn(request, 'resolutionDiagnostics') ? request.resolutionDiagnostics! : []),
    ...diagnostics,
    ...graphLayoutDecisionsOf(request).flatMap(decision => decision.requested !== 'elk' && decision.selected === 'elk' ? [{
      code: 'GRAPH_LAYOUT_FALLBACK', feature: 'graph-layout',
      message: `Agentic graph layout used the requested ELK fallback: ${decision.reason ?? 'candidate rejected'}`,
    }] : []),
  ].flatMap(diagnostic => {
    const key = canonicalJson(diagnostic)
    if (seen.has(key)) return []
    seen.add(key)
    return [Object.freeze({ ...diagnostic })]
  }))
}

export function receiptOf(
  request: ResolvedRenderRequest,
  diagnostics: readonly RenderArtifactDiagnostic[] = [],
): RenderRequestReceipt {
  const executionPlan = EXECUTION_PLAN_BY_REQUEST.get(request)
  const executionDecision = executionPlan?.executionDecision
  // Frozen records still inherit optional fields. Evidence consumed later
  // must only read fields captured by request admission, never a late getter.
  const textMeasurement = executionPlan && Object.hasOwn(executionPlan, 'textMeasurement')
    ? executionPlan.textMeasurement
    : undefined
  return Object.freeze({
    version: request.version,
    output: request.output,
    sharedRequestDigest: request.sharedRequestDigest,
    requestDigest: request.requestDigest,
    appearanceDigest: request.appearance.digest,
    capabilityDecision: request.capabilityDecision,
    diagnostics: receiptDiagnostics(request, diagnostics),
    ...(executionDecision ? { executionDecision } : {}),
    ...(textMeasurement ? { textMeasurement: textMeasurement.identity } : {}),
    ...(layoutOptimization()?.layoutOptimizationEvidenceOf(request) ? { layoutOptimization: layoutOptimization()?.layoutOptimizationEvidenceOf(request) } : {}),
    ...(graphLayoutDecisionsOf(request).length ? { layoutDecisions: graphLayoutDecisionsOf(request) } : {}),
  })
}

/** One explicit projection consumed by every family layout/render adapter. */
export function resolvedFamilyRenderContextOf(
  request: ResolvedRenderRequest,
): ResolvedFamilyRenderContext {
  const prior = FAMILY_CONTEXT_BY_REQUEST.get(request)
  if (prior) return prior
  const plan = EXECUTION_PLAN_BY_REQUEST.get(request)
  const paintBackendId = (plan?.consumer?.kind === 'native-drawing' ? plan.consumer.identity.id : plan?.backend?.identity.id)
    ?? (request.output === 'layout' ? `backend:${request.appearance.inferredBackend}` : undefined)
  const context = Object.freeze({
    renderOptions: request.renderOptions,
    ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
    ...(paintBackendId ? { paintBackendId } : {}),
    ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
    ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
  })
  if (EXECUTION_PLAN_BY_REQUEST.has(request)) FAMILY_CONTEXT_BY_REQUEST.set(request, context)
  return context
}

const FAMILY_CONTEXT_BY_REQUEST = new WeakMap<ResolvedRenderRequest, ResolvedFamilyRenderContext>()

function applyStyleDefaults(
  options: RenderOptions,
  spec: StyleSpec,
  themeVars?: Record<string, unknown>,
): RenderOptions {
  const out: RenderOptions = { ...options }
  const themed = (channel: keyof typeof CHANNEL_THEME_KEYS): boolean =>
    CHANNEL_THEME_KEYS[channel].some(key => themeVars?.[key] !== undefined)
  const channels = ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const
  for (const channel of channels) {
    if (out[channel] === undefined && !themed(channel) && spec.colors?.[channel] !== undefined) {
      out[channel] = spec.colors[channel]
    }
  }
  if (out.font === undefined && spec.font !== undefined) out.font = spec.font
  return out
}

function serializableOptions(options: RenderOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of SHARED_RENDER_OPTION_FIELDS) {
    const value = options[field]
    if (value !== undefined) out[field] = value
  }
  return out
}

const FAMILY_NORMALIZABLE_OPTION_FIELDS = new Set<SharedRenderOptionField>([
  'padding', 'nodeSpacing', 'layerSpacing', 'wrappingWidth', 'class',
])

function serializableOptionCandidate(options: RenderOptions): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(([field, value]) =>
      value !== undefined
      && !(NON_SERIALIZABLE_RENDER_OPTION_FIELDS as readonly string[]).includes(field)),
  )
}

function capturedRequestFamily(
  source: NormalizedMermaidSource,
  classification: ReturnType<typeof classifyMermaidFamilyDescriptorFromFirstLine>,
): FamilyDescriptor {
  if (classification.kind === 'registered') return classification.family
  throw new MermaidFamilyDetectionError(familyDetectionDiagnostic(
    classification.kind === 'unknown' ? { ...classification, header: source.lines[0] ?? source.firstLine } : classification,
    source.originalText,
    source.authoredWrapperLength ?? source.wrapperSource?.length ?? 0,
    source.authoredHeader ?? source.lines[0] ?? source.firstLine,
    null,
  ))
}

function assertFamilyGeometryOptions(
  family: FamilyDescriptor,
  before: RenderOptions,
  after: RenderOptions,
): void {
  if (after.onConfigDiagnostic !== undefined) {
    throw new TypeError(`Family "${family.id}" request normalizer may not return executable option "onConfigDiagnostic"`)
  }
  const problems = validateSerializableRenderOptions(serializableOptionCandidate(after))
  if (problems.length > 0) {
    // A built-in normalizer passes the author's config through; its values are
    // what fail here (an unsafe theme font, an out-of-range size).
    throw new RenderConfigError(`Family "${family.id}" returned invalid normalized RenderOptions: ${problems.join('; ')}`)
  }
  const beforeSerializable = serializableOptions(before)
  const afterSerializable = serializableOptions(after)
  for (const field of SHARED_RENDER_OPTION_FIELDS) {
    if (FAMILY_NORMALIZABLE_OPTION_FIELDS.has(field)) continue
    if (canonicalJson(beforeSerializable[field]) !== canonicalJson(afterSerializable[field])) {
      throw new TypeError(`Family "${family.id}" request normalizer may not rewrite non-geometry option "${field}"`)
    }
  }
}

function normalizedFamilyColors(
  family: FamilyDescriptor,
  value: Readonly<Partial<DiagramColors>>,
  base: DiagramColors,
): DiagramColors {
  const allowed = new Set(['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border', 'shadow', 'font', 'embedFontImport'])
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw new TypeError(`Family "${family.id}" returned unknown appearance color field "${unknown}"`)
  const out: DiagramColors = { ...base }
  for (const field of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
    const candidate = value[field]
    if (candidate === undefined) continue
    const safe = safeCssPaint(candidate)
    // The value is the author's theme or config, passed through by the family.
    if (safe === undefined) throw new RenderConfigError(`Family "${family.id}" returned an unsafe ${field} paint`)
    out[field] = safe
  }
  if (value.font !== undefined) {
    const font = safeCssFontFamily(value.font)
    if (font === undefined) throw new RenderConfigError(`Family "${family.id}" returned an unsafe font family`)
    if (font !== base.font) {
      throw new TypeError(`Family "${family.id}" request normalizer may not rewrite appearance field "font"`)
    }
  }
  if (value.shadow !== undefined) {
    if (typeof value.shadow !== 'boolean') throw new TypeError(`Family "${family.id}" returned a non-boolean shadow value`)
    if (value.shadow !== base.shadow) {
      throw new TypeError(`Family "${family.id}" request normalizer may not rewrite appearance field "shadow"`)
    }
  }
  if (value.embedFontImport !== undefined) {
    if (typeof value.embedFontImport !== 'boolean') throw new TypeError(`Family "${family.id}" returned a non-boolean embedFontImport value`)
    if (value.embedFontImport !== base.embedFontImport) {
      throw new TypeError(`Family "${family.id}" request normalizer may not rewrite appearance field "embedFontImport"`)
    }
  }
  return out
}

const FAMILY_DATA_MAX_DEPTH = 64
const FAMILY_DATA_MAX_NODES = 100_000
const FAMILY_DATA_MAX_CHARS = 2_000_000

interface FamilyDataNormalizationBudget {
  nodes: number
  chars: number
  opaque: boolean
  admission?: { nodes: number; valid: boolean }
  /** Every visited value, position-independent JSON-admission failures and
   * the deepest object/value, so a captured subtree can record its totals. */
  values: number
  invalid: number
  objectDepth: number
  valueDepth: number
}

function familyDataBudget(admission?: NonNullable<FamilyDataNormalizationBudget['admission']>): FamilyDataNormalizationBudget {
  return { nodes: 0, chars: 0, opaque: false, admission, values: 0, invalid: 0, objectDepth: 0, valueDepth: 0 }
}

/** A captured snapshot's budget totals. Snapshots are deeply frozen, so the
 * totals stay true, and a later capture can charge them without walking. Only
 * snapshots with no JSON-admission failure are recorded; any other snapshot
 * always takes the full walk. */
interface AdmittedFamilyData {
  readonly chars: number
  readonly nodes: number
  readonly values: number
  readonly objectDepth: number
  readonly valueDepth: number
}
const ADMITTED_FAMILY_DATA = new WeakMap<object, AdmittedFamilyData>()

/** Capture compact immutable data under the bounds before schema validation.
 * Opaque leaves remain unbranded for the owner's subsequent rejection.
 * A snapshot this function already captured is admitted once: later captures
 * (request receipts, cached capability decisions, family config) charge its
 * recorded totals and reuse it. Whenever a bound could be crossed, the full
 * walk runs instead, so every limit error keeps its exact type and path. */
function omitUndefinedObjectFields(
  value: unknown,
  path = '$',
  depth = 0,
  ancestors = new Set<object>(),
  budget: FamilyDataNormalizationBudget = familyDataBudget(),
): unknown {
  if (value === null || typeof value !== 'object') return captureFamilyDataNode(value, path, depth, ancestors, budget)
  const admitted = ADMITTED_FAMILY_DATA.get(value)
  if (admitted && !ancestors.has(value) && depth + admitted.objectDepth <= FAMILY_DATA_MAX_DEPTH
    && budget.chars + admitted.chars <= FAMILY_DATA_MAX_CHARS && budget.nodes + admitted.nodes <= FAMILY_DATA_MAX_NODES) {
    budget.chars += admitted.chars
    budget.nodes += admitted.nodes
    budget.values += admitted.values
    budget.objectDepth = Math.max(budget.objectDepth, depth + admitted.objectDepth)
    budget.valueDepth = Math.max(budget.valueDepth, depth + admitted.valueDepth)
    const admission = budget.admission
    if (admission?.valid) {
      admission.nodes += admitted.values
      if (admission.nodes > JSON_CONFIG_ADMISSION_LIMITS.maxNodes || depth + admitted.valueDepth > JSON_CONFIG_ADMISSION_LIMITS.maxDepth) admission.valid = false
    }
    return value
  }
  const chars = budget.chars, nodes = budget.nodes, values = budget.values, invalid = budget.invalid
  const objectDepth = budget.objectDepth, valueDepth = budget.valueDepth
  budget.objectDepth = budget.valueDepth = depth
  const captured = captureFamilyDataNode(value, path, depth, ancestors, budget)
  if (captured !== value && typeof captured === 'object' && captured !== null && IMMUTABLE_SNAPSHOTS.has(captured) && budget.invalid === invalid) {
    ADMITTED_FAMILY_DATA.set(captured, {
      chars: budget.chars - chars,
      nodes: budget.nodes - nodes,
      values: budget.values - values,
      objectDepth: budget.objectDepth - depth,
      valueDepth: budget.valueDepth - depth,
    })
  }
  budget.objectDepth = Math.max(budget.objectDepth, objectDepth)
  budget.valueDepth = Math.max(budget.valueDepth, valueDepth)
  return captured
}

function captureFamilyDataNode(
  value: unknown,
  path: string,
  depth: number,
  ancestors: Set<object>,
  budget: FamilyDataNormalizationBudget,
): unknown {
  const admission = budget.admission
  budget.values++
  if (depth > budget.valueDepth) budget.valueDepth = depth
  const invalidLeaf = typeof value === 'number' ? value - value !== 0
    : typeof value === 'undefined' || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function'
  if (invalidLeaf) budget.invalid++
  if (admission?.valid && (++admission.nodes > JSON_CONFIG_ADMISSION_LIMITS.maxNodes || depth > JSON_CONFIG_ADMISSION_LIMITS.maxDepth || invalidLeaf)) admission.valid = false
  if (typeof value === 'string') {
    budget.chars += value.length
    if (budget.chars > FAMILY_DATA_MAX_CHARS) throw new TypeError(`data exceeds the ${FAMILY_DATA_MAX_CHARS}-character aggregate limit at ${path}`)
    return value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth > FAMILY_DATA_MAX_DEPTH) throw new TypeError(`data exceeds maximum depth ${FAMILY_DATA_MAX_DEPTH} at ${path}`)
  if (depth > budget.objectDepth) budget.objectDepth = depth
  if (++budget.nodes > FAMILY_DATA_MAX_NODES) throw new TypeError(`data exceeds the ${FAMILY_DATA_MAX_NODES}-node aggregate limit at ${path}`)
  if (ancestors.has(value)) throw new TypeError(`data must be acyclic at ${path}`)

  if (Array.isArray(value)) {
    if (value.length > FAMILY_DATA_MAX_NODES) throw new TypeError(`data array exceeds the ${FAMILY_DATA_MAX_NODES}-entry limit at ${path}`)
    ancestors.add(value)
    try {
      const result: unknown[] = []
      const slot: PropertyDescriptor = Object.create(null)
      slot.enumerable = slot.configurable = slot.writable = true
      for (let index = 0; index < value.length; index++) {
        // An accessor or Proxy can grow the source after the length preflight.
        if (index >= FAMILY_DATA_MAX_NODES) throw new TypeError(`data array exceeds the ${FAMILY_DATA_MAX_NODES}-entry limit at ${path}`)
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`data must not contain a sparse array at ${path}[${index}]`)
        const child = omitUndefinedObjectFields(value[index], `${path}[${index}]`, depth + 1, ancestors, budget)
        // The fresh destination must own its slots. Ambient array setters or
        // a replaced push method cannot alter or leak this captured graph.
        slot.value = child
        Object.defineProperty(result, index, slot)
      }
      if (result.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) {
        budget.invalid++
        if (admission) admission.valid = false
      }
      return freezeSnapshot(result, !budget.opaque)
    } finally {
      ancestors.delete(value)
    }
  }
  if (!isPlainRecord(value)) {
    budget.opaque = true
    if (admission) admission.valid = false
    return value
  }

  ancestors.add(value)
  try {
    const result: Record<string, unknown> = {}
    let properties = 0
    for (const [key, child] of Object.entries(value)) {
      budget.chars += key.length
      if (budget.chars > FAMILY_DATA_MAX_CHARS) throw new TypeError(`data exceeds the ${FAMILY_DATA_MAX_CHARS}-character aggregate limit at ${path}.${key}`)
      if (child !== undefined) {
        if (++properties > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer || isForbiddenJsonConfigKey(key)) {
          budget.invalid++
          if (admission) admission.valid = false
        }
        const captured = omitUndefinedObjectFields(child, `${path}.${key}`, depth + 1, ancestors, budget)
        if (key in result) Object.defineProperty(result, key, { value: captured, enumerable: true })
        else result[key] = captured
      }
    }
    return freezeSnapshot(result, !budget.opaque)
  } finally {
    ancestors.delete(value)
  }
}

function normalizedFamilyData(
  family: FamilyDescriptor,
  value: Readonly<Record<string, unknown>> | undefined,
  label: 'config' | 'appearance',
  capturedJson = false,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined
  if (!isPlainRecord(value)) {
    throw new TypeError(`Family "${family.id}" returned ${label} data that is not a plain object`)
  }
  // This operation's bounded capture already froze and admitted every leaf.
  if (capturedJson) return value
  let compact: unknown
  try {
    compact = omitUndefinedObjectFields(value)
  } catch (error) {
    throw new TypeError(`Family "${family.id}" returned invalid ${label} data: ${error instanceof Error ? error.message : String(error)}`)
  }
  const root: JsonSchemaNode = { ...JSON_VALUE_SCHEMA, $defs: { jsonValue: JSON_VALUE_SCHEMA } }
  const problems = validateJsonSchema(compact, root, root, [`family${label === 'config' ? 'Config' : 'Appearance'}`], { diagnostics: 'field', validateRuntime: renderSchemaProblems })
  if (problems.length > 0) {
    const detail = problems.map(problem => `${problem.path.join('.')} ${problem.message}`).join('; ')
    throw new TypeError(`Family "${family.id}" returned invalid ${label} data: ${detail}`)
  }
  return immutableSnapshot(compact as Readonly<Record<string, unknown>>)
}

function applyFamilyRequestNormalization(
  family: FamilyDescriptor,
  source: NormalizedMermaidSource,
  renderOptions: RenderOptions,
  colors: DiagramColors,
  style: StyleSpec | undefined,
  face: Readonly<InternalStyleFace> | undefined,
): {
  renderOptions: RenderOptions
  colors: DiagramColors
  familyConfig?: Readonly<Record<string, unknown>>
  familyAppearance?: Readonly<Record<string, unknown>>
} {
  if (!family.normalizeRequest) return { renderOptions, colors }
  const context = Object.freeze({
    source: immutableSnapshot(source),
    renderOptions: immutableSnapshot(renderOptions),
    colors: immutableSnapshot(colors),
    ...(style ? { style: immutableSnapshot(style) } : {}),
    ...(face ? { styleFace: immutableSnapshot(face) } : {}),
  })
  const raw = family.normalizeRequest(context)
  if (raw === undefined) return { renderOptions, colors }
  let admitted: unknown
  const admission = { nodes: 0, valid: true }
  try {
    admitted = boundedImmutableJsonSnapshot(raw, `Family "${family.id}" request normalizer result`, admission)
  } catch (error) {
    throw new TypeError(
      `Family "${family.id}" request normalizer returned invalid data: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isPlainRecord(admitted)) {
    throw new TypeError(`Family "${family.id}" request normalizer must return a plain object`)
  }
  const unknownResultKey = Object.keys(admitted).find(key =>
    !['renderOptions', 'familyConfig', 'appearance'].includes(key))
  if (unknownResultKey) {
    throw new TypeError(`Family "${family.id}" request normalizer returned unknown field "${unknownResultKey}"`)
  }
  const result = admitted as FamilyRequestNormalizationResult
  const appearance: FamilyAppearanceNormalization | undefined = result.appearance
  if (appearance !== undefined) {
    const appearanceValue: unknown = appearance
    if (!isPlainRecord(appearanceValue)) {
      throw new TypeError(`Family "${family.id}" request normalizer returned a non-object appearance`)
    }
    const unknownAppearanceKey = Object.keys(appearanceValue).find(key =>
      !['colors', 'family'].includes(key))
    if (unknownAppearanceKey) {
      throw new TypeError(`Family "${family.id}" request normalizer returned unknown appearance field "${unknownAppearanceKey}"`)
    }
  }
  const normalizedOptions = result.renderOptions ?? renderOptions
  assertFamilyGeometryOptions(family, renderOptions, normalizedOptions)
  const normalizedColors = appearance?.colors
    ? normalizedFamilyColors(family, appearance.colors, colors)
    : colors
  const familyConfig = normalizedFamilyData(family, result.familyConfig, 'config', admission.valid)
  const familyAppearance = normalizedFamilyData(family, appearance?.family, 'appearance', admission.valid)
  return {
    renderOptions: normalizedOptions,
    colors: normalizedColors,
    ...(familyConfig ? { familyConfig } : {}),
    ...(familyAppearance ? { familyAppearance } : {}),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  let text = '{', separator = ''
  for (const key of Object.keys(record).sort()) {
    const child = record[key]
    if (child === undefined) continue
    text += `${separator}${JSON.stringify(key)}:${canonicalJson(child)}`
    separator = ','
  }
  return `${text}}`
}

/** Stable, browser-safe FNV-1a-64 receipt (not a security primitive). */
/** A request receipt that overflows the digest budget is a source too large
 * for this host, even when the source alone fit the sourceCharacters check. */
function admittedRequestReceipt(receipt: unknown, source: { readonly originalText: string; readonly text: string }): unknown {
  try {
    return admitRenderContractDigestInput(receipt)
  } catch (error) {
    if (error instanceof TypeError && /aggregate limit/.test(error.message)) {
      throw new DiagramWorkLimitError('sourceCharacters', source.originalText.length + source.text.length, true)
    }
    throw error
  }
}

export function renderContractDigest(value: unknown): string {
  return canonicalTextDigest(canonicalJson(admitRenderContractDigestInput(value)))
}

/** Capture and admit now, but serialize and hash only if evidence is consumed.
 * The closure never reads caller-owned data or mutable registries. Releasing
 * the captured graph after hashing also avoids retaining duplicate snapshots
 * for a long-lived receipt consumer. Internal only: public digest calls remain
 * eager, including all their admission errors. */
export function deferredRenderContractDigest(value: unknown): () => string {
  return deferredAdmittedDigest(admitRenderContractDigestInput(value))
}

/** Serialize and hash an already-admitted snapshot only when consumed. */
function deferredAdmittedDigest(admitted: unknown): () => string {
  let snapshot: unknown = admitted
  let digest: string | undefined
  return () => {
    if (digest === undefined) {
      digest = canonicalTextDigest(canonicalJson(snapshot))
      snapshot = undefined
    }
    return digest
  }
}

function admitRenderContractDigestInput(value: unknown): unknown {
  // Public digest callers may supply accessor-backed values. Materialize that
  // graph once under the request-data bounds, then validate and canonicalize
  // only the immutable snapshot. Otherwise a getter can present valid data to
  // admission and a cycle to canonicalJson's later recursive read.
  let snapshot: unknown
  // Capture already proves acyclicity, plain containers and a stricter text
  // bound. Account for the remaining JSON rules without a second valid walk.
  // Uncertain captures retain the original validator and diagnostic ordering.
  const admission = { nodes: 0, valid: FAMILY_DATA_MAX_CHARS <= JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters
    && FAMILY_DATA_MAX_CHARS * 3 <= JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextBytes }
  try {
    snapshot = boundedImmutableJsonSnapshot(value, 'render contract digest input', admission)
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace('data exceeds maximum depth', 'data exceeds maximum nesting depth')
    throw new TypeError(message)
  }
  if (!admission.valid) assertJsonConfigAdmission(snapshot, 'render contract digest input', {
    allowUndefinedObjectProperties: true,
  })
  return snapshot
}

/** Internal hash primitive for already-admitted canonical JSON text.
 * Public callers still enter through renderContractDigest's data admission. */
export function canonicalTextDigest(text: string): string {
  // The 64-bit hash as two 32-bit halves; BigInt arithmetic per code unit made
  // hashing each rendered SVG cost more than some of its passes. The prime is
  // 2^40 + 0x1b3, so a multiply is each half times 0x1b3, plus the low half
  // shifted 40 bits and the carry out of the low product into the high half.
  let high = 0xcbf29ce4 | 0
  let low = 0x84222325 | 0
  for (let i = 0; i < text.length; i++) {
    const xored = low ^ text.charCodeAt(i)
    const carry = ((xored >>> 16) * 0x1b3 + (((xored & 0xffff) * 0x1b3) >>> 16)) >>> 16
    low = Math.imul(xored, 0x1b3)
    high = (Math.imul(high, 0x1b3) + carry + (xored << 8)) | 0
  }
  return `fnv1a64:${(high >>> 0).toString(16).padStart(8, '0')}${(low >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Clone and deeply freeze one request snapshot. Shared references are allowed;
 * cycles are not, because receipts must have a finite canonical form.
 */
const IMMUTABLE_SNAPSHOTS = new WeakSet<object>()

function freezeSnapshot<T extends object>(value: T, reusable = true): T {
  // Branding is observable if a host replaces WeakSet.prototype.add. Expose
  // only the frozen container, after its captured descendants are frozen too.
  Object.freeze(value)
  if (reusable) IMMUTABLE_SNAPSHOTS.add(value)
  return value
}

function immutableSnapshot<T>(value: T, path = '$', ancestors?: Set<object>, copies?: WeakMap<object, object>): T {
  if (value === null || typeof value !== 'object') return value
  // Object.isFrozen is insufficient: an externally frozen object may retain
  // getters or mutable descendants. Reuse only snapshots created here.
  if (IMMUTABLE_SNAPSHOTS.has(value)) return value
  ancestors ??= new Set<object>()
  copies ??= new WeakMap<object, object>()
  if (ancestors.has(value)) throw new TypeError(`render request contains a cycle at ${path}`)
  const existing = copies.get(value)
  if (existing) return existing as T
  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError(`render request contains a non-JSON object at ${path}`)
  }
  ancestors.add(value)
  let clone: unknown
  if (Array.isArray(value)) {
    const length = value.length
    const items: unknown[] = new Array(length)
    for (let index = 0; index < length; index++) {
      if (index in value) items[index] = immutableSnapshot(value[index], `${path}[${index}]`, ancestors, copies)
    }
    clone = items
  } else {
    const record: Record<string, unknown> = {}
    // Capture entries before descending, retaining the existing accessor-read
    // order without allocating a second array of key/value pairs per object.
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const captured = immutableSnapshot(child, `${path}.${key}`, ancestors, copies)
      if (key in record) Object.defineProperty(record, key, { value: captured, enumerable: true })
      else record[key] = captured
    }
    clone = record
  }
  ancestors.delete(value)
  copies.set(value, clone as object)
  return freezeSnapshot(clone as object) as T
}

/** Materialize a caller-owned JSON-like graph once under the same finite
 * recursion/aggregate guard used for family data, then freeze only that fresh
 * value. Validation must consume this snapshot: validating a live accessor
 * graph and cloning it later would permit a different value at execution. */
function boundedImmutableJsonSnapshot<T>(value: T, context: string, admission?: NonNullable<FamilyDataNormalizationBudget['admission']>): T {
  try {
    // A non-JSON leaf stays unbranded until the ordinary snapshot walk names
    // it, after the complete budget/accessor pass has kept its error order.
    return immutableSnapshot(admission
      ? omitUndefinedObjectFields(value, '$', 0, new Set(), familyDataBudget(admission))
      : omitUndefinedObjectFields(value)) as T
  } catch (error) {
    throw new TypeError(`${context} could not be snapshotted: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface AdmittedRenderOptions {
  readonly serializable: Readonly<RenderOptions>
  readonly onConfigDiagnostic?: NonNullable<RenderOptions['onConfigDiagnostic']>
  readonly capturedStyle?: ReturnType<typeof resolveStyleStackWithFace>
}

const EMPTY_ADMITTED_OPTIONS: AdmittedRenderOptions = Object.freeze({
  serializable: immutableSnapshot({}),
})
const CAPTURED_OPTIONS = new WeakMap<object, AdmittedRenderOptions>()
const CAPTURED_STYLE_REFERENCES = new WeakMap<object, readonly ResolvedStyleReference[]>()

/** Own caller data before an async provider can suspend style admission. */
export function captureRenderOptionsInput(options: RenderOptions): Readonly<RenderOptions> {
  if (CAPTURED_OPTIONS.has(options)) return options
  const admitted = admitRenderOptionsInput(options)
  const captured = Object.freeze({ ...admitted.serializable, ...(admitted.onConfigDiagnostic ? { onConfigDiagnostic: admitted.onConfigDiagnostic } : {}) })
  CAPTURED_OPTIONS.set(captured, admitted)
  return captured
}

/** Snapshot once before an async feature load. Only this private membership,
 * never a caller's freeze or object identity, authorizes admission reuse. */
export function captureRenderOptions(options: RenderOptions): Readonly<RenderOptions> {
  options = captureRenderOptionsInput(options)
  const admitted = CAPTURED_OPTIONS.get(options)!
  if (admitted.capturedStyle !== undefined) return options
  const capturedStyle = immutableSnapshot(resolveStyleStackWithFace(admitted.serializable.style))
  const problems = validateSerializableRenderOptions(admitted.serializable)
  if (problems.length) throw new RenderConfigError(`Invalid RenderOptions: ${problems.join('; ')}`)
  const references = namedStyleReferences(admitted.serializable.style)
  CAPTURED_OPTIONS.set(options, Object.freeze({ ...admitted, capturedStyle }))
  CAPTURED_STYLE_REFERENCES.set(admitted.serializable, references)
  return options
}

export function capturedRenderBackend(options: RenderOptions): string {
  const captured = CAPTURED_OPTIONS.get(options)?.capturedStyle
  if (!captured) throw new TypeError('Render options have not been captured')
  return captured.style ? inferBackend(captured.style) : 'default'
}

/** Capture the complete enumerable RenderOptions surface once. The sole
 * executable field is split from declarative data before the latter is
 * recursively snapshotted, validated, normalized, and receipted. */
function admitRenderOptionsInput(untrusted: RenderOptions): AdmittedRenderOptions {
  if ((typeof untrusted !== 'object' && typeof untrusted !== 'function') || untrusted === null) {
    throw new RenderConfigError('Invalid RenderOptions: render options must be an object')
  }
  const prior = CAPTURED_OPTIONS.get(untrusted)
  if (prior) return prior
  const serializableEntries: Array<[string, unknown]> = []
  let onConfigDiagnostic: unknown
  for (const [field, value] of Object.entries(untrusted)) {
    if (field === 'onConfigDiagnostic') {
      onConfigDiagnostic = value
    } else if (value !== undefined) {
      serializableEntries.push([field, value])
    }
  }
  if (onConfigDiagnostic !== undefined && typeof onConfigDiagnostic !== 'function') {
    throw new RenderConfigError('Invalid RenderOptions: onConfigDiagnostic must be a function')
  }
  if (serializableEntries.length === 0 && onConfigDiagnostic === undefined) return EMPTY_ADMITTED_OPTIONS
  const candidate = Object.fromEntries(serializableEntries)
  let serializable: Readonly<RenderOptions>
  try {
    serializable = boundedImmutableJsonSnapshot(candidate, 'RenderOptions') as Readonly<RenderOptions>
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace('data exceeds maximum depth', 'render option tree exceeds maximum nesting depth')
    throw new RenderConfigError(`Invalid RenderOptions: ${message}`)
  }
  return Object.freeze({
    serializable,
    ...(onConfigDiagnostic === undefined
      ? {}
      : { onConfigDiagnostic: onConfigDiagnostic as NonNullable<RenderOptions['onConfigDiagnostic']> }),
  })
}

type PreparedOptionStyle = ReturnType<typeof resolveStyleStackWithFace>
const NO_OPTION_STYLE: PreparedOptionStyle = Object.freeze({})
// Keys come only from admitted own-data snapshots, never live caller objects.
// Source, host callbacks, backend resolution and family defaults stay per call.
const PREPARED_OPTIONS_MAX_WEIGHT = 256 * 1024
const preparedOptions = new WeightedLru<string, PreparedOptionStyle>(32, PREPARED_OPTIONS_MAX_WEIGHT)
let preparedOptionsRevision = -1

function prepareOptionStyle(admitted: AdmittedRenderOptions): PreparedOptionStyle {
  if (admitted.capturedStyle) return admitted.capturedStyle
  if (admitted === EMPTY_ADMITTED_OPTIONS) return NO_OPTION_STYLE
  const revision = styleRegistryRevision()
  if (revision !== preparedOptionsRevision) { preparedOptions.clear(); preparedOptionsRevision = revision }
  const candidate = admitted.serializable as Readonly<Record<string, unknown>>
  // JSON serialization drops callable/symbol leaves and can invoke toJSON on
  // them. Reject non-JSON data before deriving a key or dispatching a family.
  const admissionProblems = renderOptionsAdmissionMessages(candidate)
  if (admissionProblems.length) throw new RenderConfigError(`Invalid RenderOptions: ${admissionProblems.join('; ')}`)
  const serialized = JSON.stringify(candidate)
  const key = serialized.length <= 4096 ? serialized : undefined
  const previous = key === undefined ? undefined : preparedOptions.get(key)
  if (previous) return previous
  // Keep the established StyleInput error boundary ahead of option schema
  // failures. Only successful preparations can be reused by later requests.
  const resolved = resolveStyleStackWithFace(admitted.serializable.style)
  const problems = validateSerializableRenderOptions(candidate)
  if (problems.length) throw new RenderConfigError(`Invalid RenderOptions: ${problems.join('; ')}`)
  if (key !== undefined && revision === styleRegistryRevision()) {
    const weight = (key.length + JSON.stringify(resolved).length) * 2 + 256
    if (weight <= PREPARED_OPTIONS_MAX_WEIGHT) {
      // Native cloning owns the retained strings (including sliced parents)
      // without normalizing optional fields, shared aliases or signed zero.
      const retained = immutableSnapshot(structuredClone(resolved))
      preparedOptions.set(key, retained, weight)
      return retained
    }
  }
  return immutableSnapshot(resolved)
}

function namedStyleReferences(input: RenderOptions['style']): readonly ResolvedStyleReference[] {
  const entries = input === undefined ? [] : Array.isArray(input) ? input : [input]
  return immutableSnapshot(entries.flatMap((entry): ResolvedStyleReference[] => {
    if (typeof entry !== 'string' || entry === 'crisp') return []
    const resolution = resolveStyleReference(entry)
    if (!resolution) return [] // resolveStyleStack supplies the actionable unknown-name error.
    return [{
      input: entry,
      canonicalId: resolution.canonicalId,
    }]
  }))
}

function unsafeThemeColorKeys(source: NormalizedMermaidSource): readonly string[] {
  const rejected = new Set<string>()
  for (const keys of Object.values(CHANNEL_THEME_KEYS)) {
    for (const key of keys) {
      const raw = source.config.themeVariables?.[key]
      if (typeof raw === 'string' && raw.length > 0 && safeCssColor(raw) === undefined) rejected.add(key)
    }
  }
  return Object.freeze([...rejected].sort())
}

const EXECUTION_CAPABILITY_VERSION = '1.0.0'

function executionOffer(id: CapabilityId, available: boolean, version = EXECUTION_CAPABILITY_VERSION): CapabilityOffer[] {
  return available ? [{ id, version }] : []
}

function executionRequirement(id: CapabilityId, range = `^${EXECUTION_CAPABILITY_VERSION}`): CapabilityRequirement {
  return { id, range, level: 'required' }
}

function primitiveCapabilityId(
  requirement: EssentialScenePrimitiveCapability,
): CapabilityId {
  return `scene-primitive:${requirement.primitive}/${requirement.feature}/${requirement.operation}`
}

function requiredBackendCapabilities(family: FamilyDescriptor): readonly EssentialScenePrimitiveCapability[] {
  const applicable = new Set(family.scenePrimitiveEvidence
    .filter(cell => cell.applicability === 'applicable')
    .map(cell => cell.primitive))
  return ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES.filter(requirement => applicable.has(requirement.primitive))
}

const SUPPORTED_BACKEND_REQUIREMENTS = new WeakMap<BackendDescriptor['backend'], ReadonlySet<EssentialScenePrimitiveCapability>>()

function backendSupportsCapability(
  backend: BackendDescriptor,
  requirement: EssentialScenePrimitiveCapability,
): boolean {
  // Registration captures immutable claims. Cache by the captured backend,
  // so replacing a registration cannot inherit its predecessor's support.
  let supported = SUPPORTED_BACKEND_REQUIREMENTS.get(backend.backend)
  if (!supported) {
    supported = new Set(ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES.filter(candidate =>
      backend.backend.capabilities.some(claim =>
        claim.primitive === candidate.primitive
        && claim.feature === candidate.feature
        && claim.operation === candidate.operation
        && claim.realization !== 'unsupported')))
    SUPPORTED_BACKEND_REQUIREMENTS.set(backend.backend, supported)
  }
  return supported.has(requirement)
}

function unsatisfiedCapabilityIds(decision: CapabilityDecision): string {
  return decision.resolutions
    .filter(resolution => resolution.level === 'required' && resolution.status !== 'selected')
    .map(resolution => resolution.id)
    .join(', ')
}

function executionCapabilityError(
  output: RenderOutput,
  family: FamilyDescriptor,
  appearance: ResolvedAppearance,
  mode: InternalRenderExecutionPlan['mode'],
  backend: BackendDescriptor | undefined,
  decision: CapabilityDecision,
): RenderCapabilityError {
  const detail = unsatisfiedCapabilityIds(decision)
  const suffix = detail ? ` (unsatisfied capabilities: ${detail})` : ''
  if (output === 'layout') {
    return new RenderCapabilityError(`No public layout projection registered for Mermaid family "${family.id}"${suffix}`, output, family, decision)
  }
  if (output === 'ascii' || output === 'unicode' || output === 'html') {
    return new RenderCapabilityError(`No ASCII renderer registered for Mermaid family ${family.id}${suffix}`, output, family, decision)
  }
  if (appearance.styled && !family.lowerScene) {
    return new RenderCapabilityError(`Family "${family.id}" does not support styled rendering (no SceneGraph lowering registered). Render without the style option, or register a lowerScene hook for the family.${suffix}`, output, family, decision)
  }
  if (mode === 'scene' && family.layout && family.lowerScene && !backend) {
    return new RenderCapabilityError(appearance.styled
      ? `Style "${appearance.style?.name ?? '(inline)'}" requires an unavailable SceneGraph backend${suffix}`
      : `Default SceneGraph backend is not registered${suffix}`, output, family, decision)
  }
  return new RenderCapabilityError(`No SVG renderer registered for Mermaid family ${family.id}${suffix}`, output, family, decision)
}

const EXECUTION_CAPABILITY_DECISIONS = new Map<string, CapabilityDecision>()

// Normalization is a pure function of the text, the (empty) Mermaid config
// overrides and family routing, for the package's own family descriptors.
// Results are reused within one routing revision and for the same explicit
// descriptor. Each request receives its own frozen top-level snapshot over the
// shared frozen views, so request-scoped custody keyed by source identity is
// unchanged.
interface RememberedNormalizedSource {
  readonly revision: number
  readonly descriptor: FamilyDescriptor | undefined
  readonly source: NormalizedMermaidSource
  readonly classification: ReturnType<typeof classifyMermaidFamilyDescriptorFromFirstLine> | undefined
}
const NORMALIZED_SOURCES = new WeightedLru<string, RememberedNormalizedSource>(64, 4 * 1024 * 1024)

function rememberedNormalizedSource(text: string, descriptor: FamilyDescriptor | undefined): RememberedNormalizedSource | undefined {
  const remembered = NORMALIZED_SOURCES.get(text)
  return remembered && remembered.revision === familyRoutingRevision() && remembered.descriptor === descriptor ? remembered : undefined
}

function rememberNormalizedSource(text: string, descriptor: FamilyDescriptor | undefined, source: NormalizedMermaidSource, classification: RememberedNormalizedSource['classification']): void {
  // The normalized views hold about eight copies of the text.
  NORMALIZED_SOURCES.set(text, { revision: familyRoutingRevision(), descriptor, source, classification }, text.length * 18 + 4096)
}

function requestSourceSnapshot(shared: NormalizedMermaidSource): NormalizedMermaidSource {
  return freezeSnapshot({ ...shared })
}

// resolveAppearance is a pure function of the family, the normalized source,
// the admitted options and the style and face prepared from them; named style
// references also read the style registry. Its deeply frozen result is reused
// for a remembered source under the same registry revision, options and
// prepared style identities. Entries live as long as the remembered source.
interface RememberedAppearance {
  readonly style: Readonly<StyleSpec> | undefined
  readonly face: Readonly<InternalStyleFace> | undefined
  readonly context: ResolvedAppearanceContext
}
const REMEMBERED_APPEARANCES = new WeakMap<NormalizedMermaidSource, Map<string, RememberedAppearance>>()
const REMEMBERED_APPEARANCES_PER_SOURCE = 8

function appearanceMemoKey(admitted: AdmittedRenderOptions): string | undefined {
  // Captured options carry the style and references of their capture instant.
  if (admitted.capturedStyle) return undefined
  const options = admitted === EMPTY_ADMITTED_OPTIONS ? '' : JSON.stringify(admitted.serializable)
  return options.length <= 4096 ? `${styleRegistryRevision()}:${options}` : undefined
}

function rememberedAppearance(
  shared: NormalizedMermaidSource | undefined,
  key: string | undefined,
  input: ResolveAppearanceInput,
): ResolvedAppearanceContext {
  // An active parser observer asks to see the family normalizer's actual parse.
  if (!shared || key === undefined || parserObservationActive(input.family.id)) return resolveAppearance(input)
  let entries = REMEMBERED_APPEARANCES.get(shared)
  const remembered = entries?.get(key)
  if (remembered && remembered.style === input.style && remembered.face === input.styleFace) return remembered.context
  const context = resolveAppearance(input)
  if (!entries) REMEMBERED_APPEARANCES.set(shared, entries = new Map())
  entries.delete(key)
  entries.set(key, { style: input.style, face: input.styleFace, context })
  if (entries.size > REMEMBERED_APPEARANCES_PER_SOURCE) entries.delete(entries.keys().next().value as string)
  return context
}

/** Keys contain only captured tuple metadata, never source, hooks or policy.
 * Length prefixes preserve order and boundaries without serialization hooks. */
function executionCapabilityKey(output: RenderOutput, offers: readonly CapabilityOffer[], requirements: readonly CapabilityRequirement[], available: boolean): string | undefined {
  const count = offers.length + requirements.length
  if (typeof output !== 'string' || count > 256) return undefined
  let characters = output.length + count * 16
  if (characters > 16384) return undefined
  let key = `${output.length}:${output};${available};${offers.length};${requirements.length};`
  for (const offer of offers) {
    if (typeof offer.id !== 'string' || typeof offer.version !== 'string') return undefined
    characters += offer.id.length + offer.version.length
    if (characters > 16384) return undefined
    key += `${offer.id.length}:${offer.id}${offer.version.length}:${offer.version}`
  }
  for (const requirement of requirements) {
    if (typeof requirement.id !== 'string' || typeof requirement.range !== 'string' || typeof requirement.level !== 'string') return undefined
    characters += requirement.id.length + requirement.range.length + requirement.level.length
    if (characters > 16384) return undefined
    key += `${requirement.id.length}:${requirement.id}${requirement.range.length}:${requirement.range}${requirement.level.length}:${requirement.level}`
  }
  return key.length <= 8192 ? key : undefined
}

function executionCapabilityDecision(output: RenderOutput, offers: readonly CapabilityOffer[], requirements: readonly CapabilityRequirement[], outputAvailable: boolean): CapabilityDecision {
  const key = executionCapabilityKey(output, offers, requirements, outputAvailable)
  const retained = key === undefined ? undefined : EXECUTION_CAPABILITY_DECISIONS.get(key)
  observeCache('capability-decision', key === undefined ? 'bypass' : retained ? 'hit' : 'miss', key === undefined ? 'tuple-budget' : undefined)
  if (retained) return retained
  // Admitted once here, so every request receipt that embeds this cached
  // decision reuses it instead of copying its resolutions again.
  const decision = omitUndefinedObjectFields(negotiateRenderCapabilityTuple(output, { offers, requirements, outputAvailable })) as CapabilityDecision
  if (key !== undefined) {
    if (EXECUTION_CAPABILITY_DECISIONS.size < 32) EXECUTION_CAPABILITY_DECISIONS.set(key, decision)
    else observeCache('capability-decision', 'store-skipped', 'capacity')
  }
  return decision
}

// Descriptor identities own the executable capability tuple. Replacing a
// family/backend naturally invalidates it; per-request policy selection and
// measurement/config remain outside this cache.
const DESCRIPTOR_CAPABILITY_DECISIONS = new WeakMap<FamilyDescriptor, WeakMap<object, Map<string, CapabilityDecision>>>()
const NO_EXECUTION_BACKEND = Object.freeze({})

function descriptorCapabilityDecision(family: FamilyDescriptor, backend: BackendDescriptor | undefined, mode: InternalRenderExecutionPlan['mode'], output: RenderOutput, drawingConsumer?: FirstPartyDrawingConsumer): CapabilityDecision {
  const cacheable = Object.isFrozen(family) && (backend === undefined || Object.isFrozen(backend))
  let decisions: Map<string, CapabilityDecision> | undefined
  const key = `${mode}:${output}`
  if (cacheable) {
    let backends = DESCRIPTOR_CAPABILITY_DECISIONS.get(family)
    if (!backends) DESCRIPTOR_CAPABILITY_DECISIONS.set(family, backends = new WeakMap())
    const owner = drawingConsumer ?? backend ?? NO_EXECUTION_BACKEND
    decisions = backends.get(owner)
    if (!decisions) backends.set(owner, decisions = new Map())
    const retained = decisions.get(key)
    if (retained) {
      observeCache('capability-decision', 'hit')
      return retained
    }
  }
  const backendCapabilityRequirements = mode === 'scene'
    ? requiredBackendCapabilities(family)
    : []
  const supports = (requirement: EssentialScenePrimitiveCapability): boolean => drawingConsumer
    ? drawingConsumer.capabilities.some(claim => claim.primitive === requirement.primitive && claim.feature === requirement.feature
      && claim.operation === requirement.operation && claim.realization !== 'unsupported')
    : backend !== undefined && backendSupportsCapability(backend, requirement)
  const selected = drawingConsumer ?? backend
  const backendCapabilityOffers = selected
    ? backendCapabilityRequirements.flatMap(requirement => executionOffer(primitiveCapabilityId(requirement), supports(requirement)))
    : []

  const offers: CapabilityOffer[] = [
    { id: family.identity.id, version: family.identity.version },
    ...executionOffer('operation:layout', family.layout !== undefined),
    ...executionOffer('operation:project-positioned', family.projectPositioned !== undefined),
    ...executionOffer('operation:lower-scene', family.lowerScene !== undefined),
    ...executionOffer('operation:render-svg', family.renderSvg !== undefined),
    ...executionOffer('operation:render-terminal', family.renderAscii !== undefined),
    ...executionOffer('core:scene', mode === 'scene'),
    ...executionOffer('backend:scene-renderer', selected !== undefined, selected?.identity.version),
    ...backendCapabilityOffers,
  ]
  const requirements: CapabilityRequirement[] = [
    executionRequirement('core:family-descriptor'),
    executionRequirement(family.identity.id, family.identity.version),
  ]
  let outputAvailable: boolean
  switch (mode) {
    case 'scene':
      requirements.push(
        executionRequirement('core:scene'),
        executionRequirement('operation:layout'),
        executionRequirement('operation:lower-scene'),
        executionRequirement('backend:scene-renderer', selected?.identity.version ?? EXECUTION_CAPABILITY_VERSION),
        ...backendCapabilityRequirements.map(requirement => executionRequirement(primitiveCapabilityId(requirement))),
      )
      outputAvailable = Boolean(
        family.layout
        && family.lowerScene
        && selected
        && backendCapabilityRequirements.every(supports),
      )
      break
    case 'family-svg':
      requirements.push(
        executionRequirement('operation:layout'),
        executionRequirement('operation:render-svg'),
      )
      outputAvailable = Boolean(family.layout && family.renderSvg)
      break
    case 'terminal':
      requirements.push(executionRequirement('operation:render-terminal'))
      outputAvailable = family.renderAscii !== undefined
      break
    case 'layout':
      requirements.push(
        executionRequirement('operation:layout'),
        executionRequirement('operation:project-positioned'),
      )
      outputAvailable = Boolean(family.layout && family.projectPositioned)
      break
  }

  const capabilityDecision = executionCapabilityDecision(output, offers, requirements, outputAvailable)
  decisions?.set(key, capabilityDecision)
  return capabilityDecision
}

function resolveExecutionPlan(
  family: FamilyDescriptor,
  appearance: ResolvedAppearance,
  output: RenderOutput,
  resolutionOptions: RenderExecutionResolutionOptions,
  explicitMermaidConfig?: NonNullable<RenderOptions['mermaidConfig']>,
  onConfigDiagnostic?: NonNullable<RenderOptions['onConfigDiagnostic']>,
  fontMetrics?: RenderOptions['fontMetrics'],
): InternalRenderExecutionPlan {
  let mode: InternalRenderExecutionPlan['mode']
  let backend: BackendDescriptor | undefined
  let drawingConsumer: FirstPartyDrawingConsumer | undefined
  let requestedBackendId: string | undefined
  if (output === 'svg' || output === 'png') {
    mode = appearance.styled || family.lowerScene ? 'scene' : 'family-svg'
    if (mode === 'scene') {
      requestedBackendId = appearance.styled ? appearance.inferredBackend : 'default'
      const requestedConsumer = Object.hasOwn(resolutionOptions, 'drawingConsumer') ? resolutionOptions.drawingConsumer : undefined
      const producer = requestedConsumer === FIRST_PARTY_DRAWING_CONSUMER && isOwnedFamily(family) ? nativeDrawingOf(family.lowerScene) : undefined
      if (output === 'svg' && requestedBackendId === 'default' && !resolutionOptions.backendPolicy
        && producer && producer === originalNativeDrawingOf(family.lowerScene) && !preferSceneDrawing(family.id)) drawingConsumer = requestedConsumer
      else backend = getBackendDescriptor(requestedBackendId, resolutionOptions.backendPolicy)
    }
  } else if (output === 'layout') {
    mode = 'layout'
  } else {
    mode = 'terminal'
  }

  const capabilityDecision = descriptorCapabilityDecision(family, backend, mode, output, drawingConsumer)
  if (!capabilityDecision.accepted) {
    throw executionCapabilityError(output, family, appearance, mode, backend, capabilityDecision)
  }

  if (mode !== 'terminal' && resolutionOptions.textMeasurement && fontMetrics === 'bundled-inter') throw new RenderConfigError('fontMetrics cannot be combined with a host textMeasurement profile')
  const textMeasurement = mode === 'terminal'
    ? undefined
    : createTextMeasurementExecution(resolutionOptions.textMeasurement ?? (fontMetrics === 'bundled-inter' ? bundledInterMetrics() : undefined), appearance.font)
  let executionDecision: RenderExecutionDecision | undefined
  if (mode === 'scene' || mode === 'family-svg') {
    const backendDecision: RenderExecutionDecision['backend'] = mode === 'scene'
      ? Object.freeze({
          mode: 'scene' as const,
          requestedId: requestedBackendId!,
          selectedId: (drawingConsumer ?? backend)!.identity.id,
          version: (drawingConsumer ?? backend)!.identity.version,
          hostPolicy: resolutionOptions.backendPolicy !== undefined,
        })
      : Object.freeze({ mode: 'family-svg' as const })
    const decisionBody = {
      family: Object.freeze({ id: family.identity.id, version: family.identity.version }),
      backend: backendDecision,
      ...(textMeasurement ? { textMeasurement: textMeasurement.identity } : {}),
    }
    executionDecision = Object.freeze({
      ...decisionBody,
      digest: renderContractDigest(decisionBody),
    })
  }

  const configDiagnostics = explicitMermaidConfig === undefined
    ? undefined
    : Object.freeze(explicitFamilyConfigDiagnostics(family.id, explicitMermaidConfig, family.config, family.configDiagnostics)
      .map(diagnostic => Object.freeze({ ...diagnostic })))

  return Object.freeze({
    output,
    mode,
    family,
    ...(backend ? { backend } : {}),
    consumer: drawingConsumer,
    ...(requestedBackendId ? { requestedBackendId } : {}),
    ...(configDiagnostics === undefined ? {} : { configDiagnostics }),
    ...(onConfigDiagnostic ? { onConfigDiagnostic } : {}),
    capabilityDecision,
    ...(executionDecision ? { executionDecision } : {}),
    ...(textMeasurement ? { textMeasurement } : {}),
  })
}

/** Complete a genuinely required source Scene fallback without resolving
 * options, invoking config callbacks, or positioning a second time. */
export function selectSourceSceneFallback(request: ResolvedRenderRequest): void {
  const plan = resolvedRenderExecutionPlanOf(request)
  if (plan.consumer?.kind !== 'native-drawing') throw new Error('Source drawing fallback requires its Native consumer')
  const backend = getBackendDescriptor('default')
  const decision = descriptorCapabilityDecision(plan.family, backend, plan.mode, plan.output)
  if (!decision.accepted) throw executionCapabilityError(plan.output, plan.family, request.appearance, plan.mode, backend, decision)
  if (!backend || backend.identity.id !== plan.consumer.identity.id || backend.identity.version !== plan.consumer.identity.version) {
    throw new Error('Source Scene fallback changed the selected rendering identity')
  }
  EXECUTION_PLAN_BY_REQUEST.set(request, Object.freeze({ ...plan, backend, consumer: Object.freeze({ kind: 'scene-backend' as const }) }))
}

function isSharedCapabilityResolution(resolution: CapabilityResolution): boolean {
  return !resolution.id.startsWith('output:')
    && !resolution.id.startsWith('operation:')
    && !resolution.id.startsWith('backend:')
    && !resolution.id.startsWith('scene-primitive:')
    && resolution.id !== 'core:scene'
}

export interface ResolveAppearanceInput {
  /** Descriptor captured once before any extension callback executes. */
  readonly family: FamilyDescriptor
  readonly source: NormalizedMermaidSource
  /** Already-admitted public options; this function never reads ambient host state. */
  readonly options: RenderOptions
  /** Style and private face resolved together from one registry snapshot. */
  readonly style?: Readonly<StyleSpec>
  readonly styleFace?: Readonly<InternalStyleFace>
}

export interface ResolvedAppearanceContext {
  readonly renderOptions: Readonly<RenderOptions>
  readonly appearance: ResolvedAppearance
  readonly familyConfig?: Readonly<Record<string, unknown>>
}

/**
 * Pure request-boundary appearance projection. All mutable registry lookups,
 * source parsing, and host policy decisions happen before this function. Its
 * result is the explicit internal context shared by layout, graphical, and
 * terminal projections; public RenderOptions remain geometry/input data only.
 */
export function resolveAppearance(input: ResolveAppearanceInput): ResolvedAppearanceContext {
  const { family, source, options, style, styleFace } = input
  let effective: RenderOptions = options.security === 'strict'
    ? { ...options, embedFontImport: false }
    : { ...options }
  if (options.graphLayout) effective.graphLayout = { ...options.graphLayout, fallback: options.graphLayout.fallback ?? 'none' }

  const styled = style !== undefined && isStyledSpec(style)
  if (styled) effective = applyStyleDefaults(effective, style, source.config.themeVariables)

  const authoredFont = options.font
    ?? source.config.fontFamily
    ?? readThemeValue(source.config.themeVariables, 'fontFamily')
    ?? effective.font
    ?? 'Inter'
  // Carry the safe spelling (double-quoted names requoted) into every sink; an
  // unsafe value stays as authored for the option validator to name.
  const font = safeCssFontFamily(authoredFont) ?? authoredFont
  // `style` is a public entry format (name, record, or stack), not family input.
  // Replace it with the already-resolved canonical record before any family
  // hook runs so a family can never branch on string-vs-record syntax. Keep the
  // canonical record in the resolved request for receipts and downstream code.
  const { style: _unresolvedStyle, ...canonicalEffective } = effective
  const baseRenderOptions: RenderOptions = {
    ...canonicalEffective,
    ...(style ? { style } : {}),
    font,
    mermaidConfig: source.config,
  }
  const baseColors = { ...resolveDiagramColors(baseRenderOptions, source.config, font) }
  const normalized = applyFamilyRequestNormalization(
    family,
    source,
    baseRenderOptions,
    baseColors,
    style,
    styleFace,
  )

  const colors = immutableSnapshot(normalized.colors)
  const styleReferences = CAPTURED_STYLE_REFERENCES.get(options) ?? namedStyleReferences(options.style)
  const rejectedThemeColors = unsafeThemeColorKeys(source)
  const appearanceReceipt = {
    version: RENDER_CONTRACT_VERSION,
    colors,
    font,
    style: immutableSnapshot(style),
    face: immutableSnapshot(styleFace),
    styled,
    inferredBackend: style ? inferBackend(style) : 'default',
    styleReferences,
    ...(rejectedThemeColors.length > 0 ? { unsafeThemeColorKeys: rejectedThemeColors } : {}),
    ...(normalized.familyAppearance ? { family: normalized.familyAppearance } : {}),
  }
  const appearance: ResolvedAppearance = immutableSnapshot({
    ...appearanceReceipt,
    digest: renderContractDigest(appearanceReceipt),
  })
  return immutableSnapshot({
    renderOptions: immutableSnapshot(normalized.renderOptions),
    appearance,
    ...(normalized.familyConfig ? { familyConfig: normalized.familyConfig } : {}),
  })
}

export function resolveRenderRequest(
  text: string,
  options: RenderOptions = {},
  output: RenderOutput = 'svg',
  outputOptions?: unknown,
): ResolvedRenderRequest {
  return resolveRenderRequestForExecution(text, options, output, outputOptions)
}

/** Internal trusted-host variant. Public barrels expose only the four-argument
 * resolver above, keeping executable host policy outside serializable APIs. */
export function resolveRenderRequestForExecution(
  text: string,
  options: RenderOptions = {},
  output: RenderOutput = 'svg',
  outputOptions?: unknown,
  resolutionOptions: RenderExecutionResolutionOptions = {},
): ResolvedRenderRequest {
  const admitted = admitRenderOptionsInput(options)
  const admittedOptions = admitted.serializable as RenderOptions
  const resolvedStyle = prepareOptionStyle(admitted)
  const style = resolvedStyle.style
  const face = immutableSnapshot(resolvedStyle.face)

  // Markdown/HTML parsers commonly hand renderers entity-encoded Mermaid.
  // Decode at the shared request waist so SVG, PNG, layout and terminal
  // transports agree on semantic text; retain authored bytes separately.
  let classification: ReturnType<typeof classifyMermaidFamilyDescriptorFromFirstLine> | undefined
  // Parsing consumes decoded semantic text, while provenance retains the
  // exact authored boundary bytes. Equivalent encodings may render alike but
  // must not collapse to the same request identity.
  let detectedSource: NormalizedMermaidSource
  let sharedSource: NormalizedMermaidSource | undefined
  const memoable = admittedOptions.mermaidConfig === undefined || Object.keys(admittedOptions.mermaidConfig).length === 0
  const remembered = memoable ? rememberedNormalizedSource(text, resolutionOptions.familyDescriptor) : undefined
  if (remembered) {
    classification = remembered.classification
    sharedSource = remembered.source
    detectedSource = requestSourceSnapshot(remembered.source)
  } else {
    const normalizedSource = normalizeMermaidRenderSource(text, admittedOptions.mermaidConfig ?? {}, firstLine => {
      if (resolutionOptions.familyDescriptor) return resolutionOptions.familyDescriptor
      classification = classifyMermaidFamilyDescriptorFromFirstLine(firstLine)
      return classification.kind === 'registered' ? classification.family : null
    })
    detectedSource = immutableSnapshot(normalizedSource)
    const resolved = resolutionOptions.familyDescriptor ?? (classification?.kind === 'registered' ? classification.family : undefined)
    if (memoable && resolved && isOwnedFamily(resolved)) {
      rememberNormalizedSource(text, resolutionOptions.familyDescriptor, detectedSource, classification)
      sharedSource = detectedSource
      detectedSource = requestSourceSnapshot(detectedSource)
    }
  }
  // Capture one immutable descriptor before any extension callback runs. The
  // same object owns normalization, capability negotiation, layout and
  // lowering for the lifetime of this request.
  const family = resolutionOptions.familyDescriptor ?? capturedRequestFamily(detectedSource, classification!)
  // Pie keeps its authored label spelling in its own chunk (pieFamilyLines).
  const source = detectedSource
  if (resolutionOptions.expectedFamilyId !== undefined && family.id !== resolutionOptions.expectedFamilyId) {
    throw new ParsedDiagramFamilyMismatchError(resolutionOptions.expectedFamilyId, family.id)
  }
  // The receipt below digests both copies of the source under one data budget.
  // Name a source too long for it as the work limit it is, before the digest
  // would refuse it as malformed request data.
  assertDiagramWorkLimit('sourceCharacters', source.originalText.length + source.text.length)
  const themeCssProblem = validateRawThemeCss(source.config.themeCSS, admittedOptions.security ?? 'default')
  if (themeCssProblem) throw new RenderConfigError(themeCssProblem)
  if (family.id !== 'architecture') checkThemeVariableColors(source.config.themeVariables, family.id, admittedOptions)
  checkFamilyConfigColors(source.frontmatter, family.id)
  const explicitOptionFields = Object.freeze(SHARED_RENDER_OPTION_FIELDS.filter(field => admittedOptions[field] !== undefined))
  const resolutionDiagnostics = renderOptionApplicabilityDiagnostics(family, explicitOptionFields)
  const resolvedContext = rememberedAppearance(sharedSource, appearanceMemoKey(admitted), {
    family,
    source,
    options: admittedOptions,
    ...(style ? { style } : {}),
    ...(face ? { styleFace: face } : {}),
  })
  const { appearance, renderOptions, familyConfig } = resolvedContext
  const architectureVisual = appearance.family?.visual as ArchitectureVisualConfig | undefined
  if (family.id === 'architecture') {
    checkThemeVariableColors(source.config.themeVariables, family.id, admittedOptions, architectureVisual)
  }
  checkArchitectureRenderOptionColors(
    admittedOptions,
    family.id,
    architectureVisual,
  )

  const executionPlan = resolveExecutionPlan(
    family,
    appearance,
    output,
    resolutionOptions,
    admittedOptions.mermaidConfig,
    admitted.onConfigDiagnostic,
    admittedOptions.fontMetrics,
  )
  const capabilityDecision = executionPlan.capabilityDecision

  // The shared receipt deliberately excludes the output-specific resolution:
  // callers use its digest to prove that SVG, PNG, terminal and layout
  // transports received the same source and appearance request. The full
  // request receipt below restores the exact output negotiation decision.
  const sharedResolutions = Object.freeze(capabilityDecision.resolutions.filter(isSharedCapabilityResolution))
  const sharedCapabilityDecision: CapabilityDecision = Object.freeze({
    version: capabilityDecision.version,
    accepted: sharedResolutions
      .every(resolution => resolution.level !== 'required' || resolution.status === 'selected'),
    resolutions: sharedResolutions,
  })
  const sharedRequestReceipt = {
    version: RENDER_CONTRACT_VERSION,
    authoredSource: source.originalText,
    source: source.text,
    options: serializableOptions(renderOptions),
    appearance: appearance.digest,
    ...(familyConfig ? { familyConfig } : {}),
    ...(executionPlan.textMeasurement ? { textMeasurement: executionPlan.textMeasurement.identity } : {}),
    capabilities: sharedCapabilityDecision,
  }
  const sharedAdmitted = admittedRequestReceipt(sharedRequestReceipt, source) as Readonly<Record<string, unknown>>
  const sharedRequestDigest = deferredAdmittedDigest(sharedAdmitted)
  // The full receipt restores the output negotiation over the shared fields
  // as admitted above, so admission charges them instead of walking them again.
  const requestReceipt = {
    ...sharedAdmitted,
    output,
    outputOptions,
    capabilities: capabilityDecision,
  }
  const requestDigest = deferredAdmittedDigest(admittedRequestReceipt(requestReceipt, source))
  const request: ResolvedRenderRequest = Object.freeze({
    version: RENDER_CONTRACT_VERSION,
    output,
    source: immutableSnapshot(source),
    renderOptions,
    appearance,
    ...(familyConfig ? { familyConfig } : {}),
    capabilityDecision,
    explicitOptionFields,
    ...(resolutionDiagnostics.length === 0 ? {} : { resolutionDiagnostics }),
    get sharedRequestDigest() { return sharedRequestDigest() },
    get requestDigest() { return requestDigest() },
  })
  EXECUTION_PLAN_BY_REQUEST.set(request, executionPlan)
  admitParsedModelHandoff(resolutionOptions.parsedModelHandoff, request.source, family)
  return request
}
