// ============================================================================
// agentic-mermaid — runtime-neutral agent surface (v4).
// Everything here is pure JS/TS (elkjs bundled build included) and safe to
// bundle for workerd/browser targets. The public barrel (`./index.ts`)
// re-exports this plus the Node-native `renderMermaidPNG`; import this module
// from code that must not drag in the napi resvg addon.
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type { AsciiRenderOptions, AsciiWidthErrorReason, RenderedAscii } from '../ascii/index.ts'
export { AsciiWidthError } from '../ascii/index.ts'
export type { AsciiRegion, AsciiWarning, AsciiWarningCode, AsciiWithMeta, RegionKind } from '../ascii/meta.ts'
export { ASCII_ROUTE_PARITY_CONTRACT, renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
export { asciiToMermaid } from '../ascii/reverse.ts'
export type { FamilyDetectionDiagnostic, MermaidFamilyClassification } from '../family-detection.ts'
export { classifyMermaidFamilyFromFirstLine, MermaidFamilyDetectionError } from '../family-detection.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from '../text-metrics.ts'
export { measureText, measureTextWidth, TEXT_MEASUREMENT_CONTRACT } from '../text-metrics.ts'
export type { AnyPort, DiamondFacet, EdgeRouteCertificate, FamilyEdgeRouteCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, PortSemanticRole, PortSide, RegionContainmentCertificate, RouteBlocker, RouteCertificate, RouteClass, RoutePortAssignment } from '../types.ts'
export type { UpstreamHeaderMatch, UpstreamMermaidFamilyIndex } from '../upstream-family-index.ts'
export { findUpstreamFamilyByHeader, UPSTREAM_MERMAID_FAMILY_INDEX } from '../upstream-family-index.ts'
export type { UpstreamFamilyDescriptor, UpstreamHeaderDescriptor, UpstreamManifestDiff, UpstreamMermaidManifest } from '../upstream-mermaid-manifest.ts'
export { analyzeMermaid, analyzeMermaidSource, collectActionRecords } from './analyze.ts'
export type { ApplyOpsInput, CheckedBuildError, OpEnvelope, VerifySummary } from './apply.ts'
export { applyOps, buildChecked, verifySummary } from './apply.ts'
export type { LayoutCertificateProof } from './certificates.ts'
export { layoutCertificateProof } from './certificates.ts'
export type { BuildError, CreateMermaidOptions } from './create.ts'
export { buildMermaid, createMermaid } from './create.ts'
export type { DescribeOptions, DescribeTree } from './describe.ts'
export { describeMermaid, describeMermaidSource, describeMermaidTree } from './describe.ts'
export type { CheckMermaidObjectSpec, CheckMermaidResult, CheckMermaidSpec, MermaidFact } from './facts.ts'
export { checkMermaid, checkMermaidSource, describeMermaidFacts, describeMermaidFactsSource } from './facts.ts'
export type {
  BuiltinFamilyId,
  BuiltinFamilyMetadata,
  ExtensionIdentity,
  ExtractedLabel,
  FamilyCapability,
  FamilyCapabilityConformanceResult,
  FamilyCapabilityEvidence,
  FamilyCapabilityState,
  FamilyConformanceReport,
  FamilyConformanceStatus,
  FamilyDescriptor,
  FamilyOperations,
  FamilyPositionedProjectionContext,
  FamilyPositionedProjectionOptions,
  FamilyPositionedView,
  FamilyScenePositivePrimitive,
  FamilyScenePrimitiveApplicability,
  FamilyScenePrimitiveEvidence,
  FamilySceneRolePrimitiveDeclaration,
} from './families.ts'
export {
  BUILTIN_FAMILY_METADATA,
  BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND,
  builtinFamilyMetadata,
  declareFamilyScenePrimitiveEvidence,
  detectRegisteredFamilyFromFirstLine,
  effectiveFamilyCapabilityState,
  FAMILY_CAPABILITY_COLUMNS,
  FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES,
  FAMILY_CONFORMANCE_VERSION,
  FAMILY_DESCRIPTOR_CONTRACT_VERSION,
  getFamily,
  getFamilyConformanceReport,
  isBuiltinFamilyId,
  isExternalFamilyId,
  knownBuiltinFamilies,
  knownFamilies,
  UNREGISTERED_FAMILY_CAPABILITY_STATES,
} from './families.ts'
export { projectPositionedView } from './family-layouts.ts'
export { FamilyConformanceError, registerFamily } from './family-registration.ts'
export { edgeIdOf, mutate, mutateChecked } from './mutate.ts'
export type { OpFamily, OpFieldDoc, OpValidationError } from './op-schema.ts'
export { describeOps, hasOpSchema, opMenu, opSignatures, validateOp } from './op-schema.ts'
export { parseRegisteredMermaid } from './parse.ts'
export type { BoundBasis, BoundProvenance, QualityBounds, QualityMeasurementOptions, QualityMetrics, QualityVerdict, RankedViolation, ViolationSeverity } from './quality.ts'
export { BOUND_PROVENANCE, checkQuality, DEFAULT_BOUNDS, measureQuality } from './quality.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export type {
  Accessibility,
  AnyMutationOp,
  ArchitectureBody,
  ArchitectureEdge,
  ArchitectureEndpoint,
  ArchitectureEndpointBoundary,
  ArchitectureGroup,
  ArchitectureJunction,
  ArchitectureMutationOp,
  ArchitectureService,
  ArchitectureSide,
  ArchitectureValidDiagram,
  ClassBody,
  ClassMutationOp,
  ClassNode,
  ClassNote,
  ClassRelation,
  ClassRelationKind,
  ClassValidDiagram,
  DiagramActionKind,
  DiagramActionRecord,
  DiagramActionSecurity,
  DiagramAnalysis,
  DiagramBody,
  DiagramKind,
  EdgeId,
  ErAttribute,
  ErBody,
  ErCardinality,
  ErEntity,
  ErMutationOp,
  ErRelation,
  ErValidDiagram,
  ExtensionDiagramBody,
  ExtensionValidDiagram,
  ExternalFamilyId,
  FamilyId,
  FamilyParsedBody,
  FeedbackEdgeAnalysis,
  Finite,
  FlowchartMutationOp,
  FlowchartValidDiagram,
  GanttBody,
  GanttBodySection,
  GanttBodyTask,
  GanttBodyTaskTag,
  GanttMutationOp,
  GanttScheduleAnalysisSummary,
  GanttStatement,
  GanttValidDiagram,
  GitGraphBody,
  GitGraphMutationOp,
  GitGraphValidDiagram,
  GroupId,
  InitDirective,
  JourneyBody,
  JourneyMutationOp,
  JourneySection,
  JourneyTask,
  JourneyValidDiagram,
  LayoutWarning,
  MindmapBody,
  MindmapMutationOp,
  MindmapValidDiagram,
  MutableValidDiagram,
  MutationError,
  NodeId,
  ParsedDiagram,
  ParseError,
  ParticipantId,
  PieBody,
  PieMutationOp,
  PieSlice,
  PieValidDiagram,
  PreservedDiagramBody,
  PreservedSourceSpans,
  PreservedValidDiagram,
  QuadrantAxis,
  QuadrantBody,
  QuadrantMutationOp,
  QuadrantPoint,
  QuadrantValidDiagram,
  RadarBody,
  RadarBodyAxis,
  RadarBodyCurve,
  RadarMutationOp,
  RadarValidDiagram,
  RenderedLayout,
  RenderedLayoutEdge,
  RenderedLayoutGroup,
  RenderedLayoutNode,
  RenderedRegion,
  RenderedRegionKind,
  Result,
  SankeyBody,
  SankeyBodyLink,
  SankeyMutationOp,
  SankeyValidDiagram,
  SequenceBody,
  SequenceMessage,
  SequenceMessageStyle,
  SequenceMutationOp,
  SequenceParticipant,
  SequenceValidDiagram,
  SerializedFlowchartGraph,
  SourceComment,
  SourceMap,
  SourceMapSpans,
  SourcePreservationReceipt,
  SourceSpan,
  SourceSpanPoint,
  StateBody,
  StateMutationOp,
  StateNode,
  StateTransition,
  StateValidDiagram,
  Tier1WarningCode,
  Tier2WarningCode,
  TimelineBody,
  TimelineEvent,
  TimelineMutationOp,
  TimelinePeriod,
  TimelineSection,
  TimelineValidDiagram,
  ValidDiagram,
  ValidDiagramMeta,
  ValidDiagramPayload,
  VerifyOptions,
  VerifyResult,
  WarningCode,
  WarningSeverity,
  WarningTier,
  XyChartAxis,
  XyChartAxisSpec,
  XyChartBody,
  XyChartMutationOp,
  XyChartSeries,
  XyChartValidDiagram,
} from './types.ts'
export { asArchitecture, asClass, asEr, asFlowchart, asGantt, asGitGraph, asJourney, asMindmap, asPie, asQuadrant, asRadar, asSankey, asSequence, asState, asTimeline, asXyChart, DEFAULT_LABEL_CHAR_CAP, err, ok, toFinite, WARNING_SEVERITY, WARNING_TIER } from './types.ts'
export { verifyMermaid } from './verify.ts'

import { renderMermaidSVG as _svg, renderMermaidSVGWithReceipt as _svgWithReceipt } from '../index.ts'

export type { ArchitectureVisualOverrides } from '../architecture/config.ts'
export type { CapabilityDecision, CapabilityId, CapabilityOffer, CapabilityRequirement, CapabilityRequirementLevel, CapabilityResolution } from '../capability-negotiation.ts'
export {
  CAPABILITY_NEGOTIATION_VERSION,
  CORE_CAPABILITY_OFFERS,
  negotiateCapabilities,
  negotiateRenderCapabilities,
  parseSemVer,
  semVerSatisfies,
} from '../capability-negotiation.ts'
export {
  HOSTED_FONT_RESOURCES,
  hostedFontResource,
  RESOURCE_MANIFEST,
  validateResourceManifest,
} from '../font-manifest.ts'
export { verifyNoExternalRefs } from '../index.ts'
export type {
  NativePngHostOnlyOptionField,
  NativePngOutputPolicyField,
  PngFitTo,
  PngFontSource,
  PngOutputOptionField,
  PngOutputOptionFieldDescriptor,
  PngOutputOptionInputKind,
  PngOutputOptionPolicyState,
  PngOutputOptionReceiptState,
  PngOutputOptionScope,
  PngOutputPolicyInput,
  PngRasterDimensions,
  PngRuntimeProvenance,
  PortablePngOutputOptionField,
  PortablePngOutputOptions,
  ResolvedPngOutputPolicy,
} from '../png-contract.ts'
export {
  assertHostedPngRasterBudget,
  assertPngRasterBudget,
  MAX_HOSTED_PNG_BYTES,
  MAX_HOSTED_PNG_PIXELS,
  MAX_PNG_FONT_DIRECTORIES,
  MAX_PNG_FONT_DIRECTORY_LENGTH,
  MAX_PNG_PIXELS,
  MAX_PNG_RASTER_DIMENSION,
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS,
  NATIVE_PNG_OUTPUT_POLICY_FIELDS,
  normalizePortablePngBackground,
  omitPngOutputOptions,
  PNG_DEFAULT_FONT_FAMILY,
  PNG_DEFAULT_SCALE,
  PNG_FONT_SOURCES,
  PNG_NAPI_RUNTIME,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS,
  PNG_OUTPUT_OPTION_FIELDS,
  PNG_OUTPUT_POLICY_VERSION,
  PNG_WASM_RUNTIME,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS,
  pngNapiRuntimeProvenance,
  pngOutputOptionsJsonSchema,
  pngRasterDimensions,
  prepareSvgForPngRasterization,
  projectNativePngOutputPolicyInput,
  projectPortablePngOutputOptions,
  resolvePngOutputPolicy,
  resolvePortablePngOutputPolicy,
  svgIntrinsicDimensions,
} from '../png-contract.ts'
export type {
  CliRenderTransport,
  CodeModeRenderTransport,
  LibraryRenderTransport,
  RenderOutputDescriptor,
  RenderOutputTransports,
  RenderRequestReceipt,
} from '../render-contract.ts'
export {
  RENDER_CONTRACT_VERSION,
  RENDER_OUTPUT_DESCRIPTORS,
  RENDER_OUTPUTS,
  RenderCapabilityError,
  SHARED_RENDER_OPTION_FIELDS,
  sharedRenderOptionsJsonSchema,
  styleInputJsonSchema,
  validateSerializableRenderOptions,
} from '../render-contract.ts'
export { RESOURCE_MANIFEST_VERSION, verifyResourceBytes } from '../resource-manifest.ts'
export type { BackendDescriptor, BackendRegistrationOptions, HostBackendPolicy, StyleBackend, StyleBackendContext } from '../scene/backend.ts'
export { DefaultBackend, getBackend, knownBackendDescriptors, registerBackend } from '../scene/backend.ts'
export type { BackendCapabilityConformanceResult, BackendCapabilityConformanceStatus, BackendConformanceCheck, BackendConformanceCheckId, BackendConformanceReport } from '../scene/backend-conformance.ts'
export {
  BACKEND_CONFORMANCE_CHECK_IDS,
  BACKEND_CONFORMANCE_FIXTURE_ID,
  BACKEND_CONFORMANCE_VERSION,
  runBackendConformance,
} from '../scene/backend-conformance.ts'
export { CORE_SCENE_FEATURES, CORE_SCENE_OPERATIONS, CORE_SCENE_PRIMITIVES, PRIMITIVE_REALIZATIONS, terminalConnectorCapabilityClaims, validatePrimitiveCapabilities } from '../scene/capabilities.ts'
export type {
  ExternalSceneConnector,
  ExternalSceneConnectorGeometry,
  ExternalSceneConnectorLabel,
  ExternalSceneContainer,
  ExternalSceneDataMark,
  ExternalSceneDocument,
  ExternalSceneGeometry,
  ExternalSceneInput,
  ExternalSceneMarker,
  ExternalSceneNode,
  ExternalSceneNodeBase,
  ExternalSceneShape,
  ExternalSceneText,
} from '../scene/external-scene.ts'
export { buildExternalScene, EXTERNAL_SCENE_API_VERSION } from '../scene/external-scene.ts'
export type {
  ConnectorContourSemantics,
  ConnectorEndpoints,
  ConnectorGeometry,
  ConnectorHitGeometry,
  ConnectorLabelDescriptor,
  ConnectorMark,
  ConnectorRelationship,
  ConnectorRoute,
  ConnectorStroke,
  ConnectorSubpath,
  ConnectorTerminalLabelProjection,
  ConnectorTerminalMarkerPlacement,
  ConnectorTerminalMarkerProjection,
  ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss,
  MarkerDescriptor,
  SceneDoc,
  SceneNode,
  SceneRole,
  SemanticChannels,
} from '../scene/ir.ts'
export { SCENE_CONTRACT_VERSION } from '../scene/ir.ts'
export { BUILTIN_SCENE_ROLE_TRAITS, resolveSceneRoleTraits, SCENE_ROLE_DESCRIPTORS, sceneRoleTraits } from '../scene/roles.ts'
export type { SceneValidationDiagnostic, SceneValidationDiagnosticCode, SceneValidationOptions, SceneValidationResult } from '../scene/scene-validation.ts'
export { assertValidSceneDoc, SCENE_VALIDATION_LIMITS, SCENE_VALIDATION_VERSION, SceneValidationError, validateSceneDoc } from '../scene/scene-validation.ts'
export type {
  BindableSceneRole,
  BrandConstraint,
  BrandConstraintAction,
  BrandConstraintKind,
  ExactStyleSceneRole,
  RoleStyleFor,
  RoleStyleSpec,
  RoleStyles,
  SemanticBinding,
  SemanticBindingChannel,
  SemanticSlots,
  StyleColors,
  StyleDescriptor,
  StyleInput,
  StyleReferenceResolution,
  StyleRegistrationOptions,
  StyleSpec,
} from '../scene/style-registry.ts'
// Style system — agents reach the library through this entry, so the style
// registry must be importable here too, not only from the main entry.
export {
  BINDABLE_ROLE_STYLE_PROPERTIES,
  BINDABLE_SCENE_ROLES,
  BRAND_CONSTRAINT_DESCRIPTORS,
  BRAND_CONSTRAINT_KINDS,
  EXACT_ROLE_STYLE_CONTRACT,
  EXACT_STYLE_SCENE_ROLES,
  getStyle,
  inferBackend,
  knownStyleDescriptors,
  knownStyles,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  registerStyle,
  resolveStyleReference,
  resolveStyleStack,
  SEMANTIC_BINDING_CHANNELS,
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  STYLE_SPEC_FORMAT_VERSION,
  styleSpecJsonSchema,
  validateStyleSpec,
} from '../scene/style-registry.ts'
export { createExtensionIdentity } from '../shared/extension-identity.ts'
export type {
  AsciiRenderColorMode,
  ResolvedTerminalOutputPolicy,
  TerminalOutputPolicyInput,
} from '../terminal-contract.ts'
export { resolveTerminalOutputPolicy, TERMINAL_BOUNDED_PADDING_X, TERMINAL_DEFAULT_BOX_BORDER_PADDING, TERMINAL_DEFAULT_PADDING_X, TERMINAL_DEFAULT_PADDING_Y, TERMINAL_OUTPUT_POLICY_VERSION, TerminalOutputPolicyError } from '../terminal-contract.ts'

import { renderMermaidASCII as _ascii, renderMermaidASCIIWithReceipt as _asciiWithReceipt } from '../ascii/index.ts'
import { familyDetectionDiagnosticFromPreservedBody, MermaidFamilyDetectionError } from '../family-detection.ts'
import { emitResolvedConfigDiagnostics } from '../render-config-diagnostics.ts'
import { receiptOf as _receiptOf, resolveRenderRequestForExecution as _resolveRenderRequest } from '../render-contract.ts'
import type { RenderOptions } from '../types.ts'
import { collectActionRecords as collectRenderedActionRecords } from './analyze.ts'
import { layoutResolvedFamilyToRendered } from './family-layouts.ts'
import { parseRegisteredMermaid as _parse } from './parse.ts'
import { prepareRenderInput } from './render-input.ts'
import type { ParsedDiagram, RenderedLayout, RenderedRegion, RenderedRegionKind, ValidDiagram } from './types.ts'
import { toFinite } from './types.ts'

export function renderMermaidSVG(input: ParsedDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(input, opts)
}
export function renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts: Parameters<typeof _svg>[1] = {}) {
  return _svgWithReceipt(input, opts)
}
export function renderMermaidASCII(input: ParsedDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(input, opts)
}
export function renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts: Parameters<typeof _ascii>[1] = {}) {
  return _asciiWithReceipt(input, opts)
}

export interface LayoutMermaidOptions extends RenderOptions {
  debug?: boolean
  regions?: boolean
  actions?: boolean
}

export type LayoutRenderOptions = LayoutMermaidOptions

export interface RenderedLayoutArtifact {
  layout: RenderedLayout
  receipt: import('../render-contract.ts').RenderRequestReceipt
}

/** Canonical layout transport for Code Mode and other receipt-aware adapters. */
export function layoutMermaidWithReceipt(input: ParsedDiagram | string, opts: LayoutRenderOptions = {}): RenderedLayoutArtifact {
  const { debug, regions, actions, ...renderOptions } = opts
  const layoutOptions = { debug, regions, actions }
  const preparedInput = prepareRenderInput(input)
  const source = preparedInput.source
  const request = _resolveRenderRequest(source, renderOptions, 'layout', layoutOptions, {
    expectedFamilyId: preparedInput.expectedFamilyId,
  })
  emitResolvedConfigDiagnostics(request)
  let diagram: ParsedDiagram
  if (typeof input === 'string') {
    const parsed = _parse(source)
    if (!parsed.ok) throw new Error(parsed.error.map(error => error.message).join('; '))
    diagram = parsed.value
  } else {
    diagram = input
  }
  const familyLayout = layoutResolvedFamilyToRendered(diagram, request, { debug })
  if (!familyLayout) throw new Error(`No public layout projection registered for Mermaid family "${diagram.kind}"`)
  return {
    layout: enrichRenderedLayout(diagram, familyLayout, layoutOptions),
    receipt: _receiptOf(request),
  }
}

export function layoutMermaid(d: ParsedDiagram, opts: LayoutMermaidOptions = {}): RenderedLayout {
  if (d.body.kind === 'preserved') {
    throw new MermaidFamilyDetectionError(familyDetectionDiagnosticFromPreservedBody(d.body))
  }
  // The receipt-aware adapter owns request admission and config diagnostics;
  // direct layout delegates so a second execution path cannot drift.
  return layoutMermaidWithReceipt(d, opts).layout
}

function enrichRenderedLayout(d: ParsedDiagram, layout: RenderedLayout, opts: LayoutMermaidOptions): RenderedLayout {
  const wantRegions = opts.debug || opts.regions
  const wantActions = opts.debug || opts.actions
  if (!wantRegions && !wantActions) return layout
  const next: RenderedLayout = { ...layout }
  if (wantRegions) next.regions = buildRenderedRegions(d, layout)
  if (wantActions) {
    const nodeIds = new Set<string>(layout.nodes.map(n => n.id))
    next.actions = (d.body.kind === 'extension' || d.body.kind === 'preserved' ? [] : collectRenderedActionRecords(d as ValidDiagram)).filter(a => nodeIds.has(a.target)).map(a => ({ ...a, regionId: a.regionId ?? `node:${a.target}` }))
  }
  return next
}

function buildRenderedRegions(d: ParsedDiagram, layout: RenderedLayout): RenderedRegion[] {
  const regions: RenderedRegion[] = [
    {
      id: 'canvas',
      kind: 'canvas',
      bounds: { x: toFinite(0), y: toFinite(0), w: layout.bounds.w, h: layout.bounds.h },
    },
  ]
  const groupByMember = new Map<string, string>()
  for (const group of layout.groups) for (const member of group.members) groupByMember.set(member, group.id)
  const sourceLines = sourceLineHints(d)
  for (const group of layout.groups) {
    regions.push({
      id: `group:${group.id}`,
      kind: group.regionKind ?? renderedGroupRegionKind(layout.kind),
      elementId: group.id,
      parentId: group.parentId ? `group:${group.parentId}` : 'canvas',
      bounds: { x: group.x, y: group.y, w: group.w, h: group.h },
      sourceLine: d.source.groups.get(group.id)?.line ?? sourceLines.groups.get(group.id),
    })
  }
  for (const node of layout.nodes) {
    regions.push({
      id: `node:${node.id}`,
      kind: 'node',
      elementId: node.id,
      parentId: groupByMember.has(node.id) ? `group:${groupByMember.get(node.id)!}` : 'canvas',
      bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
      sourceLine: d.source.nodes.get(node.id)?.line ?? sourceLines.nodes.get(node.id),
    })
  }
  for (const edge of layout.edges) {
    const xs = edge.path.map(p => p[0])
    const ys = edge.path.map(p => p[1])
    if (xs.length > 0 && ys.length > 0) {
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys)
      regions.push({
        id: `edge:${edge.id}`,
        kind: 'edge',
        elementId: edge.id,
        parentId: 'canvas',
        bounds: { x: toFinite(minX), y: toFinite(minY), w: toFinite(Math.max(1, maxX - minX)), h: toFinite(Math.max(1, maxY - minY)) },
      })
    }
    if (edge.label) {
      const w = Math.max(1, edge.label.text.length * 7)
      const h = 14
      const labelX =
        d.kind === 'sequence' && edge.from === edge.to
          ? edge.label.x // sequence self-message labels render with text-anchor="start"
          : edge.label.x - w / 2
      regions.push({
        id: `label:${edge.id}`,
        kind: 'label',
        elementId: edge.id,
        parentId: `edge:${edge.id}`,
        bounds: { x: toFinite(labelX), y: toFinite(edge.label.y - h / 2), w: toFinite(w), h: toFinite(h) },
      })
    }
  }
  return regions
}

function renderedGroupRegionKind(kind: ParsedDiagram['kind']): RenderedRegionKind {
  switch (kind) {
    case 'flowchart':
    case 'state':
    case 'class':
    case 'er':
    case 'architecture':
      return 'cluster'
    case 'gitgraph':
      return 'lane'
    case 'timeline':
    case 'journey':
    case 'gantt':
      return 'band'
    case 'sequence':
    case 'quadrant':
      return 'compartment'
    case 'xychart':
      return 'plot'
    case 'radar':
      return 'ring'
    default:
      return 'group'
  }
}

function sourceLineHints(d: ParsedDiagram): { nodes: Map<string, number>; groups: Map<string, number> } {
  const nodes = new Map<string, number>()
  const groups = new Map<string, number>()
  const source = d.body.kind === 'opaque' || d.body.kind === 'extension' ? d.body.source : d.canonicalSource
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    const group = text.match(/^\s*subgraph\s+([A-Za-z0-9_:-]+)/)
    if (group?.[1] && !groups.has(group[1])) groups.set(group[1], i + 1)
    for (const node of text.matchAll(/(?:^|[\s&;])([A-Za-z][A-Za-z0-9_:-]*)(?=\s*(?:\[|\(|\{|--|==|-.|$))/g)) {
      const id = node[1]!
      if (id === 'subgraph' || id === 'end' || id === d.kind) continue
      if (!nodes.has(id)) nodes.set(id, i + 1)
    }
  }
  return { nodes, groups }
}
