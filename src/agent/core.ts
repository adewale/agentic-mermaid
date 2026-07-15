// ============================================================================
// agentic-mermaid — runtime-neutral agent surface (v4).
// Everything here is pure JS/TS (elkjs bundled build included) and safe to
// bundle for workerd/browser targets. The public barrel (`./index.ts`)
// re-exports this plus the Node-native `renderMermaidPNG`; import this module
// from code that must not drag in the napi resvg addon.
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, ParsedDiagram, ExtensionValidDiagram, ExtensionDiagramBody, PreservedValidDiagram, PreservedDiagramBody, PreservedSourceSpans, SourceSpan, SourceSpanPoint, FamilyParsedBody, FlowchartValidDiagram, StateValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, ArchitectureValidDiagram, XyChartValidDiagram, PieValidDiagram, QuadrantValidDiagram, GanttValidDiagram, MindmapValidDiagram, GitGraphValidDiagram, RadarValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind, FamilyId, ExternalFamilyId,
  StateBody, StateNode, StateTransition,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote,
  ErBody, ErEntity, ErRelation, ErAttribute, ErCardinality,
  JourneyBody, JourneySection, JourneyTask,
  ArchitectureBody, ArchitectureGroup, ArchitectureService, ArchitectureJunction, ArchitectureEdge, ArchitectureEndpoint, ArchitectureSide, ArchitectureEndpointBoundary,
  XyChartBody, XyChartAxis, XyChartSeries, XyChartAxisSpec,
  PieBody, PieSlice, QuadrantBody, QuadrantAxis, QuadrantPoint,
  GanttBody, GanttBodySection, GanttBodyTask, GanttBodyTaskTag, GanttStatement,
  MindmapBody, GitGraphBody, RadarBody, RadarBodyAxis, RadarBodyCurve,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, SourcePreservationReceipt, MutationError, MutationOp, FlowchartMutationOp, StateMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, XyChartMutationOp, PieMutationOp, QuadrantMutationOp, GanttMutationOp, MindmapMutationOp, GitGraphMutationOp, RadarMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup, RenderedRegion, RenderedRegionKind,
  DiagramAnalysis, DiagramActionRecord, DiagramActionKind, DiagramActionSecurity, FeedbackEdgeAnalysis, GanttScheduleAnalysisSummary,
  Finite,
} from './types.ts'
export type { MermaidFact, CheckMermaidSpec, CheckMermaidObjectSpec, CheckMermaidResult } from './facts.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt, asMindmap, asGitGraph, asRadar } from './types.ts'
export { parseMermaid, parseRegisteredMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { createMermaid, buildMermaid } from './create.ts'
export type { CreateMermaidOptions, BuildError } from './create.ts'
export { mutate, mutateChecked, edgeIdOf } from './mutate.ts'
export { applyOps, buildChecked, verifySummary } from './apply.ts'
export type { OpEnvelope, VerifySummary, CheckedBuildError, ApplyOpsInput } from './apply.ts'
export { validateOp, hasOpSchema, opMenu, describeOps, opSignatures } from './op-schema.ts'
export type { OpFamily, OpValidationError, OpFieldDoc } from './op-schema.ts'
export { verifyMermaid } from './verify.ts'
export { measureQuality, checkQuality, DEFAULT_BOUNDS, BOUND_PROVENANCE } from './quality.ts'
export type { QualityMetrics, QualityBounds, QualityVerdict, RankedViolation, BoundProvenance, BoundBasis, ViolationSeverity } from './quality.ts'
export { layoutCertificateProof } from './certificates.ts'
export type { LayoutCertificateProof } from './certificates.ts'
export type { RouteCertificate, EdgeRouteCertificate, FamilyEdgeRouteCertificate, RegionContainmentCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from '../types.ts'
export { registerFamily, FamilyConformanceError } from './family-registration.ts'
export { getFamily, getFamilyConformanceReport, effectiveFamilyCapabilityState, knownFamilies, knownBuiltinFamilies, detectRegisteredFamilyFromFirstLine, isBuiltinFamilyId, isExternalFamilyId, BUILTIN_FAMILY_METADATA, BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND, builtinFamilyMetadata, FAMILY_CAPABILITY_COLUMNS, FAMILY_CONFORMANCE_VERSION, FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES, UNREGISTERED_FAMILY_CAPABILITY_STATES, declareFamilyScenePrimitiveEvidence } from './families.ts'
export type {
  FamilyDescriptor, FamilyOperations, ExtensionIdentity,
  FamilyCapability, FamilyCapabilityState, FamilyCapabilityEvidence, ExtractedLabel, BuiltinFamilyMetadata, BuiltinFamilyId,
  FamilyConformanceStatus, FamilyCapabilityConformanceResult, FamilyConformanceReport,
  FamilyPositionedView, FamilyPositionedProjectionContext, FamilyPositionedProjectionOptions,
  FamilyScenePrimitiveApplicability, FamilyScenePrimitiveEvidence,
  FamilyScenePositivePrimitive, FamilySceneRolePrimitiveDeclaration,
} from './families.ts'
export { projectPositionedView } from './family-layouts.ts'
export { UPSTREAM_MERMAID_FAMILY_INDEX, findUpstreamFamilyByHeader } from '../upstream-family-index.ts'
export type { UpstreamMermaidFamilyIndex, UpstreamHeaderMatch } from '../upstream-family-index.ts'
export type { UpstreamMermaidManifest, UpstreamFamilyDescriptor, UpstreamHeaderDescriptor, UpstreamManifestDiff } from '../upstream-mermaid-manifest.ts'
export { MermaidFamilyDetectionError, classifyMermaidFamilyFromFirstLine } from '../family-detection.ts'
export type { MermaidFamilyClassification, FamilyDetectionDiagnostic } from '../family-detection.ts'
export { renderMermaidASCIIWithMeta, ASCII_ROUTE_PARITY_CONTRACT } from '../ascii/meta.ts'
export type { AsciiRegion, AsciiWithMeta, RegionKind, AsciiWarning, AsciiWarningCode } from '../ascii/meta.ts'
export { describeMermaid, describeMermaidSource, describeMermaidTree } from './describe.ts'
export { describeMermaidFacts, describeMermaidFactsSource, checkMermaid, checkMermaidSource } from './facts.ts'
export { analyzeMermaid, analyzeMermaidSource, collectActionRecords } from './analyze.ts'
export { TEXT_MEASUREMENT_CONTRACT, measureText, measureTextWidth } from '../text-metrics.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from '../text-metrics.ts'
export type { DescribeTree } from './describe.ts'
export type { DescribeOptions } from './describe.ts'
export { asciiToMermaid } from '../ascii/reverse.ts'
export { AsciiWidthError } from '../ascii/index.ts'
export type { AsciiRenderOptions, AsciiWidthErrorReason, RenderedAscii } from '../ascii/index.ts'

import { renderMermaidSVG as _svg, renderMermaidSVGWithReceipt as _svgWithReceipt } from '../index.ts'
export { verifyNoExternalRefs } from '../index.ts'
// Style system — agents reach the library through this entry, so the style
// registry must be importable here too, not only from the main entry.
export {
  registerStyle, getStyle, knownStyles, knownStyleDescriptors, resolveStyleReference,
  validateStyleSpec, resolveStyleStack, inferBackend,
  STYLE_SPEC_FORMAT_VERSION, STYLE_SPEC_FIELD_DESCRIPTORS, STYLE_COLOR_TOKEN_DESCRIPTORS,
  ROLE_STYLE_PROPERTY_DESCRIPTORS, SEMANTIC_BINDING_CHANNELS, styleSpecJsonSchema,
} from '../scene/style-registry.ts'
export type {
  StyleSpec, StyleColors, RoleStyleSpec, RoleStyles, SemanticSlots, SemanticBinding,
  SemanticBindingChannel, BrandConstraint, BrandConstraintAction, StyleInput,
  StyleDescriptor, StyleReferenceResolution, StyleRegistrationOptions,
} from '../scene/style-registry.ts'
export type { ArchitectureVisualOverrides } from '../architecture/config.ts'
export { registerBackend, getBackend, knownBackendDescriptors, DefaultBackend } from '../scene/backend.ts'
export type { StyleBackend, StyleBackendContext, BackendDescriptor, BackendRegistrationOptions, HostBackendPolicy } from '../scene/backend.ts'
export {
  BACKEND_CONFORMANCE_VERSION, BACKEND_CONFORMANCE_FIXTURE_ID,
  BACKEND_CONFORMANCE_CHECK_IDS, runBackendConformance,
} from '../scene/backend-conformance.ts'
export type {
  BackendConformanceCheckId, BackendConformanceCheck, BackendConformanceReport,
  BackendCapabilityConformanceStatus, BackendCapabilityConformanceResult,
} from '../scene/backend-conformance.ts'
export { SCENE_CONTRACT_VERSION } from '../scene/ir.ts'
export type {
  SceneDoc, SceneNode, SceneRole, SemanticChannels, ConnectorMark, ConnectorGeometry, ConnectorSubpath,
  ConnectorRoute, ConnectorContourSemantics, ConnectorStroke, ConnectorEndpoints, ConnectorRelationship,
  ConnectorLabelDescriptor, ConnectorHitGeometry, ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss, ConnectorTerminalMarkerProjection, ConnectorTerminalMarkerPlacement, ConnectorTerminalLabelProjection, MarkerDescriptor,
} from '../scene/ir.ts'
export {
  EXTERNAL_SCENE_API_VERSION, buildExternalScene,
} from '../scene/external-scene.ts'
export type {
  ExternalSceneGeometry, ExternalSceneConnectorGeometry, ExternalSceneNodeBase, ExternalSceneShape, ExternalSceneDataMark,
  ExternalSceneText, ExternalSceneContainer, ExternalSceneConnector, ExternalSceneConnectorLabel, ExternalSceneNode,
  ExternalSceneMarker, ExternalSceneDocument, ExternalSceneInput,
} from '../scene/external-scene.ts'
export {
  SCENE_VALIDATION_VERSION, SCENE_VALIDATION_LIMITS, validateSceneDoc, assertValidSceneDoc, SceneValidationError,
} from '../scene/scene-validation.ts'
export type {
  SceneValidationDiagnosticCode, SceneValidationDiagnostic, SceneValidationResult,
  SceneValidationOptions,
} from '../scene/scene-validation.ts'
export { BUILTIN_SCENE_ROLE_TRAITS, SCENE_ROLE_DESCRIPTORS, resolveSceneRoleTraits, sceneRoleTraits } from '../scene/roles.ts'
export {
  HOSTED_FONT_RESOURCES, HOSTED_FONT_FACES, HOSTED_FONT_FILES,
  RESOURCE_MANIFEST, hostedFontResource, validateResourceManifest,
} from '../font-manifest.ts'
export { RESOURCE_MANIFEST_VERSION, verifyResourceBytes } from '../resource-manifest.ts'
export { CORE_SCENE_PRIMITIVES, CORE_SCENE_OPERATIONS, CORE_SCENE_FEATURES, PRIMITIVE_REALIZATIONS, terminalConnectorCapabilityClaims, validatePrimitiveCapabilities } from '../scene/capabilities.ts'
export { createExtensionIdentity } from '../shared/extension-identity.ts'
export {
  RENDER_CONTRACT_VERSION, RENDER_OUTPUTS, RENDER_OUTPUT_DESCRIPTORS,
  SHARED_RENDER_OPTION_FIELDS, validateSerializableRenderOptions, RenderCapabilityError,
  sharedRenderOptionsJsonSchema, styleInputJsonSchema,
} from '../render-contract.ts'
export {
  CAPABILITY_NEGOTIATION_VERSION, CORE_CAPABILITY_OFFERS,
  negotiateCapabilities, negotiateRenderCapabilities, parseSemVer, semVerSatisfies,
} from '../capability-negotiation.ts'
export type {
  CapabilityId, CapabilityOffer, CapabilityRequirement, CapabilityRequirementLevel,
  CapabilityResolution, CapabilityDecision,
} from '../capability-negotiation.ts'
export {
  PNG_OUTPUT_POLICY_VERSION, PNG_DEFAULT_SCALE, PNG_DEFAULT_FONT_FAMILY,
  PNG_FONT_SOURCES, PNG_NAPI_RUNTIME, PNG_WASM_RUNTIME,
  MAX_PNG_PIXELS, MAX_PNG_RASTER_DIMENSION, MAX_HOSTED_PNG_PIXELS, MAX_HOSTED_PNG_BYTES,
  MAX_PNG_FONT_DIRECTORIES, MAX_PNG_FONT_DIRECTORY_LENGTH,
  pngRasterDimensions, assertPngRasterBudget, assertHostedPngRasterBudget,
  svgIntrinsicDimensions, prepareSvgForPngRasterization,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS, PNG_OUTPUT_OPTION_FIELDS,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS, NATIVE_PNG_OUTPUT_POLICY_FIELDS,
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS, pngOutputOptionsJsonSchema,
  normalizePortablePngBackground, projectPortablePngOutputOptions,
  projectNativePngOutputPolicyInput, omitPngOutputOptions,
  pngNapiRuntimeProvenance, resolvePngOutputPolicy, resolvePortablePngOutputPolicy,
} from '../png-contract.ts'
export type {
  PngFitTo, PngOutputPolicyInput, PortablePngOutputOptions,
  PngOutputOptionFieldDescriptor, PngOutputOptionField, PortablePngOutputOptionField,
  NativePngOutputPolicyField, NativePngHostOnlyOptionField,
  PngOutputOptionScope, PngOutputOptionInputKind, PngOutputOptionPolicyState,
  PngOutputOptionReceiptState, PngFontSource, ResolvedPngOutputPolicy, PngRuntimeProvenance,
  PngRasterDimensions,
} from '../png-contract.ts'
export {
  TERMINAL_OUTPUT_POLICY_VERSION, TERMINAL_DEFAULT_PADDING_X, TERMINAL_BOUNDED_PADDING_X,
  TERMINAL_DEFAULT_PADDING_Y, TERMINAL_DEFAULT_BOX_BORDER_PADDING,
  TerminalOutputPolicyError, resolveTerminalOutputPolicy,
} from '../terminal-contract.ts'
export type {
  AsciiRenderColorMode, TerminalOutputPolicyInput, ResolvedTerminalOutputPolicy,
} from '../terminal-contract.ts'
export type {
  RenderRequestReceipt,
  RenderOutputDescriptor, RenderOutputTransports, LibraryRenderTransport,
  CliRenderTransport, CodeModeRenderTransport,
} from '../render-contract.ts'
import { renderMermaidASCII as _ascii, renderMermaidASCIIWithReceipt as _asciiWithReceipt } from '../ascii/index.ts'
import { parseRegisteredMermaid as _parse } from './parse.ts'
import { prepareRenderInput } from './render-input.ts'
import type { ParsedDiagram, ValidDiagram, RenderedLayout, RenderedRegion } from './types.ts'
import type { RenderOptions } from '../types.ts'
import { receiptOf as _receiptOf, resolveRenderRequestForExecution as _resolveRenderRequest } from '../render-contract.ts'
import { layoutFamilyToRendered, layoutResolvedFamilyToRendered } from './family-layouts.ts'
import { collectActionRecords as collectRenderedActionRecords } from './analyze.ts'
import { toFinite } from './types.ts'
import {
  familyDetectionDiagnosticFromPreservedBody,
  MermaidFamilyDetectionError,
} from '../family-detection.ts'

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
export function layoutMermaidWithReceipt(
  input: ParsedDiagram | string,
  opts: LayoutRenderOptions = {},
): RenderedLayoutArtifact {
  const { debug, regions, actions, ...renderOptions } = opts
  const layoutOptions = { debug, regions, actions }
  const preparedInput = prepareRenderInput(input)
  const source = preparedInput.source
  const request = _resolveRenderRequest(source, renderOptions, 'layout', layoutOptions, {
    expectedFamilyId: preparedInput.expectedFamilyId,
  })
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
  // Every family now reaches layout JSON, certificates, regions and quality
  // through its descriptor's view of the same artifact used by SVG.
  const { debug, regions, actions, ...renderOptions } = opts
  const familyLayout = layoutFamilyToRendered(d, { debug, renderOptions })
  if (familyLayout) return enrichRenderedLayout(d, familyLayout, opts)
  throw new Error(`No public layout projection registered for Mermaid family "${d.kind}"`)
}

function enrichRenderedLayout(d: ParsedDiagram, layout: RenderedLayout, opts: LayoutMermaidOptions): RenderedLayout {
  const wantRegions = opts.debug || opts.regions
  const wantActions = opts.debug || opts.actions
  if (!wantRegions && !wantActions) return layout
  const next: RenderedLayout = { ...layout }
  if (wantRegions) next.regions = buildRenderedRegions(d, layout)
  if (wantActions) {
    const nodeIds = new Set<string>(layout.nodes.map(n => n.id))
    next.actions = (d.body.kind === 'extension' || d.body.kind === 'preserved'
      ? []
      : collectRenderedActionRecords(d as ValidDiagram))
      .filter(a => nodeIds.has(a.target))
      .map(a => ({ ...a, regionId: a.regionId ?? `node:${a.target}` }))
  }
  return next
}

function buildRenderedRegions(d: ParsedDiagram, layout: RenderedLayout): RenderedRegion[] {
  const regions: RenderedRegion[] = [{
    id: 'canvas',
    kind: 'canvas',
    bounds: { x: toFinite(0), y: toFinite(0), w: layout.bounds.w, h: layout.bounds.h },
  }]
  const groupByMember = new Map<string, string>()
  for (const group of layout.groups) for (const member of group.members) groupByMember.set(member, group.id)
  const sourceLines = sourceLineHints(d)
  for (const group of layout.groups) {
    regions.push({
      id: `group:${group.id}`,
      kind: 'group',
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
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
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
      const labelX = d.kind === 'sequence' && edge.from === edge.to
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
