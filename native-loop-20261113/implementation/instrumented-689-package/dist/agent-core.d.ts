import { cv as RenderedRegionKind, eH as TerminalProjectionDiagnosticCode, eI as TerminalProjectionDiagnostic, D as DiagramActionRecord, a as ParsedDiagram, cz as Result, bW as ParseError, aA as DiagramAnalysis, aC as DiagramKind, e as AgentflowMutationOp, av as CynefinMutationOp, ch as RailroadMutationOp, d0 as SwimlaneMutationOp, de as TreeviewMutationOp, dk as UsecaseMutationOp, ds as VennMutationOp, dz as WardleyMutationOp, g as AnyMutationOp, bP as MutationError, W as C4Variant, bi as FlowchartMutationOp, bj as FlowchartValidDiagram, cX as StateMutationOp, c_ as StateValidDiagram, cL as SequenceMutationOp, cN as SequenceValidDiagram, d6 as TimelineMutationOp, d9 as TimelineValidDiagram, a7 as ClassMutationOp, ac as ClassValidDiagram, aI as ErMutationOp, aK as ErValidDiagram, bB as JourneyMutationOp, bE as JourneyValidDiagram, n as ArchitectureMutationOp, q as ArchitectureValidDiagram, dH as XyChartMutationOp, dJ as XyChartValidDiagram, bZ as PieMutationOp, b$ as PieValidDiagram, c5 as QuadrantMutationOp, c7 as QuadrantValidDiagram, bo as GanttMutationOp, br as GanttValidDiagram, bM as MindmapMutationOp, bN as MindmapValidDiagram, bt as GitGraphMutationOp, bu as GitGraphValidDiagram, ce as RadarMutationOp, cf as RadarValidDiagram, N as C4MutationOp, V as C4ValidDiagram, cD as SankeyMutationOp, cE as SankeyValidDiagram, bT as PacketMutationOp, bU as PacketValidDiagram, bG as KanbanMutationOp, bH as KanbanValidDiagram, cx as RequirementMutationOp, cy as RequirementValidDiagram, db as TreemapMutationOp, dc as TreemapValidDiagram, dM as ZenUMLMutationOp, dP as ZenUMLValidDiagram, aP as EventModelingMutationOp, aQ as EventModelingValidDiagram, by as IshikawaMutationOp, bz as IshikawaValidDiagram, t as BlockMutationOp, u as BlockValidDiagram, f as AgentflowValidDiagram, aw as CynefinValidDiagram, cl as RailroadValidDiagram, d1 as SwimlaneValidDiagram, dg as TreeviewValidDiagram, dm as UsecaseValidDiagram, dt as VennValidDiagram, dA as WardleyValidDiagram, bO as MutableValidDiagram, dv as VerifyResult, eJ as ZenUMLFragmentType, dL as ZenUMLBranch, eK as ConnectorDirection, S as C4Shape, K as C4Element, E as C4Boundary, O as C4Relationship, b6 as FamilyId, ba as FamilyPositionedProjectionOptions, bb as FamilyPositionedView, b5 as FamilyDescriptor, bV as PaintLayoutCertification, cq as RenderedLayout, dq as ValidDiagramPayload, dn as ValidDiagram, aS as ExtensionDiagramBody, du as VerifyOptions, R as RenderRequestReceipt } from './paint-certification-D4KXvaqY.js';
export { A as Accessibility, c as AgentflowBody, d as AgentflowMapping, c as AgentflowModel, h as ArchitectureBody, i as ArchitectureEdge, j as ArchitectureEndpoint, k as ArchitectureEndpointBoundary, l as ArchitectureGroup, m as ArchitectureJunction, o as ArchitectureService, p as ArchitectureSide, B as BUILTIN_FAMILY_METADATA, r as BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND, s as BlockBody, w as BuiltinFamilyId, x as BuiltinFamilyMetadata, C as C4Argument, y as C4ArgumentInput, z as C4Body, F as C4BoundaryInput, G as C4BoundaryKind, H as C4Diagnostic, I as C4Direction, J as C4Directive, L as C4ElementInput, M as C4ElementKind, Q as C4RelationshipInput, T as C4Statement, U as C4Style, X as CAPABILITY_NEGOTIATION_VERSION, Y as CORE_CAPABILITY_OFFERS, Z as CORE_SCENE_FEATURES, _ as CORE_SCENE_OPERATIONS, $ as CORE_SCENE_PRIMITIVES, a0 as CapabilityDecision, a1 as CapabilityId, a2 as CapabilityOffer, a3 as CapabilityRequirement, a4 as CapabilityRequirementLevel, a5 as CapabilityResolution, a6 as ClassBody, a8 as ClassNode, a9 as ClassNote, aa as ClassRelation, ab as ClassRelationKind, ad as CliRenderTransport, ae as CodeModeRenderTransport, af as ConnectorContourSemantics, ag as ConnectorEndpoints, ah as ConnectorGeometry, ai as ConnectorHitGeometry, aj as ConnectorLabelDescriptor, ak as ConnectorMark, al as ConnectorRelationship, am as ConnectorRoute, an as ConnectorStroke, ao as ConnectorSubpath, ap as ConnectorTerminalLabelProjection, aq as ConnectorTerminalMarkerPlacement, ar as ConnectorTerminalMarkerProjection, as as ConnectorTerminalProjection, at as ConnectorTerminalStrokeLoss, au as CynefinBody, ax as DEFAULT_LABEL_CHAR_CAP, ay as DiagramActionKind, az as DiagramActionSecurity, aB as DiagramBody, aD as EdgeId, aE as ErAttribute, aF as ErBody, aG as ErCardinality, aH as ErEntity, aJ as ErRelation, aL as EventData, aM as EventFrame, aN as EventFrameType, aO as EventModelingBody, aR as EventSpecification, aT as ExtensionValidDiagram, aU as ExternalFamilyId, aV as ExtractedLabel, aW as FAMILY_CAPABILITY_COLUMNS, aX as FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES, aY as FAMILY_CONFORMANCE_VERSION, aZ as FAMILY_DESCRIPTOR_CONTRACT_VERSION, a_ as FamilyCapability, a$ as FamilyCapabilityConformanceResult, b0 as FamilyCapabilityEvidence, b1 as FamilyCapabilityState, b2 as FamilyConformanceError, b3 as FamilyConformanceReport, b4 as FamilyConformanceStatus, b7 as FamilyOperations, b8 as FamilyParsedBody, b9 as FamilyPositionedProjectionContext, bc as FamilyScenePositivePrimitive, bd as FamilyScenePrimitiveApplicability, be as FamilyScenePrimitiveEvidence, bf as FamilySceneRolePrimitiveDeclaration, bg as FeedbackEdgeAnalysis, bh as Finite, bk as GanttBody, bl as GanttBodySection, bm as GanttBodyTask, bn as GanttBodyTaskTag, bp as GanttScheduleAnalysisSummary, bq as GanttStatement, bs as GitGraphBody, bv as GroupId, bw as InitDirective, bx as IshikawaBody, bA as JourneyBody, bC as JourneySection, bD as JourneyTask, bF as KanbanBody, bI as LayoutWarning, bJ as LibraryRenderTransport, bK as MarkerDescriptor, bL as MindmapBody, bQ as NodeId, bR as PRIMITIVE_REALIZATIONS, bS as PacketBody, P as PaintLayoutCertificationError, bX as ParticipantId, bY as PieBody, b_ as PieSlice, c0 as PreservedDiagramBody, c1 as PreservedSourceSpans, c2 as PreservedValidDiagram, c3 as QuadrantAxis, c4 as QuadrantBody, c6 as QuadrantPoint, c8 as RENDER_CONTRACT_VERSION, c9 as RENDER_OUTPUTS, ca as RENDER_OUTPUT_DESCRIPTORS, cb as RadarBody, cc as RadarBodyAxis, cd as RadarBodyCurve, cg as RailroadBody, ci as RailroadNode, cj as RailroadNotation, ck as RailroadRule, cm as RenderCapabilityError, cn as RenderOutputDescriptor, co as RenderOutputTransports, cp as RenderedLabelBounds, cr as RenderedLayoutEdge, cs as RenderedLayoutGroup, ct as RenderedLayoutLabel, cu as RenderedLayoutNode, b as RenderedRegion, cw as RequirementBody, cA as SHARED_RENDER_OPTION_FIELDS, cB as SankeyBody, cC as SankeyBodyLink, cF as SceneDoc, cG as SceneNode, cH as SemanticChannels, cI as SequenceBody, cJ as SequenceMessage, cK as SequenceMessageStyle, cM as SequenceParticipant, cO as SerializedFlowchartGraph, cP as SourceComment, cQ as SourceMap, cR as SourceMapSpans, cS as SourcePreservationReceipt, cT as SourceSpan, cU as SourceSpanPoint, cV as StateBody, cW as StateFloatingNote, cY as StateNode, cZ as StateTransition, c$ as SwimlaneBody, d2 as Tier1WarningCode, d3 as Tier2WarningCode, d4 as TimelineBody, d5 as TimelineEvent, d7 as TimelinePeriod, d8 as TimelineSection, da as TreemapBody, dd as TreeviewBody, df as TreeviewNode, dh as UNREGISTERED_FAMILY_CAPABILITY_STATES, di as UsecaseBody, dj as UsecaseModel, dl as UsecaseStatement, dp as ValidDiagramMeta, dr as VennBody, dw as WARNING_SEVERITY, dx as WARNING_TIER, dy as WardleyBody, dB as WarningCode, dC as WarningSeverity, dD as WarningTier, dE as XyChartAxis, dF as XyChartAxisSpec, dG as XyChartBody, dI as XyChartSeries, dK as ZenUMLBody, dN as ZenUMLParticipant, dO as ZenUMLStatement, dQ as asAgentflow, dR as asArchitecture, dS as asBlock, dT as asC4, dU as asClass, dV as asCynefin, dW as asEr, dX as asEventModeling, dY as asFlowchart, dZ as asGantt, d_ as asGitGraph, d$ as asIshikawa, e0 as asJourney, e1 as asKanban, e2 as asMindmap, e3 as asPacket, e4 as asPie, e5 as asQuadrant, e6 as asRadar, e7 as asRailroad, e8 as asRequirement, e9 as asSankey, ea as asSequence, eb as asState, ec as asSwimlane, ed as asTimeline, ee as asTreemap, ef as asTreeview, eg as asUsecase, eh as asVenn, ei as asWardley, ej as asXyChart, ek as asZenUML, el as builtinFamilyMetadata, em as declareFamilyScenePrimitiveEvidence, en as detectRegisteredFamilyFromFirstLine, eo as effectiveFamilyCapabilityState, ep as err, eq as getFamily, er as getFamilyConformanceReport, es as isBuiltinFamilyId, et as isExternalFamilyId, eu as knownBuiltinFamilies, ev as knownFamilies, ew as negotiateCapabilities, ex as negotiateRenderCapabilities, ey as ok, ez as parseSemVer, eA as semVerSatisfies, eB as sharedRenderOptionsJsonSchema, eC as styleInputJsonSchema, eD as terminalConnectorCapabilityClaims, eE as toFinite, eF as validatePrimitiveCapabilities, eG as validateSerializableRenderOptions, v as verifyNoExternalRefs } from './paint-certification-D4KXvaqY.js';
import { A as AsciiRenderOptions, aO as Note, aN as Message, aI as Actor, bF as renderMermaidASCII$1, at as RenderedAscii, bG as renderMermaidSVG$1, bH as RenderedSvg } from './index-CAAu5PFf.js';
export { c as AsciiRenderColorMode, d as AsciiWidthError, e as AsciiWidthErrorReason, B as BACKEND_CONFORMANCE_CHECK_IDS, f as BACKEND_CONFORMANCE_FIXTURE_ID, g as BACKEND_CONFORMANCE_VERSION, h as BackendCapabilityConformanceResult, i as BackendCapabilityConformanceStatus, j as BackendConformanceCheck, k as BackendConformanceCheckId, l as BackendConformanceReport, m as BackendDescriptor, n as BackendRegistrationOptions, C as ClassDiagram, o as ClassDiagramNode, p as ClassMember, q as ClassNamespace, r as ClassRelationship, D as DefaultBackend, E as EXTERNAL_SCENE_API_VERSION, s as ErDiagram, t as ErDiagramAttribute, u as ErDiagramEntity, v as ErGroup, w as ErRelationship, x as ExternalSceneConnector, y as ExternalSceneConnectorGeometry, z as ExternalSceneConnectorLabel, F as ExternalSceneContainer, G as ExternalSceneDataMark, I as ExternalSceneDocument, J as ExternalSceneGeometry, K as ExternalSceneInput, L as ExternalSceneMarker, M as ExternalSceneNode, N as ExternalSceneNodeBase, O as ExternalSceneShape, Q as ExternalSceneText, R as FamilyDetectionDiagnostic, S as HOSTED_FONT_RESOURCES, H as HostBackendPolicy, T as MAX_HOSTED_PNG_BYTES, U as MAX_HOSTED_PNG_PIXELS, V as MAX_PNG_FONT_DIRECTORIES, W as MAX_PNG_FONT_DIRECTORY_LENGTH, X as MAX_PNG_PIXELS, Y as MAX_PNG_RASTER_DIMENSION, Z as MermaidFamilyClassification, _ as MermaidFamilyDetectionError, $ as MermaidSyntaxError, a0 as MermaidSyntaxErrorLocation, a1 as NATIVE_PNG_HOST_ONLY_OPTION_FIELDS, a2 as NATIVE_PNG_OUTPUT_POLICY_FIELDS, a3 as NativePngHostOnlyOptionField, a4 as NativePngOutputPolicyField, a5 as PNG_DEFAULT_FONT_FAMILY, a6 as PNG_DEFAULT_MIN_LABEL_PX, a7 as PNG_DEFAULT_SCALE, a8 as PNG_FONT_SOURCES, a9 as PNG_NAPI_RUNTIME, aa as PNG_OUTPUT_OPTION_FIELDS, ab as PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS, ac as PNG_OUTPUT_POLICY_VERSION, ad as PNG_WASM_RUNTIME, ae as PORTABLE_PNG_OUTPUT_OPTION_FIELDS, af as PngFitTo, ag as PngFontSource, ah as PngOutputOptionField, ai as PngOutputOptionFieldDescriptor, aj as PngOutputOptionInputKind, ak as PngOutputOptionPolicyState, al as PngOutputOptionReceiptState, am as PngOutputOptionScope, a as PngOutputPolicyInput, an as PngRasterDimensions, b as PngRuntimeProvenance, ao as PortablePngOutputOptionField, ap as PortablePngOutputOptions, aq as RESOLVED_SCENE_VERSION, ar as RESOURCE_MANIFEST, as as RESOURCE_MANIFEST_VERSION, au as ResolvedPngOutputPolicy, av as ResolvedScene, aw as ResolvedSceneError, ax as ResolvedSceneFeature, ay as ResolvedTerminalOutputPolicy, az as SCENE_CONTRACT_VERSION, aA as SCENE_VALIDATION_LIMITS, aB as SCENE_VALIDATION_VERSION, aC as SceneValidationDiagnostic, aD as SceneValidationDiagnosticCode, aE as SceneValidationError, aF as SceneValidationOptions, aG as SceneValidationResult, aH as SequenceActivationEvent, aJ as SequenceActorType, aK as SequenceBoxGroup, aL as SequenceDiagram, aM as SequenceDiagramBlock, aP as SequenceMessageHead, aQ as StyleBackend, aR as StyleBackendContext, aS as TERMINAL_BOUNDED_PADDING_X, aT as TERMINAL_DEFAULT_BOX_BORDER_PADDING, aU as TERMINAL_DEFAULT_PADDING_X, aV as TERMINAL_DEFAULT_PADDING_Y, aW as TERMINAL_OUTPUT_POLICY_VERSION, aX as TEXT_MEASUREMENT_CONTRACT, aY as TerminalOutputPolicyError, aZ as TerminalOutputPolicyInput, a_ as TextMeasurementContract, a$ as TextMeasurementInput, b0 as TextMeasurementResult, b1 as UPSTREAM_MERMAID_FAMILY_INDEX, b2 as UpstreamFamilyDescriptor, b3 as UpstreamHeaderDescriptor, b4 as UpstreamHeaderMatch, b5 as UpstreamMermaidFamilyIndex, b6 as assertHostedPngRasterBudget, b7 as assertPngRasterBudget, b8 as assertValidSceneDoc, b9 as buildExternalScene, ba as classifyMermaidFamilyFromFirstLine, bb as findUpstreamFamilyByHeader, bc as getBackend, bd as hostedFontResource, be as knownBackendDescriptors, bf as measureText, bg as measureTextWidth, bh as normalizePortablePngBackground, bi as omitPngOutputOptions, bj as parseAgentflowModel, bk as parseClassDiagram, bl as parseErDiagram, bm as parseRegisteredMermaid, bn as parseSequenceDiagram, bo as parseUsecaseModel, bp as pngNapiRuntimeProvenance, bq as pngOutputOptionsJsonSchema, br as pngRasterDimensions, bs as prepareSvgForPngRasterization, bt as projectNativePngOutputPolicyInput, bu as projectPortablePngOutputOptions, bv as registerBackend, bw as renderResolvedScene, bx as resolvePngOutputPolicy, by as resolvePortablePngOutputPolicy, bz as resolveTerminalOutputPolicy, bA as runBackendConformance, bB as svgIntrinsicDimensions, bC as validateResourceManifest, bD as validateSceneDoc, bE as verifyResourceBytes } from './index-CAAu5PFf.js';
import { m as Direction, d as LayoutRouteCertificate, n as PositionedDiagram, M as MermaidEdge, R as RenderOptions } from './types-CNsEXVPT.js';
export { A as AnyPort, a as ArchitectureVisualOverrides, D as DiamondFacet, b as DisplayRun, E as EdgeRouteCertificate, F as FamilyEdgeRouteCertificate, c as FamilyRouteCertificate, L as LabelContent, e as LayoutRouteClass, P as PortSemanticRole, f as PortSide, g as PreparedDisplayText, h as RegionContainmentCertificate, i as RouteBlocker, j as RouteCertificate, k as RouteClass, l as RoutePortAssignment } from './types-CNsEXVPT.js';
export { B as BINDABLE_ROLE_STYLE_PROPERTIES, a as BINDABLE_SCENE_ROLES, b as BRAND_CONSTRAINT_DESCRIPTORS, c as BRAND_CONSTRAINT_KINDS, d as BUILTIN_SCENE_ROLE_TRAITS, e as BindableSceneRole, f as BrandConstraint, g as BrandConstraintAction, h as BrandConstraintKind, E as EXACT_ROLE_STYLE_CONTRACT, i as EXACT_STYLE_SCENE_ROLES, j as ExactStyleSceneRole, k as ExtensionIdentity, R as ROLE_STYLE_PROPERTY_DESCRIPTORS, l as RoleStyleFor, m as RoleStyleSpec, n as RoleStyles, o as SCENE_ROLE_DESCRIPTORS, p as SEMANTIC_BINDING_CHANNELS, q as STYLE_COLOR_TOKEN_DESCRIPTORS, r as STYLE_SPEC_FIELD_DESCRIPTORS, s as STYLE_SPEC_FORMAT_VERSION, t as SceneRole, u as SemanticBinding, v as SemanticBindingChannel, w as SemanticSlots, x as StyleColors, y as StyleDescriptor, S as StyleInput, z as StyleReferenceResolution, A as StyleRegistrationOptions, C as StyleSpec, D as createExtensionIdentity, F as getStyle, G as inferBackend, H as knownStyleDescriptors, I as knownStyles, J as registerStyle, K as resolveSceneRoleTraits, L as resolveStyleReference, M as resolveStyleStack, N as sceneRoleTraits, O as styleSpecJsonSchema, P as validateStyleSpec } from './svg-styles-24_BFqX1.js';

interface TerminalIdentity {
    id: string;
    kind: Exclude<RenderedRegionKind, 'canvas'> | 'subgraph';
}
interface TerminalOwner {
    id: string;
    kind?: TerminalIdentity['kind'];
    sourceLine?: number;
    parent?: Readonly<TerminalIdentity>;
    /** Semantic attachment only; grants no containment or geometry privileges. */
    annotationTarget?: Readonly<TerminalIdentity>;
    members?: readonly string[];
    /** Shared runs may join only when their family layout declares a bundle. */
    bundle?: string;
    from?: string;
    to?: string;
    /** Producer promises a complete visible directional connector between its ports. */
    route?: 'connected';
}
type TerminalSide = 'T' | 'R' | 'B' | 'L';
interface TerminalMarker {
    shape: 'arrow' | 'triangle' | 'open-arrow' | 'circle' | 'cross' | 'diamond' | 'wide-circle' | 'lollipop' | 'filled-diamond' | 'hollow-diamond' | 'sequence-cross' | 'half-top' | 'half-bottom' | 'stick-top' | 'stick-bottom' | 'cardinality-one' | 'cardinality-many';
    direction?: TerminalSide;
    ascii?: boolean;
}
interface TerminalCellSpan {
    row: number;
    start: number;
    end: number;
}
interface TerminalPort {
    nodeId: string;
    x: number;
    y: number;
    side?: TerminalSide;
    end: 'start' | 'end';
    /** Authored item identity stays in nodeId when a container is the physical contact. */
    boundary?: Readonly<TerminalIdentity>;
    /** Model-owned expectation, declared separately from painting. Empty means
     * deliberately unmarked; multiple cells retain ER cardinality semantics. */
    markers?: readonly Readonly<TerminalMarker>[];
    markerOffset?: number;
    /** A declared family loss, backed by a diagnostic and owned fallback text. */
    markerProjection?: string;
    /** Sequence contacts a participant lifeline, not its header-card frame. */
    surface?: 'frame' | 'lifeline';
}
interface TerminalRegion {
    id: string;
    kind: NonNullable<TerminalOwner['kind']>;
    sourceLine?: number;
    parentId?: string;
    parentKind?: TerminalIdentity['kind'];
    annotationTarget?: Readonly<TerminalIdentity>;
    members?: readonly string[];
    from?: string;
    to?: string;
    bundle?: string;
    ports?: TerminalPort[];
    canvasRow: number;
    canvasColStart: number;
    canvasColEnd: number;
    rowSpan?: number;
    projectedText?: string;
    authoredTextCells?: Array<{
        row: number;
        column: number;
        glyph: string;
    }>;
    ownedCellSpans: TerminalCellSpan[];
    /** Relationship coverage hidden behind opaque marks; not visible ink. */
    occludedCellSpans?: TerminalCellSpan[];
}

type RegionKind = Exclude<RenderedRegionKind, 'canvas'> | 'subgraph';
type AsciiWarningCode = 'ASCII_RENDER_FAILED' | 'ASCII_EDGE_REGION_UNMAPPED' | TerminalProjectionDiagnosticCode;
interface AsciiWarning {
    code: AsciiWarningCode;
    message: string;
    severity: 'degraded';
    cell?: TerminalProjectionDiagnostic['cell'];
}
interface AsciiRegion extends Omit<TerminalRegion, 'ownedCellSpans'> {
    /** Exact occupied geometry, including spaces, continuations and repeated occurrences. */
    ownedCellSpans?: TerminalCellSpan[];
}
declare const ASCII_ROUTE_PARITY_CONTRACT: {
    readonly version: 1;
    readonly routeIntent: "shared-route-classes";
    readonly svgSource: "route-contract classifyRoutes() + certificates";
    readonly asciiSource: "family terminal geometry with owned cells, route classes, markers and intentional bundles";
    readonly degradationWarnings: readonly ["ASCII_RENDER_FAILED", "ASCII_EDGE_REGION_UNMAPPED", "TERMINAL_OWNERSHIP_UNAVAILABLE"];
};
interface AsciiWithMeta {
    ascii: string;
    regions: AsciiRegion[];
    actions: DiagramActionRecord[];
    warnings: AsciiWarning[];
    routeParity: typeof ASCII_ROUTE_PARITY_CONTRACT;
}
/** Metadata is emitted by the same execution as the text. No label search or rerender. */
declare function renderMermaidASCIIWithMeta(input: ParsedDiagram | string, options?: AsciiRenderOptions): AsciiWithMeta;

/**
 * Reverse an ASCII flowchart render back to (best-effort) Mermaid source.
 * Returns synthesized ids (N0, N1, …) with recovered labels and edges.
 */
declare function asciiToMermaid(ascii: string, opts?: {
    direction?: 'TD' | 'LR';
}): Result<string, ParseError[]>;

declare function analyzeMermaid(d: ParsedDiagram): DiagramAnalysis;
declare function analyzeMermaidSource(source: string): Result<DiagramAnalysis, ParseError[]>;
declare function collectActionRecords(d: ParsedDiagram): DiagramActionRecord[];

interface NativeFamilyMutationOps {
    agentflow: AgentflowMutationOp;
    cynefin: CynefinMutationOp;
    railroad: RailroadMutationOp;
    swimlane: SwimlaneMutationOp;
    treeview: TreeviewMutationOp;
    usecase: UsecaseMutationOp;
    venn: VennMutationOp;
    wardley: WardleyMutationOp;
}
/** The general dispatcher still accepts union-typed inputs. A concrete native
 * family cannot escape its operation type through that general overload. */
type MutationOpForFamily<K extends DiagramKind> = K extends keyof NativeFamilyMutationOps ? NativeFamilyMutationOps[K] : AnyMutationOp;
type MutationOpForDiagram<D extends ParsedDiagram> = D extends {
    body: {
        kind: infer K;
    };
} ? (K extends DiagramKind ? MutationOpForFamily<K> : AnyMutationOp) : AnyMutationOp;

interface CreateMermaidOptions {
    /** Legacy C4 dialect for a new diagram (default C4Context). */
    c4Variant?: C4Variant;
    /** Layout direction for flowchart/state diagrams (default TD). Ignored elsewhere. */
    direction?: Direction;
}
/** A mutation failure annotated with which op in the build list failed. */
type BuildError = MutationError & {
    opIndex: number;
};
declare function createMermaid(kind: 'flowchart', opts?: CreateMermaidOptions): FlowchartValidDiagram;
declare function createMermaid(kind: 'state', opts?: CreateMermaidOptions): StateValidDiagram;
declare function createMermaid(kind: 'sequence', opts?: CreateMermaidOptions): SequenceValidDiagram;
declare function createMermaid(kind: 'timeline', opts?: CreateMermaidOptions): TimelineValidDiagram;
declare function createMermaid(kind: 'class', opts?: CreateMermaidOptions): ClassValidDiagram;
declare function createMermaid(kind: 'er', opts?: CreateMermaidOptions): ErValidDiagram;
declare function createMermaid(kind: 'journey', opts?: CreateMermaidOptions): JourneyValidDiagram;
declare function createMermaid(kind: 'architecture', opts?: CreateMermaidOptions): ArchitectureValidDiagram;
declare function createMermaid(kind: 'xychart', opts?: CreateMermaidOptions): XyChartValidDiagram;
declare function createMermaid(kind: 'pie', opts?: CreateMermaidOptions): PieValidDiagram;
declare function createMermaid(kind: 'quadrant', opts?: CreateMermaidOptions): QuadrantValidDiagram;
declare function createMermaid(kind: 'gantt', opts?: CreateMermaidOptions): GanttValidDiagram;
declare function createMermaid(kind: 'mindmap', opts?: CreateMermaidOptions): MindmapValidDiagram;
declare function createMermaid(kind: 'gitgraph', opts?: CreateMermaidOptions): GitGraphValidDiagram;
declare function createMermaid(kind: 'radar', opts?: CreateMermaidOptions): RadarValidDiagram;
declare function createMermaid(kind: 'c4', opts?: CreateMermaidOptions): C4ValidDiagram;
declare function createMermaid(kind: 'sankey', opts?: CreateMermaidOptions): SankeyValidDiagram;
declare function createMermaid(kind: 'packet', opts?: CreateMermaidOptions): PacketValidDiagram;
declare function createMermaid(kind: 'kanban', opts?: CreateMermaidOptions): KanbanValidDiagram;
declare function createMermaid(kind: 'requirement', opts?: CreateMermaidOptions): RequirementValidDiagram;
declare function createMermaid(kind: 'treemap', opts?: CreateMermaidOptions): TreemapValidDiagram;
declare function createMermaid(kind: 'zenuml', opts?: CreateMermaidOptions): ZenUMLValidDiagram;
declare function createMermaid(kind: 'eventmodeling', opts?: CreateMermaidOptions): EventModelingValidDiagram;
declare function createMermaid(kind: 'ishikawa', opts?: CreateMermaidOptions): IshikawaValidDiagram;
declare function createMermaid(kind: 'block', opts?: CreateMermaidOptions): BlockValidDiagram;
declare function createMermaid(kind: 'agentflow', opts?: CreateMermaidOptions): AgentflowValidDiagram;
declare function createMermaid(kind: 'cynefin', opts?: CreateMermaidOptions): CynefinValidDiagram;
declare function createMermaid(kind: 'railroad', opts?: CreateMermaidOptions): RailroadValidDiagram;
declare function createMermaid(kind: 'swimlane', opts?: CreateMermaidOptions): SwimlaneValidDiagram;
declare function createMermaid(kind: 'treeview', opts?: CreateMermaidOptions): TreeviewValidDiagram;
declare function createMermaid(kind: 'usecase', opts?: CreateMermaidOptions): UsecaseValidDiagram;
declare function createMermaid(kind: 'venn', opts?: CreateMermaidOptions): VennValidDiagram;
declare function createMermaid(kind: 'wardley', opts?: CreateMermaidOptions): WardleyValidDiagram;
declare function createMermaid(kind: DiagramKind, opts?: CreateMermaidOptions): MutableValidDiagram;
declare function buildMermaid(kind: 'flowchart', ops: FlowchartMutationOp[], opts?: CreateMermaidOptions): Result<FlowchartValidDiagram, BuildError>;
declare function buildMermaid(kind: 'state', ops: StateMutationOp[], opts?: CreateMermaidOptions): Result<StateValidDiagram, BuildError>;
declare function buildMermaid(kind: 'sequence', ops: SequenceMutationOp[], opts?: CreateMermaidOptions): Result<SequenceValidDiagram, BuildError>;
declare function buildMermaid(kind: 'timeline', ops: TimelineMutationOp[], opts?: CreateMermaidOptions): Result<TimelineValidDiagram, BuildError>;
declare function buildMermaid(kind: 'class', ops: ClassMutationOp[], opts?: CreateMermaidOptions): Result<ClassValidDiagram, BuildError>;
declare function buildMermaid(kind: 'er', ops: ErMutationOp[], opts?: CreateMermaidOptions): Result<ErValidDiagram, BuildError>;
declare function buildMermaid(kind: 'journey', ops: JourneyMutationOp[], opts?: CreateMermaidOptions): Result<JourneyValidDiagram, BuildError>;
declare function buildMermaid(kind: 'architecture', ops: ArchitectureMutationOp[], opts?: CreateMermaidOptions): Result<ArchitectureValidDiagram, BuildError>;
declare function buildMermaid(kind: 'xychart', ops: XyChartMutationOp[], opts?: CreateMermaidOptions): Result<XyChartValidDiagram, BuildError>;
declare function buildMermaid(kind: 'pie', ops: PieMutationOp[], opts?: CreateMermaidOptions): Result<PieValidDiagram, BuildError>;
declare function buildMermaid(kind: 'quadrant', ops: QuadrantMutationOp[], opts?: CreateMermaidOptions): Result<QuadrantValidDiagram, BuildError>;
declare function buildMermaid(kind: 'gantt', ops: GanttMutationOp[], opts?: CreateMermaidOptions): Result<GanttValidDiagram, BuildError>;
declare function buildMermaid(kind: 'mindmap', ops: MindmapMutationOp[], opts?: CreateMermaidOptions): Result<MindmapValidDiagram, BuildError>;
declare function buildMermaid(kind: 'gitgraph', ops: GitGraphMutationOp[], opts?: CreateMermaidOptions): Result<GitGraphValidDiagram, BuildError>;
declare function buildMermaid(kind: 'radar', ops: RadarMutationOp[], opts?: CreateMermaidOptions): Result<RadarValidDiagram, BuildError>;
declare function buildMermaid(kind: 'c4', ops: C4MutationOp[], opts?: CreateMermaidOptions): Result<C4ValidDiagram, BuildError>;
declare function buildMermaid(kind: 'sankey', ops: SankeyMutationOp[], opts?: CreateMermaidOptions): Result<SankeyValidDiagram, BuildError>;
declare function buildMermaid(kind: 'packet', ops: PacketMutationOp[], opts?: CreateMermaidOptions): Result<PacketValidDiagram, BuildError>;
declare function buildMermaid(kind: 'kanban', ops: KanbanMutationOp[], opts?: CreateMermaidOptions): Result<KanbanValidDiagram, BuildError>;
declare function buildMermaid(kind: 'requirement', ops: RequirementMutationOp[], opts?: CreateMermaidOptions): Result<RequirementValidDiagram, BuildError>;
declare function buildMermaid(kind: 'treemap', ops: TreemapMutationOp[], opts?: CreateMermaidOptions): Result<TreemapValidDiagram, BuildError>;
declare function buildMermaid(kind: 'zenuml', ops: ZenUMLMutationOp[], opts?: CreateMermaidOptions): Result<ZenUMLValidDiagram, BuildError>;
declare function buildMermaid(kind: 'eventmodeling', ops: EventModelingMutationOp[], opts?: CreateMermaidOptions): Result<EventModelingValidDiagram, BuildError>;
declare function buildMermaid(kind: 'ishikawa', ops: IshikawaMutationOp[], opts?: CreateMermaidOptions): Result<IshikawaValidDiagram, BuildError>;
declare function buildMermaid(kind: 'block', ops: BlockMutationOp[], opts?: CreateMermaidOptions): Result<BlockValidDiagram, BuildError>;
declare function buildMermaid(kind: 'agentflow', ops: AgentflowMutationOp[], opts?: CreateMermaidOptions): Result<AgentflowValidDiagram, BuildError>;
declare function buildMermaid(kind: 'cynefin', ops: CynefinMutationOp[], opts?: CreateMermaidOptions): Result<CynefinValidDiagram, BuildError>;
declare function buildMermaid(kind: 'railroad', ops: RailroadMutationOp[], opts?: CreateMermaidOptions): Result<RailroadValidDiagram, BuildError>;
declare function buildMermaid(kind: 'swimlane', ops: SwimlaneMutationOp[], opts?: CreateMermaidOptions): Result<SwimlaneValidDiagram, BuildError>;
declare function buildMermaid(kind: 'treeview', ops: TreeviewMutationOp[], opts?: CreateMermaidOptions): Result<TreeviewValidDiagram, BuildError>;
declare function buildMermaid(kind: 'usecase', ops: UsecaseMutationOp[], opts?: CreateMermaidOptions): Result<UsecaseValidDiagram, BuildError>;
declare function buildMermaid(kind: 'venn', ops: VennMutationOp[], opts?: CreateMermaidOptions): Result<VennValidDiagram, BuildError>;
declare function buildMermaid(kind: 'wardley', ops: WardleyMutationOp[], opts?: CreateMermaidOptions): Result<WardleyValidDiagram, BuildError>;
declare function buildMermaid<K extends DiagramKind>(kind: K, ops: MutationOpForFamily<NoInfer<K>>[], opts?: CreateMermaidOptions): Result<MutableValidDiagram, BuildError>;

declare const MUTATION_OPS_BY_FAMILY: {
    readonly zenuml: readonly ["upsert_participant", "remove_participant", "rename_participant", "insert_statement", "remove_statement", "set_statement", "set_title", "set_accessibility_title", "set_accessibility_description"];
    readonly eventmodeling: readonly ["insert_frame", "remove_frame", "move_frame", "set_frame", "set_entities", "set_notes", "set_specifications", "set_data", "set_title", "set_accessibility_title", "set_accessibility_description"];
    readonly flowchart: readonly ["add_node", "remove_node", "rename_node", "set_label", "add_edge", "remove_edge", "set_shape", "set_direction", "add_subgraph", "remove_subgraph", "move_node", "define_class", "set_node_class", "set_node_style"];
    readonly swimlane: readonly ["add_node", "remove_node", "rename_node", "set_label", "add_edge", "remove_edge", "set_shape", "set_direction", "add_subgraph", "remove_subgraph", "move_node", "define_class", "set_node_class", "set_node_style"];
    readonly treeview: readonly ["add_node", "remove_node", "set_label", "set_description", "set_icon", "set_class", "set_node_type", "move_node", "set_title", "set_accessibility_title", "set_accessibility_description"];
    readonly cynefin: readonly ["set_title", "add_item", "set_item", "remove_item", "add_transition", "remove_transition", "set_accessibility_title", "set_accessibility_description"];
    readonly railroad: readonly ["add_rule", "replace_rule", "remove_rule", "set_title"];
    readonly venn: readonly ["set_subset", "remove_subset", "rename_set", "set_text", "remove_text", "set_style", "set_title", "set_accessibility_title", "set_accessibility_description"];
    readonly wardley: readonly ["set_title", "add_component", "set_component_position", "remove_component", "add_dependency", "remove_dependency", "set_evolution", "add_note", "set_accessibility_title", "set_accessibility_description"];
    readonly usecase: readonly ["add_actor", "add_usecase", "add_boundary", "remove_node", "set_label", "move_node", "add_relationship", "remove_relationship", "set_direction", "set_title", "set_accessibility_title", "set_accessibility_description"];
    readonly agentflow: readonly ["add_node", "remove_node", "rename_node", "set_label", "add_edge", "remove_edge", "set_shape", "set_direction", "add_subgraph", "remove_subgraph", "move_node", "define_class", "set_node_class", "set_node_style", "set_metadata", "set_role"];
    readonly state: readonly ["add_region", "remove_region", "add_state", "remove_state", "rename_state", "set_state_label", "add_transition", "remove_transition", "set_transition_label", "make_composite", "set_direction", "move_state", "dissolve_composite", "add_note", "remove_note", "set_note_text", "add_floating_note", "remove_floating_note", "set_floating_note_text", "define_class", "set_state_class", "set_state_style", "set_transition_style"];
    readonly sequence: readonly ["add_participant", "remove_participant", "add_message", "remove_message", "set_message_text", "set_message_wrap", "move_message", "set_participant_label", "add_fragment", "remove_fragment", "set_fragment_label", "add_fragment_branch", "set_fragment_branch_label", "add_fragment_message", "remove_fragment_message", "set_fragment_message_text", "set_fragment_message_wrap"];
    readonly timeline: readonly ["set_title", "add_section", "remove_section", "set_section_label", "add_period", "remove_period", "set_period_label", "add_event", "remove_event", "set_event_text", "move_period", "move_event", "move_section", "set_accessibility_title", "set_accessibility_description"];
    readonly class: readonly ["set_title", "add_class", "remove_class", "rename_class", "set_class_generic", "add_member", "remove_member", "add_interface", "add_relation", "remove_relation", "add_note", "remove_note", "set_class_namespace", "define_class", "set_css_class", "set_class_style"];
    readonly er: readonly ["add_entity", "remove_entity", "rename_entity", "set_entity_label", "add_attribute", "remove_attribute", "add_relation", "remove_relation", "set_direction", "define_class", "set_entity_class", "set_entity_style"];
    readonly journey: readonly ["set_title", "add_section", "remove_section", "set_section_label", "add_task", "remove_task", "set_task_text", "set_task_score", "set_task_actors", "rename_actor", "move_task", "move_section", "set_accessibility_title", "set_accessibility_description"];
    readonly architecture: readonly ["set_title", "set_accessibility_title", "set_accessibility_description", "add_service", "remove_service", "rename_service", "set_service_label", "set_service_icon", "set_service_icon_text", "move_service", "add_junction", "remove_junction", "rename_junction", "move_junction", "add_group", "set_group_label", "remove_group", "add_edge", "update_edge", "remove_edge"];
    readonly xychart: readonly ["set_title", "set_x_axis", "set_y_axis", "add_series", "remove_series", "set_series_values", "set_series_name", "reorder_series", "set_orientation", "set_data_point"];
    readonly pie: readonly ["set_title", "set_show_data", "add_slice", "remove_slice", "rename_slice", "set_slice_value", "reorder_slice"];
    readonly quadrant: readonly ["set_title", "set_axis_labels", "set_quadrant_label", "add_point", "remove_point", "move_point", "rename_point"];
    readonly gantt: readonly ["set_title", "add_section", "rename_section", "remove_section", "add_task", "remove_task", "rename_task", "set_task_status", "set_task_dates", "set_task_flags", "set_task_id", "move_task", "move_section"];
    readonly mindmap: readonly ["add_node", "remove_node", "rename_node", "set_label", "move_node", "set_shape", "set_icon", "set_node_class", "set_accessibility_title", "set_accessibility_description"];
    readonly gitgraph: readonly ["append_commit", "create_branch", "checkout_branch", "merge_branch", "cherry_pick", "set_commit_message", "set_commit_type", "set_commit_tags", "rename_branch", "set_accessibility_title", "set_accessibility_description"];
    readonly radar: readonly ["set_title", "add_axis", "remove_axis", "rename_axis", "set_axis_label", "reorder_axis", "add_curve", "remove_curve", "set_curve_values", "set_curve_value", "set_curve_label", "rename_curve", "reorder_curve", "set_config"];
    readonly sankey: readonly ["add_link", "remove_link", "set_link_value", "rename_node"];
    readonly c4: readonly ["add_element", "update_element", "rename_element", "reparent_element", "remove_element", "add_boundary", "update_boundary", "rename_boundary", "reparent_boundary", "remove_boundary", "add_relationship", "update_relationship", "remove_relationship", "set_title", "set_variant", "add_directive", "update_directive", "remove_directive"];
    readonly packet: readonly ["set_title", "set_accessibility_title", "set_accessibility_description", "add_field", "remove_field", "set_field_label", "set_field_bits", "move_field"];
    readonly kanban: readonly ["add_column", "remove_column", "set_column_label", "move_column", "add_task", "remove_task", "set_task_label", "set_task_metadata", "move_task", "set_icon", "set_class", "set_accessibility_title", "set_accessibility_description"];
    readonly requirement: readonly ["set_direction", "add_requirement", "update_requirement", "add_element", "update_element", "rename_node", "remove_node", "add_relation", "remove_relation", "define_class", "set_node_class", "set_node_style"];
    readonly treemap: readonly ["set_title", "add_node", "remove_node", "set_label", "set_value", "move_node", "define_class", "set_node_class", "set_accessibility_title", "set_accessibility_description"];
    readonly ishikawa: readonly ["set_effect", "add_cause", "remove_cause", "set_label", "move_cause", "set_accessibility_title", "set_accessibility_description"];
    readonly block: readonly ["set_columns", "add_block", "update_block", "rename_block", "remove_block", "move_block", "add_edge", "remove_edge", "define_class", "set_node_class", "set_node_style"];
};

type MutableFamilyId = keyof typeof MUTATION_OPS_BY_FAMILY;

type OpFamily = MutableFamilyId;
/** True when `family` has a shape schema (i.e. is a mutable structured family).
 *  Own-property only: `family in SCHEMAS` would report inherited Object.prototype
 *  names (`toString`, `constructor`, `__proto__`, …) as families and mis-narrow them. */
declare function hasOpSchema(family: string): family is OpFamily;
/**
 * Structured, model-actionable validation error. `code` is always INVALID_OP
 * (so it flows through the existing MutationError channel unchanged), but the
 * payload names the exact problem and enumerates the legal fields so a weak
 * model can self-correct in one turn.
 */
interface OpValidationError {
    code: 'INVALID_OP';
    /** 'expected_single_op' | 'unknown_kind' | 'unknown_field' | 'missing_field' | 'wrong_type' | 'require_one_of' */
    reason: string;
    message: string;
    family: OpFamily;
    opKind?: string;
    /** the offending field, when applicable */
    field?: string;
    /** valid field names for this op (or valid op kinds, for unknown_kind) */
    validFields?: string[];
    /** nearest valid name to a typo'd field/kind, when an obvious match exists.
     *  For an op missing `kind` whose op kind sits under another key (`field`,
     *  e.g. `{op:'add_node'}`), `kind`; the message shows the corrected op. */
    didYouMean?: string;
}
declare function validateOp(family: OpFamily, op: unknown): OpValidationError | null;
/** Machine-readable op menu for a family — { opKind: [fieldName, …] } — the
 *  basis for tool-discovery output. Optional fields are marked with a trailing
 *  `?`; the op's `kind` is implicit and omitted. */
declare function opMenu(family: OpFamily): Record<string, string[]>;
/** One field of an op, as a model needs it to fill the op correctly: the name,
 *  whether it is required, and a human type that spells out enum values inline
 *  (e.g. `one of "inheritance", "composition", …`). */
interface OpFieldDoc {
    name: string;
    required: boolean;
    type: string;
    note?: string;
    /** The fields of a nested record (`object`, `object | null`, or each item of
     *  `object[]`), when the shape layer validates them. Omitted where a record
     *  repeats its own shape (block `children`), or is named by reference in
     *  the note (an update record with its add record's fields). */
    fields?: OpFieldDoc[];
}
/** Full field shapes for every op of a family — the thing a model must know to
 *  author a correct op without guessing (which the prescriptive INVALID_OP error
 *  only teaches AFTER a wrong guess). Surfaced in `am capabilities --json` and
 *  the declarative MCP tool descriptions so field names, required-ness, and enum
 *  vocabularies are discoverable up front. */
declare function describeOps(family: OpFamily): Record<string, OpFieldDoc[]>;
/** Compact one-line signatures for a family's ops — `add_relation(from, to,
 *  relKind, label?)` — for embedding in a tool description. Optional fields carry
 *  a trailing `?`; enum values are left to `describeOps`/the error to keep the
 *  menu short. */
declare function opSignatures(family: OpFamily): string[];

/** A verify summary reduced to plain JSON (no RenderedLayout proxy graph). */
interface VerifySummary {
    ok: boolean;
    warnings: VerifyResult['warnings'];
    checks?: VerifyResult['checks'];
}
/** A mutation failure annotated with which op in the list failed. */
type CheckedBuildError = MutationError & {
    opIndex: number;
};
/**
 * THE single output DTO for the declarative surface. Success and failure share
 * one shape: `ok` discriminates. Every field is plain JSON — safe to return
 * straight out as an MCP tool result and safe to JSON round-trip: no
 * `{ok,value}`-vs-plain split, no provenance proxy, no Map.
 */
type OpEnvelope = {
    ok: true;
    family: DiagramKind;
    /** Canonical source by default; exact edited bytes in source-preserving mode. */
    source: string;
    mode?: 'source-preserving';
    verify: VerifySummary;
} | {
    ok: false;
    family: OpFamily | DiagramKind | null;
    /** index of the failing op within the batch, when the failure is op-scoped */
    opIndex?: number;
    error: OpValidationError | {
        code: string;
        message: string;
        details?: unknown;
    };
};
/** Drop the layout proxy graph; keep the model-actionable verdict. The JSON
 *  round-trip guarantees no residual Map / prototype leaks through. */
declare function verifySummary(v: VerifyResult): VerifySummary;
/**
 * buildMermaid's contract (createMermaid → fold ops) with the shape check in
 * front of every op. Same Result shape as buildMermaid, so it is a drop-in for
 * the untyped build path (Code Mode facade `buildMermaid`, declarative `build`).
 */
declare function buildChecked(kind: DiagramKind, ops: unknown[], opts?: CreateMermaidOptions): Result<MutableValidDiagram, CheckedBuildError>;
interface ApplyOpsInput {
    /** Existing Mermaid `source` to edit, OR `family` to author from blank. */
    source?: string;
    family?: string;
    ops: unknown;
    /** Explicitly retain unsupported syntax while applying a bounded family edit. */
    mode?: 'structured' | 'source-preserving';
}
/**
 * Plain-JSON-in / plain-JSON-out batch edit. Fail-fast, all-or-nothing: ops
 * apply in order over a working copy; the first invalid or semantically-rejected
 * op stops the batch and reports its index — nothing is committed (the input
 * `source` is untouched, mirroring buildMermaid). Returns the canonical envelope.
 */
declare function applyOps(input: ApplyOpsInput): OpEnvelope;

type LayoutCertificateProof = 'edge-route' | 'region-containment';
declare function layoutCertificateProof(cert: LayoutRouteCertificate): LayoutCertificateProof;

interface ZenUMLSemanticScope {
    fragmentId: string;
    fragmentIndex: number;
    type: ZenUMLFragmentType;
    branchIndex: number;
    branchKind: ZenUMLBranch['kind'];
    condition?: string;
}
interface ZenUMLMessageContext {
    message: Message;
    kind: 'call' | 'async' | 'reply' | 'creation';
    sourceId: string;
    callAncestors: readonly string[];
    scopes: readonly ZenUMLSemanticScope[];
}
interface ZenUMLNoteContext {
    note: Note;
    sourceId: string;
    callAncestors: readonly string[];
    scopes: readonly ZenUMLSemanticScope[];
}

/** How an edge with optional arrowheads reads between its authored endpoints. */
type ArrowheadDirection = Exclude<ConnectorDirection, 'self'>;

/** Every describe format, for the CLI flag, the MCP tool schema, and argument checks. */
declare const DESCRIBE_FORMATS: readonly ["text", "json", "facts"];
type DescribeFormat = (typeof DESCRIBE_FORMATS)[number];
interface DescribeOptions {
    /** 'text' (default): prose summary. 'json': structured AX tree (#7349). 'facts': deterministic semantic facts. */
    format?: DescribeFormat;
}
/** Structured accessibility tree (#7349): the graph as a list of nodes + edges. */
interface DescribeTree {
    kind: string;
    /** Visible document title, when retained by this family's readback. */
    title?: string;
    nodes: Array<{
        id: string;
        label: string;
        parentId?: string;
        value?: number;
        /** Renderer-owned endpoint, not an authored participant. */
        external?: true;
        zenuml?: {
            kind: 'participant';
            type: Actor['type'];
        } | (Pick<ZenUMLNoteContext, 'sourceId' | 'callAncestors' | 'scopes'> & {
            kind: 'note';
            actorIds: readonly string[];
            position: ZenUMLNoteContext['note']['position'];
            afterIndex: number;
        });
        c4?: ({
            category: 'element';
            effectiveShape: C4Shape;
        } & Pick<C4Element, 'kind' | 'external' | 'shape' | 'parentId'>) | ({
            category: 'boundary';
        } & Pick<C4Boundary, 'kind' | 'parentId'>);
    }>;
    edges: Array<{
        from: string;
        to: string;
        label?: string;
        /** How the drawn arrowheads read between `from` and `to`; absent means
         * forward (`from` points at `to`). */
        direction?: Exclude<ArrowheadDirection, 'forward'>;
        sequence?: {
            fragmentIndex: number;
            branchIndex: number;
            fragmentKind: string;
            branchLabel?: string;
        };
        zenuml?: Pick<ZenUMLMessageContext, 'kind' | 'sourceId' | 'callAncestors' | 'scopes'> & {
            id: string;
        };
        c4?: Pick<C4Relationship, 'id' | 'order' | 'index' | 'macro' | 'direction' | 'bidirectional' | 'reversed'> & {
            authoredFrom: string;
            authoredTo: string;
        };
    }>;
    entryPoints: string[];
    sinks: string[];
}
declare function describeMermaidSource(source: string, opts?: DescribeOptions): string;
declare function describeMermaid(d: ParsedDiagram, opts?: DescribeOptions): string;
/**
 * #7349: machine-readable accessibility tree — the graph as a flat node/edge
 * list with entry points and sinks. More useful to agents and screen-reader
 * tooling than prose. Covers the structured families; source-level/opaque
 * families expose extracted labels as nodes and no edges.
 */
declare function describeMermaidTree(d: ParsedDiagram): DescribeTree;

type MermaidFact = string;
interface CheckMermaidObjectSpec {
    /** Required facts. Aliases: expected / require / required. */
    include?: readonly string[];
    expected?: readonly string[];
    require?: readonly string[];
    required?: readonly string[];
    /** Forbidden facts. Aliases: absent / forbid / forbidden / unexpected. */
    exclude?: readonly string[];
    absent?: readonly string[];
    forbid?: readonly string[];
    forbidden?: readonly string[];
    unexpected?: readonly string[];
    /** When true, every emitted fact must be listed in the required set. */
    exact?: boolean;
}
type CheckMermaidSpec = readonly string[] | CheckMermaidObjectSpec;
interface CheckMermaidResult {
    ok: boolean;
    /** Required facts not present in the diagram. */
    missing: string[];
    /** Forbidden facts that were present, or extra facts under exact:true. */
    unexpected: string[];
    /** Full deterministic fact set used for the comparison. */
    facts: string[];
}
/** Facts for a parsed diagram. Output is sorted, de-duplicated, and single-line. */
declare function describeMermaidFacts(d: ParsedDiagram): string[];
/** Parse then emit facts. Parse failures are explicit Result errors. */
declare function describeMermaidFactsSource(source: string): Result<string[], ParseError[]>;
/** Check required/forbidden semantic facts against a parsed diagram. */
declare function checkMermaid(d: ParsedDiagram, spec: CheckMermaidSpec): CheckMermaidResult;
declare function checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult, ParseError[]>;

/**
 * Invoke a descriptor's pure positioned view without parsing or laying out.
 * This open-id form is useful to extension conformance tests even though the
 * current public `RenderedLayout` envelope remains a closed built-in union.
 */
declare function projectPositionedView(familyId: FamilyId, positioned: PositionedDiagram, options?: FamilyPositionedProjectionOptions): FamilyPositionedView | null;

/** Register a namespaced extension only after its canonical example proves
 * every native declaration twice against the public execution contracts. */
declare function registerFamily(descriptor: FamilyDescriptor): () => void;

declare function edgeIdOf(edge: MermaidEdge, idx?: number): string;

declare function mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>;
declare function mutate(d: StateValidDiagram, op: StateMutationOp): Result<StateValidDiagram, MutationError>;
declare function mutate(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError>;
declare function mutate(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError>;
declare function mutate(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError>;
declare function mutate(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError>;
declare function mutate(d: JourneyValidDiagram, op: JourneyMutationOp): Result<JourneyValidDiagram, MutationError>;
declare function mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, MutationError>;
declare function mutate(d: XyChartValidDiagram, op: XyChartMutationOp): Result<XyChartValidDiagram, MutationError>;
declare function mutate(d: PieValidDiagram, op: PieMutationOp): Result<PieValidDiagram, MutationError>;
declare function mutate(d: QuadrantValidDiagram, op: QuadrantMutationOp): Result<QuadrantValidDiagram, MutationError>;
declare function mutate(d: GanttValidDiagram, op: GanttMutationOp): Result<GanttValidDiagram, MutationError>;
declare function mutate(d: RadarValidDiagram, op: RadarMutationOp): Result<RadarValidDiagram, MutationError>;
declare function mutate(d: C4ValidDiagram, op: C4MutationOp): Result<C4ValidDiagram, MutationError>;
declare function mutate(d: SankeyValidDiagram, op: SankeyMutationOp): Result<SankeyValidDiagram, MutationError>;
declare function mutate(d: PacketValidDiagram, op: PacketMutationOp): Result<PacketValidDiagram, MutationError>;
declare function mutate(d: KanbanValidDiagram, op: KanbanMutationOp): Result<KanbanValidDiagram, MutationError>;
declare function mutate(d: RequirementValidDiagram, op: RequirementMutationOp): Result<RequirementValidDiagram, MutationError>;
declare function mutate(d: TreemapValidDiagram, op: TreemapMutationOp): Result<TreemapValidDiagram, MutationError>;
declare function mutate(d: EventModelingValidDiagram, op: EventModelingMutationOp): Result<EventModelingValidDiagram, MutationError>;
declare function mutate(d: IshikawaValidDiagram, op: IshikawaMutationOp): Result<IshikawaValidDiagram, MutationError>;
declare function mutate(d: BlockValidDiagram, op: BlockMutationOp): Result<BlockValidDiagram, MutationError>;
declare function mutate(d: AgentflowValidDiagram, op: AgentflowMutationOp): Result<AgentflowValidDiagram, MutationError>;
declare function mutate(d: CynefinValidDiagram, op: CynefinMutationOp): Result<CynefinValidDiagram, MutationError>;
declare function mutate(d: RailroadValidDiagram, op: RailroadMutationOp): Result<RailroadValidDiagram, MutationError>;
declare function mutate(d: SwimlaneValidDiagram, op: SwimlaneMutationOp): Result<SwimlaneValidDiagram, MutationError>;
declare function mutate(d: TreeviewValidDiagram, op: TreeviewMutationOp): Result<TreeviewValidDiagram, MutationError>;
declare function mutate(d: UsecaseValidDiagram, op: UsecaseMutationOp): Result<UsecaseValidDiagram, MutationError>;
declare function mutate(d: VennValidDiagram, op: VennMutationOp): Result<VennValidDiagram, MutationError>;
declare function mutate(d: WardleyValidDiagram, op: WardleyMutationOp): Result<WardleyValidDiagram, MutationError>;
declare function mutate<D extends ParsedDiagram>(d: D, op: MutationOpForDiagram<NoInfer<D>>): Result<D, MutationError>;
/**
 * mutate with a shape check in front — the one choke point every UNTYPED edit
 * path funnels through: the declarative applyOps/buildChecked entrypoints, the
 * Code Mode facade, and the CLI `--op`/`--ops` path. Typed callers keep using
 * `mutate` directly, where the compiler already guarantees op shape;
 * `mutateChecked` restores that guarantee at the boundaries where ops arrive as
 * raw JSON.
 *
 * `validateOp` proves the op's SHAPE (field names, primitive types, enums)
 * BEFORE the mutator runs, so a malformed op is rejected with a prescriptive
 * INVALID_OP error instead of silently mangling the diagram. Semantics — does
 * the referenced node exist, is the id a duplicate — stay in the mutator, which
 * runs second on a shape-proven op. Result shape is identical to `mutate`, so
 * this is a drop-in wherever the raw mutator was called with untyped ops.
 */
declare function mutateChecked<D extends ParsedDiagram>(d: D, op: unknown): Result<D, MutationError>;
interface SourceMutationResult {
    /** Save these exact bytes. Unsupported syntax remains source-preserved;
     * this artifact is not promised to be portable Mermaid. */
    readonly source: string;
    readonly diagram: ParsedDiagram;
}
/** Explicit source-level edits for opaque bodies. Family hooks admit only
 * operations whose complete native read-back changes by the requested delta.
 * Ordinary mutate, checked batches and canonical writers retain their contracts. */
declare function mutatePreservingSource(d: ParsedDiagram, op: unknown): Result<SourceMutationResult, MutationError>;

interface LabelConflictCounts {
    total: number;
    labelLabel: number;
    labelNode: number;
    labelEdge: number;
}

interface QualityMetrics {
    /** Evidence from the actual native paint projection, when this layout retains it. */
    paintCertification?: PaintLayoutCertification;
    edgeCrossings: number;
    labelLegibility: number;
    labelMeasurement: {
        measuredNodes: number;
        unmeasuredNodes: number;
        hiddenNodes: number;
        semanticNodes: number;
        measuredEdges: number;
        unmeasuredEdges: number;
        measuredLabels: number;
        unmeasuredLabels: number;
        hiddenLabels: number;
        semanticLabels: number;
    };
    whitespaceBalance: number;
    labelEdgeProximity: number;
    /** Padded label-pill conflicts for graph families with retained pill geometry. */
    labelConflicts?: LabelConflictCounts;
    /** Visible graph edge pairs sharing collinear ink. These remain distinct
     * from proper crossings; hiding a crossing in shared ink is not a win.
     * Parallel excludes self-loops, matching the existing route rubric. */
    routeOverlaps?: {
        parallel: number;
        opposing: number;
    };
    /** Raw visible polyline geometry, without subjective bundle/bend exemptions. */
    routeGeometry?: {
        bends: number;
        length: number;
        area: number;
    };
    minimumNodeSpacing: number;
    elementDensity: number;
    minimumTextContrast: number | null;
    aspectRatio: number;
    nodeCount: number;
    edgeCount: number;
}
interface QualityBounds {
    /** Max proper crossing incidences per visible edge pair. Default 0.05 = 5%. */
    maxCrossingsRatio?: number;
    /** Min label legibility. Default 0.85 = 85% of labels fit. */
    minLabelLegibility?: number;
    /** Whitespace fill band [min, max]. Default [0.05, 0.55]. */
    whitespaceBand?: [number, number];
    /** Min pixels between any edge-label bbox and a non-attached node, another edge-label, or another edge path. Default 4. */
    minLabelEdgeProximity?: number;
    /** Min pixels between distinct node/mark boxes. Default 8. */
    minNodeSpacing?: number;
    /** Elements (nodes + edges) per 10,000 canvas pixels. Default [0.02, 6]. */
    elementDensityBand?: [number, number];
    /** Minimum WCAG text contrast ratio. Default 4.5 (AA normal text). */
    minTextContrast?: number;
    /** Aspect ratio band [min, max]. Default [0.2, 5.0]. */
    aspectBand?: [number, number];
}
declare const DEFAULT_BOUNDS: Required<QualityBounds>;
interface QualityMeasurementOptions {
    /** Text/foreground paint. Defaults to the crisp theme foreground. */
    foreground?: string;
    /** Canvas paint. Defaults to the crisp theme background. */
    background?: string;
    /** Additional node/label fills to include in the minimum contrast. */
    surfaces?: readonly string[];
    /** Exact rendered text/surface pairs; these supersede foreground/surfaces while background remains the canvas paint. */
    textPairs?: readonly {
        foreground: string;
        background: string;
    }[];
}
type BoundBasis = 'evidence' | 'standard' | 'derived' | 'chosen' | 'sanity';
type ViolationSeverity = 'primary' | 'secondary' | 'sanity';
interface BoundProvenance {
    basis: BoundBasis;
    severity: ViolationSeverity;
    note: string;
}
/** Per-metric provenance. Keyed by the QualityMetrics field each bound gates. */
declare const BOUND_PROVENANCE: Record<'paintCertification' | 'edgeCrossings' | 'labelLegibility' | 'whitespaceBalance' | 'labelEdgeProximity' | 'minimumNodeSpacing' | 'elementDensity' | 'minimumTextContrast' | 'aspectRatio', BoundProvenance>;
declare function measureQuality(layout: RenderedLayout, options?: QualityMeasurementOptions): QualityMetrics;
interface RankedViolation {
    metric: keyof typeof BOUND_PROVENANCE;
    severity: ViolationSeverity;
    message: string;
}
interface QualityVerdict {
    ok: boolean;
    metrics: QualityMetrics;
    /**
     * The same violations, each tagged with its evidence-based severity so a
     * consumer can weight a crossings violation above a whitespace one
     * (Purchase 1997/2002). Ordered primary → secondary → sanity.
     */
    ranked: RankedViolation[];
}
declare function checkQuality(layout: RenderedLayout, bounds?: QualityBounds, measurement?: QualityMeasurementOptions): QualityVerdict;

interface SerializeOptions {
    /**
     * Wrapper emission policy. 'verbatim' (default) re-emits the leading source
     * wrapper (frontmatter, init directives, comments) byte-identically from
     * `meta.wrapperSource`, except adjacent frontmatter delimiters with no content
     * line, which Mermaid rejects. It then re-emits any init directive authored *after*
     * the family header that the serialized body does not already own — a
     * structured serializer receives directive-free grammar, so without this the
     * config would be lost. Such a directive therefore moves ahead of the
     * header; source-preserving bodies keep theirs in place and are unaffected.
     * 'canonical' synthesizes Mermaid's documented shape
     * instead: one frontmatter block with `title`/`displayMode` at the top
     * level and config values nested under `config:`. A single object init
     * directive folds in; multiple init layers retain their order and boundaries.
     * Invalid configuration must be repaired before canonical export, and
     * wrapper comments dropped. Diagrams without a captured wrapper (e.g.
     * synthesized from JSON payloads) always use canonical synthesis.
     */
    wrapper?: 'verbatim' | 'canonical';
}
declare function serializeMermaid(d: ParsedDiagram, opts?: SerializeOptions): string;
declare function synthesizeFromGraph(payload: ValidDiagramPayload & {
    kind: ValidDiagram['kind'];
    body: Exclude<ValidDiagramPayload['body'], ExtensionDiagramBody>;
}): Result<ValidDiagram, ParseError[]>;
declare function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ParsedDiagram, ParseError[]>;

/** The legacy ok flag is an error gate, never a task-correctness certificate. */
declare function verifyMermaid(input: ParsedDiagram | string, opts?: VerifyOptions): VerifyResult;

declare function renderMermaidSVG(input: ParsedDiagram | string, opts?: Parameters<typeof renderMermaidSVG$1>[1]): string;
declare function renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts?: Parameters<typeof renderMermaidSVG$1>[1]): RenderedSvg;
declare function renderMermaidASCII(input: ParsedDiagram | string, opts?: Parameters<typeof renderMermaidASCII$1>[1]): string;
declare function renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts?: Parameters<typeof renderMermaidASCII$1>[1]): RenderedAscii;
interface LayoutMermaidOptions extends RenderOptions {
    debug?: boolean;
    regions?: boolean;
    actions?: boolean;
}
type LayoutRenderOptions = LayoutMermaidOptions;
interface RenderedLayoutArtifact {
    layout: RenderedLayout;
    receipt: RenderRequestReceipt;
}
/** Canonical layout transport for Code Mode and other receipt-aware adapters. */
declare function layoutMermaidWithReceipt(input: ParsedDiagram | string, opts?: LayoutRenderOptions): RenderedLayoutArtifact;
declare function layoutMermaid(d: ParsedDiagram, opts?: LayoutMermaidOptions): RenderedLayout;

export { ASCII_ROUTE_PARITY_CONTRACT, AgentflowMutationOp, AgentflowValidDiagram, AnyMutationOp, type ApplyOpsInput, ArchitectureMutationOp, ArchitectureValidDiagram, type AsciiRegion, AsciiRenderOptions, type AsciiWarning, type AsciiWarningCode, type AsciiWithMeta, BOUND_PROVENANCE, BlockMutationOp, BlockValidDiagram, type BoundBasis, type BoundProvenance, type BuildError, C4Boundary, C4Element, C4MutationOp, C4Relationship, C4Shape, C4ValidDiagram, C4Variant, type CheckMermaidObjectSpec, type CheckMermaidResult, type CheckMermaidSpec, type CheckedBuildError, ClassMutationOp, ClassValidDiagram, type CreateMermaidOptions, CynefinMutationOp, CynefinValidDiagram, DEFAULT_BOUNDS, type DescribeOptions, type DescribeTree, DiagramActionRecord, DiagramAnalysis, DiagramKind, ErMutationOp, ErValidDiagram, EventModelingMutationOp, EventModelingValidDiagram, ExtensionDiagramBody, FamilyDescriptor, FamilyId, FamilyPositionedProjectionOptions, FamilyPositionedView, FlowchartMutationOp, FlowchartValidDiagram, GanttMutationOp, GanttValidDiagram, GitGraphMutationOp, GitGraphValidDiagram, IshikawaMutationOp, IshikawaValidDiagram, JourneyMutationOp, JourneyValidDiagram, KanbanMutationOp, KanbanValidDiagram, type LayoutCertificateProof, type LayoutMermaidOptions, type LayoutRenderOptions, LayoutRouteCertificate, type MermaidFact, MindmapMutationOp, MindmapValidDiagram, MutableValidDiagram, MutationError, type OpEnvelope, type OpFamily, type OpFieldDoc, type OpValidationError, PacketMutationOp, PacketValidDiagram, PaintLayoutCertification, ParseError, ParsedDiagram, PieMutationOp, PieValidDiagram, QuadrantMutationOp, QuadrantValidDiagram, type QualityBounds, type QualityMeasurementOptions, type QualityMetrics, type QualityVerdict, RadarMutationOp, RadarValidDiagram, RailroadMutationOp, RailroadValidDiagram, type RankedViolation, type RegionKind, RenderRequestReceipt, RenderedAscii, RenderedLayout, type RenderedLayoutArtifact, RenderedRegionKind, RequirementMutationOp, RequirementValidDiagram, Result, SankeyMutationOp, SankeyValidDiagram, Actor as SequenceActor, Message as SequenceDiagramMessage, Note as SequenceDiagramNote, SequenceMutationOp, SequenceValidDiagram, type SourceMutationResult, StateMutationOp, StateValidDiagram, SwimlaneMutationOp, SwimlaneValidDiagram, TimelineMutationOp, TimelineValidDiagram, TreemapMutationOp, TreemapValidDiagram, TreeviewMutationOp, TreeviewValidDiagram, UsecaseMutationOp, UsecaseValidDiagram, ValidDiagram, ValidDiagramPayload, VennMutationOp, VennValidDiagram, VerifyOptions, VerifyResult, type VerifySummary, type ViolationSeverity, WardleyMutationOp, WardleyValidDiagram, XyChartMutationOp, XyChartValidDiagram, ZenUMLBranch, ZenUMLMutationOp, ZenUMLValidDiagram, analyzeMermaid, analyzeMermaidSource, applyOps, asciiToMermaid, buildChecked, buildMermaid, checkMermaid, checkMermaidSource, checkQuality, collectActionRecords, createMermaid, describeMermaid, describeMermaidFacts, describeMermaidFactsSource, describeMermaidSource, describeMermaidTree, describeOps, edgeIdOf, hasOpSchema, layoutCertificateProof, layoutMermaid, layoutMermaidWithReceipt, measureQuality, mutate, mutateChecked, mutatePreservingSource, opMenu, opSignatures, projectPositionedView, registerFamily, renderMermaidASCII, renderMermaidASCIIWithMeta, renderMermaidASCIIWithReceipt, renderMermaidSVG, renderMermaidSVGWithReceipt, serializeMermaid, synthesizeFromGraph, validateOp, verifyMermaid, verifySummary };
