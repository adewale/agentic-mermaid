import { L as LabelContent, o as LabelDisplay, p as PixelTextBlock, b as DisplayRun, q as DiagramColors, G as GraphLayoutDecision, r as TextMeasurementProfileIdentity, C as ConfigDiagnostic, N as NormalizedMermaidSource, R as RenderOptions, s as ResolvedFamilyRenderContext, n as PositionedDiagram, U as UncertifiedLayoutReceipt, t as RenderContext, u as MermaidGraph, v as PositionedDiagramTitle, w as MermaidFrontmatterMap, x as MermaidConfigMap, m as Direction$1, y as FloatingStateNote, z as NodeShape, B as EdgeStyle, E as EdgeRouteCertificate, h as RegionContainmentCertificate, k as RouteClass, H as MermaidNode, M as MermaidEdge } from './types-CNsEXVPT.js';
import { t as SceneRole, C as StyleSpec, Q as InternalStyleFace, k as ExtensionIdentity, T as BRAND_CONSTRAINT_WARNING_POLICY, U as BrandConstraintWarningCode, h as BrandConstraintKind } from './svg-styles-24_BFqX1.js';

/** Public semantic identity carried by every structured Scene mark. */
interface SvgSemanticIdentity {
    /** Stable within one rendered SVG and derived from source semantics. */
    id: string;
    /** Core or namespaced Scene role; consumers never infer it from CSS classes. */
    role: SceneRole;
    /** Source endpoints when the mark is a relation. */
    from?: string;
    to?: string;
    /** Sanitized Mermaid class tokens preserved on the semantic element. */
    classNames?: readonly string[];
}

interface SvgRelationSemantics {
    from: string;
    to: string;
    label?: string;
}
/** Typed per-element accessibility carried beside Scene identity. */
interface SvgSemanticAccessibility {
    label: string;
    role: 'graphics-symbol';
    roleDescription: 'relation';
    relation: SvgRelationSemantics;
}

/** A small, renderer-independent vocabulary for declaring Scene support. */
declare const CORE_SCENE_PRIMITIVES: readonly ["document", "image", "text", "shape", "container", "connector", "marker", "data-mark"];
type CoreScenePrimitive = (typeof CORE_SCENE_PRIMITIVES)[number];
type ScenePrimitive = CoreScenePrimitive | `${string}:${string}`;
interface EssentialScenePrimitiveOperation {
    readonly primitive: CoreScenePrimitive;
    readonly operation: 'render' | 'serialize';
}
/** One authority for the minimum operation that makes each core primitive
 * usable by a selected Scene backend. */
declare const ESSENTIAL_SCENE_PRIMITIVE_OPERATIONS: readonly EssentialScenePrimitiveOperation[];
declare function essentialScenePrimitiveOperation(primitive: CoreScenePrimitive): EssentialScenePrimitiveOperation['operation'];
declare const CORE_SCENE_OPERATIONS: readonly ["measure", "layout", "bounds", "hit-test", "render", "accessibility", "terminal-project", "serialize"];
type CoreSceneOperation = (typeof CORE_SCENE_OPERATIONS)[number];
type SceneOperation = CoreSceneOperation | `${string}:${string}`;
declare const CORE_SCENE_FEATURES: readonly ["geometry", "paint", "stroke", "transform", "identity", "relation", "labels", "markers", "resources", "interaction", "topology", "subpaths", "closedness", "bend-radius", "endpoints", "direction", "hit-geometry", "stroke-opacity", "stroke-cap", "stroke-join", "stroke-miter", "dash-array", "dash-offset", "dash-restart", "path-length", "paint-order", "compositing", "non-scaling-stroke", "marker-orientation", "marker-overflow"];
type CoreSceneFeature = (typeof CORE_SCENE_FEATURES)[number];
type SceneFeature = CoreSceneFeature | `${string}:${string}`;
interface EssentialScenePrimitiveCapability {
    readonly primitive: CoreScenePrimitive;
    readonly feature: CoreSceneFeature;
    readonly operation: CoreSceneOperation;
}
/** Minimum feature-level contract required before a backend can truthfully
 * accept a family that emits a primitive. This is intentionally stricter than
 * checking that any claim exists for a primitive/operation pair: geometry
 * support alone must not silently discard paint, identity, markers, relation,
 * accessibility, or hit semantics. */
declare const ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES: readonly EssentialScenePrimitiveCapability[];
declare const PRIMITIVE_REALIZATIONS: readonly ["native", "emulated", "projected", "lossy", "unsupported"];
type PrimitiveRealization = (typeof PRIMITIVE_REALIZATIONS)[number];

interface PrimitiveCapabilityClaim {
    /** Stable implementation/backend identifier, e.g. `svg:rough`. */
    target: string;
    primitive: ScenePrimitive;
    feature: SceneFeature;
    operation: SceneOperation;
    realization: PrimitiveRealization;
    /** Human-readable proof, test name, or contract reference. */
    evidence?: string;
    /** Required explanation for an observable limitation. */
    diagnostic?: string;
}
/** Claim-keyed contract for the typed Scene -> terminal evidence adapter.
 * The projection preserves exact source semantics for family terminal
 * renderers and receipts; continuous visual fields remain explicitly lossy on
 * a character grid. */
declare function terminalConnectorCapabilityClaims(target?: `terminal:${string}`): readonly PrimitiveCapabilityClaim[];
interface CapabilityValidationResult {
    valid: boolean;
    diagnostics: readonly string[];
}
/** Validate one immutable per-call capability manifest. */
declare function validatePrimitiveCapabilities(claims: readonly PrimitiveCapabilityClaim[]): CapabilityValidationResult;

/** One canonical closed channel vocabulary shared by Scene types, family
 * descriptors, binding admission, generated census, and terminal projection. */
declare const SEMANTIC_CHANNEL_NAMES: readonly ["importance", "value", "category", "status", "progress", "route", "emphasis"];
type SemanticChannelName = typeof SEMANTIC_CHANNEL_NAMES[number];
/** Semantic channels preserved across the renderer boundary (SPEC §5).
 *  `tone`/hue are style-derived outputs, not stored here. */
interface SemanticChannels {
    /** Hierarchy / callout weight / star magnitude. */
    importance?: number;
    /** Chart value or quantitative measure (normalized where known). */
    value?: number;
    /** Chart series, entity type, swimlane, section identity. */
    category?: string;
    /** e.g. gantt 'done' | 'active' | 'crit'; state 'start' | 'end'. */
    status?: string;
    /** Task completion in [0,1]. */
    progress?: number;
    /** Transit route / PCB net identity. */
    route?: string;
    /** Author-flagged emphasis. */
    emphasis?: boolean;
}
/** Geometry a styled backend can redraw. Numbers are in final user units.
 *  Paint strings may be CSS var()/color-mix() refs — they resolve later via
 *  inlineResolvedColors, exactly like the default backend. */
type Geometry = {
    kind: 'rect';
    x: number;
    y: number;
    width: number;
    height: number;
    rx?: number;
    ry?: number;
} | {
    kind: 'circle';
    cx: number;
    cy: number;
    r: number;
} | {
    kind: 'ellipse';
    cx: number;
    cy: number;
    rx: number;
    ry: number;
} | {
    kind: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
} | {
    kind: 'polygon';
    points: Array<{
        x: number;
        y: number;
    }>;
} | {
    kind: 'polyline';
    points: Array<{
        x: number;
        y: number;
    }>;
} | {
    kind: 'path';
    d: string;
} | {
    kind: 'compound';
    children: Geometry[];
};
/** The resolved paint attached to a part — already cascaded (theme tokens,
 *  classDef, inline style, role defaults) by the family lowering. Internal
 *  scenes may reference a declared typed gradient through `url(#safe-id)`;
 *  arbitrary/external fetching paints remain forbidden. */
interface MarkPaint {
    fill?: string;
    fillOpacity?: string;
    stroke?: string;
    strokeOpacity?: string;
    strokeWidth?: string;
    strokeDasharray?: string;
    strokeDashoffset?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round';
    strokeMiterlimit?: string;
    vectorEffect?: 'none' | 'non-scaling-stroke';
    paintOrder?: string;
    opacity?: string;
}
type SceneTransform = {
    kind: 'rotate';
    angle: number;
    cx: number;
    cy: number;
}
/** SVG affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f. */
 | {
    kind: 'matrix';
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
};
/** Semantic subject whose artwork this part contributes. This is an authored
 * identity or an explicit family identity, never a guessed id-prefix parent. */
interface SceneOwner {
    id: string;
    role: SceneRole;
}
/** Inert attributes a family adds to a part's SVG element: CSS hook classes
 *  and `data-*` inspection metadata. The SVG writer emits them beside the
 *  attributes it derives from the typed fields; none of them can change what
 *  the part draws, so they are outside paint certification. */
interface MarkAttributes {
    /** Space-separated CSS class tokens (`[A-Za-z0-9_-]`). */
    className?: string;
    /** Emitted as `data-<key>`, in insertion order. Identity, relationship and
     *  marker keys belong to typed fields instead. */
    data?: Readonly<Record<string, string>>;
    /** Emitted as `aria-hidden="true"` on artwork with no accessible meaning. */
    ariaHidden?: true;
    /** Emitted as `tabindex="0"` on a part that carries a followable link. */
    tabIndex?: 0;
    /** Emitted as `aria-label` when the drawn text abbreviates or wraps the
     *  authored name. Relation parts take theirs from typed accessibility. */
    ariaLabel?: string;
}
interface SceneNodeBase {
    /** Stable identifier for seeding and cross-references. Derived from source
     *  semantics (node id, edge endpoints, slice label...), never list position
     *  (§8 seed contract). */
    id: string;
    role: SceneRole;
    /** Typed DOM identity mirrored as data-id/data-role on rendered SVG elements.
     * An owned shape may omit it only inside its matching semantic group. */
    identity?: SvgSemanticIdentity;
    /** Explicit subject, or the nearest enclosing semantic group's identity. */
    owner?: SceneOwner;
    /** Artwork shown only in an interactive state, such as a tooltip. */
    visibility?: 'conditional';
    /** Typed accessibility semantics mirrored into ARIA on relation parts. */
    accessibility?: SvgSemanticAccessibility;
    channels?: SemanticChannels;
    /** Semantic geometry transform applied by every backend. */
    transform?: SceneTransform;
    /** Inert SVG hooks; see MarkAttributes. */
    attributes?: MarkAttributes;
}
/** A self-contained raster viewport. Pixel availability/alpha are not paint facts. */
interface ImageMark extends SceneNodeBase {
    kind: 'image';
    href: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fit: 'contain' | 'stretch';
}
interface ShapeMark extends SceneNodeBase {
    kind: 'shape';
    geometry: Geometry;
    paint: MarkPaint;
    /** Paint of each child of compound geometry, in order, when the pieces of
     *  one outline differ (a cylinder's body and caps). Defaults to `paint`. */
    childPaints?: readonly MarkPaint[];
    /** Alternate ink admitted for a declared interactive state. */
    conditionalPaint?: MarkPaint;
    /** Internal fill-only piece of an outlined surface. Sketch fill policies still
     * apply to its default surface color after the outline is separated. */
    surfaceFragment?: boolean;
}
interface ScenePoint {
    x: number;
    y: number;
}
interface SceneBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
type MarkerShape = 'arrow' | 'open-arrow' | 'circle' | 'cross' | 'triangle' | 'diamond' | 'diamond-open';
/** Complete marker resource description. Existing family renderers need only
 * id/shape; extension renderers can provide geometry and bounds without
 * requiring a backend to inspect SVG defs. */
interface MarkerDescriptor {
    /** Def id referenced via url(#...) — 'arrowhead', 'cls-inherit', ... */
    id: string;
    /** Marker archetype so styled backends can redraw without parsing defs. */
    shape: MarkerShape;
    geometry?: Geometry;
    /** Marker viewport emitted as markerWidth/markerHeight. */
    size?: {
        width: number;
        height: number;
    };
    viewBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    ref?: ScenePoint;
    bounds?: SceneBox;
    units?: 'strokeWidth' | 'userSpaceOnUse';
    orient?: 'auto' | 'auto-start-reverse' | number;
    overflow?: 'hidden' | 'visible';
    paint?: MarkPaint;
    /** Scalar relative to marker units; used for conservative bounds. */
    scale?: number;
}
/** A safe same-document SVG linear gradient. Parts reference this paint through
 * `url(#id)`; the descriptor, not raw `<defs>` markup, remains the resource
 * authority for validation and backend serialization. */
interface LinearGradientDescriptor {
    id: string;
    units: 'userSpaceOnUse' | 'objectBoundingBox';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stops: readonly {
        offset: number;
        color: string;
        opacity?: number;
    }[];
}
/** One continuous path contour. `closed` is semantic topology: callers must
 * not infer it from a repeated endpoint or reparse SVG `d`. */
interface ConnectorSubpath {
    points: Array<ScenePoint>;
    closed: boolean;
}
type ConnectorGeometry = {
    kind: 'polyline';
    points: Array<ScenePoint>;
}
/** Curved path plus its deterministic routed polyline projection. Requiring
 * points keeps bounds, hit-testing, tangents and terminal projection total
 * without asking consumers to reparse SVG path data. Multiple SVG subpaths
 * require explicit contour boundaries so backends never draw across `M`. */
 | {
    kind: 'path';
    d: string;
    points: Array<ScenePoint>;
    subpaths?: Array<ConnectorSubpath>;
    /** Exact SVG marker-mid vertices in document order. Routed points may
     * include curve controls or sampling points, so they are never treated
     * as marker vertices for path geometry. */
    markerMidpoints?: Array<ScenePoint>;
} | {
    kind: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};
type ConnectorDirection = 'forward' | 'reverse' | 'bidirectional' | 'undirected' | 'self';
interface ConnectorEndpointAnchor {
    /** Semantic node/entity identifier. */
    id?: string;
    /** Typed endpoint subject when authored IDs occur in more than one role. */
    owner?: SceneOwner;
    /** Optional family-owned port/terminal identifier. */
    portId?: string;
    /** Routed endpoint in final user units. */
    point?: ScenePoint;
}
interface ConnectorEndpoints {
    from?: string;
    to?: string;
    start?: ConnectorEndpointAnchor;
    end?: ConnectorEndpointAnchor;
}
interface ConnectorRelationship {
    /** Family vocabulary, e.g. dependency, inheritance, parent, message. */
    kind: string;
    direction: ConnectorDirection;
}
interface ConnectorRoute {
    geometry: ConnectorGeometry;
    ownership: 'authored' | 'layout' | 'family' | 'projected';
    closed: boolean;
    bendRadius: number;
    /** Per-contour endpoint semantics. Multi-subpath connectors must not
     * collapse marker anchors or tangents into one overall start/end pair. */
    contours: readonly ConnectorContourSemantics[];
    startTangent?: ScenePoint;
    endTangent?: ScenePoint;
    labelAnchors: readonly ScenePoint[];
}
interface ConnectorContourSemantics {
    start: ScenePoint;
    end: ScenePoint;
    closed: boolean;
    startTangent?: ScenePoint;
    endTangent?: ScenePoint;
}
interface ConnectorDash {
    array: string | readonly number[];
    offset?: string | number;
}
interface ConnectorStroke {
    color: string;
    width: string | number;
    opacity?: string | number;
    dash?: ConnectorDash;
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round';
    miterLimit: number;
    pathLength?: number;
    paintOrder?: string;
    mixBlendMode?: 'normal' | 'multiply';
    nonScaling: boolean;
    /** The width is the data (a sankey flow's quantity), so every backend draws
     * it exactly as given and never scales it by a look's pen width. */
    encodesValue?: boolean;
}
interface ConnectorLabelDescriptor {
    id?: string;
    text: string;
    textContent?: LabelContent;
    anchor?: ScenePoint;
    bounds?: SceneBox;
    halo?: {
        color?: string;
        width: number;
    };
    clearance?: number;
    /** Resolved visual styling when the connector owns its label artwork. */
    paint?: MarkPaint;
    fontSize?: number;
    /** Internal typography. External Scene v1 retains its fixed literal policy. */
    fontWeight?: number;
    letterSpacing?: number;
    display?: LabelDisplay;
    block?: PixelTextBlock;
    textAnchor?: 'start' | 'middle' | 'end';
    /** `inline` is serialized by the connector constructor; `companion`
     * records the separately emitted TextMark that owns the artwork. */
    visual?: {
        kind: 'inline';
    } | {
        kind: 'companion';
        markId: string;
    };
}
interface ConnectorHitGeometry {
    geometry: ConnectorGeometry;
    /** Closes the single contour when geometry has no subpaths. */
    closed: boolean;
    strokeWidth: number;
    pointerEvents: 'stroke' | 'none';
}
type ConnectorTerminalStrokeLoss = 'continuous-geometry' | 'bend-radius' | 'stroke-width' | 'stroke-opacity' | 'stroke-cap' | 'stroke-join' | 'stroke-miter' | 'dash-pattern' | 'dash-offset' | 'path-length' | 'paint-order' | 'gradient-paint' | 'mix-blend-mode' | 'non-scaling-stroke';
type ConnectorTerminalMarkerProjection = Readonly<MarkerDescriptor>;
interface ConnectorTerminalMarkerPlacement {
    readonly markerId: string;
    readonly point: ScenePoint;
    readonly contourIndex: number;
}
interface ConnectorTerminalLabelProjection {
    readonly id?: string;
    readonly text: string;
    readonly textContent?: LabelContent;
    readonly anchor?: ScenePoint;
    readonly bounds?: SceneBox;
    readonly halo?: {
        readonly color?: string;
        readonly width: number;
    };
    readonly clearance?: number;
    readonly paint?: MarkPaint;
    readonly fontSize?: number;
    readonly textAnchor?: 'start' | 'middle' | 'end';
    readonly visual?: {
        readonly kind: 'inline';
    } | {
        readonly kind: 'companion';
        readonly markId: string;
    };
}
interface ConnectorTerminalProjection {
    realization: PrimitiveRealization;
    topology: 'line' | 'polyline' | 'path';
    geometry: ConnectorGeometry;
    direction: ConnectorDirection;
    relationship: string;
    markers: {
        start?: ConnectorTerminalMarkerProjection;
        mid: readonly ConnectorTerminalMarkerProjection[];
        end?: ConnectorTerminalMarkerProjection;
    };
    /** Actual SVG attachment sites. Start/end repeat for every subpath. */
    markerPlacements: {
        start: readonly ConnectorTerminalMarkerPlacement[];
        mid: readonly ConnectorTerminalMarkerPlacement[];
        end: readonly ConnectorTerminalMarkerPlacement[];
    };
    endpoints: ConnectorEndpoints;
    route: Omit<ConnectorRoute, 'geometry'>;
    stroke: ConnectorStroke;
    hit: ConnectorHitGeometry;
    transform?: SceneTransform;
    labels: readonly ConnectorTerminalLabelProjection[];
    lineStyle: ConnectorMark['lineStyle'];
    strokeLosses: readonly ConnectorTerminalStrokeLoss[];
    diagnostics: readonly string[];
}
interface ConnectorMark extends SceneNodeBase {
    kind: 'connector';
    lineStyle: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible';
    endpoints: ConnectorEndpoints;
    relationship: ConnectorRelationship;
    route: ConnectorRoute;
    stroke: ConnectorStroke;
    markers: {
        start?: MarkerDescriptor;
        mid: readonly MarkerDescriptor[];
        end?: MarkerDescriptor;
    };
    labels: readonly ConnectorLabelDescriptor[];
    hit: ConnectorHitGeometry;
    terminalProjection: ConnectorTerminalProjection;
}
interface TextMark extends SceneNodeBase {
    kind: 'text';
    /** Unescaped source text (may contain <br> separators for multiline). */
    text: string;
    /** Anchor position the crisp emitter used. */
    x: number;
    y: number;
    fontSize: number;
    fontWeight?: number;
    letterSpacing?: number;
    display?: LabelDisplay;
    prepared?: boolean;
    /** Fitted runs retained for text fidelity and existing consumers. */
    preparedLines?: readonly (readonly DisplayRun[])[];
    /** Exact family-prepared text, including source, typography and measured geometry. */
    block?: PixelTextBlock;
    /** Whether layout retained the block or the constructor prepared fallback metrics. */
    measurement?: 'prepared' | 'fallback';
    /** Occupied band and placement offset retained for existing consumers. */
    textLayout?: {
        width: number;
        height: number;
        lineHeight: number;
        offsetY: number;
    };
    anchor: 'start' | 'middle' | 'end';
    /** First baseline below `y`, in ems; the writer emits it as `dy`. */
    baselineShift?: number;
    dominantBaseline?: 'middle' | 'central' | 'hanging';
    fontStyle?: 'italic';
    textDecoration?: 'underline' | 'line-through' | 'underline line-through';
    /** One-line text drawn as differently painted runs (syntax highlighting).
     *  Their concatenation is the displayed line. */
    spans?: readonly {
        text: string;
        fill: string;
    }[];
    paint: MarkPaint;
    /** Ink the family chose for this text on the page, when `paint.fill` was
     *  instead chosen against the data part the text sits on (a value label
     *  inside a bar). A backend that puts the glyphs back on the page, as the
     *  sketch looks do with their page-colored halo over hatched or washed
     *  fills, paints this ink so the label stays readable. */
    pageFill?: string;
}
/** A semantic wrapper (<g ...>...</g>) whose children are Scene parts (SceneNode).
 *  Serialization is reconstructed from open/close/children + per-child indent,
 *  so styled backends can restyle children while keeping wrapper semantics
 *  (classes, data-* attributes, ARIA). */
interface GroupMark extends SceneNodeBase {
    kind: 'group';
    /** Paint the wrapper cascades to its children: its opacity composites the
     *  whole group, its fill applies to children that set none. The open tag
     *  carries it; nothing else in `open` may paint. */
    paint?: Pick<MarkPaint, 'opacity' | 'fill'>;
    open: string;
    close: string;
    children: Array<{
        node: SceneNode;
        indent: number;
    }>;
    /** Joiner between open/children/close segments; '\n' everywhere today. */
    join: string;
}
/** One typed element in the ordered SVG document shell. */
interface DocumentMark extends SceneNodeBase {
    kind: 'document';
    element: 'open' | 'title' | 'description' | 'definitions' | 'content' | 'close';
    text?: string;
    domId?: string;
    /** Closed non-paint purpose, validated against the actual document elements.
     * Hidden or conditional artwork is not metadata. */
    nonPaint?: 'accessibility' | 'stylesheet' | 'interaction-metadata';
    /** Typed marker resources owned by the definitions part. Backends may
     * reserialize these without inspecting the private SVG definition string. */
    markerResources?: readonly MarkerDescriptor[];
    /** Typed, fragment-local paint resources. External URLs remain forbidden. */
    gradientResources?: readonly LinearGradientDescriptor[];
}
/** A Scene part. Existing *Mark names describe drawing parts, not source nodes. */
type SceneNode = ImageMark | ShapeMark | ConnectorMark | TextMark | GroupMark | DocumentMark;
/** The lowered document: an ordered flat list of top-level Scene parts. */
interface SceneDoc {
    family: string;
    width: number;
    height: number;
    colors: DiagramColors;
    transparent: boolean;
    parts: SceneNode[];
}

/** Lightweight compatibility-parser ownership, deliberately independent of
 * the complete family registry so direct graph-parser imports remain usable. */
declare function detectsFlowchartFamily(firstLine: string): boolean;
declare function detectsStateFamily(firstLine: string): boolean;
declare function detectsStateFamilyLoose(firstLine: string): boolean;

interface SourceEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/** Which lexer reads a family's authored lines. Flowchart lines are read by
 * the flowchart lexer (flowchart-lexer.ts), which the parser uses too; other
 * families keep the generic line scanner below. */
type SourceSpanGrammar = 'flowchart' | 'generic';

/** Configuration for ASCII rendering. */
interface AsciiConfig {
    /** Sanitized frontmatter title; family-native inline titles take precedence. */
    title?: string;
    /** Resolved display-cell wrapping budget; never applied to Mermaid source. */
    maxWidth?: number;
    targetWidth?: number;
    /** true = ASCII chars (+,-,|), false = Unicode box-drawing (┌,─,│). Default: false */
    useAscii: boolean;
    /** Horizontal spacing between nodes. Default: 5 */
    paddingX: number;
    /** Vertical spacing between nodes. Default: 5 */
    paddingY: number;
    /** Padding inside node boxes. Default: 1 */
    boxBorderPadding: number;
    /** Logical layout axis. Reverse directions are mirrored after routing. */
    graphDirection: 'LR' | 'TD';
    /** Mirror the completed logical grid on its main axis (RL over LR). */
    reverseDirection?: boolean;
}
/**
 * Theme colors for ASCII output — hex color strings.
 * Derived from the SVG theme system for visual consistency.
 */
interface AsciiTheme {
    /** Text color (node labels, edge labels) */
    fg: string;
    /** Box border color (node borders, subgraph borders) */
    border: string;
    /** Edge line color (paths between nodes) */
    line: string;
    /** Arrowhead color (▲▼◄► or ^v<>) */
    arrow: string;
    /** Theme accent color (optional, used by xycharts for series 0) */
    accent?: string;
    /** Background color (optional, used by xycharts for dark-mode-aware shading) */
    bg?: string;
    /** Corner character color (optional, defaults to line) */
    corner?: string;
    /** Junction character color (optional, defaults to border) */
    junction?: string;
}
/** Color mode for output. */
type ColorMode = 'none' | 'ansi16' | 'ansi256' | 'truecolor' | 'html';

declare const TERMINAL_STYLE_VERSION: 1;
type TerminalProjectionDiagnosticCode = 'TERMINAL_TEXT_COLLISION' | 'TERMINAL_ROUTE_OVERLAP' | 'TERMINAL_GEOMETRY_COLLISION' | 'TERMINAL_FAMILY_PROJECTION' | 'TERMINAL_OWNERSHIP_UNAVAILABLE' | 'TERMINAL_RADIUS_PROJECTED' | 'TERMINAL_TYPOGRAPHY_PROJECTED' | 'TERMINAL_ELEVATION_PROJECTED' | 'TERMINAL_STROKE_CHARACTER_PROJECTED' | 'TERMINAL_FILL_PROJECTED' | 'TERMINAL_ROLE_PAINT_PROJECTED' | 'TERMINAL_ROLE_CUE_PROJECTED' | 'TERMINAL_RENDER_OPTION_PROJECTED' | 'TERMINAL_RENDER_OPTION_NOT_APPLICABLE' | 'TERMINAL_UNSAFE_COLOR_REJECTED' | 'TERMINAL_COLOR_UNREPRESENTABLE' | 'TERMINAL_CONNECTOR_PROJECTED' | 'TERMINAL_CONNECTOR_UNSUPPORTED' | 'TERMINAL_CONNECTOR_DECLARED_LIMITATION' | 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE' | 'TERMINAL_CONTROL_CHARACTERS_REPLACED';
interface TerminalProjectionDiagnostic {
    code: TerminalProjectionDiagnosticCode;
    feature: string;
    message: string;
    /** Optional zero-based cell in the final composed terminal drawing. */
    cell?: {
        column: number;
        row: number;
    };
}
interface ResolvedTerminalStyle {
    readonly version: typeof TERMINAL_STYLE_VERSION;
    readonly colorMode: ColorMode;
    readonly theme: Readonly<AsciiTheme>;
    readonly diagnostics: readonly TerminalProjectionDiagnostic[];
    /** No-color keeps categories/status through labels, glyphs and line styles. */
    readonly semanticFallbacks: readonly ['labels', 'symbols', 'markers', 'line-patterns'];
    readonly connectorProjection: TerminalConnectorProjectionReceipt;
    readonly digest: string;
}
interface TerminalConnectorProjectionReceipt {
    readonly evidence: 'scene' | 'unavailable' | 'not-evaluated';
    readonly count: number;
    readonly topologies: Readonly<Record<'line' | 'polyline' | 'path', number>>;
    readonly realizations: Readonly<Record<string, number>>;
    readonly relationships: readonly string[];
    readonly directions: readonly ConnectorMark['relationship']['direction'][];
    readonly markerPositions: Readonly<{
        start: number;
        mid: number;
        end: number;
    }>;
    readonly labelCount: number;
    /** Typed semantic projection supplied to the family terminal renderer. */
    readonly connectors: readonly TerminalConnectorProjection[];
    readonly capabilities: readonly PrimitiveCapabilityClaim[];
    readonly digest: string;
}
interface TerminalConnectorProjection extends ConnectorTerminalProjection {
    readonly id: string;
    readonly role: SceneRole;
}
interface TerminalProjectionSecurityContext {
    /** User-derived C0/C1 controls replaced before terminal layout/emission. */
    readonly controlsReplaced?: boolean;
    /** Optional graphical connector projection failed; terminal rendering remains independent. */
    readonly connectorProjectionFailed?: boolean;
}

type TerminalCertificationStatus = 'passed' | 'failed' | 'unverified';
interface TerminalLayoutCertificationIssue {
    readonly code: string;
    readonly status: Exclude<TerminalCertificationStatus, 'passed'>;
    readonly message: string;
    readonly elementId?: string;
    readonly cell?: Readonly<{
        column: number;
        row: number;
    }>;
}
interface TerminalLayoutCertification {
    readonly version: 1;
    readonly unit: 'cell';
    readonly scope: 'terminal-cells';
    readonly status: TerminalCertificationStatus;
    /** Digest of the exact encoded text returned to this caller, not source/model data. */
    readonly outputDigest?: string;
    readonly bounds?: Readonly<{
        width: number;
        height: number;
    }>;
    readonly coverage: Readonly<{
        cells: number;
        graphemes: number;
        ownedCells: number;
        unownedCells: number;
        textAllocations: number;
        textClusters: number;
        identities: number;
        ports: number;
        markerContracts: number;
    }>;
    readonly budget: Readonly<{
        operations: number;
        maxOperations: number;
        outputCodeUnits: number;
        maxOutputCodeUnits: number;
        exhausted: boolean;
        issuesTruncated: boolean;
        projectionsTruncated: boolean;
    }>;
    readonly issues: readonly TerminalLayoutCertificationIssue[];
    /** Native representation choices are reported separately from cell-layout correctness. */
    readonly projections: readonly Readonly<{
        feature: string;
        message: string;
    }>[];
    readonly limitations: readonly string[];
}

/** Versioned, deterministic capability negotiation for hosts and receipts. */
declare const CAPABILITY_NEGOTIATION_VERSION: 1;
type CapabilityId = `${string}:${string}`;
type CapabilityRequirementLevel = 'required' | 'preferred' | 'optional';
interface CapabilityOffer {
    id: CapabilityId;
    version: string;
}
interface CapabilityRequirement {
    id: CapabilityId;
    range: string;
    level: CapabilityRequirementLevel;
}
interface CapabilityResolution {
    id: CapabilityId;
    range: string;
    level: CapabilityRequirementLevel;
    status: 'selected' | 'unsupported' | 'incompatible';
    version?: string;
}
interface CapabilityDecision {
    version: typeof CAPABILITY_NEGOTIATION_VERSION;
    accepted: boolean;
    resolutions: readonly CapabilityResolution[];
}
interface SemVer {
    major: string;
    minor: string;
    patch: string;
    prerelease?: string;
}
declare function parseSemVer(value: string): SemVer | undefined;
/** Deliberately small public range language: exact, ^, ~, >=, major.x, or *. */
declare function semVerSatisfies(version: string, range: string): boolean;
declare function negotiateCapabilities(offers: readonly CapabilityOffer[], requirements: readonly CapabilityRequirement[]): CapabilityDecision;
/** Built-in waist offers. Output and Scene support are tuple-specific: they
 * are offered by execution planning only after the selected family/hooks and
 * backend form a complete path. Unknown optional requirements are grease by
 * design. */
declare const CORE_CAPABILITY_OFFERS: readonly CapabilityOffer[];
/** Public compatibility negotiation over the nominal render waist. Runtime
 * execution uses negotiateRenderCapabilityTuple() with proved hooks/backend. */
declare function negotiateRenderCapabilities(output: string, family?: CapabilityOffer): CapabilityDecision;

declare const OUTPUT_SECURITY_POLICY_VERSION: 2;
type OutputSecurityMode = 'default' | 'strict';
interface OutputSecurityDiagnostic {
    code: 'EXTERNAL_REFERENCE' | 'ACTIVE_CONTENT';
    reference: string;
}
interface OutputSecurityResult {
    svg: string;
    diagnostics: readonly OutputSecurityDiagnostic[];
}
/** Dependency-free XML well-formedness gate shared by backend
 * admission and every final SVG result. It deliberately accepts only the
 * bounded XML subset an SVG serializer needs: one paired `<svg>` root,
 * quoted attributes, no DTD/processing instructions, balanced tags, valid
 * characters/references, and no duplicate attributes. */
declare function verifySvgDocumentEnvelope(svg: string, work?: (operations: number) => boolean): boolean;
declare function verifyNoExternalRefs(svg: string): {
    ok: boolean;
    refs: string[];
};
/** Public boundary always examines arbitrary supplied SVG bytes. */
declare function applyOutputSecurityPolicy(svg: string, mode?: OutputSecurityMode): OutputSecurityResult;

/** Closed first-party output vocabulary shared by render and negotiation. */
declare const RENDER_OUTPUTS: readonly ["svg", "png", "ascii", "unicode", "html", "layout"];
type RenderOutput = typeof RENDER_OUTPUTS[number];

interface LayoutOptimizationEvidence {
    readonly additionalProducerLimit: number;
    readonly additionalProducerCalls: number;
    readonly primaryProducerCalls: number;
    readonly alternativesAttempted: number;
    readonly selected: readonly string[];
}

declare const RENDER_CONTRACT_VERSION: 2;
type RenderTransportAvailability = 'direct' | 'projected' | 'indirect' | 'unavailable';
interface RenderTransportClaim<A extends RenderTransportAvailability = RenderTransportAvailability> {
    readonly availability: A;
    /** Concrete public entry point, or `none` when the product does not expose the output. */
    readonly entrypoint: string;
    /** Option/value or route that selects this logical output when an entry point is shared. */
    readonly selector?: string;
    readonly reason?: string;
    /** Repository paths that prove this particular product/output cell. */
    readonly evidence: readonly string[];
}
type LibraryRenderTransport = RenderTransportClaim<'direct' | 'projected'>;
type CliRenderTransport = (RenderTransportClaim<'direct'> & {
    /** Canonical public CLI spelling. */
    readonly format: string;
    readonly order: number;
    readonly help: string;
    readonly default?: true;
}) | RenderTransportClaim<'unavailable'>;
type CodeModeRenderTransport = (RenderTransportClaim<'direct' | 'projected'> & {
    readonly method: string;
    readonly optionsType: 'SvgRenderOptions' | 'AsciiRenderOptions' | 'LayoutRenderOptions';
    readonly returnType: 'RenderedSvg' | 'RenderedAscii' | 'RenderedLayoutArtifact';
}) | RenderTransportClaim<'unavailable'>;
type ProductRenderTransport = RenderTransportClaim;
interface RenderOutputTransports {
    readonly library: LibraryRenderTransport;
    readonly cli: CliRenderTransport;
    readonly codeMode: CodeModeRenderTransport;
    readonly localMcp: ProductRenderTransport;
    readonly hostedMcp: ProductRenderTransport;
    readonly editor: ProductRenderTransport;
    readonly website: ProductRenderTransport;
}
interface RenderOutputDescriptor {
    readonly id: RenderOutput;
    /** Public means at least one documented public transport can produce it. */
    readonly availability: 'public' | 'internal' | 'reserved';
    readonly security: 'enforced' | 'not-applicable' | 'reserved';
    readonly color: 'srgb' | 'terminal-projected' | 'not-applicable' | 'reserved';
    readonly terminal: 'projected' | 'not-applicable' | 'reserved';
    readonly transports: RenderOutputTransports;
    readonly evidence: readonly string[];
}
declare const RENDER_OUTPUT_DESCRIPTORS: readonly RenderOutputDescriptor[];

declare const SHARED_RENDER_OPTION_FIELD_DESCRIPTORS: {
    readonly fontMetrics: {
        readonly typeScript: "'estimate' | 'bundled-inter'";
        readonly description: "Optional pinned Inter ASCII advances and pair corrections. Does not load fonts; unsupported runs retain estimates.";
        readonly defaultLabel: "`estimate`";
        readonly validationExpectation: "be estimate or bundled-inter";
        readonly schema: {
            readonly type: "string";
            readonly enum: readonly ["estimate", "bundled-inter"];
        };
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal cells do not use font advances";
    };
    readonly layoutHints: {
        readonly typeScript: "{ ranks?: Record<string, number>; adjacent?: string[][]; shortEdges?: string[] }";
        readonly description: "Relative ranks, sibling adjacency and short-edge preferences.";
        readonly defaultLabel: "unset";
        readonly validationExpectation: "contain integer ranks, node groups and edge IDs";
        readonly schema: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly ranks: {
                    readonly type: "object";
                    readonly additionalProperties: {
                        readonly type: "integer";
                        readonly minimum: 0;
                        readonly maximum: 10000;
                    };
                };
                readonly adjacent: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "array";
                        readonly minItems: 2;
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly shortEdges: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly terminal: "not-applicable";
        readonly terminalNote: "not used by terminals";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "usecase", "swimlane", "agentflow"];
    };
    readonly graphLayout: {
        readonly typeScript: "{ backend: 'elk' | 'agentic'; fallback?: 'none' | 'elk'; quality?: 'balanced'; viewport?: { width: number; height: number } }";
        readonly description: "Graph geometry producer with explicit ELK fallback.";
        readonly defaultLabel: "`elk`, no fallback";
        readonly validationExpectation: "be a graph layout selection object";
        readonly schema: {
            readonly anyOf: readonly [Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>];
        };
        readonly terminal: "projected";
        readonly terminalNote: "selects pixel placement and optional graphical companion evidence, not terminal-cell placement";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "architecture", "class", "er", "requirement"];
    };
    readonly layoutSafety: {
        readonly typeScript: "'report' | 'strict'";
        readonly description: "Report bounded layout evidence, still drawing a layout that fails certification only on drawable checks (verify then fails), or require a passed final certificate. Strict mode rejects missing, unverified or failed evidence.";
        readonly defaultLabel: "`report`";
        readonly validationExpectation: "be report or strict";
        readonly schema: {
            readonly type: "string";
            readonly enum: readonly ["report", "strict"];
            readonly default: "report";
            readonly description: "Require a passed final native layout certificate.";
        };
        readonly terminal: "consumed";
    };
    readonly bg: {
        readonly typeScript: "string";
        readonly description: "Background color or CSS variable.";
        readonly defaultLabel: "`#FFFFFF`";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
    };
    readonly fg: {
        readonly typeScript: "string";
        readonly description: "Primary foreground and text color.";
        readonly defaultLabel: "`#27272A`";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
    };
    readonly line: {
        readonly typeScript: "string";
        readonly description: "Connector and secondary-line color.";
        readonly defaultLabel: "derived";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
    };
    readonly accent: {
        readonly typeScript: "string";
        readonly description: "Arrowhead, highlight, and data accent color.";
        readonly defaultLabel: "derived";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
    };
    readonly muted: {
        readonly typeScript: "string";
        readonly description: "Secondary text and label color.";
        readonly defaultLabel: "derived";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "terminal themes have no dedicated muted-text role";
    };
    readonly surface: {
        readonly typeScript: "string";
        readonly description: "Node and group surface color.";
        readonly defaultLabel: "derived";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "terminal cells do not paint graphical surfaces";
    };
    readonly border: {
        readonly typeScript: "string";
        readonly description: "Node and group border color.";
        readonly defaultLabel: "derived";
        readonly validationExpectation: "be a safe non-fetching CSS paint";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
    };
    readonly font: {
        readonly typeScript: "string";
        readonly description: "CSS font family or stack.";
        readonly defaultLabel: "`Inter`";
        readonly validationExpectation: "be a safe non-fetching CSS font family or stack";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "the host terminal owns the font face";
    };
    readonly style: {
        readonly typeScript: "StyleInput | StyleInput[]";
        readonly description: "Registered Style/Palette name, inline StyleSpec, or left-to-right stack.";
        readonly defaultLabel: "`crisp`";
        readonly validationExpectation: "be a registered Style name or StyleSpec, or an array of them";
        readonly schema: {
            readonly anyOf: readonly [{
                readonly anyOf: readonly [{
                    readonly type: "string";
                    readonly description: "Registered Style or Palette name.";
                }, {
                    readonly $ref: "#/$defs/styleSpec";
                }];
                readonly 'x-agentic-mermaid-validation-expectation': "a registered Style name or StyleSpec";
            }, {
                readonly type: "array";
                readonly items: {
                    readonly anyOf: readonly [{
                        readonly type: "string";
                        readonly description: "Registered Style or Palette name.";
                    }, {
                        readonly $ref: "#/$defs/styleSpec";
                    }];
                    readonly 'x-agentic-mermaid-validation-expectation': "a registered Style name or StyleSpec";
                };
                readonly description: "Style stack merged from left to right.";
            }];
            readonly description: "A registered name, inline StyleSpec, or left-to-right stack of either.";
            readonly 'x-agentic-mermaid-runtime-validator': "styleInput";
        };
        readonly terminal: "consumed";
    };
    readonly padding: {
        readonly typeScript: "number";
        readonly description: "Canvas padding in SVG user units.";
        readonly defaultLabel: "`40`";
        readonly validationExpectation: "be a non-negative finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal output uses paddingX, paddingY, and boxBorderPadding";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "architecture", "c4", "requirement", "block", "packet", "kanban", "eventmodeling", "usecase", "wardley", "cynefin", "swimlane", "agentflow"];
    };
    readonly nodeSpacing: {
        readonly typeScript: "number";
        readonly description: "Horizontal spacing between sibling nodes.";
        readonly defaultLabel: "`24`";
        readonly validationExpectation: "be a non-negative finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout has a cell-grid spacing contract";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "class", "er", "architecture", "c4", "eventmodeling", "swimlane"];
    };
    readonly layerSpacing: {
        readonly typeScript: "number";
        readonly description: "Vertical spacing between graph layers.";
        readonly defaultLabel: "`40`";
        readonly validationExpectation: "be a non-negative finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout has a cell-grid spacing contract";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "class", "er", "architecture", "c4", "requirement", "usecase", "agentflow"];
    };
    readonly wrappingWidth: {
        readonly typeScript: "number";
        readonly description: "Flowchart measured-label wrapping budget in pixels.";
        readonly defaultLabel: "unset";
        readonly validationExpectation: "be a positive finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal output uses maxWidth or targetWidth";
        readonly applicableBuiltinFamilies: readonly ["flowchart"];
    };
    readonly componentSpacing: {
        readonly typeScript: "number";
        readonly description: "Spacing between disconnected graph components for compatible extension families; no built-in family currently consumes it.";
        readonly defaultLabel: "extension-defined";
        readonly validationExpectation: "be a non-negative finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout has a cell-grid spacing contract";
        readonly applicableBuiltinFamilies: readonly [];
    };
    readonly transparent: {
        readonly typeScript: "boolean";
        readonly description: "Omit the painted SVG canvas background.";
        readonly defaultLabel: "`false`";
        readonly validationExpectation: "be a boolean";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "terminal output has no painted canvas background";
    };
    readonly interactive: {
        readonly typeScript: "boolean";
        readonly description: "Enable hover tooltips for supported chart data points.";
        readonly defaultLabel: "`false`";
        readonly validationExpectation: "be a boolean";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "terminal output is a static semantic projection";
        readonly applicableBuiltinFamilies: readonly ["xychart", "pie", "quadrant"];
    };
    readonly shadow: {
        readonly typeScript: "boolean";
        readonly description: "Paint explicit drop shadows on node shapes.";
        readonly defaultLabel: "`false`";
        readonly validationExpectation: "be a boolean";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "projected";
        readonly terminalNote: "elevation projects to borders and labels";
        readonly applicableBuiltinFamilies: readonly ["flowchart", "state", "sequence", "timeline", "class", "er", "journey", "sankey", "c4", "zenuml", "swimlane", "agentflow"];
    };
    readonly class: {
        readonly typeScript: "{ hierarchicalNamespaces?: boolean }";
        readonly description: "Class-diagram rendering controls.";
        readonly defaultLabel: "`hierarchicalNamespaces: true`";
        readonly validationExpectation: "be a class options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "this option configures graphical class layout";
        readonly applicableBuiltinFamilies: readonly ["class"];
    };
    readonly kanban: {
        readonly typeScript: "{ maxWidth?: number }";
        readonly description: "Opt-in Kanban column wrapping with readable column widths.";
        readonly defaultLabel: "`maxWidth`: unset";
        readonly validationExpectation: "be a kanban options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout uses its own targetWidth";
        readonly applicableBuiltinFamilies: readonly ["kanban"];
    };
    readonly pie: {
        readonly typeScript: "{ maxWidth?: number }";
        readonly description: "Opt-in Pie title and legend fitting without shrinking typography.";
        readonly defaultLabel: "`maxWidth`: unset";
        readonly validationExpectation: "be a pie options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout uses its own targetWidth";
        readonly applicableBuiltinFamilies: readonly ["pie"];
    };
    readonly radar: {
        readonly typeScript: "{ maxWidth?: number }";
        readonly description: "Opt-in Radar plot and legend fitting without shrinking typography.";
        readonly defaultLabel: "`maxWidth`: unset";
        readonly validationExpectation: "be a radar options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal layout uses its own targetWidth";
        readonly applicableBuiltinFamilies: readonly ["radar"];
    };
    readonly architecture: {
        readonly typeScript: "{ visual?: ArchitectureVisualOverrides }";
        readonly description: "Sparse architecture renderer visual metric and paint overrides.";
        readonly defaultLabel: "built-in metrics";
        readonly validationExpectation: "be an architecture options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "this option configures graphical architecture rendering";
        readonly applicableBuiltinFamilies: readonly ["architecture"];
    };
    readonly timeline: {
        readonly typeScript: "{ maxWidth?: number }";
        readonly description: "Timeline layout controls.";
        readonly defaultLabel: "`maxWidth`: unset";
        readonly validationExpectation: "be a timeline options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal output uses maxWidth or targetWidth";
        readonly applicableBuiltinFamilies: readonly ["timeline"];
    };
    readonly journey: {
        readonly typeScript: "{ experienceCurve?: boolean }";
        readonly description: "User-journey graphical controls.";
        readonly defaultLabel: "`experienceCurve: true`";
        readonly validationExpectation: "be a journey options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "experience curves are graphical-only";
        readonly applicableBuiltinFamilies: readonly ["journey"];
    };
    readonly gantt: {
        readonly typeScript: "{ dependencyArrows?: boolean; criticalPath?: boolean }";
        readonly description: "Gantt dependency and critical-path overlays.";
        readonly defaultLabel: "both `false`";
        readonly validationExpectation: "be a Gantt options object";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "graphical Gantt connector emphasis is not represented in cells";
        readonly applicableBuiltinFamilies: readonly ["gantt"];
    };
    readonly mermaidConfig: {
        readonly typeScript: "MermaidRuntimeConfig";
        readonly description: "Mermaid-style recursive runtime configuration.";
        readonly defaultLabel: "source config";
        readonly validationExpectation: "be a plain JSON object";
        readonly schema: {
            readonly type: "object";
            readonly description: "Mermaid-style recursive runtime configuration.";
            readonly additionalProperties: {
                readonly $ref: "#/$defs/jsonValue";
            };
        };
        readonly terminal: "consumed";
    };
    readonly embedFontImport: {
        readonly typeScript: "boolean";
        readonly description: "Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization.";
        readonly defaultLabel: "`false`";
        readonly validationExpectation: "be a boolean";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal output embeds no web-font import";
    };
    readonly compact: {
        readonly typeScript: "boolean";
        readonly description: "Compact SVG serialization while preserving agent hooks.";
        readonly defaultLabel: "`false`";
        readonly validationExpectation: "be a boolean";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "compact controls SVG serialization";
    };
    readonly idPrefix: {
        readonly typeScript: "string";
        readonly description: "Non-empty namespace for generated SVG definition IDs and local references.";
        readonly defaultLabel: "unset";
        readonly validationExpectation: "be non-empty and contain only ASCII letters, digits, underscore, hyphen, dot, and colon";
        readonly schema: {
            readonly pattern: "^[A-Za-z0-9_.:-]+$";
        };
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal output has no SVG definition ids";
    };
    readonly security: {
        readonly typeScript: "'default' | 'strict'";
        readonly description: "Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.";
        readonly defaultLabel: "`default`";
        readonly validationExpectation: "be default or strict";
        readonly schema: {
            readonly type: "string";
            readonly enum: readonly ["default", "strict"];
            readonly description: "Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.";
            readonly default: "default";
        };
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal text has its own control-character and HTML-color safety projection";
    };
    readonly ganttToday: {
        readonly typeScript: "string";
        readonly description: "Explicit deterministic date for the Gantt today marker.";
        readonly defaultLabel: "unset";
        readonly validationExpectation: "be a string";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "consumed";
        readonly applicableBuiltinFamilies: readonly ["gantt"];
    };
    readonly seed: {
        readonly typeScript: "number";
        readonly description: "Deterministic re-roll seed for stochastic Styles.";
        readonly defaultLabel: "`0`";
        readonly validationExpectation: "be a finite number";
        readonly schema: Readonly<Record<string, unknown>>;
        readonly terminal: "not-applicable";
        readonly terminalNote: "terminal glyph geometry is deterministic and has no stochastic ink";
    };
};
type SharedRenderOptionField = keyof typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS;
declare const SHARED_RENDER_OPTION_FIELDS: readonly SharedRenderOptionField[];
/** Shared fields whose effect depends on the selected family implementation. */
type FamilyScopedRenderOptionField = {
    [Field in SharedRenderOptionField]: (typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS)[Field] extends {
        readonly applicableBuiltinFamilies: readonly DiagramKind[];
    } ? Field : never;
}[SharedRenderOptionField];
/** Validate the shared advanced JSON object used by CLI/MCP/editor adapters. */
declare function validateSerializableRenderOptions(value: unknown): string[];
/** JSON Schema projection generated from the same field manifest. */
declare function sharedRenderOptionsJsonSchema(): Record<string, unknown>;
/** Public StyleInput projection reused by advanced and convenience adapters.
 * Self-contained: it carries the StyleSpec definitions its references name. */
declare function styleInputJsonSchema(description?: string): Record<string, unknown>;

interface RenderRequestReceipt {
    /** Actual graph geometry decisions, retained outside caller-owned metadata. */
    layoutDecisions?: readonly GraphLayoutDecision[];
    /** Bounded evidence from the actual pixel or terminal-cell projection. */
    layoutCertification?: PaintLayoutCertification | TerminalLayoutCertification;
    version: typeof RENDER_CONTRACT_VERSION;
    output: RenderOutput;
    sharedRequestDigest: string;
    requestDigest: string;
    appearanceDigest: string;
    capabilityDecision: CapabilityDecision;
    /** Request-resolution and output-policy decisions. */
    diagnostics?: readonly RenderArtifactDiagnostic[];
    /** Digest of the secured graphical projection emitted by this execution. */
    graphicalProjectionDigest?: string;
    /** Family/backend selected at execution, including trusted host policy. */
    executionDecision?: RenderExecutionDecision;
    /** Pixel metrics used by graphical outputs; contains no executable host inputs. */
    textMeasurement?: TextMeasurementProfileIdentity;
    /** Actual bounded optional layout work, separate from mandatory fallbacks. */
    layoutOptimization?: LayoutOptimizationEvidence;
}
interface RenderExecutionDecision {
    readonly family: {
        readonly id: string;
        readonly version: string;
    };
    readonly backend: {
        readonly mode: 'scene';
        readonly requestedId: string;
        readonly selectedId: string;
        readonly version: string;
        readonly hostPolicy: boolean;
    } | {
        readonly mode: 'family-svg';
    };
    readonly digest: string;
    readonly textMeasurement?: TextMeasurementProfileIdentity;
}
/** A ParsedDiagram serializer must reproduce source for that same family. */
declare class ParsedDiagramFamilyMismatchError extends Error {
    readonly expectedFamilyId: FamilyId;
    readonly detectedFamilyId: FamilyId;
    readonly name = "ParsedDiagramFamilyMismatchError";
    readonly code = "PARSED_DIAGRAM_FAMILY_MISMATCH";
    constructor(expectedFamilyId: FamilyId, detectedFamilyId: FamilyId);
}
/** Structured preflight failure for hosts that need more than an error string. */
declare class RenderCapabilityError extends Error {
    readonly name = "RenderCapabilityError";
    readonly code = "UNSATISFIED_RENDER_CAPABILITIES";
    readonly output: RenderOutput;
    readonly family: {
        readonly id: string;
        readonly version: string;
    };
    readonly decision: CapabilityDecision;
    constructor(message: string, output: RenderOutput, family: FamilyDescriptor, decision: CapabilityDecision);
    toJSON(): Record<string, unknown>;
}
interface RenderArtifactDiagnostic {
    readonly code: string;
    readonly message?: string;
    readonly reference?: string;
    readonly feature?: string;
}
declare function renderContractDigest(value: unknown): string;

/** Frozen source provenance for map builders; no runtime config authority. */
type FamilySourceMapContext = Readonly<Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource' | 'authoredWrapperLength' | 'cleanup'> & {
    /** Published canonical bytes before the legacy universal accessibility mask. */
    canonicalSource?: string;
}>;
interface ExtractedLabel {
    /** The label text, with quotes stripped. */
    text: string;
    /** Best-effort target identifier (node id, participant, period, etc.). */
    target: string;
}
interface FamilyLayoutContext extends ResolvedFamilyRenderContext {
    source: NormalizedMermaidSource;
}
interface FamilyLayoutResult<TPositioned extends PositionedDiagram = PositionedDiagram> {
    positioned: TPositioned;
    /** False when the family renderer already owns SVG accessibility metadata. */
    injectAccessibility?: boolean;
    /** Set by the positioning seam, never by a descriptor: report layout safety
     * drew geometry that failed certification only on drawable checks. */
    uncertifiedLayout?: UncertifiedLayoutReceipt;
}
/** Inputs available to a descriptor's one request-boundary normalizer. Public
 * source/options/style data remains serializable; the optional internal face is
 * an immutable, already-resolved view and cannot be returned as a new authority. */
interface FamilyRequestNormalizationContext {
    source: NormalizedMermaidSource;
    /** Options after shared security and Style defaults, before the final freeze. */
    renderOptions: RenderOptions;
    /** Shared palette resolved exactly once before family projection. */
    colors: Readonly<DiagramColors>;
    /** Resolved public Style stack, never a registry name or unresolved input. */
    style?: Readonly<StyleSpec>;
    /** Internal face paired with the resolved Style stack. */
    styleFace?: Readonly<InternalStyleFace>;
}
interface FamilyAppearanceNormalization {
    /** Sparse family-specific adjustment merged over the shared palette. */
    colors?: Readonly<Partial<DiagramColors>>;
    /** Serializable family-owned visual/config projection shared by layout and renderers. */
    family?: Readonly<Record<string, unknown>>;
}
interface FamilyRequestNormalizationResult {
    /** Geometry/config projection. It must remain a valid public RenderOptions object. */
    renderOptions?: RenderOptions;
    /** Serializable family configuration that has no public RenderOptions slot. */
    familyConfig?: Readonly<Record<string, unknown>>;
    /** Appearance projection, deliberately separate from geometry options. */
    appearance?: FamilyAppearanceNormalization;
}
/**
 * Public, family-neutral view of one already-positioned artifact. The family
 * id is deliberately supplied by the registry caller rather than repeated by
 * every projector, so namespaced extensions can implement this hook while the
 * public layout envelope records their registered family id.
 */
type FamilyPositionedView = Pick<RenderedLayout, 'version' | 'nodes' | 'edges' | 'groups' | 'labels' | 'certificates' | 'bounds'>;
interface FamilyPositionedProjectionOptions {
    /** Include route/containment proof sidecars when the family supports them. */
    debug?: boolean;
}
interface FamilyPositionedProjectionContext<TPositioned extends PositionedDiagram = PositionedDiagram> {
    /** The exact artifact produced by this descriptor's `layout` hook. */
    positioned: TPositioned;
    options: Readonly<FamilyPositionedProjectionOptions>;
}
interface AsciiContext extends ResolvedFamilyRenderContext {
    source: NormalizedMermaidSource;
    config: AsciiConfig;
    colorMode: ColorMode;
    theme: AsciiTheme;
    /** Connector semantics derived from the exact positioned Scene artifact.
     * Family terminal renderers receive this projection beside their source
     * view so output and receipts share one semantic contract. */
    connectorProjection: readonly TerminalConnectorProjection[];
    options: {
        maxWidth?: number;
        targetWidth?: number;
        ganttToday?: string;
    };
}
/** One normalized source envelope shared by every family parser. */
interface FamilyParseContext {
    source: NormalizedMermaidSource;
    /** Family grammar view: header included, universal accessibility removed. */
    lines: readonly string[];
    /** Full normalized logical lines for compatibility parsers that still model accessibility. */
    envelopeLines: readonly string[];
    /** Original post-wrapper body for lossless opaque preservation. */
    opaqueSource: string;
    meta: ValidDiagramMeta;
    canonicalSource: string;
}
type FamilyMaturity = 'stable' | 'beta' | 'experimental';
/** Capability columns are owned by the descriptor contract. Reports and
 * discovery surfaces project this vocabulary instead of maintaining a second
 * hook-inference table. */
declare const FAMILY_CAPABILITY_COLUMNS: readonly ["detection", "source-preservation", "parse", "serialize", "mutation", "verify", "layout", "scene", "svg", "terminal"];
/** Registration witnesses stay small enough to execute twice synchronously. */
declare const FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES: number;
type FamilyCapability = (typeof FAMILY_CAPABILITY_COLUMNS)[number];
type FamilyCapabilityState = 'native' | 'source-preserved' | 'diagnosed' | 'not-applicable' | 'absent';
declare const FAMILY_DESCRIPTOR_CONTRACT_VERSION: 2;
declare const FAMILY_CONFORMANCE_VERSION: 2;
/**
 * Canonical processing contract for a Mermaid family that is recognized by
 * the open parser but has no installed descriptor. The source envelope and
 * its serializer remain lossless; operations that require family semantics
 * fail through the preserved family diagnostic instead of disappearing from
 * discovery as an unaccounted `absent` capability.
 */
declare const UNREGISTERED_FAMILY_CAPABILITY_STATES: Readonly<{
    detection: "diagnosed";
    'source-preservation': "source-preserved";
    parse: "diagnosed";
    serialize: "source-preserved";
    mutation: "diagnosed";
    verify: "diagnosed";
    layout: "diagnosed";
    scene: "diagnosed";
    svg: "diagnosed";
    terminal: "diagnosed";
}>;
interface FamilyCapabilityEvidence {
    capability: FamilyCapability;
    state: FamilyCapabilityState;
    evidence: readonly string[];
}
/** Executable registration evidence is deliberately separate from a
 * descriptor's declaration. A descriptor says what it intends to support;
 * this report records what its bounded canonical example actually proved. */
type FamilyConformanceStatus = 'passed' | 'failed' | 'unverified-extension';
interface FamilyCapabilityConformanceResult {
    capability: FamilyCapability;
    declaredState: FamilyCapabilityState;
    status: FamilyConformanceStatus;
    /** Stable id for the canonical example witness, present for passed checks. */
    witnessId?: string;
    /** Required for failed and deliberately-unverified extension cells. */
    diagnostic?: string;
}
interface FamilyConformanceReport {
    readonly version: typeof FAMILY_CONFORMANCE_VERSION;
    readonly familyId: FamilyId;
    readonly example: string;
    readonly passed: boolean;
    readonly capabilities: readonly FamilyCapabilityConformanceResult[];
}
/** Thrown by registerFamily when a native claim has no witness. Declared beside
 * its report, so verify's error classification need not load registration. */
declare class FamilyConformanceError extends Error {
    readonly report: FamilyConformanceReport;
    constructor(report: FamilyConformanceReport);
}
type FamilyScenePrimitiveApplicability = 'applicable' | 'not-applicable';
/** One complete family-role/Scene-primitive contract cell. */
interface FamilyScenePrimitiveEvidence {
    role: SceneRole;
    primitive: CoreScenePrimitive;
    applicability: FamilyScenePrimitiveApplicability;
    /** `unsupported` is reserved for explicit not-applicable cells. */
    realization: PrimitiveRealization;
    evidence: readonly string[];
    /** Required for an explicit negative cell. */
    diagnostic?: string;
}
type FamilyScenePositivePrimitive = CoreScenePrimitive | Readonly<{
    primitive: CoreScenePrimitive;
    realization: Exclude<PrimitiveRealization, 'unsupported'>;
    diagnostic?: string;
}>;
/** Compact positive authority; `declareFamilyScenePrimitiveEvidence` derives
 * the complete matrix, including every explicit negative cell. */
interface FamilySceneRolePrimitiveDeclaration {
    role: SceneRole;
    primitives: readonly FamilyScenePositivePrimitive[];
}
declare function declareFamilyScenePrimitiveEvidence(familyId: string, declarations: readonly FamilySceneRolePrimitiveDeclaration[], evidence: readonly string[]): readonly FamilyScenePrimitiveEvidence[];
/** Descriptor-owned Mermaid config section contract. */
interface FamilyConfigContract {
    section: string;
    keys: readonly string[];
    noopKeys?: readonly string[];
}
interface FamilyOperations {
    /** Body-owned accessibility fields and their writer's text transport. The
     * shared envelope mirrors only bodies admitted by this family authority. */
    bodyAccessibility?: (body: DiagramBody) => {
        fields: {
            accessibilityTitle?: string;
            accessibilityDescription?: string;
        };
        syntax: 'statement' | 'native';
    } | undefined;
    /** Synchronize body-owned wrapper fields before save or mutation commit. */
    bodyMeta?: (body: DiagramBody, meta: ValidDiagramMeta, previousBody?: DiagramBody) => ValidDiagramMeta;
    /** Parsed rendering uses the family's source authority. Omission preserves
     * legacy extension behavior; family admission still validates the result. */
    renderSource?: (body: Readonly<FamilyParsedBody>) => 'canonical' | 'serialized';
    /** Preserve executable physical source where indentation is family grammar. */
    canonicalSource?: 'preserved';
    /** Diagnose one authored or explicit config root. Common dispatch preserves
     * root boundaries, deterministic ordering and duplicate suppression. */
    configDiagnostics?: (context: {
        root: unknown;
        config: FamilyConfigContract;
    }) => readonly ConfigDiagnostic[];
    /**
     * Normalize family config once at the canonical request boundary. Layout and
     * render hooks receive only the frozen result and must not re-read raw Style,
     * theme, or family option authorities.
     */
    normalizeRequest?: (ctx: FamilyRequestNormalizationContext) => FamilyRequestNormalizationResult | void;
    /**
     * Source-based label extractor for universal Tier 1 LABEL_OVERFLOW on opaque
     * bodies. Each descriptor should extract everything an agent would consider a
     * label — node text, edge text, message text, axis names, section titles.
     * The generic fallback (extractLabelsGeneric) is used when a family doesn't
     * provide its own.
     */
    extractLabels?: (source: string) => ExtractedLabel[];
    /**
     * For each source line, the last line of the family statement that starts
     * there: a quoted string may run onto later lines (see quotedTextEnds).
     * Source normalization reads no line inside a statement as a universal
     * accTitle/accDescr directive. Omission: each line is its own statement.
     */
    statementEnds?: (lines: readonly string[]) => readonly number[];
    /**
     * Family-specific structured parser. The context carries one normalized
     * source envelope: `lines` is the family grammar view (header included,
     * universal accessibility removed), `envelopeLines` retains those universal
     * lines, and `opaqueSource` is the original post-wrapper body for lossless
     * fallback. Structured-or-opaque
     * families return ok(structured ?? opaque); error-semantics families
     * (flowchart/state) return err(ParseError[]).
     */
    parse?: (ctx: FamilyParseContext) => Result<FamilyParsedBody, ParseError[]>;
    /**
     * Optional source-map builder, run after a successful parse. The frozen
     * provenance context preserves authored payloads and original source spans.
     */
    /** Grammar owned by the map producer for multiline authored statement spans. */
    sourceMapGrammar?: SourceSpanGrammar;
    buildSourceMap?: (body: DiagramBody, canonicalSource: string, source?: FamilySourceMapContext) => SourceMap;
    /** Optional: family-specific serializer. Public save/edit callers pass the
     * wrapper metadata so body-owned overrides need not duplicate its fields. */
    serialize?: (body: FamilyParsedBody, meta?: Readonly<ValidDiagramMeta>) => string;
    /** Optional: family-specific structured mutation. */
    mutate?: (body: DiagramBody, op: AnyMutationOp) => Result<DiagramBody, MutationError>;
    /** Optional source-preserving edit. Retain bytes outside owned edit ranges and
     * verify the complete native model against the requested semantic delta.
     * This does not grant canonical portability or structured-body admission. */
    mutateSource?: (source: string, op: AnyMutationOp) => Result<readonly SourceEdit[], MutationError>;
    /** Optional: family-specific verify (Tier 1 + Tier 2). Returns warnings only.
     * The hook alone does not make public verification native: verification also
     * consumes the family's executable SVG and positioned-layout projections. */
    verify?: (body: FamilyParsedBody, opts: VerifyOptions) => LayoutWarning[];
    /** Optional: family-specific source-to-positioned layout for graphical output.
     * Public layout JSON additionally requires projectPositioned. */
    layout?: (ctx: FamilyLayoutContext) => FamilyLayoutResult | PositionedDiagram;
    /**
     * Optional typed projection of that same positioned artifact for layout
     * JSON, verification, route certificates, and quality metrics. This is a
     * view, not a second layout path: implementations must not parse or lay out
     * source again.
     */
    projectPositioned?: (ctx: FamilyPositionedProjectionContext) => FamilyPositionedView;
    /** Optional extension fallback for descriptors that cannot lower SceneDoc.
     * Built-ins adapt one typed drawing program to Scene and native crisp output. */
    renderSvg?: (ctx: RenderContext<PositionedDiagram>) => string;
    /**
     * Optional: family-specific SceneGraph lowering (SPEC §3.1). Produces the
     * semantic render-mark tree that style backends consume. Styled and extension output
     * serialize through a registered backend; native crisp uses the same writers.
     */
    lowerScene?: (ctx: RenderContext<PositionedDiagram>) => SceneDoc;
    /** Optional: family-specific ASCII renderer. */
    renderAscii?: (ctx: AsciiContext) => string;
}
interface BuiltinFamilyMetadata {
    /** Built-in DiagramKind exposed by Agentic Mermaid. */
    id: DiagramKind;
    /** Human-facing family name used in docs and editor examples. */
    label: string;
    /** Mermaid headers routed to this family. */
    headers: readonly string[];
    /** SDK narrower advertised for structured mutation. */
    narrower: `as${string}`;
    /** Editor example category label. */
    editorDiagramType: string;
    /** User-facing editor example label and summary. */
    editorLabel: string;
    editorDescription: string;
    /** Stable id for the representative editor/comparison example. */
    editorExampleId: string;
    /** Short glyph used by the editor example picker. */
    editorGlyph: string;
    /** Representative source shared by the editor and website comparisons. */
    editorExample: string;
    /** Minimal conformance/discovery witness: correct header plus core syntax.
     *  This is intentionally smaller than `editorExample`. Exposed via
     *  `am capabilities` so agents learn each family's dialect from the
     *  discovery envelope instead of error-message trial-and-error (the
     *  onboarding probes burned most of their iterations on exactly this —
     *  architecture-beta headers, quadrant [x, y] brackets). A test pins
     *  every example to parse, verify, and render clean. */
    example: string;
}
interface FamilyDescriptor extends FamilyOperations {
    readonly contractVersion: typeof FAMILY_DESCRIPTOR_CONTRACT_VERSION;
    readonly identity: ExtensionIdentity<'family'>;
    readonly id: FamilyId;
    readonly upstreamId?: string;
    readonly label: string;
    /** Canonical authored headers owned by this descriptor. */
    readonly headers: readonly string[];
    /** Supported compatibility headers that are not upstream public-family claims. */
    readonly aliases: readonly string[];
    readonly maturity: FamilyMaturity;
    /** Higher priorities are consulted first; equal priorities sort by id. */
    readonly collisionPriority: number;
    /** Strict public-renderer detector over one normalized logical line. */
    readonly detect: (firstLineLower: string) => boolean;
    /** Agent parser detector for malformed-but-recognizable native headers. */
    readonly detectLoose?: (firstLineLower: string) => boolean;
    readonly config?: FamilyConfigContract;
    /** Family-scoped shared RenderOptions consumed by this implementation.
     * External families opt in explicitly; omission means none. Built-in
     * applicability remains derived from the canonical render-field manifest. */
    readonly applicableRenderOptions?: readonly FamilyScopedRenderOptionField[];
    readonly semanticRoles: readonly string[];
    /** Closed Scene channels this family may populate. Empty is explicit. */
    readonly semanticChannels: readonly SemanticChannelName[];
    /** Complete role x core-primitive matrix. Positive cells name their
     * realization; negative cells are explicit and diagnosed. */
    readonly scenePrimitiveEvidence: readonly FamilyScenePrimitiveEvidence[];
    readonly capabilityEvidence: readonly FamilyCapabilityEvidence[];
    readonly example: string;
}
declare const BUILTIN_FAMILY_DESCRIPTOR_SEEDS: readonly [{
    readonly id: "flowchart";
    readonly upstreamId: "flowchart-v2";
    readonly maturity: "stable";
    readonly label: "Flowchart";
    readonly headers: readonly ["flowchart", "graph"];
    readonly aliases: readonly ["swimlane"];
    readonly narrower: "asFlowchart";
    readonly editorDiagramType: "Flowchart";
    readonly editorLabel: "Flowchart";
    readonly editorDescription: "Decision flow with labeled branches.";
    readonly editorExampleId: "flowchart-basic";
    readonly editorGlyph: "F";
    readonly config: {
        readonly section: "flowchart";
        readonly keys: readonly ["nodeSpacing", "rankSpacing", "wrappingWidth", "titleTopMargin", "subGraphTitleMargin", "arrowMarkerAbsolute", "diagramPadding", "htmlLabels", "curve", "padding", "defaultRenderer", "inheritDir", "look", "minNodeWidth", "theme"];
        readonly noopKeys: readonly ["arrowMarkerAbsolute", "curve", "defaultRenderer", "diagramPadding", "htmlLabels", "inheritDir", "look", "minNodeWidth", "padding", "subGraphTitleMargin", "theme", "titleTopMargin"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: typeof detectsFlowchartFamily;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "flowchart TD\n  A[Start] --> B{Ship?}\n  B -->|yes| C[Deploy]\n  B -->|no| D[Fix]";
    readonly editorExample: "flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n  C --> E[End]\n  D --> E";
}, {
    readonly id: "state";
    readonly upstreamId: "stateDiagram";
    readonly maturity: "stable";
    readonly label: "State";
    readonly headers: readonly ["stateDiagram", "stateDiagram-v2"];
    readonly narrower: "asState";
    readonly editorDiagramType: "State";
    readonly editorLabel: "State diagram";
    readonly editorDescription: "Lifecycle using Mermaid stateDiagram-v2 syntax.";
    readonly editorExampleId: "state-basic";
    readonly editorGlyph: "S";
    readonly config: {
        readonly section: "state";
        readonly keys: readonly ["arrowMarkerAbsolute", "compositTitleSize", "defaultRenderer", "dividerMargin", "edgeLengthFactor", "fontSize", "fontSizeFactor", "forkHeight", "forkWidth", "labelHeight", "layout", "look", "miniPadding", "minNodeWidth", "nodeSpacing", "noteMargin", "padding", "radius", "rankSpacing", "sizeUnit", "textHeight", "theme", "titleShift", "titleTopMargin", "wrappingWidth"];
    };
    readonly semanticChannels: readonly ["status"];
    readonly detect: typeof detectsStateFamily;
    readonly detectLoose: typeof detectsStateFamilyLoose;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> [*] : approve";
    readonly editorExample: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: start\n  Processing --> Complete: done\n  Processing --> Failed: error\n  Failed --> Idle: retry\n  Complete --> [*]";
}, {
    readonly id: "sequence";
    readonly upstreamId: "sequence";
    readonly maturity: "stable";
    readonly label: "Sequence";
    readonly headers: readonly ["sequenceDiagram"];
    readonly narrower: "asSequence";
    readonly editorDiagramType: "Sequence";
    readonly editorLabel: "Sequence";
    readonly editorDescription: "Request/response messages between participants.";
    readonly editorExampleId: "sequence-basic";
    readonly editorGlyph: "Q";
    readonly config: {
        readonly section: "sequence";
        readonly keys: readonly ["actorMargin", "width", "height", "diagramMarginX", "diagramMarginY", "messageMargin", "noteMargin", "activationWidth", "showSequenceNumbers", "boxMargin", "boxTextMargin", "messageAlign", "mirrorActors", "bottomMarginAdj", "rightAngles", "wrap", "wrapPadding", "labelBoxWidth", "labelBoxHeight", "hideUnusedParticipants", "forceMenus", "arrowMarkerAbsolute", "noteAlign", "actorFontSize", "actorFontFamily", "actorFontWeight", "noteFontSize", "noteFontFamily", "noteFontWeight", "messageFontSize", "messageFontFamily", "messageFontWeight", "actorFont", "noteFont", "messageFont", "useMaxWidth", "useWidth", "look", "theme"];
        readonly noopKeys: readonly ["actorFont", "actorFontFamily", "actorFontSize", "actorFontWeight", "arrowMarkerAbsolute", "bottomMarginAdj", "boxMargin", "boxTextMargin", "forceMenus", "hideUnusedParticipants", "labelBoxHeight", "labelBoxWidth", "look", "messageAlign", "messageFont", "messageFontFamily", "messageFontSize", "messageFontWeight", "mirrorActors", "noteAlign", "noteFont", "noteFontFamily", "noteFontSize", "noteFontWeight", "rightAngles", "theme", "useMaxWidth", "useWidth", "wrapPadding"];
    };
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: FamilySceneRolePrimitiveDeclaration[];
    readonly example: "sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: request\n  S-->>U: response";
    readonly editorExample: "sequenceDiagram\n  participant User\n  participant App\n  participant API\n  User->>App: Click export\n  App->>API: Render SVG\n  API-->>App: SVG string\n  App-->>User: Download";
}, {
    readonly id: "timeline";
    readonly upstreamId: "timeline";
    readonly maturity: "experimental";
    readonly label: "Timeline";
    readonly headers: readonly ["timeline"];
    readonly narrower: "asTimeline";
    readonly editorDiagramType: "Timeline";
    readonly editorLabel: "Timeline";
    readonly editorDescription: "Chronological milestones with sections.";
    readonly editorExampleId: "timeline-basic";
    readonly editorGlyph: "T";
    readonly config: {
        readonly section: "timeline";
        readonly keys: readonly ["disableMulticolor", "sectionFills", "sectionColours", "diagramMarginX", "diagramMarginY", "leftMargin", "width", "height", "padding", "boxMargin", "boxTextMargin", "noteMargin", "messageMargin", "messageAlign", "bottomMarginAdj", "rightAngles", "taskFontSize", "taskFontFamily", "taskMargin", "activationWidth", "textPlacement", "actorColours", "useMaxWidth", "useWidth"];
        readonly noopKeys: readonly ["diagramMarginX", "diagramMarginY", "leftMargin", "width", "height", "padding", "boxMargin", "boxTextMargin", "noteMargin", "messageMargin", "messageAlign", "bottomMarginAdj", "rightAngles", "taskFontSize", "taskFontFamily", "taskMargin", "activationWidth", "textPlacement", "actorColours", "useMaxWidth", "useWidth"];
    };
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "timeline\n  title Roadmap\n  2025 : Alpha : Beta\n  2026 : GA";
    readonly editorExample: "timeline\n  title Product roadmap\n  section Foundation\n  2024 Q1 : Prototype\n          : Parser coverage\n  section Launch\n  2024 Q2 : Public editor\n          : SVG export";
}, {
    readonly id: "class";
    readonly upstreamId: "classDiagram";
    readonly maturity: "stable";
    readonly label: "Class";
    readonly headers: readonly ["classDiagram", "classDiagram-v2"];
    readonly narrower: "asClass";
    readonly editorDiagramType: "Class";
    readonly editorLabel: "Class";
    readonly editorDescription: "Classes with members, inheritance, and composition.";
    readonly editorExampleId: "class-basic";
    readonly editorGlyph: "C";
    readonly config: {
        readonly section: "class";
        readonly keys: readonly ["nodeSpacing", "rankSpacing", "titleTopMargin", "arrowMarkerAbsolute", "dividerMargin", "padding", "textHeight", "defaultRenderer", "diagramPadding", "htmlLabels", "hideEmptyMembersBox", "hierarchicalNamespaces", "look", "theme"];
        readonly noopKeys: readonly ["arrowMarkerAbsolute", "defaultRenderer", "diagramPadding", "dividerMargin", "hideEmptyMembersBox", "htmlLabels", "look", "padding", "textHeight", "theme", "titleTopMargin"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "classDiagram\n  class Account {\n    +id: string\n    +close() void\n  }\n  Account <|-- Savings\n  Account \"1\" o-- \"*\" Transaction : logs";
    readonly editorExample: "classDiagram\n  class Renderer {\n    <<abstract>>\n    +render(source) string\n  }\n  class SVGRenderer {\n    +render(source) string\n  }\n  class RenderPipeline {\n    +run(source) string\n  }\n  Renderer <|-- SVGRenderer\n  RenderPipeline *-- SVGRenderer : owns";
}, {
    readonly id: "er";
    readonly upstreamId: "er";
    readonly maturity: "stable";
    readonly label: "ER";
    readonly headers: readonly ["erDiagram"];
    readonly narrower: "asEr";
    readonly editorDiagramType: "ER";
    readonly editorLabel: "ER diagram";
    readonly editorDescription: "Entities, attributes, keys, and cardinality markers.";
    readonly editorExampleId: "er-basic";
    readonly editorGlyph: "ER";
    readonly config: {
        readonly section: "er";
        readonly keys: readonly ["layoutDirection", "nodeSpacing", "rankSpacing", "titleTopMargin", "diagramPadding", "minEntityWidth", "minEntityHeight", "entityPadding", "stroke", "fill", "fontSize", "look", "theme"];
        readonly noopKeys: readonly ["diagramPadding", "entityPadding", "fill", "fontSize", "look", "minEntityHeight", "minEntityWidth", "stroke", "theme", "titleTopMargin"];
    };
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id\n  }";
    readonly editorExample: "erDiagram\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    date created\n  }\n  LINE_ITEM {\n    string id PK\n    int quantity\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains";
}, {
    readonly id: "journey";
    readonly upstreamId: "journey";
    readonly maturity: "stable";
    readonly label: "Journey";
    readonly headers: readonly ["journey"];
    readonly narrower: "asJourney";
    readonly editorDiagramType: "Journey";
    readonly editorLabel: "User journey";
    readonly editorDescription: "Scored user tasks grouped by section.";
    readonly editorExampleId: "journey-basic";
    readonly editorGlyph: "J";
    readonly config: {
        readonly section: "journey";
        readonly keys: readonly ["diagramMarginX", "diagramMarginY", "leftMargin", "maxLabelWidth", "width", "height", "taskFontSize", "taskFontFamily", "taskMargin", "actorColours", "sectionFills", "sectionColours", "titleColor", "titleFontFamily", "titleFontSize", "useMaxWidth", "boxMargin", "boxTextMargin", "noteMargin", "messageMargin", "messageAlign", "bottomMarginAdj", "rightAngles", "activationWidth", "textPlacement"];
        readonly noopKeys: readonly ["boxMargin", "boxTextMargin", "noteMargin", "messageMargin", "messageAlign", "bottomMarginAdj", "rightAngles", "activationWidth", "textPlacement"];
    };
    readonly semanticChannels: readonly ["value", "category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "journey\n  title Checkout\n  section Browse\n    Find product: 4: Shopper\n  section Buy\n    Pay: 3: Shopper";
    readonly editorExample: "journey\n  title Editor adoption\n  section Try\n    Open editor: 5: User\n    Load example: 4: User, Developer\n  section Share\n    Copy URL: 5: User\n    Export SVG: 4: Developer";
}, {
    readonly id: "architecture";
    readonly upstreamId: "architecture";
    readonly maturity: "stable";
    readonly label: "Architecture";
    readonly headers: readonly ["architecture", "architecture-beta"];
    readonly narrower: "asArchitecture";
    readonly editorDiagramType: "Architecture";
    readonly editorLabel: "Architecture";
    readonly editorDescription: "Services, groups, icons, and routed connections.";
    readonly editorExampleId: "architecture-basic";
    readonly editorGlyph: "A";
    readonly config: {
        readonly section: "architecture";
        readonly keys: readonly ["padding", "iconSize", "fontSize", "nodeSeparation", "idealEdgeLengthMultiplier", "edgeElasticity", "numIter", "seed", "randomize"];
        readonly noopKeys: readonly ["edgeElasticity", "numIter", "randomize", "seed"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[Database] in backend\n  service cache(disk)[Cache] in backend\n  api:R --> L:db\n  api:B -[reads]-> T:cache";
    readonly editorExample: "architecture-beta\n  group app(cloud)[Application]\n  group data(database)[Data]\n  service web(server)[Web App] in app\n  service api(server)[API] in app\n  service db(database)[Postgres] in data\n  web:R --> L:api\n  api:R --> L:db";
}, {
    readonly id: "xychart";
    readonly upstreamId: "xychart";
    readonly maturity: "stable";
    readonly label: "XY chart";
    readonly headers: readonly ["xychart", "xychart-beta"];
    readonly narrower: "asXyChart";
    readonly editorDiagramType: "XY Chart";
    readonly editorLabel: "XY chart";
    readonly editorDescription: "Bar and line series using xychart syntax.";
    readonly editorExampleId: "xychart-basic";
    readonly editorGlyph: "XY";
    readonly config: {
        readonly section: "xyChart";
        readonly keys: readonly ["width", "height", "useMaxWidth", "useWidth", "titleFontSize", "titlePadding", "chartOrientation", "plotReservedSpacePercent", "showDataLabel", "showDataLabelOutsideBar", "showTitle", "showLegend", "legendFontSize", "legendPadding", "xAxis", "yAxis"];
    };
    readonly semanticChannels: readonly ["value", "category"];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "xychart-beta\n  title \"Revenue\"\n  x-axis [Q1, Q2, Q3]\n  y-axis \"USD\" 0 --> 100\n  bar [45, 62, 80]";
    readonly editorExample: "xychart\n  title \"Weekly renders\"\n  x-axis [Mon, Tue, Wed, Thu, Fri]\n  y-axis \"Renders\" 0 --> 100\n  bar [25, 42, 58, 74, 88]\n  line [18, 35, 52, 70, 95]";
}, {
    readonly id: "pie";
    readonly upstreamId: "pie";
    readonly maturity: "stable";
    readonly label: "Pie";
    readonly headers: readonly ["pie"];
    readonly narrower: "asPie";
    readonly editorDiagramType: "Pie";
    readonly editorLabel: "Pie chart";
    readonly editorDescription: "Proportional slices with values shown in the legend.";
    readonly editorExampleId: "pie-basic";
    readonly editorGlyph: "P";
    readonly config: {
        readonly section: "pie";
        readonly keys: readonly ["textPosition", "donutHole", "legendPosition", "highlightSlice", "useMaxWidth", "useWidth"];
        readonly noopKeys: readonly ["useMaxWidth", "useWidth"];
    };
    readonly semanticChannels: readonly ["value", "category", "emphasis"];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "pie title Plans\n  \"Free\" : 60\n  \"Pro\" : 30\n  \"Enterprise\" : 10";
    readonly editorExample: "pie showData\n  title Export requests by format\n  \"SVG\" : 42\n  \"PNG\" : 28\n  \"ASCII\" : 18\n  \"Unicode\" : 12";
}, {
    readonly id: "quadrant";
    readonly upstreamId: "quadrantChart";
    readonly maturity: "stable";
    readonly label: "Quadrant";
    readonly headers: readonly ["quadrantChart"];
    readonly narrower: "asQuadrant";
    readonly editorDiagramType: "Quadrant";
    readonly editorLabel: "Quadrant chart";
    readonly editorDescription: "Two-axis priority map with labeled regions and points.";
    readonly editorExampleId: "quadrant-basic";
    readonly editorGlyph: "4Q";
    readonly config: {
        readonly section: "quadrantChart";
        readonly keys: readonly ["chartWidth", "chartHeight", "titleFontSize", "titlePadding", "quadrantPadding", "quadrantLabelFontSize", "xAxisLabelFontSize", "yAxisLabelFontSize", "xAxisLabelPadding", "yAxisLabelPadding", "pointLabelFontSize", "pointRadius", "pointTextPadding", "quadrantInternalBorderStrokeWidth", "quadrantExternalBorderStrokeWidth", "useMaxWidth", "quadrantTextTopPadding", "xAxisPosition", "yAxisPosition", "useWidth"];
        readonly noopKeys: readonly ["quadrantTextTopPadding", "xAxisPosition", "yAxisPosition", "useWidth"];
    };
    readonly aliases: readonly ["quadrant"];
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "quadrantChart\n  title Prioritize\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  Quick win: [0.2, 0.8]\n  Money pit: [0.8, 0.2]";
    readonly editorExample: "quadrantChart\n  title Feature priorities\n  x-axis Low impact --> High impact\n  y-axis Low effort --> High effort\n  quadrant-1 Plan carefully\n  quadrant-2 Big bets\n  quadrant-3 Defer\n  quadrant-4 Quick wins\n  SVG export: [0.78, 0.28]\n  MCP setup: [0.62, 0.72]\n  Palette polish: [0.35, 0.24]";
}, {
    readonly id: "gantt";
    readonly upstreamId: "gantt";
    readonly maturity: "stable";
    readonly label: "Gantt";
    readonly headers: readonly ["gantt"];
    readonly narrower: "asGantt";
    readonly editorDiagramType: "Gantt";
    readonly editorLabel: "Gantt chart";
    readonly editorDescription: "Sections, dependencies, status tags, and a milestone.";
    readonly editorExampleId: "gantt-basic";
    readonly editorGlyph: "G";
    readonly config: {
        readonly section: "gantt";
        readonly keys: readonly ["displayMode", "barHeight", "topAxis", "tickInterval", "axisFormat", "barGap", "topPadding", "leftPadding", "gridLineStartPadding", "fontSize", "sectionFontSize", "numberSectionStyles", "todayMarker", "weekday", "rightPadding", "titleTopMargin"];
        readonly noopKeys: readonly ["barGap", "topPadding", "leftPadding", "rightPadding", "titleTopMargin", "gridLineStartPadding", "fontSize", "sectionFontSize", "numberSectionStyles", "todayMarker", "weekday"];
    };
    readonly semanticChannels: readonly ["status", "progress", "emphasis", "category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Implement :a1, 2026-01-05, 5d\n  Review :after a1, 2d";
    readonly editorExample: "gantt\n  title Release train\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  section Build\n    Completed task :done, des1, 2024-01-08, 2024-01-10\n    Active task    :active, des2, 2024-01-11, 3d\n    Future task    :des3, after des2, 5d\n  section Ship\n    Crit review    :crit, rev1, after des3, 2d\n    Release        :milestone, m1, after rev1, 0d";
}, {
    readonly id: "mindmap";
    readonly upstreamId: "mindmap";
    readonly maturity: "stable";
    readonly label: "Mindmap";
    readonly headers: readonly ["mindmap"];
    readonly narrower: "asMindmap";
    readonly editorDiagramType: "Mindmap";
    readonly editorLabel: "Mindmap";
    readonly editorDescription: "A centered, bilateral hierarchy with shapes, Markdown, Unicode, accessibility, and deep quality branches.";
    readonly editorExampleId: "mindmap-basic";
    readonly editorGlyph: "M";
    readonly config: {
        readonly section: "mindmap";
        readonly keys: readonly ["padding", "maxNodeWidth", "layoutAlgorithm", "colorBy"];
        readonly noopKeys: readonly ["colorBy", "layoutAlgorithm"];
    };
    readonly semanticChannels: readonly ["importance", "category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "mindmap\n  root((Product))\n    Research\n      Interviews\n      Evidence\n    Delivery\n      Launch";
    readonly editorExample: "mindmap\n  root((Agent-native release))\n    discovery[Discovery]\n      ::icon(fa fa-book)\n      :::urgent large\n      evidence[\"`**Evidence** across\ninterviews, benchmarks, and Unicode naïve café`\"]\n      constraints{{Constraints}}\n        Security\n        Determinism\n    delivery(Delivery)\n      beta))Beta signal((\n      launch)Launch cloud(\n      quality[Quality gates]\n        Parser round-trip\n        SVG identity\n        Terminal width\n    Ecosystem\n      Mermaid parity\n      Terminal tools";
}, {
    readonly id: "gitgraph";
    readonly upstreamId: "gitGraph";
    readonly maturity: "stable";
    readonly label: "GitGraph";
    readonly headers: readonly ["gitGraph"];
    readonly narrower: "asGitGraph";
    readonly editorDiagramType: "GitGraph";
    readonly editorLabel: "GitGraph";
    readonly editorDescription: "Ordered branches, commit types, tags, a semantic merge, and a merge-parent backport.";
    readonly editorExampleId: "gitgraph-basic";
    readonly editorGlyph: "Git";
    readonly config: {
        readonly section: "gitGraph";
        readonly keys: readonly ["showBranches", "showCommitLabel", "mainBranchName", "mainBranchOrder", "parallelCommits", "rotateCommitLabel", "arrowMarkerAbsolute", "diagramPadding", "nodeLabel", "titleTopMargin"];
        readonly noopKeys: readonly ["arrowMarkerAbsolute", "diagramPadding", "nodeLabel", "titleTopMargin"];
    };
    readonly semanticChannels: readonly ["status", "category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "gitGraph\n  commit id:\"base\"\n  branch feature\n  commit id:\"work\"\n  checkout main\n  commit id:\"release\"\n  merge feature id:\"merge\"";
    readonly editorExample: "---\ntitle: Release train with backport\nconfig:\n  gitGraph:\n    mainBranchName: main\n    mainBranchOrder: 0\n    showBranches: true\n    showCommitLabel: true\n    rotateCommitLabel: true\n---\ngitGraph LR:\n  accTitle: Release history with feature merge and backport\n  accDescr: Develop and release branches diverge, main merges develop, and release cherry-picks the merge\n  commit id:\"ROOT\" tag:\"v1.0.0\" msg:\"Foundation\"\n  branch develop order:2\n  commit id:\"API\" type:HIGHLIGHT tag:\"beta\" msg:\"Build API\"\n  branch release order:3\n  commit id:\"RC\" type:REVERSE tag:\"rc.1\" msg:\"Cut release candidate\"\n  checkout develop\n  commit id:\"UI\" msg:\"Finish interface\"\n  checkout main\n  commit id:\"HOTFIX\" type:REVERSE msg:\"Patch production\"\n  merge develop id:\"MERGE\" tag:\"v2.0.0\" type:HIGHLIGHT\n  checkout release\n  cherry-pick id:\"MERGE\" parent:\"UI\" tag:\"backport\"\n  commit id:\"PATCH\" msg:\"Verify release\"";
}, {
    readonly id: "radar";
    readonly upstreamId: "radar";
    readonly maturity: "experimental";
    readonly label: "Radar";
    readonly headers: readonly ["radar-beta"];
    readonly narrower: "asRadar";
    readonly editorDiagramType: "Radar";
    readonly editorLabel: "Radar chart";
    readonly editorDescription: "Multivariate profiles compared across shared axes — the silhouette is the message.";
    readonly editorExampleId: "radar-basic";
    readonly editorGlyph: "R";
    readonly config: {
        readonly section: "radar";
        readonly keys: readonly ["width", "height", "marginTop", "marginRight", "marginBottom", "marginLeft", "axisScaleFactor", "axisLabelFactor", "curveTension", "useMaxWidth", "tickLabels", "useWidth"];
        readonly noopKeys: readonly ["useWidth"];
    };
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "radar-beta\n  title Skills\n  axis speed[\"Speed\"], power[\"Power\"], range[\"Range\"]\n  curve now[\"Current\"]{4, 3, 5}\n  curve goal[\"Target\"]{5, 5, 4}\n  max 5";
    readonly editorExample: "radar-beta\n  title Model comparison\n  axis speed[\"Speed\"], accuracy[\"Accuracy\"], cost[\"Cost\"]\n  axis latency[\"Latency\"], context[\"Context\"], safety[\"Safety\"]\n  curve a[\"Model A\"]{4, 5, 3, 4, 4, 5}\n  curve b[\"Model B\"]{5, 3, 4, 3, 5, 3}\n  graticule polygon\n  max 5";
}, {
    readonly id: "sankey";
    readonly upstreamId: "sankey";
    readonly maturity: "experimental";
    readonly label: "Sankey";
    readonly headers: readonly ["sankey", "sankey-beta"];
    readonly narrower: "asSankey";
    readonly editorDiagramType: "Sankey";
    readonly editorLabel: "Sankey diagram";
    readonly editorDescription: "Conserved flows between layered stages — ribbon width is the quantity.";
    readonly editorExampleId: "sankey-basic";
    readonly editorGlyph: "SK";
    readonly config: {
        readonly section: "sankey";
        readonly keys: readonly ["width", "height", "linkColor", "nodeAlignment", "showValues", "prefix", "suffix", "labelStyle", "nodeWidth", "nodePadding", "nodeColors", "useMaxWidth"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly ["value", "category"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "sankey-beta\n  Coal,Electricity grid,127.93\n  Electricity grid,Industry,71.24\n  Electricity grid,Losses,56.69";
    readonly editorExample: "sankey-beta\n  Coal,Electricity,60\n  Gas,Electricity,80\n  Solar,Electricity,40\n  Electricity,Homes,120\n  Electricity,Industry,60";
}, {
    readonly id: "c4";
    readonly upstreamId: "c4";
    readonly maturity: "experimental";
    readonly label: "C4";
    readonly headers: readonly ["C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment"];
    readonly narrower: "asC4";
    readonly editorDiagramType: "C4";
    readonly editorLabel: "C4 architecture";
    readonly editorDescription: "People, software systems, containers and components within nested architecture boundaries.";
    readonly editorExampleId: "c4-basic";
    readonly editorGlyph: "C4";
    readonly config: {
        readonly section: "c4";
        readonly keys: readonly string[];
        readonly noopKeys: readonly string[];
    };
    readonly semanticChannels: readonly ["category", "status"];
    readonly detect: (line: string) => boolean;
    readonly detectLoose: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "C4Context\n  Person(user, \"Customer\")\n  System(api, \"API\", \"Serves requests\")\n  Rel(user, api, \"Uses\", \"HTTPS\")";
    readonly editorExample: "C4Container\n  title Internet banking\n  Person(customer, \"Customer\", \"Checks balances and makes payments\")\n  System_Boundary(bank, \"Internet banking\") {\n    Container(web, \"Web application\", \"TypeScript\", \"Customer portal\")\n    Container(api, \"API\", \"Node.js\", \"Accounts and payments\")\n    ContainerDb(db, \"Accounts\", \"PostgreSQL\", \"Balances and transactions\")\n  }\n  Rel(customer, web, \"Uses\", \"HTTPS\")\n  Rel(web, api, \"Calls\", \"JSON/HTTPS\")\n  Rel(api, db, \"Reads and writes\", \"SQL\")";
}, {
    readonly id: "packet";
    readonly upstreamId: "packet";
    readonly maturity: "stable";
    readonly label: "Packet";
    readonly headers: readonly ["packet", "packet-beta"];
    readonly narrower: "asPacket";
    readonly editorDiagramType: "Packet";
    readonly editorLabel: "Packet layout";
    readonly editorDescription: "Bit-accurate packet fields with wrapping word rows.";
    readonly editorExampleId: "packet-basic";
    readonly editorGlyph: "PK";
    readonly config: {
        readonly section: "packet";
        readonly keys: readonly ["bitsPerRow", "bitOrder", "showBits", "rowHeight", "bitWidth", "paddingX", "paddingY", "useMaxWidth"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [{
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "chrome";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "packet\n0-15: \"Source port\"\n16-31: \"Destination port\"";
    readonly editorExample: "packet\ntitle UDP datagram\n+16: \"Source port\"\n+16: \"Destination port\"\n+16: \"Length\"\n+16: \"Checksum\"\n+32: \"Payload\"";
}, {
    readonly id: "kanban";
    readonly upstreamId: "kanban";
    readonly maturity: "stable";
    readonly label: "Kanban";
    readonly headers: readonly ["kanban"];
    readonly narrower: "asKanban";
    readonly editorDiagramType: "Kanban";
    readonly editorLabel: "Kanban board";
    readonly editorDescription: "Ordered workflow columns and task cards with assignees and tickets.";
    readonly editorExampleId: "kanban-basic";
    readonly editorGlyph: "KB";
    readonly config: {
        readonly section: "kanban";
        readonly keys: readonly ["padding", "sectionWidth", "ticketBaseUrl", "useMaxWidth"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [{
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "chrome";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "group";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "group-header";
        readonly primitives: readonly ["shape"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "kanban\n  todo[To do]\n    parser[Build parser]\n  done[Done]\n    research[Research]";
    readonly editorExample: "kanban\n  todo[To do]\n    packet[Packet family]@{ assigned: \"Maya\", priority: \"High\" }\n  doing[In progress]\n    kanban[Kanban family]@{ assigned: \"Alex\", ticket: \"AM-409\" }\n  done[Done]\n    research[Community research]";
}, {
    readonly id: "requirement";
    readonly upstreamId: "requirement";
    readonly maturity: "stable";
    readonly label: "Requirement";
    readonly headers: readonly ["requirementDiagram", "requirement"];
    readonly narrower: "asRequirement";
    readonly editorDiagramType: "Requirement";
    readonly editorLabel: "Requirements";
    readonly editorDescription: "Requirements, evidence elements and typed traceability relationships.";
    readonly editorExampleId: "requirement-basic";
    readonly editorGlyph: "RQ";
    readonly config: {
        readonly section: "requirement";
        readonly keys: readonly ["rect_fill", "text_color", "rect_border_size", "rect_border_color", "rect_min_width", "rect_min_height", "maxWidth", "fontSize", "rect_padding", "line_height", "nodeSpacing", "rankSpacing", "useMaxWidth", "look", "theme"];
        readonly noopKeys: readonly ["useMaxWidth", "look", "theme"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [...({
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    } | {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    })[], {
        readonly role: "chrome";
        readonly primitives: readonly ["document", "shape"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "relationship";
        readonly primitives: readonly ["connector"];
    }, {
        readonly role: "attribute";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "edge-label";
        readonly primitives: readonly ["text", "container"];
    }, {
        readonly role: "defs";
        readonly primitives: readonly ["document", "marker"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "requirementDiagram\n  requirement fast {\n    id: 1\n    text: Respond within 100ms\n    risk: high\n    verifymethod: test\n  }\n  element benchmark {\n    type: \"test\"\n  }\n  benchmark - verifies -> fast";
    readonly editorExample: "requirementDiagram\n  direction LR\n  requirement reliable {\n    id: R1\n    text: Requests retain authored meaning\n    risk: high\n    verifymethod: test\n  }\n  functionalRequirement edits {\n    id: R2\n    text: Typed edits preserve all relationships\n    risk: medium\n    verifymethod: inspection\n  }\n  element suite {\n    type: conformance suite\n  }\n  reliable - contains -> edits\n  suite - verifies -> edits";
}, {
    readonly id: "treemap";
    readonly upstreamId: "treemap";
    readonly maturity: "stable";
    readonly label: "Treemap";
    readonly headers: readonly ["treemap", "treemap-beta"];
    readonly narrower: "asTreemap";
    readonly editorDiagramType: "Treemap";
    readonly editorLabel: "Treemap";
    readonly editorDescription: "Value-proportional nested rectangles for hierarchical data.";
    readonly editorExampleId: "treemap-basic";
    readonly editorGlyph: "TM";
    readonly config: {
        readonly section: "treemap";
        readonly keys: readonly ["useMaxWidth", "padding", "diagramPadding", "showValues", "nodeWidth", "nodeHeight", "borderWidth", "valueFontSize", "labelFontSize", "valueFormat"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly ["value", "category"];
    readonly sceneRoles: readonly [...({
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    } | {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    })[], {
        readonly role: "chrome";
        readonly primitives: readonly ["document", "shape"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container"];
    }, {
        readonly role: "group";
        readonly primitives: readonly ["container"];
    }, {
        readonly role: "bar";
        readonly primitives: readonly ["shape", "data-mark"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "treemap\n\"Product\"\n  \"Engineering\": 60\n  \"Design\": 40";
    readonly editorExample: "treemap\ntitle Product investment\n\"Build\"\n  \"Engineering\": 60\n  \"Design\": 25\n\"Learn\"\n  \"Research\": 30\n  \"Analytics\": 15";
}, {
    readonly id: "ishikawa";
    readonly upstreamId: "ishikawa";
    readonly maturity: "stable";
    readonly label: "Ishikawa";
    readonly headers: readonly ["ishikawa", "ishikawa-beta"];
    readonly narrower: "asIshikawa";
    readonly editorDiagramType: "Ishikawa";
    readonly editorLabel: "Fishbone analysis";
    readonly editorDescription: "Cause-and-effect fishbone with nested contributing causes.";
    readonly editorExampleId: "ishikawa-basic";
    readonly editorGlyph: "IK";
    readonly config: {
        readonly section: "ishikawa";
        readonly keys: readonly ["diagramPadding", "useMaxWidth"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [{
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "chrome";
        readonly primitives: readonly ["document"];
    }, {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "defs";
        readonly primitives: readonly ["document", "marker"];
    }, {
        readonly role: "edge";
        readonly primitives: readonly ["connector"];
    }, {
        readonly role: "rail";
        readonly primitives: readonly ["connector"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "ishikawa\n  Slow release\n  Process\n    Manual checks\n  Tooling\n    Slow builds";
    readonly editorExample: "ishikawa\n  Delayed release\n  Process\n    Manual approvals\n    Unclear acceptance\n  People\n    Shared ownership\n  Tooling\n    Slow builds\n      Cold caches\n  Environment\n    Unstable test data";
}, {
    readonly id: "block";
    readonly upstreamId: "block";
    readonly maturity: "stable";
    readonly label: "Block";
    readonly headers: readonly ["block", "block-beta"];
    readonly narrower: "asBlock";
    readonly editorDiagramType: "Block";
    readonly editorLabel: "Block diagram";
    readonly editorDescription: "Authored grid placement with column spans and nested composites.";
    readonly editorExampleId: "block-basic";
    readonly editorGlyph: "BL";
    readonly config: {
        readonly section: "block";
        readonly keys: readonly ["padding", "useMaxWidth"];
        readonly noopKeys: readonly ["useMaxWidth"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [...({
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    } | {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    })[], {
        readonly role: "chrome";
        readonly primitives: readonly ["document", "shape"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "group";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "edge";
        readonly primitives: readonly ["connector"];
    }, {
        readonly role: "edge-label";
        readonly primitives: readonly ["text", "container"];
    }, {
        readonly role: "defs";
        readonly primitives: readonly ["document", "marker"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "block\n  columns 2\n  A[\"API\"] B[\"Database\"]\n  A --> B";
    readonly editorExample: "block\n  columns 3\n  client[\"Client\"] space api[\"API\"]\n  block:data:3\n    columns 2\n    primary[(\"Primary\")] replica[(\"Replica\")]\n    primary --> replica\n  end\n  client --> api\n  api --> primary";
}, {
    readonly id: "eventmodeling";
    readonly upstreamId: "eventmodeling";
    readonly maturity: "experimental";
    readonly label: "Event Modeling";
    readonly headers: readonly ["eventmodeling"];
    readonly narrower: "asEventModeling";
    readonly editorDiagramType: "Event Modeling";
    readonly editorLabel: "Event Modeling";
    readonly editorDescription: "Time frames, swimlanes and directed information flow.";
    readonly editorExampleId: "eventmodeling-basic";
    readonly editorGlyph: "EM";
    readonly config: {
        readonly section: "eventmodeling";
        readonly keys: readonly ["padding", "rowHeight", "useWidth", "useMaxWidth", "theme", "look", "layout"];
        readonly noopKeys: readonly ["useWidth", "useMaxWidth", "theme", "look", "layout"];
    };
    readonly semanticChannels: readonly [];
    readonly sceneRoles: readonly [...({
        readonly role: "prelude";
        readonly primitives: readonly ["document"];
    } | {
        readonly role: "title";
        readonly primitives: readonly ["text"];
    })[], {
        readonly role: "chrome";
        readonly primitives: readonly ["document", "shape"];
    }, {
        readonly role: "node";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "label";
        readonly primitives: readonly ["text"];
    }, {
        readonly role: "group";
        readonly primitives: readonly ["container", "shape"];
    }, {
        readonly role: "edge";
        readonly primitives: readonly ["connector"];
    }, {
        readonly role: "defs";
        readonly primitives: readonly ["document", "marker"];
    }];
    readonly detect: (line: string) => boolean;
    readonly example: "eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded";
    readonly editorExample: "eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded\ntf 04 rmo CartItems\ntf 05 ui CartUI";
}, {
    readonly id: "zenuml";
    readonly upstreamId: "zenuml";
    readonly maturity: "experimental";
    readonly label: "ZenUML";
    readonly headers: readonly ["zenuml"];
    readonly narrower: "asZenUML";
    readonly editorDiagramType: "ZenUML";
    readonly editorLabel: "ZenUML interactions";
    readonly editorDescription: "Nested calls, replies and control scopes with checked native edits.";
    readonly editorExampleId: "zenuml-checkout";
    readonly editorGlyph: "ZU";
    readonly config: {
        readonly section: "zenuml";
        readonly keys: readonly [];
        readonly noopKeys: readonly [];
    };
    readonly semanticChannels: readonly ["category"];
    readonly sceneRoles: {
        role: SceneRole;
        primitives: FamilyScenePositivePrimitive[];
    }[];
    readonly detect: (line: string) => boolean;
    readonly example: "zenuml\nAlice->Bob: Hello\nBob->Alice: Reply";
    readonly editorExample: "zenuml\ntitle Checkout\nBuyer as Customer\nAPI\nStore\nBuyer->API.placeOrder() {\n  Store.reserve()\n  if (inStock) {\n    return confirmation\n  } else {\n    return unavailable\n  }\n}\nAPI->Buyer: accepted";
}, {
    readonly id: "railroad";
    readonly upstreamId: "railroad";
    readonly maturity: "beta";
    readonly label: "Railroad";
    readonly headers: readonly ["railroad-beta", "railroad-ebnf-beta", "railroad-abnf-beta", "railroad-peg-beta"];
    readonly narrower: "asRailroad";
    readonly editorDiagramType: "Railroad";
    readonly editorLabel: "Railroad grammars";
    readonly editorDescription: "Grammar sequences, choices, optional branches, repetition tracks and lookahead.";
    readonly editorExampleId: "railroad-basic";
    readonly editorGlyph: "RR";
    readonly config: {
        readonly section: "railroad";
        readonly keys: readonly ["arcRadius", "commentFill", "commentStroke", "commentTextColor", "compactMode", "fontFamily", "fontSize", "horizontalSeparation", "lineColor", "markerFill", "markerRadius", "nonTerminalFill", "nonTerminalStroke", "nonTerminalTextColor", "padding", "ruleNameColor", "showMarkers", "specialFill", "specialStroke", "strokeWidth", "terminalFill", "terminalStroke", "terminalTextColor", "verticalSeparation"];
        readonly noopKeys: readonly ["arcRadius", "commentFill", "commentStroke", "commentTextColor", "compactMode", "fontFamily", "fontSize", "horizontalSeparation", "lineColor", "markerFill", "markerRadius", "nonTerminalFill", "nonTerminalStroke", "nonTerminalTextColor", "padding", "ruleNameColor", "showMarkers", "specialFill", "specialStroke", "strokeWidth", "terminalFill", "terminalStroke", "terminalTextColor", "verticalSeparation"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "railroad-beta\nentry = sequence(terminal(\"start\"), optional(nonterminal(\"item\")));";
    readonly editorExample: "railroad-ebnf-beta\nentry = \"start\", [item], {\",\", item};\nitem = \"word\" | \"number\";";
}, {
    readonly id: "cynefin";
    readonly upstreamId: "cynefin";
    readonly maturity: "beta";
    readonly label: "Cynefin";
    readonly headers: readonly ["cynefin-beta"];
    readonly narrower: "asCynefin";
    readonly editorDiagramType: "Cynefin";
    readonly editorLabel: "Cynefin domains";
    readonly editorDescription: "Decision domains, retained items and directed domain transitions.";
    readonly editorExampleId: "cynefin-basic";
    readonly editorGlyph: "CY";
    readonly config: {
        readonly section: "cynefin";
        readonly keys: readonly ["boundaryAmplitude", "height", "padding", "seed", "showDomainDescriptions", "width"];
        readonly noopKeys: readonly ["boundaryAmplitude", "height", "padding", "seed", "showDomainDescriptions", "width"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "cynefin-beta\ncomplex\n  \"Explore\"\nclear\n  \"Operate\"\ncomplex --> clear: \"Learn\"";
    readonly editorExample: "cynefin-beta\ncomplex\n  \"Explore\"\ncomplicated\n  \"Analyse\"\nclear\n  \"Operate\"\nchaotic\n  \"Stabilise\"\nconfusion\n  \"Investigate\"\ncomplex --> clear: \"Learn\"";
}, {
    readonly id: "agentflow";
    readonly upstreamId: "agentflow";
    readonly maturity: "beta";
    readonly label: "AgentFlow";
    readonly headers: readonly ["agentflow-beta"];
    readonly narrower: "asAgentflow";
    readonly editorDiagramType: "AgentFlow";
    readonly editorLabel: "Agent workflows";
    readonly editorDescription: "Agent roles, tool metadata, attachments and directed workflow connections.";
    readonly editorExampleId: "agentflow-basic";
    readonly editorGlyph: "AF";
    readonly config: {
        readonly section: "agentflow";
        readonly keys: readonly ["diagramPadding", "look", "minNodeWidth", "nodeSpacing", "rankSpacing", "theme", "titleTopMargin", "wrappingWidth"];
        readonly noopKeys: readonly ["diagramPadding", "look", "minNodeWidth", "nodeSpacing", "rankSpacing", "theme", "titleTopMargin", "wrappingWidth"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "agentflow-beta\n A[Plan]@{ shape: task }\n B[Search]@{ shape: tool }\n A --> B";
    readonly editorExample: "agentflow-beta\n A[Plan]@{ shape: task }\n B[Search]@{ shape: tool }\n A --> B";
}, {
    readonly id: "usecase";
    readonly upstreamId: "usecase";
    readonly maturity: "beta";
    readonly label: "UseCase";
    readonly headers: readonly ["usecase-beta"];
    readonly narrower: "asUsecase";
    readonly editorDiagramType: "UseCase";
    readonly editorLabel: "Use cases";
    readonly editorDescription: "Actors and use cases inside system boundaries with typed relationships.";
    readonly editorExampleId: "usecase-basic";
    readonly editorGlyph: "UC";
    readonly config: {
        readonly section: "usecase";
        readonly keys: readonly ["actorFontFamily", "actorFontSize", "actorFontWeight", "colorScheme", "diagramPadding", "look", "minNodeWidth", "nodeSpacing", "rankSpacing", "theme", "usecaseFontFamily", "usecaseFontSize", "usecaseFontWeight", "wrappingWidth"];
        readonly noopKeys: readonly ["actorFontFamily", "actorFontSize", "actorFontWeight", "colorScheme", "diagramPadding", "look", "minNodeWidth", "nodeSpacing", "rankSpacing", "theme", "usecaseFontFamily", "usecaseFontSize", "usecaseFontWeight", "wrappingWidth"];
    };
    readonly semanticChannels: readonly ["category", "emphasis"];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "usecase-beta\nactor Customer\nCheckout(\"Checkout\")\nCustomer --> Checkout";
    readonly editorExample: "usecase-beta\nactor Customer\nCheckout(\"Checkout\")\nCustomer --> Checkout";
}, {
    readonly id: "wardley";
    readonly upstreamId: "wardley";
    readonly maturity: "beta";
    readonly label: "Wardley";
    readonly headers: readonly ["wardley-beta"];
    readonly narrower: "asWardley";
    readonly editorDiagramType: "Wardley";
    readonly editorLabel: "Wardley map";
    readonly editorDescription: "Authored evolution and visibility coordinates, dependencies and pipelines.";
    readonly editorExampleId: "wardley-basic";
    readonly editorGlyph: "WM";
    readonly config: {
        readonly section: "wardley";
        readonly keys: readonly [];
        readonly noopKeys: readonly [];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "wardley-beta\ncomponent API [0.8, 0.3]\ncomponent Database [0.3, 0.8]\nAPI -> Database";
    readonly editorExample: "wardley-beta\ncomponent API [0.8, 0.3]\ncomponent Database [0.3, 0.8]\nAPI -> Database";
}, {
    readonly id: "venn";
    readonly upstreamId: "venn";
    readonly maturity: "beta";
    readonly label: "Venn";
    readonly headers: readonly ["venn-beta"];
    readonly narrower: "asVenn";
    readonly editorDiagramType: "Venn";
    readonly editorLabel: "Venn intersections";
    readonly editorDescription: "Sets, intersections, exact values and region-owned text.";
    readonly editorExampleId: "venn-basic";
    readonly editorGlyph: "VN";
    readonly config: {
        readonly section: "venn";
        readonly keys: readonly ["height", "look", "padding", "theme", "useDebugLayout", "width"];
        readonly noopKeys: readonly ["height", "look", "padding", "theme", "useDebugLayout", "width"];
    };
    readonly semanticChannels: readonly ["category"];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "venn-beta\nset A[\"Frontend\"]:20\nset B[\"Backend\"]:12\nunion A,B[\"Shared\"]:3";
    readonly editorExample: "venn-beta\nset A[\"Frontend\"]:20\nset B[\"Backend\"]:12\nunion A,B[\"Shared\"]:3";
}, {
    readonly id: "swimlane";
    readonly upstreamId: "swimlane";
    readonly maturity: "beta";
    readonly label: "Swimlane";
    readonly headers: readonly ["swimlane-beta"];
    readonly narrower: "asSwimlane";
    readonly editorDiagramType: "Swimlane";
    readonly editorLabel: "Swimlane workflow";
    readonly editorDescription: "Responsibility lanes with source-ordered tasks and directed connections.";
    readonly editorExampleId: "swimlane-workflow";
    readonly editorGlyph: "SL";
    readonly config: {
        readonly section: "swimlane";
        readonly keys: readonly ["automaticLaneOrdering", "ignoreCrossLaneEdges", "layout", "lineHops", "look", "optimizeRanksByCrossings", "theme"];
        readonly noopKeys: readonly ["automaticLaneOrdering", "ignoreCrossLaneEdges", "layout", "lineHops", "look", "optimizeRanksByCrossings", "theme"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "swimlane-beta LR\n  subgraph customer[Customer]\n    request[Place order]\n  end\n  subgraph team[Team]\n    fulfill[Fulfil order]\n  end\n  request --> fulfill";
    readonly editorExample: "swimlane-beta LR\n  subgraph customer[Customer]\n    request[Place order]\n    receive[Receive order]\n  end\n  subgraph team[Team]\n    check{In stock?}\n    fulfill[Fulfil order]\n  end\n  request --> check\n  check -->|Yes| fulfill\n  fulfill --> receive";
}, {
    readonly id: "treeview";
    readonly upstreamId: "treeView";
    readonly maturity: "beta";
    readonly label: "TreeView";
    readonly headers: readonly ["treeView-beta"];
    readonly narrower: "asTreeview";
    readonly editorDiagramType: "TreeView";
    readonly editorLabel: "File tree";
    readonly editorDescription: "Ordered folders and files with descriptions and hierarchy guides.";
    readonly editorExampleId: "treeview-project";
    readonly editorGlyph: "TV";
    readonly config: {
        readonly section: "treeView";
        readonly keys: readonly ["defaultIconPack", "extensionIcons", "filenameIcons", "lineThickness", "paddingX", "paddingY", "rowIndent", "showIcons"];
        readonly noopKeys: readonly ["defaultIconPack", "extensionIcons", "filenameIcons", "lineThickness", "paddingX"];
    };
    readonly semanticChannels: readonly [];
    readonly detect: (line: string) => boolean;
    readonly sceneRoles: readonly [FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration, FamilySceneRolePrimitiveDeclaration];
    readonly example: "treeView-beta\n  \"src/\"\n    \"index.ts\"\n    \"parser.ts\"";
    readonly editorExample: "treeView-beta\n  \"project/\"\n    \"src/\"\n      \"index.ts\"\n      \"parser.ts\"\n    \"tests/\"\n      \"parser.test.ts\"\n    \"README.md\"";
}];
type BuiltinFamilyId = (typeof BUILTIN_FAMILY_DESCRIPTOR_SEEDS)[number]['id'];
declare const BUILTIN_FAMILY_METADATA: readonly BuiltinFamilyMetadata[];
type BuiltinFamilyMetadataCoversDiagramKind = [Exclude<DiagramKind, BuiltinFamilyId>, Exclude<BuiltinFamilyId, DiagramKind>] extends [never, never] ? true : never;
declare const BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND: BuiltinFamilyMetadataCoversDiagramKind;
declare function builtinFamilyMetadata(kind: DiagramKind): BuiltinFamilyMetadata | undefined;
declare function isBuiltinFamilyId(id: string): id is BuiltinFamilyId;
declare function isExternalFamilyId(id: string): id is ExternalFamilyId;
declare function getFamily(kind: FamilyId | string): FamilyDescriptor | undefined;
/** Immutable executable evidence for one exact registered descriptor. */
declare function getFamilyConformanceReport(kind: FamilyId | string): FamilyConformanceReport | undefined;
/** Report-facing state projection. A declaration alone can never manufacture
 * a native capability; native appears only beside a passed executable cell. */
declare function effectiveFamilyCapabilityState(descriptor: FamilyDescriptor, capability: FamilyCapability): FamilyCapabilityState;
declare function knownFamilies(): FamilyId[];
declare function knownBuiltinFamilies(): BuiltinFamilyId[];
declare function detectRegisteredFamilyFromFirstLine(firstLine: string, mode?: 'strict' | 'loose'): FamilyId | null;

type AgentflowRole = 'task' | 'tool' | 'action' | 'input' | 'refdoc' | 'decision' | 'connector';
interface AgentflowMapping {
    id: string;
    type: 'vertex' | 'edge' | 'flow' | 'connector' | 'attachment';
    line: number;
    col: number;
    endLine: number;
    endCol: number;
}
/** Topology is the shared graph IR. AgentFlow's roles, arbitrary YAML,
 * connector declarations and global escape semantics remain family-owned. */
interface AgentflowBody {
    kind: 'agentflow';
    graph: MermaidGraph;
    metadata: Map<string, Record<string, unknown>>;
    roles: Map<string, AgentflowRole>;
    connectors: Set<string>;
    globals: Set<string>;
    mappings: AgentflowMapping[];
}
type AgentflowMutationOp = FlowchartMutationOp | {
    kind: 'set_metadata';
    target: string;
    metadata: Record<string, unknown> | null;
} | {
    kind: 'set_role';
    id: string;
    role: AgentflowRole;
};

type StyleDeclaration = [property: string, value: string];

type RailroadNode = {
    type: 'terminal';
    value: string;
    literalKind?: 'abnf-numeric';
} | {
    type: 'nonterminal';
    name: string;
} | {
    type: 'special';
    text: string;
} | {
    type: 'sequence';
    elements: RailroadNode[];
} | {
    type: 'choice';
    alternatives: RailroadNode[];
    ordered?: true;
} | {
    type: 'optional';
    element: RailroadNode;
} | {
    type: 'repetition';
    element: RailroadNode;
    min: number;
    max: number | null;
} | {
    type: 'predicate';
    operator: '!' | '&';
    element: RailroadNode;
} | {
    type: 'any';
} | {
    type: 'exception';
    base: RailroadNode;
    except: RailroadNode;
};
interface RailroadRule {
    name: string;
    definition: RailroadNode;
}
type Notation = 'railroad' | 'ebnf' | 'abnf' | 'peg';
interface RailroadBody {
    kind: 'railroad';
    notation: Notation;
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    rules: RailroadRule[];
}
type RailroadMutationOp = {
    kind: 'add_rule';
    name: string;
    definition: RailroadNode;
    index?: number;
} | {
    kind: 'replace_rule';
    index: number;
    name?: string;
    definition: RailroadNode;
} | {
    kind: 'remove_rule';
    index: number;
} | {
    kind: 'set_title';
    title: string | null;
};

type DomainName = 'complex' | 'complicated' | 'clear' | 'chaotic' | 'confusion';

interface CynefinDomain {
    name: DomainName;
    items: {
        label: string;
    }[];
}
interface CynefinTransition {
    from: DomainName;
    to: DomainName;
    label?: string;
}
interface CynefinBody {
    kind: 'cynefin';
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    domains: CynefinDomain[];
    transitions: CynefinTransition[];
}
type CynefinMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_item';
    domain: DomainName;
    label: string;
} | {
    kind: 'set_item';
    domain: DomainName;
    index: number;
    label: string;
} | {
    kind: 'remove_item';
    domain: DomainName;
    index: number;
} | {
    kind: 'add_transition';
    from: DomainName;
    to: DomainName;
    label?: string;
} | {
    kind: 'remove_transition';
    index: number;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

interface VennSubset {
    sets: string[];
    size: number;
    label?: string;
}
interface VennText {
    sets: string[];
    id: string;
    label?: string;
}
interface VennStyle {
    targets: string[];
    styles: Record<string, string>;
}
interface VennBody {
    kind: 'venn';
    subsets: VennSubset[];
    textNodes: VennText[];
    styles: VennStyle[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type VennMutationOp = {
    kind: 'set_subset';
    sets: string[];
    size: number;
    label?: string;
} | {
    kind: 'remove_subset';
    sets: string[];
    cascade?: boolean;
} | {
    kind: 'rename_set';
    from: string;
    to: string;
} | {
    kind: 'set_text';
    sets: string[];
    id: string;
    label?: string;
} | {
    kind: 'remove_text';
    id: string;
} | {
    kind: 'set_style';
    targets: string[];
    styles: Record<string, string>;
} | {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

type SourceStrategy = 'build' | 'buy' | 'outsource' | 'market';
type Flow = 'forward' | 'backward' | 'bidirectional';
interface WardleyNode {
    id: string;
    label: string;
    x?: number;
    y?: number;
    className?: string;
    labelOffsetX?: number;
    labelOffsetY?: number;
    inPipeline?: boolean;
    isPipelineParent?: boolean;
    inertia?: boolean;
    sourceStrategy?: SourceStrategy;
}
interface WardleyLink {
    source: string;
    target: string;
    dashed?: boolean;
    label?: string;
    flow?: Flow;
}
interface WardleyTrend {
    nodeId: string;
    targetX: number;
    targetY: number;
}
interface WardleyPipeline {
    nodeId: string;
    componentIds: string[];
}
interface WardleyAnnotation {
    number: number;
    coordinates: {
        x: number;
        y: number;
    }[];
    text?: string;
}
interface WardleyNote {
    text: string;
    x: number;
    y: number;
}
interface WardleyForce {
    name: string;
    x: number;
    y: number;
}
interface WardleyAxesConfig {
    xLabel?: string;
    yLabel?: string;
    stages?: string[];
    stageBoundaries?: number[];
}
interface WardleyBuildResult {
    nodes: WardleyNode[];
    links: WardleyLink[];
    trends: WardleyTrend[];
    pipelines: WardleyPipeline[];
    annotations: WardleyAnnotation[];
    notes: WardleyNote[];
    accelerators: WardleyForce[];
    deaccelerators: WardleyForce[];
    annotationsBox?: {
        x: number;
        y: number;
    };
    axes: WardleyAxesConfig;
    size?: {
        width: number;
        height: number;
    };
}

interface WardleyBody extends WardleyBuildResult {
    kind: 'wardley';
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type WardleyMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_component';
    id: string;
    x: number;
    y: number;
    anchor?: boolean;
} | {
    kind: 'set_component_position';
    id: string;
    x: number;
    y: number;
} | {
    kind: 'remove_component';
    id: string;
} | {
    kind: 'add_dependency';
    source: string;
    target: string;
    label?: string;
    dashed?: boolean;
    flow?: Flow;
} | {
    kind: 'remove_dependency';
    index: number;
} | {
    kind: 'set_evolution';
    id: string;
    x: number;
} | {
    kind: 'add_note';
    text: string;
    x: number;
    y: number;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

type LabelType = 'text' | 'markdown';
type ActorType = 'normal' | 'hollow' | 'awesome' | 'icon';
type UseCaseShape = 'ellipse' | 'rect';
type BoundaryType = 'rect' | 'package';
type RelationshipType = 'association' | 'include' | 'extend' | 'generalization';
type Animation = 'fast' | 'slow';
type Direction = 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
type Span = [start: number, end: number];
interface Actor {
    id: string;
    label: string;
    labelType: LabelType;
    type: ActorType;
    icon?: string;
    business: boolean;
    stereotype?: string;
    parentId?: string;
    classes: string[];
    styles: string[];
}
interface UseCase {
    id: string;
    label: string;
    labelType: LabelType;
    shape: UseCaseShape;
    business: boolean;
    stereotype?: string;
    parentId?: string;
    classes: string[];
    styles: string[];
}
interface SystemBoundary {
    id: string;
    label: string;
    labelType: LabelType;
    type: BoundaryType;
    members: string[];
    classes: string[];
    styles: string[];
}
interface Relationship {
    id: string;
    explicitId: boolean;
    source: string;
    target: string;
    type: RelationshipType;
    arrowType: number;
    label?: string;
    labelType?: LabelType;
    minlen: number;
    classes: string[];
    styles: string[];
    animate: boolean;
    animation?: Animation;
}
interface UsecaseNote {
    id: string;
    target: string;
    label: string;
    labelType: LabelType;
}
interface UsecaseJsonNode {
    id: string;
    value: Record<string, unknown>;
    propertyOrder: Map<string, string[]>;
    classes: string[];
    styles: string[];
}
interface ClassDef {
    id: string;
    styles: string[];
}
interface MetadataOccurrence {
    key: string;
    span: Span;
    keySpan: Span;
    valueSpan: Span;
}
interface NodeOccurrence {
    id: string;
    span: Span;
    idSpan: Span;
    labelSpan?: Span;
    defines?: boolean;
    stereotypeSpan?: Span;
    metadata?: MetadataOccurrence[];
    classSpans?: Span[];
}
interface EdgeOccurrence {
    id: string;
    span: Span;
    labelSpan?: Span;
    idSpan?: Span;
    metadata?: MetadataOccurrence[];
}
interface GraphStatement {
    kind: 'node' | 'edge' | 'group' | 'note' | 'json' | 'metadata' | 'edgeMetadata' | 'classDef' | 'classAssign' | 'style' | 'direction' | 'accTitle' | 'accDescr' | 'comment' | 'blank';
    span: Span;
    nodes?: NodeOccurrence[];
    edges?: EdgeOccurrence[];
    group?: string;
    idSpan?: Span;
    titleSpan?: Span;
    endSpan?: Span;
    ref?: string;
    refSpan?: Span;
    children?: GraphStatement[];
    metadata?: MetadataOccurrence[];
    classSpans?: Span[];
}
interface UsecaseModel {
    type: 'usecase';
    actors: Map<string, Actor>;
    useCases: Map<string, UseCase>;
    systemBoundaries: Map<string, SystemBoundary>;
    relationships: Relationship[];
    notes: Map<string, UsecaseNote>;
    jsonNodes: Map<string, UsecaseJsonNode>;
    classDefs: Map<string, ClassDef>;
    direction: Direction;
    title?: string;
    accTitle: string;
    accDescr: string;
    accDescription: string;
    source: string;
    headerSpan: Span;
    statements: GraphStatement[];
}

type UsecaseNode = ({
    kind: 'actor';
} & Actor) | ({
    kind: 'usecase';
} & UseCase);
interface UsecaseBody {
    kind: 'usecase';
    direction: 'TB' | 'BT' | 'LR' | 'RL';
    nodes: UsecaseNode[];
    boundaries: SystemBoundary[];
    relationships: Relationship[];
    notes: UsecaseNote[];
    jsonNodes: (Omit<UsecaseJsonNode, 'propertyOrder'> & {
        propertyOrder: [string, string[]][];
    })[];
    classDefs: ClassDef[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type UsecaseMutationOp = {
    kind: 'add_actor';
    id: string;
    label?: string;
    parentId?: string;
} | {
    kind: 'add_usecase';
    id: string;
    label?: string;
    parentId?: string;
    shape?: 'ellipse' | 'rect';
} | {
    kind: 'add_boundary';
    id: string;
    label?: string;
    boundaryType?: 'rect' | 'package';
} | {
    kind: 'remove_node';
    id: string;
    cascade?: boolean;
} | {
    kind: 'set_label';
    id: string;
    label: string;
} | {
    kind: 'move_node';
    id: string;
    parentId: string | null;
} | {
    kind: 'add_relationship';
    from: string;
    to: string;
    id?: string;
    relation?: 'association' | 'include' | 'extend' | 'generalization';
    label?: string;
} | {
    kind: 'remove_relationship';
    id: string;
} | {
    kind: 'set_direction';
    direction: UsecaseBody['direction'];
} | {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

/** Swimlanes share Flowchart's authored graph grammar. Top-level subgraphs
 * are responsibility lanes; nested subgraphs remain ordinary containers. */
interface SwimlaneBody {
    kind: 'swimlane';
    graph: MermaidGraph;
}
/** The lane editor uses the shared checked topology operations. */
type SwimlaneMutationOp = FlowchartMutationOp;

interface TreeviewNode {
    /** Positional reader address; structural edits may renumber it. */
    id: string;
    label: string;
    parentId?: string;
    nodeType: 'file' | 'directory';
    className?: string;
    icon?: string;
    description?: string;
}
interface TreeviewBody {
    kind: 'treeview';
    nodes: TreeviewNode[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type TreeviewMutationOp = {
    kind: 'add_node';
    label: string;
    parentId?: string;
    nodeType?: 'file' | 'directory';
    icon?: string;
    description?: string;
    className?: string;
} | {
    kind: 'remove_node';
    id: string;
} | {
    kind: 'set_label';
    id: string;
    label: string;
} | {
    kind: 'set_description';
    id: string;
    description: string | null;
} | {
    kind: 'set_icon';
    id: string;
    icon: string | null;
} | {
    kind: 'set_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_node_type';
    id: string;
    nodeType: 'file' | 'directory';
} | {
    kind: 'move_node';
    id: string;
    parentId?: string;
    index?: number;
} | {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

/** Authored Zen semantics. Statement IDs are local editing addresses, assigned
 * in lexical order on parsing; participant IDs are authored identities. */
interface ZenUMLParticipant {
    id: string;
    label: string;
    annotations: string[];
    stereotype?: string;
    /** Comments on declarations are preserved but have no rendered note. */
    comments?: string[];
}
interface ZenUMLAssignment {
    name: string;
    type?: string;
}
interface ZenUMLBranch {
    kind: 'body' | 'else-if' | 'else' | 'catch' | 'finally';
    condition?: string;
    statements: ZenUMLStatement[];
}
type ZenUMLFragmentType = 'if' | 'opt' | 'while' | 'for' | 'forEach' | 'foreach' | 'loop' | 'par' | 'try' | 'critical';
type ZenUMLStatement = {
    kind: 'call';
    id: string;
    from?: string;
    to?: string;
    label: string;
    assignment?: ZenUMLAssignment;
    children: ZenUMLStatement[];
} | {
    kind: 'message';
    id: string;
    from: string;
    to: string;
    label: string;
    reply: boolean;
} | {
    kind: 'create';
    id: string;
    constructor: string;
    arguments?: string;
    assignment?: ZenUMLAssignment;
    children: ZenUMLStatement[];
} | {
    kind: 'return';
    id: string;
    label: string;
} | {
    kind: 'fragment';
    id: string;
    type: ZenUMLFragmentType;
    condition?: string;
    branches: ZenUMLBranch[];
} | {
    kind: 'comment';
    id: string;
    text: string;
} | {
    kind: 'opaque';
    id: string;
    source: string;
};
interface ZenUMLBody {
    kind: 'zenuml';
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    starter?: string;
    /** Whole authored document retained when any construct is not modelled. */
    unsupportedSource?: string;
    participants: ZenUMLParticipant[];
    statements: ZenUMLStatement[];
}
type ZenUMLMutationOp = {
    kind: 'upsert_participant';
    participant: ZenUMLParticipant;
    index?: number;
} | {
    kind: 'remove_participant';
    id: string;
} | {
    kind: 'rename_participant';
    id: string;
    newId: string;
} | {
    kind: 'insert_statement';
    statement: ZenUMLStatement;
    parentId?: string;
    branchIndex?: number;
    index?: number;
} | {
    kind: 'remove_statement';
    id: string;
} | {
    kind: 'set_statement';
    id: string;
    statement: ZenUMLStatement;
} | {
    kind: 'set_title';
    title?: string;
} | {
    kind: 'set_accessibility_title';
    title?: string;
} | {
    kind: 'set_accessibility_description';
    description?: string;
};

type EventFrameType = 'ui' | 'processor' | 'command' | 'readmodel' | 'event';
interface EventData {
    type?: string;
    text: string;
}
interface EventFrame {
    id: string;
    reset: boolean;
    type: EventFrameType;
    entity: string;
    sources: string[];
    dataReference?: string;
    data?: EventData;
}
interface EventSpecification {
    frame: string;
    given: Array<{
        type: EventFrameType;
        entity: string;
    }>;
    when: Array<{
        type: EventFrameType;
        entity: string;
    }>;
    then: Array<{
        type: EventFrameType;
        entity: string;
    }>;
}
interface EventModelingBody {
    kind: 'eventmodeling';
    frames: EventFrame[];
    entities: string[];
    data: Record<string, EventData>;
    notes: Array<{
        frame: string;
        data: EventData;
    }>;
    specifications: EventSpecification[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type EventModelingMutationOp = {
    kind: 'insert_frame';
    frame: EventFrame;
    index?: number;
} | {
    kind: 'remove_frame';
    id: string;
} | {
    kind: 'move_frame';
    id: string;
    index: number;
} | {
    kind: 'set_frame';
    id: string;
    frame: EventFrame;
} | {
    kind: 'set_data';
    id: string;
    data: EventData;
} | {
    kind: 'set_entities';
    entities: string[];
} | {
    kind: 'set_notes';
    notes: EventModelingBody['notes'];
} | {
    kind: 'set_specifications';
    specifications: EventSpecification[];
} | {
    kind: 'set_title';
    title?: string;
} | {
    kind: 'set_accessibility_title';
    title?: string;
} | {
    kind: 'set_accessibility_description';
    description?: string;
};

/** Shared authored C4 semantics. Pixel and terminal projections consume this
 * model without rewriting identities or deriving one layout from the other. */
type C4Variant = 'C4Context' | 'C4Container' | 'C4Component' | 'C4Dynamic' | 'C4Deployment';
type C4Direction = 'LR' | 'RL' | 'TB' | 'BT';
type C4ElementKind = 'person' | 'system' | 'container' | 'component';
type C4Shape = 'person' | 'rectangle' | 'database' | 'queue';
type C4BoundaryKind = 'boundary' | 'enterprise' | 'system' | 'container' | 'deployment';
interface C4SourceSpan {
    start: number;
    end: number;
    line: number;
    column: number;
}
interface C4ArgumentInput {
    name?: string;
    value: string;
}
interface C4Argument extends C4ArgumentInput {
    raw: string;
}
interface C4Style {
    bgColor?: string;
    fontColor?: string;
    borderColor?: string;
    textColor?: string;
    lineColor?: string;
    lineStyle?: string;
    shape?: string;
    shadowing?: string;
    offsetX?: string;
    offsetY?: string;
    [property: string]: string | undefined;
}
interface C4Declaration {
    id: string;
    /** Exact declaration macro; aliases remain distinct from their interpretation. */
    macro: string;
    label: string;
    parentId?: string;
    tags: string[];
    link?: string;
    /** Resolved link extension; authored link remains independent. */
    effectiveLink?: string;
    sprite?: string;
    style: C4Style;
    args: C4Argument[];
    statementId: string;
}
interface C4Element extends C4Declaration {
    kind: C4ElementKind;
    external: boolean;
    shape: C4Shape;
    technology?: string;
    description?: string;
}
interface C4Boundary extends C4Declaration {
    kind: C4BoundaryKind;
    type?: string;
    description?: string;
    alignment?: 'left' | 'right';
}
interface C4Relationship {
    id: string;
    macro: string;
    /** Authored endpoints, before Rel_Back interpretation. */
    from: string;
    to: string;
    /** Effective endpoints used by both projections. */
    source: string;
    target: string;
    label: string;
    technology?: string;
    description?: string;
    tags: string[];
    link?: string;
    effectiveLink?: string;
    sprite?: string;
    style: C4Style;
    args: C4Argument[];
    statementId: string;
    /** Explicit RelIndex value, independent of authored interaction order. */
    index?: string;
    /** One-based interaction number; repeated endpoint pairs remain separate. */
    order: number;
    bidirectional: boolean;
    reversed: boolean;
    direction?: C4Direction;
}
interface C4LayoutHint {
    from: string;
    to: string;
    direction: C4Direction;
    statementId: string;
}
interface C4LayoutHints {
    direction?: C4Direction;
    shapesPerRow?: number;
    boundariesPerRow?: number;
    hints: C4LayoutHint[];
}
interface C4Directive {
    id: string;
    name: string;
    args: C4Argument[];
    category: 'element-style' | 'relationship-style' | 'element-tag' | 'relationship-tag' | 'layout' | 'legend' | 'link' | 'unknown';
    statementId: string;
}
interface C4Statement {
    id: string;
    kind: 'header' | 'title' | 'accessibility' | 'element' | 'boundary-open' | 'boundary-close' | 'relationship' | 'directive' | 'trivia' | 'unknown';
    raw: string;
    span: C4SourceSpan;
    entityId?: string;
    /** Canonical authored fields at parse time, used only to retain unchanged raw source. */
    signature?: string;
}
interface C4Diagnostic {
    code: string;
    message: string;
    severity: 'warning' | 'error';
    statementId?: string;
}
/** A reader diagnostic on an authored statement. */
interface C4SyntaxDiagnostic extends C4Diagnostic {
    /** Stable `c4_<construct>` name, reported as verify's `syntax`. */
    syntax: string;
}
interface C4Body {
    kind: 'c4';
    variant: C4Variant;
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    elements: C4Element[];
    boundaries: C4Boundary[];
    relationships: C4Relationship[];
    directives: C4Directive[];
    statements: C4Statement[];
    diagnostics: C4SyntaxDiagnostic[];
    layout: C4LayoutHints;
    legend?: {
        visible: boolean;
        entries: {
            id: string;
            label: string;
            kind: 'element' | 'relationship';
            style: C4Style;
        }[];
    };
}
interface C4ElementInput {
    id: string;
    label: string;
    macro?: string;
    kind?: C4ElementKind;
    external?: boolean;
    shape?: C4Shape;
    technology?: string;
    description?: string;
    parentId?: string;
    tags?: string[];
    link?: string;
    sprite?: string;
}
interface C4BoundaryInput {
    id: string;
    label: string;
    macro?: string;
    kind?: C4BoundaryKind;
    type?: string;
    description?: string;
    parentId?: string;
    tags?: string[];
    link?: string;
    sprite?: string;
}
interface C4RelationshipInput {
    id?: string;
    from: string;
    to: string;
    label: string;
    macro?: string;
    technology?: string;
    description?: string;
    tags?: string[];
    link?: string;
    sprite?: string;
    index?: string;
}
type C4MutationOp = {
    kind: 'add_element';
    element: C4ElementInput;
} | {
    kind: 'update_element';
    id: string;
    changes: Partial<Omit<C4ElementInput, 'id' | 'parentId'>>;
} | {
    kind: 'rename_element';
    from: string;
    to: string;
} | {
    kind: 'reparent_element';
    id: string;
    parentId: string | null;
} | {
    kind: 'remove_element';
    id: string;
    cascade?: boolean;
} | {
    kind: 'add_boundary';
    boundary: C4BoundaryInput;
} | {
    kind: 'update_boundary';
    id: string;
    changes: Partial<Omit<C4BoundaryInput, 'id' | 'parentId'>>;
} | {
    kind: 'rename_boundary';
    from: string;
    to: string;
} | {
    kind: 'reparent_boundary';
    id: string;
    parentId: string | null;
} | {
    kind: 'remove_boundary';
    id: string;
    cascade?: boolean;
} | {
    kind: 'add_relationship';
    relationship: C4RelationshipInput;
} | {
    kind: 'update_relationship';
    id: string;
    changes: Partial<Omit<C4RelationshipInput, 'id'>>;
} | {
    kind: 'remove_relationship';
    id: string;
} | {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_variant';
    variant: C4Variant;
} | {
    kind: 'add_directive';
    name: string;
    args: C4ArgumentInput[];
} | {
    kind: 'update_directive';
    id: string;
    args: C4ArgumentInput[];
} | {
    kind: 'remove_directive';
    id: string;
};

interface Block {
    id: string;
    type?: string;
    label?: string;
    children?: Block[];
    columns?: number;
    widthInColumns?: number;
    width?: number;
    directions?: string[];
    classes?: string[];
    styles?: string[];
    colorIndex?: number;
    start?: string;
    end?: string;
    arrowTypeStart?: string;
    arrowTypeEnd?: string;
    thickness?: string;
    pattern?: string;
    css?: string;
    styleClass?: string;
    stylesStr?: string;
}
interface BlockClassDef {
    id: string;
    styles: string[];
    textStyles: string[];
}
interface BlockBody {
    kind: 'block';
    root: Block;
    edges: Block[];
    classDefs: BlockClassDef[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
interface BlockInput {
    id: string;
    label?: string;
    type?: string;
    widthInColumns?: number;
    columns?: number;
    directions?: string[];
    classes?: string[];
    styles?: string[];
    width?: number;
    children?: BlockInput[];
}
type BlockMutationOp = {
    kind: 'set_columns';
    columns: number;
    parentId?: string;
} | {
    kind: 'add_block';
    block: BlockInput;
    parentId?: string;
    index?: number;
} | {
    kind: 'update_block';
    id: string;
    changes: Partial<Omit<BlockInput, 'id'>>;
} | {
    kind: 'rename_block';
    from: string;
    to: string;
} | {
    kind: 'remove_block';
    id: string;
    cascade?: boolean;
} | {
    kind: 'move_block';
    id: string;
    parentId?: string;
    index?: number;
} | {
    kind: 'add_edge';
    from: string;
    to: string;
    label?: string;
    style?: 'solid' | 'dotted' | 'thick';
    arrowStart?: string;
    arrowEnd?: string;
} | {
    kind: 'remove_edge';
    id: string;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_node_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_node_style';
    id: string;
    style: string | null;
};

interface IshikawaNode {
    id: string;
    label: string;
    parentId?: string;
}
interface IshikawaBody {
    kind: 'ishikawa';
    nodes: IshikawaNode[];
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type IshikawaMutationOp = {
    kind: 'set_effect';
    label: string;
} | {
    kind: 'add_cause';
    label: string;
    parentId?: string;
} | {
    kind: 'remove_cause';
    id: string;
} | {
    kind: 'set_label';
    id: string;
    label: string;
} | {
    kind: 'move_cause';
    id: string;
    parentId: string;
    index?: number;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

interface KanbanItem {
    /** Collision-free public identity; sourceId retains repeated authored IDs. */
    id: string;
    sourceId: string;
    implicitId?: boolean;
    label: string;
    /** The declaration wrote the label as a Mermaid markdown string ("`…`"). */
    markdown?: true;
    metadata: Record<string, unknown>;
    icon?: string;
    className?: string;
}
interface KanbanColumn extends KanbanItem {
    tasks: KanbanItem[];
}
interface KanbanBody {
    kind: 'kanban';
    columns: KanbanColumn[];
    /** Display-only title supplied by the universal frontmatter envelope. */
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type KanbanMutationOp = {
    kind: 'add_column';
    id: string;
    label: string;
    index?: number;
} | {
    kind: 'remove_column';
    id: string;
    removeTasks?: boolean;
} | {
    kind: 'set_column_label';
    id: string;
    label: string;
} | {
    kind: 'move_column';
    id: string;
    index: number;
} | {
    kind: 'add_task';
    column: string;
    id: string;
    label: string;
    metadata?: Record<string, unknown>;
    index?: number;
} | {
    kind: 'remove_task';
    id: string;
} | {
    kind: 'set_task_label';
    id: string;
    label: string;
} | {
    kind: 'set_task_metadata';
    id: string;
    metadata: Record<string, unknown> | null;
} | {
    kind: 'move_task';
    id: string;
    column: string;
    index?: number;
} | {
    kind: 'set_icon';
    id: string;
    icon?: string;
} | {
    kind: 'set_class';
    id: string;
    className?: string;
} | {
    kind: 'set_accessibility_title';
    title?: string;
} | {
    kind: 'set_accessibility_description';
    description?: string;
};

interface PacketField {
    id: string;
    start: number;
    end: number;
    label: string;
}
interface PacketBody {
    kind: 'packet';
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    fields: PacketField[];
}
type PacketMutationOp = {
    kind: 'set_title';
    title?: string;
} | {
    kind: 'set_accessibility_title';
    title?: string;
} | {
    kind: 'set_accessibility_description';
    description?: string;
} | {
    kind: 'add_field';
    label: string;
    bits: number;
    index?: number;
} | {
    kind: 'remove_field';
    index: number;
} | {
    kind: 'set_field_label';
    index: number;
    label: string;
} | {
    kind: 'set_field_bits';
    index: number;
    bits: number;
} | {
    kind: 'move_field';
    from: number;
    to: number;
};

interface Requirement {
    name: string;
    type: string;
    requirementId: string;
    text: string;
    risk: string;
    verifyMethod: string;
    cssStyles: string[];
    classes: string[];
    directStyles?: string[];
}
interface RequirementElement {
    name: string;
    type: string;
    docRef: string;
    cssStyles: string[];
    classes: string[];
    directStyles?: string[];
}
interface Relation {
    type: string;
    src: string;
    dst: string;
}
interface RequirementClass {
    id: string;
    styles: string[];
    textStyles: string[];
}
interface RequirementRelation extends Relation {
    id: string;
}
interface RequirementBody {
    kind: 'requirement';
    direction: 'TB' | 'BT' | 'LR' | 'RL';
    requirements: Requirement[];
    elements: RequirementElement[];
    relations: RequirementRelation[];
    classDefs: RequirementClass[];
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
type RequirementInput = Pick<Requirement, 'name'> & Partial<Omit<Requirement, 'name' | 'cssStyles'>>;
type RequirementElementInput = Pick<RequirementElement, 'name'> & Partial<Omit<RequirementElement, 'name' | 'cssStyles'>>;
type RequirementMutationOp = {
    kind: 'set_direction';
    direction: RequirementBody['direction'];
} | {
    kind: 'add_requirement';
    requirement: RequirementInput;
} | {
    kind: 'update_requirement';
    id: string;
    changes: Partial<Omit<RequirementInput, 'name'>>;
} | {
    kind: 'add_element';
    element: RequirementElementInput;
} | {
    kind: 'update_element';
    id: string;
    changes: Partial<Omit<RequirementElementInput, 'name'>>;
} | {
    kind: 'rename_node';
    from: string;
    to: string;
} | {
    kind: 'remove_node';
    id: string;
    cascade?: boolean;
} | {
    kind: 'add_relation';
    relation: Omit<RequirementRelation, 'id'> & {
        id?: string;
    };
} | {
    kind: 'remove_relation';
    id: string;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_node_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_node_style';
    id: string;
    style: string | null;
};

interface TreemapNode {
    id: string;
    label: string;
    parentId?: string;
    value?: number;
    className?: string;
}
interface TreemapBody {
    kind: 'treemap';
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    nodes: TreemapNode[];
    classDefs: Record<string, Record<string, string>>;
}
type TreemapMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_node';
    label: string;
    value?: number;
    parentId?: string;
    className?: string;
} | {
    kind: 'remove_node';
    id: string;
} | {
    kind: 'set_label';
    id: string;
    label: string;
} | {
    kind: 'set_value';
    id: string;
    value: number;
} | {
    kind: 'move_node';
    id: string;
    parentId?: string;
    index?: number;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_node_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};

type GitGraphDirection = 'LR' | 'TB' | 'BT';
type GitGraphCommitType = 'NORMAL' | 'REVERSE' | 'HIGHLIGHT' | 'MERGE' | 'CHERRY_PICK';
interface GitGraphCommit {
    id: string;
    /** Authored duplicate ID when the stable occurrence identity differs. */
    sourceId?: string;
    message?: string;
    type: GitGraphCommitType;
    /** Visual override authored on a semantic merge commit. */
    customType?: Exclude<GitGraphCommitType, 'MERGE' | 'CHERRY_PICK'>;
    tags: string[];
    branch: string;
    parents: string[];
    sequence: number;
    source: 'commit' | 'merge' | 'cherry-pick';
    mergeBranch?: string;
    cherrySource?: string;
    cherryParent?: string;
    /** Parser-owned visual tag synthesized only when cherry-pick has no authored tags. */
    syntheticCherryTag?: string;
    /** True when the author supplied id:, false for deterministic c<N> ids. */
    customId: boolean;
}
interface GitGraphBranch {
    name: string;
    order: number;
    /** Source creation order; deterministic tiebreaker for equal explicit orders. */
    sequence: number;
    head?: string;
}
type GitGraphStatement = {
    kind: 'commit';
    ref: string;
} | {
    kind: 'branch';
    name: string;
    order?: number;
} | {
    kind: 'checkout';
    branch: string;
    keyword: 'checkout' | 'switch';
} | {
    kind: 'merge';
    ref: string;
    branch: string;
} | {
    kind: 'cherry-pick';
    ref: string;
    source: string;
    parent?: string;
};
interface GitGraphDiagram {
    direction: GitGraphDirection;
    mainBranchName: string;
    /** Frontmatter diagram title, rendered separately from accessibility metadata. */
    title?: string;
    commits: GitGraphCommit[];
    branches: GitGraphBranch[];
    statements: GitGraphStatement[];
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
interface PositionedGitGraphCommit extends GitGraphCommit {
    labelBlock?: PixelTextBlock;
    tagBlocks?: PixelTextBlock[];
    x: number;
    y: number;
    lane: number;
}
interface PositionedGitGraphBranch extends GitGraphBranch {
    labelBlock?: PixelTextBlock;
    lane: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
interface PositionedGitGraphEdge {
    from: string;
    to: string;
    kind: 'parent' | 'merge' | 'cherry-pick';
    points: Array<{
        x: number;
        y: number;
    }>;
}
interface PositionedGitGraphDiagram extends PositionedDiagram {
    titleBlock?: PixelTextBlock;
    direction: GitGraphDirection;
    title?: string;
    commits: PositionedGitGraphCommit[];
    branches: PositionedGitGraphBranch[];
    edges: PositionedGitGraphEdge[];
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    showBranches: boolean;
    showCommitLabel: boolean;
    rotateCommitLabel: boolean;
    /** Present only when a connector still passes a commit or runs along
     *  another connector (gitGraphRouteViolations): drawn, but uncertified. */
    uncertifiedLayout?: UncertifiedLayoutReceipt;
}

type MindmapShape = 'default' | 'rect' | 'rounded' | 'circle' | 'cloud' | 'bang' | 'hexagon';
interface MindmapNode {
    /** Distinct, addressable identity: the authored identity (explicit id, or a
     * default node's text), or for a later node repeating one, `<identity>#<n>`
     * in document order (see assignMindmapIdentities). */
    id: string;
    /** The authored identity, present only when `id` is a later occurrence's
     * generated id; serialization writes this, never `id`. */
    sourceId?: string;
    label: string;
    shape: MindmapShape;
    /** Label originated as Mermaid's quoted Markdown String syntax. */
    markdown?: true;
    icon?: string;
    className?: string;
    children: MindmapNode[];
}
interface MindmapDiagram {
    root: MindmapNode;
    /** The diagram's title (frontmatter `title:`). */
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
interface PositionedMindmapNode {
    labelBlock?: PixelTextBlock;
    iconFallbackBlock?: PixelTextBlock;
    id: string;
    label: string;
    shape: MindmapShape;
    markdown?: true;
    icon?: string;
    className?: string;
    parentId?: string;
    depth: number;
    /** Root-relative side assigned at the first branch boundary. */
    side: 'root' | 'left' | 'right';
    x: number;
    y: number;
    width: number;
    height: number;
}
interface PositionedMindmapEdge {
    from: string;
    to: string;
    /** Cubic branch control points: start, control1, control2, end. */
    points: Array<{
        x: number;
        y: number;
    }>;
    d: string;
}
interface PositionedMindmapDiagram extends PositionedDiagram {
    /** The diagram's title, in its band above the map. */
    title?: PositionedDiagramTitle;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    nodes: PositionedMindmapNode[];
    edges: PositionedMindmapEdge[];
}

type Result<T, E> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
declare function ok<T, E = never>(value: T): Result<T, E>;
declare function err<E, T = never>(error: E): Result<T, E>;
type DiagramKind = 'flowchart' | 'state' | 'sequence' | 'class' | 'er' | 'timeline' | 'journey' | 'xychart' | 'architecture' | 'pie' | 'quadrant' | 'gantt' | 'mindmap' | 'gitgraph' | 'radar' | 'sankey' | 'c4' | 'packet' | 'kanban' | 'requirement' | 'treemap' | 'ishikawa' | 'block' | 'eventmodeling' | 'zenuml' | 'agentflow' | 'usecase' | 'wardley' | 'venn' | 'cynefin' | 'railroad' | 'swimlane' | 'treeview';
/** Runtime extensions are open but must pass the registry's namespace validator. */
type ExternalFamilyId = `family:${string}`;
type FamilyId = DiagramKind | ExternalFamilyId;
type SequenceParticipantKind = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue';
interface SequenceParticipant {
    wrap?: boolean;
    id: string;
    label: string;
    labelContent?: LabelContent;
    kind: SequenceParticipantKind;
    /** Declaration keyword remains distinct from the visual metadata type. */
    declaration?: 'participant' | 'actor';
    /** Sanitized inert actor-menu links. */
    links?: Record<string, string>;
}
/** One name per Mermaid whole-head arrow, solid then dashed. A half-arrow
 * keeps its exact operator in `arrow` and only its shaft here (sync/reply). */
type SequenceMessageStyle = 'sync' | 'reply' | 'line' | 'line-dashed' | 'async' | 'async-dashed' | 'lost' | 'lost-dashed' | 'bidirectional' | 'bidirectional-dashed';
type SequenceMessageArrow = '<<->>' | '<<-->>' | '->>' | '-->>' | '->' | '-->' | '-x' | '--x' | '-)' | '--)' | '-|\\' | '--|\\' | '-|/' | '--|/' | '-\\\\' | '--\\\\' | '-//' | '--//' | '/|-' | '/|--' | '\\|-' | '\\|--' | '//-' | '//--' | '\\\\-' | '\\\\--' | '-|' | '--|' | '-/' | '--/' | '-\\' | '--\\' | '|-' | '|--' | '/-' | '/--' | '\\-' | '\\--';
interface SequenceMessage {
    /** Authored wrap control; absent inherits the diagram configuration. */
    wrap?: boolean;
    from: string;
    to: string;
    text: string;
    textContent?: LabelContent;
    style: SequenceMessageStyle;
    /** Exact official operator as read. Written while it has this `style`;
     * otherwise `style`'s own arrow is written. */
    arrow?: SequenceMessageArrow;
    centralStart?: boolean;
    centralEnd?: boolean;
    activate?: boolean;
    deactivate?: boolean;
}
type SequenceFragmentKind = 'alt' | 'opt' | 'loop' | 'par' | 'par_over';
interface SequenceFragmentBranch {
    wrap?: boolean;
    /** `else` / `and` caption. The first branch normally omits it. */
    label?: string;
    labelContent?: LabelContent;
    messages: SequenceMessage[];
}
interface SequenceFragment {
    wrap?: boolean;
    fragmentKind: SequenceFragmentKind;
    label?: string;
    labelContent?: LabelContent;
    branches: SequenceFragmentBranch[];
    /** Authored spelling retained until a typed fragment op changes the fragment. */
    rawLines?: string[];
}
type SequenceStatement = {
    kind: 'participant';
    ref: number;
} | {
    kind: 'message';
    ref: number;
} | {
    kind: 'actor-links';
    actorId: string;
    links: Record<string, string>;
} | {
    kind: 'fragment';
    fragment: SequenceFragment;
} | {
    kind: 'opaque-block';
    lines: string[];
};
interface SequenceBody {
    kind: 'sequence';
    participants: SequenceParticipant[];
    messages: SequenceMessage[];
    statements: SequenceStatement[];
}
interface TimelineEvent {
    /** Stable within one parse; recomputed each parse. Not a durable identifier. */
    id: string;
    text: string;
}
interface TimelinePeriod {
    id: string;
    /** The temporal label (e.g., "2020", "Q1 2024"). */
    label: string;
    events: TimelineEvent[];
}
interface TimelineSection {
    id: string;
    /** Undefined = implicit/ungrouped section. */
    label?: string;
    periods: TimelinePeriod[];
}
interface TimelineBody {
    kind: 'timeline';
    /** Authored family source when statement spelling cannot be canonicalized safely. */
    source?: string;
    /** Explicit header direction token (`timeline TD` / `timeline LR`,
     *  upstream PR #7270). Undefined = bare header (LR default). */
    direction?: 'LR' | 'TD';
    title?: string;
    /** Optional accessibility title from Mermaid accTitle. */
    accessibilityTitle?: string;
    /** Optional accessibility description from Mermaid accDescr (line or block form). */
    accessibilityDescription?: string;
    sections: TimelineSection[];
}
interface JourneyTask {
    /** Stable within one parse; recomputed each parse. Not a durable identifier. */
    id: string;
    text: string;
    textContent?: LabelContent;
    /** Satisfaction score, finite number 1..5 (Mermaid journey convention). */
    score: number;
    actors: string[];
    actorContents?: Array<LabelContent | undefined>;
}
interface JourneySection {
    id: string;
    /** Undefined = implicit/ungrouped section. */
    label?: string;
    labelContent?: LabelContent;
    tasks: JourneyTask[];
}
interface JourneyBody {
    kind: 'journey';
    title?: string;
    titleContent?: LabelContent;
    /** Optional accessibility title from Mermaid accTitle. */
    accessibilityTitle?: string;
    /** Optional accessibility description from Mermaid accDescr. */
    accessibilityDescription?: string;
    sections: JourneySection[];
}
type ClassRelationKind = 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization' | 'link-solid' | 'link-dashed' | 'lollipop';
interface ClassNode {
    /** A source lollipop occurrence, drawn as an interface endpoint rather than a class compartment. */
    isInterface?: boolean;
    /** Stable bare class identity (e.g., `Box` for authored `Box~T~`). */
    id: string;
    /** Generic parameter text from Mermaid's `~...~` syntax. */
    generic?: string;
    /** Optional display label (e.g., from `class X["My Label"]` or `class X as "..."`). */
    label?: string;
    labelContent?: LabelContent;
    /** Members, each as the raw source string ('+String name', '+eat()', '<<interface>>'). */
    members: string[];
    /**
     * Dot-joined namespace path the class is declared in (e.g. 'Platform.Auth');
     * undefined = top level. Serialization groups classes into `namespace path {}`
     * blocks the render parser accepts (repo #118).
     */
    namespace?: string;
    /** Assigned classDef name (`A:::hot`, class, or cssClass). */
    className?: string;
    /** Inline `style A ...` properties. */
    style?: Record<string, string>;
    /** Full ordered CSS when repeated properties cannot fit the query record. */
    styleDeclarations?: StyleDeclaration[];
    /** Sanitized inert class interaction URL. */
    href?: string;
    /** Optional authored hover text for a safe inert class link. */
    tooltip?: string;
}
/** A declared namespace: dot path + optional display label (`namespace X["L"]`). */
interface ClassNamespaceDecl {
    /** Dot-joined path, e.g. 'Company.Engineering.Backend'. */
    name: string;
    /** Optional display label (upstream v11.15+). */
    label?: string;
    labelContent?: LabelContent;
}
interface ClassRelation {
    from: string;
    to: string;
    kind: ClassRelationKind;
    /** Explicit shaft style; omitted values use the endpoint kinds' default. */
    lineStyle?: 'solid' | 'dashed';
    /** Optional relationship label, e.g., from `A --> B : uses`. */
    label?: string;
    labelContent?: LabelContent;
    /** Optional cardinality on the `from` side (e.g., '"1"'). */
    fromCardinality?: string;
    fromCardinalityContent?: LabelContent;
    /** Optional cardinality on the `to` side. */
    toCardinality?: string;
    toCardinalityContent?: LabelContent;
    /** Marker ownership for two-ended and lollipop relations. */
    markerAt?: 'from' | 'to' | 'both' | 'none';
    fromKind?: ClassRelationKind;
    toKind?: ClassRelationKind;
}
interface ClassNote {
    text: string;
    textContent?: LabelContent;
    /** Class id the note is attached to (undefined = freestanding). */
    for?: string;
}
interface ClassBody {
    kind: 'class';
    /** Authored family source retaining unmodeled statements and their block ownership. */
    source?: string;
    title?: string;
    classes: ClassNode[];
    relations: ClassRelation[];
    notes: ClassNote[];
    /**
     * Declared namespaces in first-seen order (repo #118). Optional so existing
     * constructions stay valid; classes reference entries via `namespace`.
     */
    namespaces?: ClassNamespaceDecl[];
    /** Typed classDef declarations keyed by class name. */
    classDefs?: Record<string, Record<string, string>>;
    classDefDeclarations?: Record<string, StyleDeclaration[]>;
}
type ErCardinality = 'parent' | 'one-only' | 'zero-or-one' | 'zero-or-many' | 'one-or-many';
interface ErAttribute {
    /** The full source line (e.g., 'string name PK "comment"'). */
    text: string;
}
interface ErEntity {
    /** Stable source identity. */
    id: string;
    /** Optional display label from `ID["Label"]`; identity remains `id`. */
    label?: string;
    labelContent?: LabelContent;
    attributes: ErAttribute[];
    className?: string;
    style?: Record<string, string>;
    /** The subgraph that keeps the entity: the first to close among those whose
     * own body names it (upstream 11.17's ER subgraphs; src/er/creation.ts). */
    groupId?: string;
}
interface ErGroup {
    id: string;
    label: string;
    labelContent?: LabelContent;
    parentId?: string;
    direction?: Direction$1;
}
interface ErRelation {
    from: string;
    to: string;
    leftCard: ErCardinality;
    rightCard: Exclude<ErCardinality, 'parent'>;
    /** Solid (--) or dashed (..) line. */
    dashed: boolean;
    label?: string;
    labelContent?: LabelContent;
}
type ErStatement = {
    kind: 'entity';
    id: string;
} | {
    kind: 'relation';
    ref: number;
} | {
    kind: 'direction';
    groupId?: string;
} | {
    kind: 'group-open';
    id: string;
} | {
    kind: 'group-close';
    id: string;
} | {
    kind: 'opaque';
    lines: string[];
};
interface ErBody {
    kind: 'er';
    entities: ErEntity[];
    relations: ErRelation[];
    groups?: ErGroup[];
    direction?: Direction$1;
    classDefs?: Record<string, Record<string, string>>;
    /** Ordered typed/opaque source segments; parsed bodies always populate it. */
    statements?: ErStatement[];
}
type ArchitectureSide = 'L' | 'R' | 'T' | 'B';
type ArchitectureEndpointBoundary = 'item' | 'group';
interface ArchitectureGroup {
    id: string;
    label: string;
    icon?: string;
    /** Undefined = root (not nested in another group). */
    parentId?: string;
}
interface ArchitectureService {
    id: string;
    label: string;
    icon?: string;
    iconText?: string;
    /** Undefined = ungrouped (not inside a group). */
    parentId?: string;
}
interface ArchitectureJunction {
    id: string;
    parentId?: string;
}
interface ArchitectureEndpoint {
    id: string;
    side: ArchitectureSide;
    /** Omitted is the canonical item boundary; `group` emits `{group}`. */
    boundary?: ArchitectureEndpointBoundary;
}
interface ArchitectureEdge {
    source: ArchitectureEndpoint;
    target: ArchitectureEndpoint;
    label?: string;
    hasArrowStart: boolean;
    hasArrowEnd: boolean;
}
/** `align row|column` directive (upstream v11.16.0): members share a row
 *  (same center y) or column (same center x). Members are declared
 *  services/junctions, ≥2 and unique per directive. */
interface ArchitectureAlignment {
    axis: 'row' | 'column';
    members: string[];
}
interface ArchitectureBody {
    kind: 'architecture';
    /** Visible heading from `title ...` (distinct from accessibility metadata). */
    title?: string;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    groups: ArchitectureGroup[];
    services: ArchitectureService[];
    junctions: ArchitectureJunction[];
    edges: ArchitectureEdge[];
    /** Optional so externally-synthesized bodies stay valid; absent ≡ []. */
    alignments?: ArchitectureAlignment[];
}
/** A single chart axis: an optional bare-text name plus EITHER categorical
 *  labels (x-axis only) OR a numeric range. All three fields are optional;
 *  a structured axis carries at least one of them. */
interface XyChartAxis {
    /** Optional bare-text axis name/title. */
    name?: string;
    /** Categorical labels (x-axis only) — mutually exclusive with range. */
    categories?: string[];
    /** Numeric range — mutually exclusive with categories. */
    range?: {
        min: number;
        max: number;
    };
}
interface XyChartSeries {
    /** Stable within one parse; recomputed each parse. Not a durable identifier. */
    id: string;
    kind: 'bar' | 'line';
    /** Optional bare-text series name. */
    name?: string;
    /** Data values; all finite. */
    values: number[];
    /** Mermaid 11.16 line point labels, index-aligned with values. */
    pointLabels?: Array<string | undefined>;
}
interface XyChartBody {
    kind: 'xychart';
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    title?: string;
    /** Header orientation: true = explicit horizontal, false = explicit vertical,
     *  absent = no header override (runtime config decides). */
    horizontal?: boolean;
    xAxis?: XyChartAxis;
    yAxis?: XyChartAxis;
    series: XyChartSeries[];
}
interface PieSlice {
    /** Stable within one parse; recomputed each parse. Not a durable identifier. */
    id: string;
    /** The slice label (contents of the `"..."` quotes). */
    label: string;
    /** The slice value — a positive finite number. */
    value: number;
}
interface PieBody {
    kind: 'pie';
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    title?: string;
    /** When true (`pie showData`), the legend shows each slice's numeric value. */
    showData: boolean;
    /** Slices in source order (drawn clockwise). */
    slices: PieSlice[];
}
/** Axis label pair. The "far" side is optional in the grammar. */
interface QuadrantAxis {
    /** x-axis: left label / y-axis: bottom label. */
    near: string;
    /** x-axis: right label / y-axis: top label. Optional. */
    far?: string;
}
/** Per-point styling (upstream mermaid#5173): direct or via classDef + `:::`.
 *  Shares the grammar/validation in src/quadrant/point-style.ts. */
interface QuadrantPointStyle {
    radius?: number;
    color?: string;
    strokeColor?: string;
    /** May carry a px suffix (upstream form, e.g. "5px"). */
    strokeWidth?: string;
    /** Unknown-but-safe `key: value` entries retained by the generous reader.
     * They never render and have no portable Mermaid spelling. */
    extra?: string[];
}
interface QuadrantPoint {
    label: string;
    /** Normalized x in [0, 1] (0 = left, 1 = right). */
    x: number;
    /** Normalized y in [0, 1] (0 = bottom, 1 = top). */
    y: number;
    /** Optional `:::className` class assignment. */
    className?: string;
    /** Optional direct styles (win over class styles). */
    style?: QuadrantPointStyle;
}
interface QuadrantBody {
    kind: 'quadrant';
    accessibilityTitle?: string;
    accessibilityDescription?: string;
    title?: string;
    xAxis?: QuadrantAxis;
    yAxis?: QuadrantAxis;
    /**
     * Quadrant region labels indexed 1..4 by Mermaid's numbering:
     *   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
     * Stored 0-based where index `n-1` holds quadrant-`n`.
     */
    quadrants: [string?, string?, string?, string?];
    /** Plotted points in source order. */
    points: QuadrantPoint[];
    /** classDef styles by class name, in source order. Optional for synthesized
     *  payloads; parsed bodies populate it whenever classDefs are present. */
    classDefs?: Record<string, QuadrantPointStyle>;
}
/** A radial axis (spoke). */
interface RadarBodyAxis {
    /** Axis identifier (resolves keyed curve entries). */
    id: string;
    /** Display label; defaults to `id` when no `["Label"]` was given. */
    label: string;
}
/** A plotted curve (series). Values are in axis-declaration order. */
interface RadarBodyCurve {
    id: string;
    label: string;
    /** One value per axis, in axis order. Non-negative (grammar has no sign). */
    values: number[];
}
interface RadarBody {
    kind: 'radar';
    title?: string;
    /** Axes (spokes) in declaration order. */
    axes: RadarBodyAxis[];
    /** Curves (series) in declaration order. */
    curves: RadarBodyCurve[];
    /** Lower scale bound (default 0). */
    min: number;
    /** Upper scale bound; undefined = auto (max of all curve values). */
    max?: number;
    /** Concentric ring count (default 5). */
    ticks: number;
    /** Ring + curve-edge style (default 'circle'). */
    graticule: 'circle' | 'polygon';
    /** Whether the legend is drawn (default true). */
    showLegend: boolean;
}
/** One flow row (`source,target,value`). Nodes are implied by the labels. */
interface SankeyBodyLink {
    source: string;
    target: string;
    /** Flow amount — non-negative and finite. */
    value: number;
}
interface SankeyBody {
    kind: 'sankey';
    /** Flows in authored row order. Parallel duplicates are legal and kept. */
    links: SankeyBodyLink[];
}
type GanttBodyTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert';
interface GanttBodyTask {
    /** Stable within one parse; recomputed each parse. Not a durable identifier. */
    id: string;
    /** Mermaid task id from `:id, start, end` — referenced by after/until/click. */
    taskId?: string;
    label: string;
    /** Status/shape tags in canonical order (active/done/crit/milestone/vert). */
    tags: GanttBodyTaskTag[];
    /** Raw start expression: a date in the diagram's dateFormat or `after id…`.
     *  Undefined = starts when the previous task ends (Mermaid default). */
    start?: string;
    /** Raw end expression: a date, a duration token (`3d`), or `until id…`. */
    end: string;
}
interface GanttBodySection {
    id: string;
    /** Undefined = implicit/ungrouped section. */
    label?: string;
    tasks: GanttBodyTask[];
}
/**
 * Segment-preserving statement list (the sequence-body pattern): typed ops see
 * sections/tasks/title; calendar directives (dateFormat, excludes, weekend…),
 * click lines, comments, and markers ride along VERBATIM as opaque-block
 * segments — never dropped, edited at the source level only.
 */
type GanttStatement = {
    kind: 'title';
} | {
    kind: 'section';
    ref: number;
} | {
    kind: 'task';
    section: number;
    ref: number;
} | {
    kind: 'opaque-block';
    lines: string[];
};
interface GanttBody {
    kind: 'gantt';
    title?: string;
    /** Effective tick format; distinct from literal task labels and date input. */
    axisFormat?: string;
    sections: GanttBodySection[];
    /** Optional for synthesized payloads; parsed bodies always populate it. */
    statements?: GanttStatement[];
}
/**
 * A state node. Simple states carry an optional display label; composite states
 * additionally carry their own nested `states` + `transitions` (and an optional
 * per-composite `direction`). The reserved pseudostate `[*]` is NOT a StateNode
 * — it is modeled contextually as the endpoint id '[*]' on transitions (source
 * = start pseudostate, target = end pseudostate), scoped per composite level.
 */
interface StateNode {
    id: string;
    /** Optional display label (`state "Label" as id` / `id : Label`), its
     *  Mermaid entity codes (`#35;`) read. */
    label?: string;
    /** The label as written, while `label` still holds what it reads. */
    labelContent?: LabelContent;
    /** Authored/synthesized standalone declaration; implicit transition endpoints omit it. */
    declaredBare?: true;
    /** Standalone declaration boundary among transitions in this owning scope.
     * Contextual [*] nodes are created at their transition, so state-array order
     * alone cannot reconstruct this timing. Omitted on synthetic legacy bodies. */
    declarationBeforeTransition?: number;
    /** Pseudostate stereotype (`state id <<fork|join|choice|history|…>>`) —
     *  fork/join render as bars, choice as a diamond, history as an (H)/(H*)
     *  circle. `<<H>>`/`<<H*>>` shorthands normalize to history/deep-history. */
    stereotype?: 'fork' | 'join' | 'choice' | 'history' | 'deep-history';
    /** Composite children — present for a non-concurrent composite. */
    states?: StateNode[];
    /** Composite-internal transitions — present for a non-concurrent composite. */
    transitions?: StateTransition[];
    /** Parallel regions split by `--`; mutually exclusive with states/transitions. */
    regions?: StateRegion[];
    /** Assigned classDef names (`A:::hot` / `class A hot`), space-separated in
     *  assignment order: a state takes every class assigned to it, as in
     *  Mermaid. `set_state_class` replaces them with one class. */
    className?: string;
    /** Inline state paint (`style A fill:#...`). */
    style?: Record<string, string>;
    /** Full ordered CSS when repeated properties cannot fit the query record. */
    styleDeclarations?: StyleDeclaration[];
    /** Optional per-composite layout direction. */
    direction?: Direction$1;
}
interface StateRegion {
    states: StateNode[];
    transitions: StateTransition[];
    /** A direction authored after this region's separator. */
    direction?: Direction$1;
}
interface StateTransition {
    /** Source state id, '[*]' for a start pseudostate, or a history reference
     *  (`[H]`, `[H*]`, `Base[H]`, `Base[H*]` — preserved verbatim). */
    from: string;
    /** Target state id, '[*]' for an end pseudostate, or a history reference. */
    to: string;
    /** classDef name on a `[*]` or history `from` (`[*]:::hot --> A`). Such an
     *  endpoint is not a StateNode and Mermaid has no `class` statement for it,
     *  so its class stays on the transition. */
    fromClass?: string;
    /** classDef name on a `[*]` or history `to` (`A --> [*]:::hot`). */
    toClass?: string;
    label?: string;
    /** The label as written, while `label` still holds what it reads. */
    labelContent?: LabelContent;
    /** Inline edge paint represented canonically as a linkStyle directive. */
    style?: Record<string, string>;
}
/** A state-diagram note (`note left|right of X`). Part of the structured body
 *  (repo #118): queryable, mutable via add_note/remove_note/set_note_text,
 *  and round-tripping through the render parser. */
interface StateNote {
    /** The state (or composite) the note is anchored to. */
    target: string;
    /** Declared side — the renderer anchors the note box on this side. */
    side: 'left' | 'right';
    /** Note text; multi-line text serializes as the block form (`end note`). */
    text: string;
    /** The text as written, while `text` still holds what it reads. */
    textContent?: LabelContent;
}
interface StateBody {
    /** Authored Mermaid layout hints retained through editing; geometry remains renderer-owned. */
    layoutDirectives?: string[];
    /** Class assignments awaiting an actual state declaration; they never create a state. */
    unresolvedClasses?: Array<{
        id: string;
        className: string;
    }>;
    /** Inline styles awaiting an actual state declaration. */
    unresolvedStyles?: Array<{
        id: string;
        style: Record<string, string>;
        styleDeclarations?: StyleDeclaration[];
    }>;
    kind: 'state';
    states: StateNode[];
    transitions: StateTransition[];
    /** Notes in source order; absent when the diagram has none. */
    notes?: StateNote[];
    /** Named, unattached annotations; scoped independently of state identity. */
    floatingNotes?: StateFloatingNote[];
    /** Optional top-level layout direction. */
    direction?: Direction$1;
    /** Typed classDef declarations keyed by class name. */
    classDefs?: Record<string, Record<string, string>>;
    classDefDeclarations?: Record<string, StyleDeclaration[]>;
    /** Default edge paint (`linkStyle default ...`). */
    defaultTransitionStyle?: Record<string, string>;
}
type StateFloatingNote = FloatingStateNote;
interface MindmapBody {
    kind: 'mindmap';
    root: MindmapNode;
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}
interface GitGraphBody extends GitGraphDiagram {
    kind: 'gitgraph';
}
interface SourceComment {
    text: string;
    line: number;
}
interface InitDirective {
    raw: string;
    /** Authored object layer, retaining legacy config scope; not an effective merge. */
    parsed: MermaidConfigMap;
}
interface Accessibility {
    title?: string;
    descr?: string;
}
interface ValidDiagramMeta {
    /** Native effective config view. Captured wrapper/init bytes own authored layers.
     * For explicit JSON config changes, omit wrapperSource when synthesizing. */
    frontmatter?: MermaidFrontmatterMap;
    initDirectives: InitDirective[];
    comments: SourceComment[];
    accessibility: Accessibility;
    /**
     * The leading source wrapper (frontmatter block, `%%{init}%%` directives,
     * `%%` comments, and blank lines before the diagram header): the exact bytes
     * before the family header. Parsed diagrams retain it even when empty.
     * serializeMermaid re-emits it untouched by default; canonical wrapper
     * synthesis is opt-in via `{ wrapper: 'canonical' }`. Diagrams synthesized
     * from JSON payloads omit it to request canonical synthesis.
     */
    wrapperSource?: string;
    /**
     * In-body `%%` comments that structured serialization does not preserve,
     * computed at parse time by diffing against the canonical serialization.
     * Surfaced by verify as the Tier 3 `COMMENT_DROPPED` lint. Opaque bodies
     * preserve comments verbatim and never set this.
     *
     * `line` locates the comment in the artifact where the loss happened, which
     * is not always the artifact carrying this receipt: mutation rebuilds every
     * other meta field and the source map from its output, but reparsing
     * already-canonical source cannot rediscover a comment that serialization
     * dropped, so the original receipt — and its original line — rides along.
     * Treat it as a record of what was lost, not as an index into
     * `canonicalSource`.
     */
    droppedComments?: SourceComment[];
    /** Parser-identified body comments, anchored where the family exposes a
     * stable statement identity; unassociated/deleted anchors follow the body. */
    bodyComments?: Array<{
        raw: string;
        anchor?: {
            collection: 'nodes' | 'edges' | 'groups';
            id: string;
        };
        placement: 'before' | 'after';
    }>;
}
interface SourceLocation {
    line: number;
    col: number;
}
interface SourceMapSpans {
    /** Exact authored document spans, including wrapper/config directives. */
    preserved: PreservedSourceSpans;
    /** Exact authored statement spans keyed like the corresponding location map. */
    nodes: Map<string, SourceSpan>;
    edges: Map<string, SourceSpan>;
    groups: Map<string, SourceSpan>;
    /** Exact authored sub-statement spans (labels, members, values, cardinalities). */
    labels: Map<string, SourceSpan>;
    /** Authored metadata key/value tokens, keyed by canonical item occurrence identity and property. */
    metadata?: Map<string, Map<string, {
        key: SourceSpan;
        value: SourceSpan;
    }>>;
}
interface SourceMap {
    nodes: Map<string, SourceLocation>;
    edges: Map<string, SourceLocation>;
    groups: Map<string, SourceLocation>;
    /** Stable label spans where known: `node:<id>`, `edge#<i>:<from>-><to>`, `group:<id>`. */
    labels: Map<string, SourceLocation>;
    /**
     * Exact authored spans. The legacy location maps above remain canonical-source
     * coordinates for compatibility; this sidecar is authored-source based.
     */
    spans?: SourceMapSpans;
}
type DiagramActionKind = 'href' | 'call' | 'callback';
type DiagramActionSecurity = 'safe' | 'unsafe' | 'source-only' | 'unsupported';
interface DiagramActionRecord {
    /** Stable source-side action id (`action:<family>:<target>:<n>`). */
    id?: string;
    /** Region id this action attaches to when a rendered layout exposes regions. */
    regionId?: string;
    family: DiagramKind;
    target: string;
    action: DiagramActionKind;
    /** Original action payload after the target id; never executed by analysis. */
    raw: string;
    line?: number;
    href?: string;
    tooltip?: string;
    security: DiagramActionSecurity;
    executable: false;
    message?: string;
}
interface FeedbackEdgeAnalysis {
    edgeIndex: number;
    from: NodeId;
    to: NodeId;
    label?: string;
    routeClass: RouteClass;
}
interface GanttScheduleAnalysisSummary {
    criticalPathTaskIds: string[];
    slackByTaskId: Record<string, number>;
    projectStart: number;
    projectEnd: number;
    entryTaskIds: string[];
    sinkTaskIds: string[];
}
interface DiagramAnalysis {
    kind: FamilyId;
    feedbackEdges: FeedbackEdgeAnalysis[];
    actions: DiagramActionRecord[];
    gantt?: GanttScheduleAnalysisSummary;
}
type DiagramBody = {
    kind: 'flowchart';
    graph: MermaidGraph;
} | AgentflowBody | UsecaseBody | WardleyBody | VennBody | CynefinBody | RailroadBody | SwimlaneBody | TreeviewBody | StateBody | SequenceBody | TimelineBody | ClassBody | ErBody | JourneyBody | ArchitectureBody | XyChartBody | PieBody | QuadrantBody | GanttBody | MindmapBody | GitGraphBody | RadarBody | SankeyBody | C4Body | PacketBody | KanbanBody | RequirementBody | TreemapBody | IshikawaBody | BlockBody | EventModelingBody | ZenUMLBody
/**
 * Opaque body — the parser understood the family header but encountered
 * unmodeled syntax. `source` is the ORIGINAL body with indentation, blank
 * lines, and comments PRESERVED (per the Loop 5 Phase A fix), so the
 * serializer can re-emit byte-for-byte. Distinct from `ValidDiagram.canonicalSource`,
 * which for structured bodies is the rebuilt canonical form.
 */
 | {
    kind: 'opaque';
    family: DiagramKind;
    source: string;
    diagnostic?: {
        code: 'GITGRAPH_DUPLICATE_COMMIT_ID';
        id: string;
    };
};
/** Open, source-preserving body envelope owned by a namespaced family. */
interface ExtensionDiagramBody {
    kind: 'extension';
    family: ExternalFamilyId;
    source: string;
    /** Descriptor-owned structured value; core treats it as opaque data. */
    data?: unknown;
}
interface SourceSpanPoint {
    /** UTF-16 offset in the exact authored source string. */
    readonly offset: number;
    readonly line: number;
    readonly col: number;
}
interface SourceSpan {
    readonly start: SourceSpanPoint;
    readonly end: SourceSpanPoint;
}
/** Exact spans retained when no installed family can claim the source. */
interface PreservedSourceSpans {
    /** Exact span of the complete authored source. */
    readonly source: SourceSpan;
    readonly wrapper?: SourceSpan;
    /** YAML frontmatter including its delimiters and trailing newline. */
    readonly frontmatter?: SourceSpan;
    /** Mermaid `%%{init...}%%` / `%%{initialize...}%%` directives. */
    readonly initDirectives?: readonly SourceSpan[];
    /** Exact source spans of `accTitle` / `accDescr` directives. */
    readonly accessibilityDirectives?: readonly SourceSpan[];
    readonly header: SourceSpan;
    /** Authored payload after the header line. */
    readonly body: SourceSpan;
}
/**
 * Lossless, non-renderable family envelope. Upstream-recognized sources use an
 * opaque classification; wholly unknown headers use `unknown`. In both cases
 * the original document and its source spans remain available for storage,
 * serialization, later registration, and stable capability diagnostics.
 */
interface PreservedDiagramBody {
    readonly kind: 'preserved';
    readonly representation: 'opaque' | 'unknown';
    readonly source: string;
    readonly preservation: SourcePreservationReceipt;
    readonly spans: PreservedSourceSpans;
    readonly diagnostic: {
        readonly code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH';
        readonly message: string;
        readonly help: string;
    };
}
type FamilyParsedBody = DiagramBody | ExtensionDiagramBody | PreservedDiagramBody;
interface ValidDiagram {
    readonly kind: DiagramKind;
    readonly meta: ValidDiagramMeta;
    readonly body: DiagramBody;
    readonly source: SourceMap;
    /**
     * Load-bearing round-trip pillar. See AGENT_NATIVE.md § (3).
     *
     * For STRUCTURED bodies, `canonicalSource` is the normalized text
     * (`normalized.text` from `mermaid-source.ts`) — used by `renderMermaidSVG`
     * + the legacy parser for the flowchart pathway. After `serializeMermaid`,
     * the re-emitted source is rebuilt from the structured body. Families whose
     * grammar reads indentation as structure (mindmap, kanban, treemap,
     * ishikawa) keep each line's indentation, so parsing `canonicalSource`
     * reads the same diagram; other families' lines are trimmed.
     * AgentFlow preserves indentation in this source because flattening YAML
     * changes its meaning; copied parsed envelopes must remain executable.
     *
     * For OPAQUE bodies, the serializer emits `body.source` directly (NOT
     * `canonicalSource`) so original indentation and blank lines round-trip
     * byte-for-byte. `canonicalSource` is still set, but it's the normalized
     * form (line-trimmed, or indentation-keeping for the families above) —
     * useful for layout / rendering, not for fidelity.
     *
     * This split exists because the legacy flowchart parser needs trimmed
     * lines, but opaque-fallback round-trip needs the original. Treat
     * `body.source` as the source of truth for opaque-body fidelity.
     */
    readonly canonicalSource: string;
}
interface ExtensionValidDiagram {
    readonly kind: ExternalFamilyId;
    /** Identity of the exact descriptor contract that produced `body.data`.
     * Core uses it to keep an upgraded registration from consuming stale,
     * descriptor-owned structured data. */
    readonly descriptorIdentity: ExtensionIdentity<'family'>;
    readonly meta: ValidDiagramMeta;
    readonly body: ExtensionDiagramBody;
    readonly source: SourceMap;
    readonly canonicalSource: string;
}
interface PreservedValidDiagram {
    /** Namespaced non-registration identity; the upstream/header identity lives in `body.preservation`. */
    readonly kind: ExternalFamilyId;
    readonly meta: ValidDiagramMeta;
    readonly body: PreservedDiagramBody;
    readonly source: SourceMap;
    readonly canonicalSource: string;
}
type ParsedDiagram = ValidDiagram | ExtensionValidDiagram | PreservedValidDiagram;
type FlowchartValidDiagram = ValidDiagram & {
    body: {
        kind: 'flowchart';
        graph: MermaidGraph;
    };
};
type SwimlaneValidDiagram = ValidDiagram & {
    body: SwimlaneBody;
};
type TreeviewValidDiagram = ValidDiagram & {
    body: TreeviewBody;
};
declare function asSwimlane(d: ParsedDiagram): SwimlaneValidDiagram | null;
declare function asTreeview(d: ParsedDiagram): TreeviewValidDiagram | null;
type StateValidDiagram = ValidDiagram & {
    body: StateBody;
};
type SequenceValidDiagram = ValidDiagram & {
    body: SequenceBody;
};
type TimelineValidDiagram = ValidDiagram & {
    body: TimelineBody;
};
type ClassValidDiagram = ValidDiagram & {
    body: ClassBody;
};
type ErValidDiagram = ValidDiagram & {
    body: ErBody;
};
type JourneyValidDiagram = ValidDiagram & {
    body: JourneyBody;
};
type ArchitectureValidDiagram = ValidDiagram & {
    body: ArchitectureBody;
};
type XyChartValidDiagram = ValidDiagram & {
    body: XyChartBody;
};
type PieValidDiagram = ValidDiagram & {
    body: PieBody;
};
type QuadrantValidDiagram = ValidDiagram & {
    body: QuadrantBody;
};
type GanttValidDiagram = ValidDiagram & {
    body: GanttBody;
};
type MindmapValidDiagram = ValidDiagram & {
    body: MindmapBody;
};
type GitGraphValidDiagram = ValidDiagram & {
    body: GitGraphBody;
};
type RadarValidDiagram = ValidDiagram & {
    body: RadarBody;
};
type SankeyValidDiagram = ValidDiagram & {
    body: SankeyBody;
};
type C4ValidDiagram = ValidDiagram & {
    body: C4Body;
};
type PacketValidDiagram = ValidDiagram & {
    body: PacketBody;
};
type KanbanValidDiagram = ValidDiagram & {
    body: KanbanBody;
};
type RequirementValidDiagram = ValidDiagram & {
    body: RequirementBody;
};
type TreemapValidDiagram = ValidDiagram & {
    body: TreemapBody;
};
type ZenUMLValidDiagram = ValidDiagram & {
    body: ZenUMLBody;
};
type EventModelingValidDiagram = ValidDiagram & {
    body: EventModelingBody;
};
type IshikawaValidDiagram = ValidDiagram & {
    body: IshikawaBody;
};
type BlockValidDiagram = ValidDiagram & {
    body: BlockBody;
};
type MutableValidDiagram = FlowchartValidDiagram | AgentflowValidDiagram | UsecaseValidDiagram | WardleyValidDiagram | VennValidDiagram | CynefinValidDiagram | RailroadValidDiagram | SwimlaneValidDiagram | TreeviewValidDiagram | StateValidDiagram | SequenceValidDiagram | TimelineValidDiagram | ClassValidDiagram | ErValidDiagram | JourneyValidDiagram | ArchitectureValidDiagram | XyChartValidDiagram | PieValidDiagram | QuadrantValidDiagram | GanttValidDiagram | MindmapValidDiagram | GitGraphValidDiagram | RadarValidDiagram | SankeyValidDiagram | C4ValidDiagram | PacketValidDiagram | KanbanValidDiagram | RequirementValidDiagram | TreemapValidDiagram | IshikawaValidDiagram | EventModelingValidDiagram | ZenUMLValidDiagram | BlockValidDiagram;
declare function asPacket(d: ParsedDiagram): PacketValidDiagram | null;
declare function asKanban(d: ParsedDiagram): KanbanValidDiagram | null;
declare function asRequirement(d: ParsedDiagram): RequirementValidDiagram | null;
declare function asTreemap(d: ParsedDiagram): TreemapValidDiagram | null;
declare function asIshikawa(d: ParsedDiagram): IshikawaValidDiagram | null;
declare function asBlock(d: ParsedDiagram): BlockValidDiagram | null;
declare function asFlowchart(d: ParsedDiagram): FlowchartValidDiagram | null;
declare function asState(d: ParsedDiagram): StateValidDiagram | null;
declare function asSequence(d: ParsedDiagram): SequenceValidDiagram | null;
declare function asTimeline(d: ParsedDiagram): TimelineValidDiagram | null;
declare function asClass(d: ParsedDiagram): ClassValidDiagram | null;
declare function asEr(d: ParsedDiagram): ErValidDiagram | null;
declare function asJourney(d: ParsedDiagram): JourneyValidDiagram | null;
declare function asArchitecture(d: ParsedDiagram): ArchitectureValidDiagram | null;
declare function asXyChart(d: ParsedDiagram): XyChartValidDiagram | null;
declare function asPie(d: ParsedDiagram): PieValidDiagram | null;
declare function asQuadrant(d: ParsedDiagram): QuadrantValidDiagram | null;
declare function asRadar(d: ParsedDiagram): RadarValidDiagram | null;
declare function asC4(d: ParsedDiagram): C4ValidDiagram | null;
declare function asSankey(d: ParsedDiagram): SankeyValidDiagram | null;
declare function asGantt(d: ParsedDiagram): GanttValidDiagram | null;
declare function asMindmap(d: ParsedDiagram): MindmapValidDiagram | null;
declare function asGitGraph(d: ParsedDiagram): GitGraphValidDiagram | null;
interface SourcePreservationReceipt {
    version: 1;
    classification: 'unsupported' | 'inventory-only' | 'unknown';
    /** Exact authored bytes supplied to parseRegisteredMermaid. */
    source: string;
    header: string;
    upstreamFamilyId?: string;
    mermaidVersion: string;
    /** Present for open preserved envelopes and family-detection errors emitted by this version. */
    spans?: PreservedSourceSpans;
}
interface ParseError {
    code: string;
    message: string;
    line?: number;
    col?: number;
    /** One-based column; col is retained as a compatibility alias. */
    column?: number;
    diagramType?: string;
    /** Present when parsing cannot proceed but no authored bytes were discarded. */
    preservation?: SourcePreservationReceipt;
    help?: string;
}
interface MutationError {
    code: 'NODE_NOT_FOUND' | 'EDGE_NOT_FOUND' | 'PARTICIPANT_NOT_FOUND' | 'MESSAGE_NOT_FOUND' | 'SECTION_NOT_FOUND' | 'PERIOD_NOT_FOUND' | 'EVENT_NOT_FOUND' | 'TASK_NOT_FOUND' | 'ACTOR_NOT_FOUND' | 'CLASS_NOT_FOUND' | 'MEMBER_NOT_FOUND' | 'RELATION_NOT_FOUND' | 'NOTE_NOT_FOUND' | 'ENTITY_NOT_FOUND' | 'ATTRIBUTE_NOT_FOUND' | 'SERVICE_NOT_FOUND' | 'GROUP_NOT_FOUND' | 'SERIES_NOT_FOUND' | 'AXIS_NOT_FOUND' | 'CURVE_NOT_FOUND' | 'SLICE_NOT_FOUND' | 'POINT_NOT_FOUND' | 'LINK_NOT_FOUND' | 'STATE_NOT_FOUND' | 'TRANSITION_NOT_FOUND' | 'DUPLICATE_NODE' | 'DUPLICATE_PARTICIPANT' | 'DUPLICATE_CLASS' | 'DUPLICATE_ENTITY' | 'DUPLICATE_STATE' | 'DUPLICATE_TASK' | 'INVALID_OP' | 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER';
    message: string;
}
type NodeId = string;
type EdgeId = string;
type GroupId = string;
type ParticipantId = string;
type FlowchartMutationOp = {
    kind: 'add_node';
    id: NodeId;
    label: string;
    shape?: NodeShape | (string & {});
    parent?: GroupId;
} | {
    kind: 'remove_node';
    id: NodeId;
} | {
    kind: 'rename_node';
    from: NodeId;
    to: NodeId;
} | {
    kind: 'set_label';
    target: NodeId | EdgeId;
    label: string;
} | {
    kind: 'add_edge';
    from: NodeId;
    to: NodeId;
    label?: string;
    style?: EdgeStyle;
} | {
    kind: 'remove_edge';
    id: EdgeId;
} | {
    kind: 'set_shape';
    id: NodeId;
    shape: NodeShape | (string & {});
} | {
    kind: 'set_direction';
    direction: Direction$1;
    subgraph?: GroupId;
} | {
    kind: 'add_subgraph';
    id: GroupId;
    label?: string;
    parent?: GroupId;
    members?: NodeId[];
} | {
    kind: 'remove_subgraph';
    id: GroupId;
    removeMembers?: boolean;
} | {
    kind: 'move_node';
    id: NodeId;
    subgraph: GroupId | null;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_node_class';
    id: NodeId;
    className: string | null;
} | {
    kind: 'set_node_style';
    id: NodeId;
    style: string | null;
};
type SequenceMutationOp = {
    kind: 'add_participant';
    id: ParticipantId;
    label?: string;
    participantKind?: 'participant' | 'actor';
} | {
    kind: 'remove_participant';
    id: ParticipantId;
} | {
    kind: 'add_message';
    from: ParticipantId;
    to: ParticipantId;
    text: string;
    wrap?: boolean;
    style?: SequenceMessageStyle;
    index?: number;
} | {
    kind: 'remove_message';
    index: number;
} | {
    kind: 'set_message_text';
    index: number;
    text: string;
} | {
    kind: 'set_message_wrap';
    index: number;
    wrap: boolean | null;
} | {
    kind: 'move_message';
    from: number;
    to: number;
} | {
    kind: 'set_participant_label';
    id: ParticipantId;
    label: string;
} | {
    kind: 'add_fragment';
    fragmentKind: SequenceFragmentKind;
    label?: string;
    index?: number;
} | {
    kind: 'remove_fragment';
    index: number;
} | {
    kind: 'set_fragment_label';
    index: number;
    label: string | null;
} | {
    kind: 'add_fragment_branch';
    fragmentIndex: number;
    label?: string;
} | {
    kind: 'set_fragment_branch_label';
    fragmentIndex: number;
    branchIndex: number;
    label: string | null;
} | {
    kind: 'add_fragment_message';
    fragmentIndex: number;
    branchIndex?: number;
    from: ParticipantId;
    to: ParticipantId;
    text: string;
    wrap?: boolean;
    style?: SequenceMessageStyle;
    index?: number;
} | {
    kind: 'remove_fragment_message';
    fragmentIndex: number;
    branchIndex?: number;
    index: number;
} | {
    kind: 'set_fragment_message_text';
    fragmentIndex: number;
    branchIndex?: number;
    index: number;
    text: string;
} | {
    kind: 'set_fragment_message_wrap';
    fragmentIndex: number;
    branchIndex?: number;
    index: number;
    wrap: boolean | null;
};
type TimelineMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_section';
    label: string;
    index?: number;
} | {
    kind: 'remove_section';
    index: number;
} | {
    kind: 'set_section_label';
    index: number;
    label: string;
} | {
    kind: 'add_period';
    sectionIndex: number;
    label: string;
    events?: string[];
    index?: number;
} | {
    kind: 'remove_period';
    sectionIndex: number;
    periodIndex: number;
} | {
    kind: 'set_period_label';
    sectionIndex: number;
    periodIndex: number;
    label: string;
} | {
    kind: 'add_event';
    sectionIndex: number;
    periodIndex: number;
    text: string;
    index?: number;
} | {
    kind: 'remove_event';
    sectionIndex: number;
    periodIndex: number;
    eventIndex: number;
} | {
    kind: 'set_event_text';
    sectionIndex: number;
    periodIndex: number;
    eventIndex: number;
    text: string;
} | {
    kind: 'move_period';
    fromSection: number;
    fromIndex: number;
    toSection: number;
    toIndex: number;
} | {
    kind: 'move_event';
    fromSection: number;
    fromPeriod: number;
    fromIndex: number;
    toSection: number;
    toPeriod: number;
    toIndex: number;
} | {
    kind: 'move_section';
    from: number;
    to: number;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};
type ClassMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_class';
    id: string;
    label?: string;
    generic?: string;
    members?: string[];
    namespace?: string;
} | {
    kind: 'remove_class';
    id: string;
} | {
    kind: 'rename_class';
    from: string;
    to: string;
} | {
    kind: 'set_class_generic';
    class: string;
    generic: string | null;
} | {
    kind: 'add_member';
    class: string;
    text: string;
} | {
    kind: 'remove_member';
    class: string;
    index: number;
} | {
    kind: 'add_interface';
    class: string;
    label: string;
    side?: 'from' | 'to';
    relationLabel?: string;
    lineStyle?: 'solid' | 'dashed';
} | {
    kind: 'add_relation';
    from: string;
    to: string;
    relKind: ClassRelationKind;
    label?: string;
    markerAt?: ClassRelation['markerAt'];
    fromKind?: ClassRelationKind;
    toKind?: ClassRelationKind;
    lineStyle?: ClassRelation['lineStyle'];
} | {
    kind: 'remove_relation';
    index: number;
} | {
    kind: 'add_note';
    text: string;
    for?: string;
} | {
    kind: 'remove_note';
    index: number;
} | {
    kind: 'set_class_namespace';
    class: string;
    namespace: string | null;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_css_class';
    class: string;
    className: string | null;
} | {
    kind: 'set_class_style';
    class: string;
    style: string | null;
};
type ErMutationOp = {
    kind: 'add_entity';
    id: string;
    label?: string;
    attributes?: string[];
} | {
    kind: 'remove_entity';
    id: string;
} | {
    kind: 'rename_entity';
    from: string;
    to: string;
} | {
    kind: 'set_entity_label';
    entity: string;
    label: string | null;
} | {
    kind: 'add_attribute';
    entity: string;
    text: string;
} | {
    kind: 'remove_attribute';
    entity: string;
    index: number;
} | {
    kind: 'add_relation';
    from: string;
    to: string;
    leftCard: ErCardinality;
    rightCard: Exclude<ErCardinality, 'parent'>;
    dashed?: boolean;
    label?: string;
} | {
    kind: 'remove_relation';
    index: number;
} | {
    kind: 'set_direction';
    direction: Direction$1;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_entity_class';
    entity: string;
    className: string | null;
} | {
    kind: 'set_entity_style';
    entity: string;
    style: string | null;
};
type JourneyMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_section';
    label: string;
    index?: number;
} | {
    kind: 'remove_section';
    index: number;
} | {
    kind: 'set_section_label';
    index: number;
    label: string;
} | {
    kind: 'add_task';
    sectionIndex: number;
    text: string;
    score: number;
    actors?: string[];
    index?: number;
} | {
    kind: 'remove_task';
    sectionIndex: number;
    taskIndex: number;
} | {
    kind: 'set_task_text';
    sectionIndex: number;
    taskIndex: number;
    text: string;
} | {
    kind: 'set_task_score';
    sectionIndex: number;
    taskIndex: number;
    score: number;
} | {
    kind: 'set_task_actors';
    sectionIndex: number;
    taskIndex: number;
    actors: string[];
} | {
    kind: 'rename_actor';
    from: string;
    to: string;
} | {
    kind: 'move_task';
    fromSection: number;
    fromIndex: number;
    toSection: number;
    toIndex: number;
} | {
    kind: 'move_section';
    from: number;
    to: number;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};
type ArchitectureMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
} | {
    kind: 'add_service';
    id: string;
    label?: string;
    icon?: string | null;
    iconText?: string | null;
    group?: string | null;
} | {
    kind: 'remove_service';
    id: string;
} | {
    kind: 'rename_service';
    from: string;
    to: string;
} | {
    kind: 'set_service_label';
    id: string;
    label: string;
} | {
    kind: 'set_service_icon';
    id: string;
    icon: string | null;
} | {
    kind: 'set_service_icon_text';
    id: string;
    text: string | null;
} | {
    kind: 'move_service';
    id: string;
    group: string | null;
} | {
    kind: 'add_junction';
    id: string;
    group?: string | null;
} | {
    kind: 'remove_junction';
    id: string;
} | {
    kind: 'rename_junction';
    from: string;
    to: string;
} | {
    kind: 'move_junction';
    id: string;
    group: string | null;
} | {
    kind: 'add_group';
    id: string;
    label?: string;
    icon?: string | null;
    parent?: string | null;
} | {
    kind: 'set_group_label';
    id: string;
    label: string;
} | {
    kind: 'remove_group';
    id: string;
} | {
    kind: 'add_edge';
    from: string;
    to: string;
    fromSide: ArchitectureSide;
    toSide: ArchitectureSide;
    fromBoundary?: ArchitectureEndpointBoundary;
    toBoundary?: ArchitectureEndpointBoundary;
    label?: string | null;
    hasArrowStart?: boolean;
    hasArrowEnd?: boolean;
} | {
    kind: 'update_edge';
    index: number;
    from?: string;
    to?: string;
    fromSide?: ArchitectureSide;
    toSide?: ArchitectureSide;
    fromBoundary?: ArchitectureEndpointBoundary;
    toBoundary?: ArchitectureEndpointBoundary;
    label?: string | null;
    hasArrowStart?: boolean;
    hasArrowEnd?: boolean;
} | {
    kind: 'remove_edge';
    index?: number;
    id?: string;
};
type StateMutationOp = {
    kind: 'add_region';
    parent: string;
    index?: number;
} | {
    kind: 'remove_region';
    parent: string;
    index: number;
} | {
    kind: 'add_state';
    id: string;
    label?: string | null;
    parent?: string | null;
    region?: number;
} | {
    kind: 'remove_state';
    id: string;
    recursive?: boolean;
} | {
    kind: 'rename_state';
    from: string;
    to: string;
} | {
    kind: 'set_state_label';
    id: string;
    label: string | null;
} | {
    kind: 'add_transition';
    from: string;
    to: string;
    label?: string | null;
    parent?: string | null;
    region?: number;
} | {
    kind: 'remove_transition';
    index?: number;
    from?: string;
    to?: string;
    parent?: string | null;
    region?: number;
} | {
    kind: 'set_transition_label';
    index?: number;
    from?: string;
    to?: string;
    label: string | null;
    parent?: string | null;
    region?: number;
} | {
    kind: 'make_composite';
    id: string;
    members: string[];
    label?: string | null;
} | {
    kind: 'set_direction';
    direction: Direction$1;
    state?: string | null;
} | {
    kind: 'move_state';
    id: string;
    parent: string | null;
    region?: number;
} | {
    kind: 'dissolve_composite';
    id: string;
} | {
    kind: 'add_note';
    target: string;
    side?: 'left' | 'right';
    text: string;
} | {
    kind: 'remove_note';
    index: number;
} | {
    kind: 'set_note_text';
    index: number;
    text: string;
} | {
    kind: 'add_floating_note';
    id: string;
    text: string;
    parent?: string | null;
    region?: number;
} | {
    kind: 'remove_floating_note';
    id: string;
} | {
    kind: 'set_floating_note_text';
    id: string;
    text: string;
} | {
    kind: 'define_class';
    name: string;
    style: string;
} | {
    kind: 'set_state_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_state_style';
    id: string;
    style: string | null;
} | {
    kind: 'set_transition_style';
    index?: number;
    default?: boolean;
    style: string | null;
    parent?: string | null;
    region?: number;
};
type GitGraphMutationOp = {
    kind: 'append_commit';
    id?: string;
    message?: string;
    type?: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'>;
    tags?: string[];
} | {
    kind: 'create_branch';
    name: string;
    order?: number;
} | {
    kind: 'checkout_branch';
    name: string;
} | {
    kind: 'merge_branch';
    name: string;
    id?: string;
    type?: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'>;
    tags?: string[];
} | {
    kind: 'cherry_pick';
    id: string;
    parent?: string;
    tags?: string[];
} | {
    kind: 'set_commit_message';
    id: string;
    message: string | null;
} | {
    kind: 'set_commit_type';
    id: string;
    type: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'>;
} | {
    kind: 'set_commit_tags';
    id: string;
    tags: string[];
} | {
    kind: 'rename_branch';
    from: string;
    to: string;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};
type MindmapMutationOp = {
    kind: 'add_node';
    id: string;
    label: string;
    parent: string;
    shape?: MindmapShape;
    index?: number;
} | {
    kind: 'remove_node';
    id: string;
    recursive?: boolean;
} | {
    kind: 'rename_node';
    from: string;
    to: string;
} | {
    kind: 'set_label';
    id: string;
    label: string;
} | {
    kind: 'move_node';
    id: string;
    parent: string;
    index?: number;
} | {
    kind: 'set_shape';
    id: string;
    shape: MindmapShape;
} | {
    kind: 'set_icon';
    id: string;
    icon: string | null;
} | {
    kind: 'set_node_class';
    id: string;
    className: string | null;
} | {
    kind: 'set_accessibility_title';
    title: string | null;
} | {
    kind: 'set_accessibility_description';
    description: string | null;
};
type XyChartAxisSpec = {
    name?: string | null;
    categories?: string[];
    range?: {
        min: number;
        max: number;
    };
};
type XyChartMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_x_axis';
    axis: XyChartAxisSpec | null;
} | {
    kind: 'set_y_axis';
    axis: XyChartAxisSpec | null;
} | {
    kind: 'add_series';
    kind2: 'bar' | 'line';
    name?: string | null;
    values: number[];
} | {
    kind: 'remove_series';
    index: number;
} | {
    kind: 'set_series_values';
    index: number;
    values: number[];
} | {
    kind: 'set_series_name';
    index: number;
    name: string | null;
} | {
    kind: 'reorder_series';
    from: number;
    to: number;
} | {
    kind: 'set_orientation';
    horizontal: boolean;
} | {
    kind: 'set_data_point';
    seriesIndex: number;
    index: number;
    value: number;
};
type PieMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_show_data';
    showData: boolean;
} | {
    kind: 'add_slice';
    label: string;
    value: number;
} | {
    kind: 'remove_slice';
    label: string;
} | {
    kind: 'rename_slice';
    from: string;
    to: string;
} | {
    kind: 'set_slice_value';
    label: string;
    value: number;
} | {
    kind: 'reorder_slice';
    from: number;
    to: number;
};
type QuadrantMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'set_axis_labels';
    axis: 'x' | 'y';
    near: string | null;
    far?: string | null;
} | {
    kind: 'set_quadrant_label';
    quadrant: number;
    label: string | null;
} | {
    kind: 'add_point';
    label: string;
    x: number;
    y: number;
} | {
    kind: 'remove_point';
    label: string;
} | {
    kind: 'move_point';
    label: string;
    x: number;
    y: number;
} | {
    kind: 'rename_point';
    from: string;
    to: string;
};
type RadarMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_axis';
    id: string;
    label?: string | null;
    index?: number;
    fill?: number;
} | {
    kind: 'remove_axis';
    id: string;
} | {
    kind: 'rename_axis';
    from: string;
    to: string;
} | {
    kind: 'set_axis_label';
    id: string;
    label: string | null;
} | {
    kind: 'reorder_axis';
    from: number;
    to: number;
} | {
    kind: 'add_curve';
    id: string;
    label?: string | null;
    values: number[];
    index?: number;
} | {
    kind: 'remove_curve';
    id: string;
} | {
    kind: 'set_curve_values';
    id: string;
    values: number[];
} | {
    kind: 'set_curve_value';
    curve: string;
    axis: string;
    value: number;
} | {
    kind: 'set_curve_label';
    id: string;
    label: string | null;
} | {
    kind: 'rename_curve';
    from: string;
    to: string;
} | {
    kind: 'reorder_curve';
    from: number;
    to: number;
} | {
    kind: 'set_config';
    max?: number | null;
    min?: number | null;
    ticks?: number | null;
    graticule?: 'circle' | 'polygon' | null;
    showLegend?: boolean | null;
};
type SankeyMutationOp = {
    kind: 'add_link';
    source: string;
    target: string;
    value: number;
    index?: number;
} | {
    kind: 'remove_link';
    source: string;
    target: string;
    occurrence?: number;
} | {
    kind: 'set_link_value';
    source: string;
    target: string;
    value: number;
    occurrence?: number;
} | {
    kind: 'rename_node';
    from: string;
    to: string;
};
type GanttMutationOp = {
    kind: 'set_title';
    title: string | null;
} | {
    kind: 'add_section';
    label: string;
} | {
    kind: 'rename_section';
    index: number;
    label: string;
} | {
    kind: 'remove_section';
    index: number;
} | {
    kind: 'add_task';
    sectionIndex: number;
    label: string;
    taskId?: string;
    tags?: GanttBodyTaskTag[];
    start?: string;
    end: string;
    index?: number;
} | {
    kind: 'remove_task';
    sectionIndex: number;
    taskIndex: number;
} | {
    kind: 'rename_task';
    sectionIndex: number;
    taskIndex: number;
    label: string;
} | {
    kind: 'set_task_status';
    sectionIndex: number;
    taskIndex: number;
    status: 'active' | 'done' | 'crit' | null;
} | {
    kind: 'set_task_dates';
    sectionIndex: number;
    taskIndex: number;
    start?: string | null;
    end?: string;
} | {
    kind: 'set_task_flags';
    sectionIndex: number;
    taskIndex: number;
    milestone?: boolean;
    vert?: boolean;
} | {
    kind: 'set_task_id';
    sectionIndex: number;
    taskIndex: number;
    taskId: string | null;
} | {
    kind: 'move_task';
    fromSection: number;
    fromIndex: number;
    toSection: number;
    toIndex: number;
} | {
    kind: 'move_section';
    from: number;
    to: number;
};
type AnyMutationOp = SwimlaneMutationOp | FlowchartMutationOp | AgentflowMutationOp | UsecaseMutationOp | WardleyMutationOp | VennMutationOp | CynefinMutationOp | RailroadMutationOp | TreeviewMutationOp | StateMutationOp | SequenceMutationOp | TimelineMutationOp | ClassMutationOp | ErMutationOp | JourneyMutationOp | ArchitectureMutationOp | XyChartMutationOp | PieMutationOp | QuadrantMutationOp | GanttMutationOp | MindmapMutationOp | GitGraphMutationOp | RadarMutationOp | SankeyMutationOp | C4MutationOp | PacketMutationOp | KanbanMutationOp | RequirementMutationOp | TreemapMutationOp | IshikawaMutationOp | BlockMutationOp | EventModelingMutationOp | ZenUMLMutationOp;
declare const FINITE_BRAND: unique symbol;
type Finite = number & {
    readonly [FINITE_BRAND]: true;
};
declare function toFinite(n: number): Finite;
type WarningSeverity = 'error' | 'warning';
type WarningTier = 'structural' | 'geometric' | 'lint';
/** Who can fix a finding: the authored diagram source, its configuration
 * (Mermaid config, theme, render options), or Agentic Mermaid itself. */
type WarningOrigin = 'source' | 'config' | 'engine';
type Tier1WarningCode = 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH' | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'UNRESOLVABLE_SCHEDULE' | 'RENDER_FAILED' | 'INTERNAL_ERROR';
type Tier2WarningCode = 'NODE_OVERLAP' | 'CONTENT_OCCLUDED' | 'LAYOUT_LIMIT_EXCEEDED' | 'LAYOUT_UNCERTIFIED' | 'ROUTE_SELF_CROSS' | 'ROUTE_HITCH' | 'ROUTE_UNEXPLAINED_BEND' | 'ROUTE_LABEL_ON_SHARED_TRUNK' | 'ROUTE_SELF_LOOP_OCCUPANCY' | 'ROUTE_CONTAINER_MISANCHOR' | 'ROUTE_SHAPE_MISANCHOR' | 'ROUTE_STALE_AFTER_NODE_MOVE';
/**
 * Tier 3 (advisory lint). Family-specific quality hints for common agent
 * mistakes that still parse and render. Lint warnings never flip verify.ok.
 */
type Tier3WarningCode = 'DUPLICATE_EDGE' | 'UNREACHABLE_NODE' | 'DECISION_BRANCH_UNLABELED' | 'FLOW_IMBALANCE' | 'VENN_APPROXIMATION' | 'COMMENT_DROPPED' | 'UNSUPPORTED_SYNTAX' | 'CONTENT_DROPPED_ON_ROUNDTRIP' | 'EVENT_SOURCE_TYPE' | 'INEFFECTIVE_CONFIG' | 'LOW_CONTRAST' | 'LABELS_HIDDEN' | 'SCALE_RANGE_EXCLUDES_ZERO' | 'BAR_RANGE_EXCLUDES_ZERO' | 'VALUES_OUTSIDE_RANGE' | typeof BRAND_CONSTRAINT_WARNING_POLICY.warn.code;
type WarningCode = Tier1WarningCode | Tier2WarningCode | Tier3WarningCode | BrandConstraintWarningCode;
type LayoutWarning = {
    code: 'VENN_APPROXIMATION';
    message: string;
} | {
    code: 'EMPTY_DIAGRAM';
} | {
    code: 'EDGE_MISANCHORED';
    edge: EdgeId;
    from?: NodeId;
    to?: NodeId;
} | {
    code: 'OFF_CANVAS';
    target: NodeId | EdgeId;
    axis: 'x' | 'y';
} | {
    code: 'GROUP_BREACH';
    group: GroupId;
    member: NodeId;
} | {
    code: 'UNKNOWN_SHAPE';
    node: NodeId;
    shape: string;
} | {
    code: 'LABEL_OVERFLOW';
    target: NodeId | EdgeId;
    charCount: number;
    limit: number;
}
/**
 * The diagram parses (and round-trips) but its semantics cannot resolve, so
 * rendering will fail loudly — e.g. a Gantt whose schedule hits a bad
 * calendar date, a dependency cycle, or an everything-excluded calendar.
 * `reason` carries the named renderer error (GANTT_*…). Closes the
 * "verify ok but render throws" seam for structured gantt bodies.
 */
 | {
    code: 'UNRESOLVABLE_SCHEDULE';
    reason: string;
}
/**
 * The diagram parses on the agent side (possibly with unmodeled syntax
 * preserved verbatim) but the STRICT render parser throws on its canonical
 * source — `am render` would exit 4. Generalizes UNRESOLVABLE_SCHEDULE's
 * "verify ok but render throws" seam-closing to every family: found live
 * when onboarding agents followed verify-before-commit and still shipped
 * unrenderable quadrant/architecture diagrams. `reason` carries the
 * renderer's error message; `origin` says whether the source or its
 * configuration caused it (an engine defect is INTERNAL_ERROR instead).
 */
 | {
    code: 'RENDER_FAILED';
    reason: string;
    origin: Exclude<WarningOrigin, 'engine'>;
}
/**
 * Agentic Mermaid hit an internal defect while drawing this source; the
 * source did not cause it. `defaultRender` records whether an ordinary
 * render of the same request still produces output (`succeeds-unchecked`:
 * only verify's extra consistency checks failed, so the layout evidence
 * cannot be trusted) or throws (`fails`).
 */
 | {
    code: 'INTERNAL_ERROR';
    reason: string;
    defaultRender: 'fails' | 'succeeds-unchecked';
} | {
    code: 'NODE_OVERLAP';
    a: NodeId;
    b: NodeId;
    areaPx: number;
}
/** Final measured paint hides authored text or an interaction marker. */
 | {
    code: 'CONTENT_OCCLUDED';
    target: string;
    feature: 'label' | 'marker';
    line?: number;
    message: string;
}
/** Content remains intact but cannot fit an explicitly requested layout budget. */
 | {
    code: 'LAYOUT_LIMIT_EXCEEDED';
    constraint: string;
    message: string;
}
/**
 * No bounded layout candidate passed certification, so report layout safety
 * drew the best one anyway. `violation` is the failed check class (a hard
 * rubric metric such as `endpointApproaches`, `groupHeaderBand`, or a paint
 * issue code); `targets` are the element ids it names.
 */
 | {
    code: 'LAYOUT_UNCERTIFIED';
    violation: string;
    targets: string[];
    message: string;
} | {
    code: 'ROUTE_SELF_CROSS';
    edge: EdgeId;
    count: number;
} | {
    code: 'ROUTE_HITCH';
    edge: EdgeId;
    deviationPx: number;
} | {
    code: 'ROUTE_UNEXPLAINED_BEND';
    edge: EdgeId;
} | {
    code: 'ROUTE_LABEL_ON_SHARED_TRUNK';
    edge: EdgeId;
    sharedWith: EdgeId;
} | {
    code: 'ROUTE_SELF_LOOP_OCCUPANCY';
    edge: EdgeId;
    conflictWith?: EdgeId;
    kind: 'allocation' | 'side' | 'boundary' | 'route-route' | 'label-label' | 'label-route';
} | {
    code: 'ROUTE_CONTAINER_MISANCHOR';
    edge: EdgeId;
    container: GroupId;
} | {
    code: 'ROUTE_SHAPE_MISANCHOR';
    edge: EdgeId;
    node: NodeId;
} | {
    code: 'ROUTE_STALE_AFTER_NODE_MOVE';
    edge: EdgeId;
    node: NodeId;
} | {
    code: 'DUPLICATE_EDGE';
    edge: EdgeId;
    duplicateOf: EdgeId;
    from: NodeId;
    to: NodeId;
    label?: string;
} | {
    code: 'UNREACHABLE_NODE';
    node: NodeId;
} | {
    code: 'DECISION_BRANCH_UNLABELED';
    node: NodeId;
    edge: EdgeId;
}
/**
 * A sankey intermediate node (one with both inflow and outflow) receives a
 * different total than it emits. Conservation across stages is the domain's
 * defining property — the ribbon widths are an account — and an imbalance
 * renders silently as node height `max(in, out)`, hiding the unaccounted
 * quantity. Advisory lint (real datasets carry rounding drift); never flips
 * verify.ok.
 */
 | {
    code: 'FLOW_IMBALANCE';
    node: NodeId;
    inflow: number;
    outflow: number;
    message: string;
} | {
    code: 'COMMENT_DROPPED';
    count: number;
    lines: number[];
} | {
    code: 'UNSUPPORTED_SYNTAX';
    line?: number;
    syntax: string;
    node?: NodeId;
    message: string;
}
/**
 * Structured content changed across a parse → serialize → re-parse cycle:
 * the re-read states different facts (`lost`, `gained`; describeMermaidFacts),
 * so canonical serialization is silently dropping, adding or altering
 * content even though the bytes may re-parse; `before`/`after` carry the
 * {nodes, edges, groups} tallies. The faithfulness analogue of
 * COMMENT_DROPPED — "100% parse success is not faithfulness" (Loop 17).
 * Lint, never flips verify.ok.
 */
 | {
    code: 'CONTENT_DROPPED_ON_ROUNDTRIP';
    before: {
        nodes: number;
        edges: number;
        groups: number;
    };
    after: {
        nodes: number;
        edges: number;
        groups: number;
    };
    lost?: string[];
    gained?: string[];
    message?: string;
}
/**
 * A Mermaid config field was accepted (for config-shape compatibility) but
 * has no effect on this family's geometry or paint — e.g. Journey's
 * sequence-era fields. Accepting-and-ignoring silently misleads migrating
 * users; this lint says so. Never flips verify.ok.
 */
 | {
    code: 'EVENT_SOURCE_TYPE';
    node: NodeId;
    source: NodeId;
    message: string;
} | {
    code: 'INEFFECTIVE_CONFIG';
    field: string;
    message: string;
}
/** Authored paint remains authoritative but fails a measurable contrast
 * threshold against the final resolved background. Advisory: never repaints. */
 | {
    code: 'LOW_CONTRAST';
    field: string;
    foreground: string;
    background: string;
    ratio: number;
    minimum: number;
    message: string;
}
/**
 * The layout left out chart text the source asked for because it did not
 * fit: x-axis category names thinned or dropped, or bar value labels with no
 * room inside or beyond their bar. `labels` lists exactly what is missing.
 * Advisory: the chart still renders; never flips verify.ok.
 */
 | {
    code: 'LABELS_HIDDEN';
    target: 'title' | 'legend' | 'x-axis' | 'data-labels' | 'point-labels';
    labels: string[];
    message: string;
}
/**
 * An authored value-axis range excludes zero on a chart with bar series, so
 * bars start at `baseline` and their lengths are not proportional to their
 * values. Advisory: the authored range is kept; never flips verify.ok.
 */
 | {
    code: 'SCALE_RANGE_EXCLUDES_ZERO';
    range: {
        min: number;
        max: number;
    };
    baseline: number;
    message: string;
} | {
    code: 'BAR_RANGE_EXCLUDES_ZERO';
    range: {
        min: number;
        max: number;
    };
    baseline: number;
    message: string;
}
/**
 * A series has values outside the authored value-axis range. A bar stops at
 * the edge of the range, so its length understates the value; a line point
 * is drawn past the plot. `values` lists every such value of the series.
 * Advisory: the authored range is kept; never flips verify.ok.
 */
 | {
    code: 'VALUES_OUTSIDE_RANGE';
    series: string;
    values: number[];
    range: {
        min: number;
        max: number;
    };
    message: string;
} | {
    code: BrandConstraintWarningCode;
    constraint: BrandConstraintKind;
    measurement: 'measurable' | 'unmeasurable' | 'not-applicable';
    role?: string;
    mark?: string;
    foreground?: string;
    background?: string;
    ratio?: number;
    minimum?: number;
    actual?: number;
    maximum?: number;
    message: string;
};
declare const WARNING_SEVERITY: Record<WarningCode, WarningSeverity>;
declare const WARNING_TIER: Record<WarningCode, WarningTier>;
declare const DEFAULT_LABEL_CHAR_CAP = 40;
interface VerifyOptions {
    /** Known warning codes; any other value is refused (VerifyOptionsError). */
    suppress?: WarningCode[];
    /** LABEL_OVERFLOW's cap, a positive safe integer (default 40); any other
     * value is refused (VerifyOptionsError), as `am verify --label-cap` refuses it. */
    labelCharCap?: number;
    /** Shared source/config/geometry/appearance options used by render parity and layout evidence. */
    renderOptions?: RenderOptions;
}
/**
 * Semantic region vocabulary shared by layout/action surfaces. `group` is the
 * compatibility fallback; built-in families use the more precise container
 * kinds wherever their layout model can prove one.
 */
type RenderedRegionKind = 'node' | 'edge' | 'label' | 'canvas' | 'group' | 'cluster' | 'lane' | 'band' | 'compartment' | 'plot' | 'ring';
interface RenderedRegion {
    id: string;
    kind: RenderedRegionKind;
    elementId?: string;
    parentId?: string;
    bounds: {
        x: Finite;
        y: Finite;
        w: Finite;
        h: Finite;
    };
    /** Exact occupied terminal cells; repeated occurrences need not form one rectangle. */
    cellSpans?: Array<{
        row: number;
        start: number;
        end: number;
    }>;
    /** Semantic route cells occluded by opaque chart marks; excluded from visible cellSpans. */
    occludedCellSpans?: Array<{
        row: number;
        start: number;
        end: number;
    }>;
    sourceLine?: number;
}
/** Retained bounds in the renderer's pixel coordinate system. */
interface RenderedLabelBounds {
    x: Finite;
    y: Finite;
    w: Finite;
    h: Finite;
}
/** Painted text independent of a semantic node, such as chart ticks or titles. */
interface RenderedLayoutLabel {
    id: string;
    text: string;
    bounds?: RenderedLabelBounds;
    container?: RenderedLabelBounds;
    visibility?: 'visible' | 'hidden' | 'semantic';
}
interface RenderedLayoutNode {
    id: NodeId;
    /** Authored immediate container, supplied by families with a typed hierarchy. */
    parentId?: GroupId;
    x: Finite;
    y: Finite;
    w: Finite;
    h: Finite;
    shape: string;
    label?: string;
    /** Actual prepared visible text; absent when an extension did not retain measurement. */
    labelBounds?: RenderedLabelBounds;
    /** Available text region; external mark labels use the canvas rather than the mark. */
    labelContainer?: RenderedLabelBounds;
    /** Hidden text and semantic-only mark metadata are not unmeasured visible labels. */
    labelVisibility?: 'visible' | 'hidden' | 'semantic';
    /** Authored chart coordinates, retained before pixel rounding. */
    dataPosition?: {
        x: Finite;
        y: Finite;
    };
    /** Explicit semantic role for family-generic quality scoring. Shape is paint,
     *  not semantics: a rectangular bar is a mark, not a node box. */
    role?: 'box' | 'mark' | 'labelled-mark';
}
interface RenderedLayoutEdge {
    /** Lexical fragment that owns this relation, when the family retains scopes. */
    parentId?: GroupId;
    id: EdgeId;
    from: NodeId;
    to: NodeId;
    path: [Finite, Finite][];
    /** Hidden structural routes do not contribute visible crossing metrics. Omitted means visible. */
    visibility?: 'visible' | 'hidden';
    label?: {
        x: Finite;
        y: Finite;
        text: string;
        bounds?: RenderedLabelBounds;
    };
    /** Edge route certificate; present only under layoutMermaid(d, { debug: true }) for families with an edge certificate model. */
    route?: EdgeRouteCertificate;
}
interface RenderedLayoutGroup {
    id: GroupId;
    x: Finite;
    y: Finite;
    w: Finite;
    h: Finite;
    members: NodeId[];
    label?: string;
    /** Parent group id for flattened region-tree consumers; undefined means root-level group. */
    parentId?: GroupId;
    /** Semantic region kind used by the renderer/action sidecar. */
    regionKind?: Exclude<RenderedRegionKind, 'node' | 'edge' | 'label' | 'canvas'>;
}
interface RenderedLayout {
    /** Bounded native paint evidence, included by debug layout projection. */
    paintCertification?: PaintLayoutCertification;
    version: 1;
    /** Open family id so registered extensions can expose the same layout envelope. */
    kind: FamilyId;
    nodes: RenderedLayoutNode[];
    edges: RenderedLayoutEdge[];
    groups: RenderedLayoutGroup[];
    /** Retained painted text that does not create a semantic node or data mark. */
    labels?: RenderedLayoutLabel[];
    /** Region-containment certificates for non-edge invariants; present only under layoutMermaid(d, { debug: true }). */
    certificates?: RegionContainmentCertificate[];
    /** Optional region sidecar for renderer/action alignment; debug-only in layoutMermaid V1. */
    regions?: RenderedRegion[];
    /** Optional source-only actions aligned to region ids; debug-only in layoutMermaid V1. */
    actions?: DiagramActionRecord[];
    bounds: {
        w: Finite;
        h: Finite;
    };
}
interface VerificationChecks {
    renderability: 'passed' | 'failed' | 'not-checked';
    /** No detected loss is not a general losslessness proof. */
    sourceLoss: 'detected' | 'not-detected';
    taskCorrectness: 'not-checked';
}
interface VerifyResult {
    /** Explicit check scope; ok remains the backward-compatible error gate. */
    checks?: VerificationChecks;
    /** Final graphical proof or its explicit coverage limitations. */
    layoutCertification?: PaintLayoutCertification;
    ok: boolean;
    warnings: LayoutWarning[];
    layout: RenderedLayout;
}
interface SerializedFlowchartGraph {
    direction: Direction$1;
    nodes: Record<string, MermaidNode> | Array<[string, MermaidNode]>;
    edges?: MermaidEdge[];
    subgraphs?: unknown;
    classDefs?: unknown;
    classAssignments?: unknown;
    nodeStyles?: unknown;
    linkStyles?: unknown;
    linkCurves?: unknown;
}
interface ValidDiagramPayload {
    kind: DiagramKind | ExternalFamilyId;
    descriptorIdentity?: ExtensionIdentity<'family'>;
    canonicalSource?: string;
    meta?: Partial<ValidDiagramMeta>;
    body: {
        kind: 'flowchart';
        graph: SerializedFlowchartGraph;
    } | (Omit<AgentflowBody, 'graph' | 'metadata' | 'roles' | 'connectors' | 'globals'> & {
        graph: SerializedFlowchartGraph | MermaidGraph;
        metadata: AgentflowBody['metadata'] | Record<string, Record<string, unknown>> | Array<[string, Record<string, unknown>]>;
        roles: AgentflowBody['roles'] | Record<string, AgentflowRole> | Array<[string, AgentflowRole]>;
        connectors: Set<string> | string[];
        globals: Set<string> | string[];
    }) | UsecaseBody | WardleyBody | VennBody | CynefinBody | RailroadBody | {
        kind: 'swimlane';
        graph: SerializedFlowchartGraph | MermaidGraph;
    } | TreeviewBody | StateBody | SequenceBody | TimelineBody | ClassBody | ErBody | JourneyBody | ArchitectureBody | XyChartBody | PieBody | QuadrantBody | GanttBody | MindmapBody | GitGraphBody | RadarBody | SankeyBody | C4Body | PacketBody | KanbanBody | RequirementBody | TreemapBody | IshikawaBody | BlockBody | EventModelingBody | ZenUMLBody | ExtensionDiagramBody | {
        kind: 'opaque';
        family: DiagramKind;
        source: string;
        diagnostic?: {
            code: 'GITGRAPH_DUPLICATE_COMMIT_ID';
            id: string;
        };
    };
}
declare function asEventModeling(d: ParsedDiagram): EventModelingValidDiagram | null;
declare function asZenUML(d: ParsedDiagram): ZenUMLValidDiagram | null;
type AgentflowValidDiagram = ValidDiagram & {
    body: AgentflowBody;
};
declare function asAgentflow(d: ParsedDiagram): AgentflowValidDiagram | null;
type UsecaseValidDiagram = ValidDiagram & {
    body: UsecaseBody;
};
declare function asUsecase(d: ParsedDiagram): UsecaseValidDiagram | null;
type WardleyValidDiagram = ValidDiagram & {
    body: WardleyBody;
};
declare function asWardley(d: ParsedDiagram): WardleyValidDiagram | null;
type VennValidDiagram = ValidDiagram & {
    body: VennBody;
};
declare function asVenn(d: ParsedDiagram): VennValidDiagram | null;
type CynefinValidDiagram = ValidDiagram & {
    body: CynefinBody;
};
declare function asCynefin(d: ParsedDiagram): CynefinValidDiagram | null;
type RailroadValidDiagram = ValidDiagram & {
    body: RailroadBody;
};
declare function asRailroad(d: ParsedDiagram): RailroadValidDiagram | null;

interface PaintViewport {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface PaintCertificationIssue {
    readonly code: 'UNMEASURED_PAINT' | 'UNPREPARED_TEXT' | 'CONDITIONAL_PAINT' | 'LABEL_CONTAINMENT' | 'TEXT_OCCLUDED' | 'CHECK_BUDGET' | 'OUTPUT_SCOPE' | 'POTENTIAL_OCCLUSION' | 'MARKER_OCCLUDED' | 'CONNECTOR_CARD_CROSSING';
    readonly id?: string;
    readonly by?: string;
    readonly message: string;
}
interface PaintLayoutCertification {
    readonly version: 1;
    readonly unit: 'px';
    readonly scope: 'native-scene';
    readonly status: 'passed' | 'failed' | 'unverified';
    /** Digest of the final secured SVG this proof was issued with. Its shape,
     * text and connector elements are written from the fields the proof reads;
     * the document passes after the backend resolve colour variables, fit
     * uncalibrated host fonts, namespace ids and scope styles, and the security
     * policy may remove content it does not admit. */
    readonly outputDigest?: string;
    readonly viewport: PaintViewport;
    readonly attempts: 1 | 2;
    readonly repairs: readonly 'expand-viewport'[];
    readonly coverage: {
        readonly measured: number;
        readonly unmeasured: number;
        readonly preparedText: number;
        readonly fallbackText: number;
        readonly conditional: number;
    };
    readonly checks: {
        readonly primitives: number;
        readonly labels: number;
        readonly occlusionPairs: number;
        readonly maxOcclusionPairs: number;
        readonly operations: number;
        readonly maxOperations: number;
        readonly markers: number;
    };
    readonly issues: readonly PaintCertificationIssue[];
    readonly limitations: readonly string[];
    /** Present when report layout safety drew geometry that failed layout
     * certification: the candidate drawn and the checks it fails. `status`
     * remains the paint proof's own verdict. */
    readonly geometry?: UncertifiedLayoutReceipt;
}
declare class PaintLayoutCertificationError extends Error {
    readonly certification: PaintLayoutCertification;
    readonly code = "PAINT_LAYOUT_CERTIFICATION_FAILED";
    constructor(certification: PaintLayoutCertification);
}

export { CORE_SCENE_PRIMITIVES as $, type Accessibility as A, BUILTIN_FAMILY_METADATA as B, type C4Argument as C, type DiagramActionRecord as D, type C4Boundary as E, type C4BoundaryInput as F, type C4BoundaryKind as G, type C4Diagnostic as H, type C4Direction as I, type C4Directive as J, type C4Element as K, type C4ElementInput as L, type C4ElementKind as M, type C4MutationOp as N, type C4Relationship as O, PaintLayoutCertificationError as P, type C4RelationshipInput as Q, type RenderRequestReceipt as R, type C4Shape as S, type C4Statement as T, type C4Style as U, type C4ValidDiagram as V, type C4Variant as W, CAPABILITY_NEGOTIATION_VERSION as X, CORE_CAPABILITY_OFFERS as Y, CORE_SCENE_FEATURES as Z, CORE_SCENE_OPERATIONS as _, type ParsedDiagram as a, type FamilyCapabilityConformanceResult as a$, type CapabilityDecision as a0, type CapabilityId as a1, type CapabilityOffer as a2, type CapabilityRequirement as a3, type CapabilityRequirementLevel as a4, type CapabilityResolution as a5, type ClassBody as a6, type ClassMutationOp as a7, type ClassNode as a8, type ClassNote as a9, type DiagramAnalysis as aA, type DiagramBody as aB, type DiagramKind as aC, type EdgeId as aD, type ErAttribute as aE, type ErBody as aF, type ErCardinality as aG, type ErEntity as aH, type ErMutationOp as aI, type ErRelation as aJ, type ErValidDiagram as aK, type EventData as aL, type EventFrame as aM, type EventFrameType as aN, type EventModelingBody as aO, type EventModelingMutationOp as aP, type EventModelingValidDiagram as aQ, type EventSpecification as aR, type ExtensionDiagramBody as aS, type ExtensionValidDiagram as aT, type ExternalFamilyId as aU, type ExtractedLabel as aV, FAMILY_CAPABILITY_COLUMNS as aW, FAMILY_CONFORMANCE_MAX_EXAMPLE_BYTES as aX, FAMILY_CONFORMANCE_VERSION as aY, FAMILY_DESCRIPTOR_CONTRACT_VERSION as aZ, type FamilyCapability as a_, type ClassRelation as aa, type ClassRelationKind as ab, type ClassValidDiagram as ac, type CliRenderTransport as ad, type CodeModeRenderTransport as ae, type ConnectorContourSemantics as af, type ConnectorEndpoints as ag, type ConnectorGeometry as ah, type ConnectorHitGeometry as ai, type ConnectorLabelDescriptor as aj, type ConnectorMark as ak, type ConnectorRelationship as al, type ConnectorRoute as am, type ConnectorStroke as an, type ConnectorSubpath as ao, type ConnectorTerminalLabelProjection as ap, type ConnectorTerminalMarkerPlacement as aq, type ConnectorTerminalMarkerProjection as ar, type ConnectorTerminalProjection as as, type ConnectorTerminalStrokeLoss as at, type CynefinBody as au, type CynefinMutationOp as av, type CynefinValidDiagram as aw, DEFAULT_LABEL_CHAR_CAP as ax, type DiagramActionKind as ay, type DiagramActionSecurity as az, type RenderedRegion as b, type PieValidDiagram as b$, type FamilyCapabilityEvidence as b0, type FamilyCapabilityState as b1, FamilyConformanceError as b2, type FamilyConformanceReport as b3, type FamilyConformanceStatus as b4, type FamilyDescriptor as b5, type FamilyId as b6, type FamilyOperations as b7, type FamilyParsedBody as b8, type FamilyPositionedProjectionContext as b9, type JourneyBody as bA, type JourneyMutationOp as bB, type JourneySection as bC, type JourneyTask as bD, type JourneyValidDiagram as bE, type KanbanBody as bF, type KanbanMutationOp as bG, type KanbanValidDiagram as bH, type LayoutWarning as bI, type LibraryRenderTransport as bJ, type MarkerDescriptor as bK, type MindmapBody as bL, type MindmapMutationOp as bM, type MindmapValidDiagram as bN, type MutableValidDiagram as bO, type MutationError as bP, type NodeId as bQ, PRIMITIVE_REALIZATIONS as bR, type PacketBody as bS, type PacketMutationOp as bT, type PacketValidDiagram as bU, type PaintLayoutCertification as bV, type ParseError as bW, type ParticipantId as bX, type PieBody as bY, type PieMutationOp as bZ, type PieSlice as b_, type FamilyPositionedProjectionOptions as ba, type FamilyPositionedView as bb, type FamilyScenePositivePrimitive as bc, type FamilyScenePrimitiveApplicability as bd, type FamilyScenePrimitiveEvidence as be, type FamilySceneRolePrimitiveDeclaration as bf, type FeedbackEdgeAnalysis as bg, type Finite as bh, type FlowchartMutationOp as bi, type FlowchartValidDiagram as bj, type GanttBody as bk, type GanttBodySection as bl, type GanttBodyTask as bm, type GanttBodyTaskTag as bn, type GanttMutationOp as bo, type GanttScheduleAnalysisSummary as bp, type GanttStatement as bq, type GanttValidDiagram as br, type GitGraphBody as bs, type GitGraphMutationOp as bt, type GitGraphValidDiagram as bu, type GroupId as bv, type InitDirective as bw, type IshikawaBody as bx, type IshikawaMutationOp as by, type IshikawaValidDiagram as bz, type AgentflowBody as c, type SwimlaneBody as c$, type PreservedDiagramBody as c0, type PreservedSourceSpans as c1, type PreservedValidDiagram as c2, type QuadrantAxis as c3, type QuadrantBody as c4, type QuadrantMutationOp as c5, type QuadrantPoint as c6, type QuadrantValidDiagram as c7, RENDER_CONTRACT_VERSION as c8, RENDER_OUTPUTS as c9, SHARED_RENDER_OPTION_FIELDS as cA, type SankeyBody as cB, type SankeyBodyLink as cC, type SankeyMutationOp as cD, type SankeyValidDiagram as cE, type SceneDoc as cF, type SceneNode as cG, type SemanticChannels as cH, type SequenceBody as cI, type SequenceMessage as cJ, type SequenceMessageStyle as cK, type SequenceMutationOp as cL, type SequenceParticipant as cM, type SequenceValidDiagram as cN, type SerializedFlowchartGraph as cO, type SourceComment as cP, type SourceMap as cQ, type SourceMapSpans as cR, type SourcePreservationReceipt as cS, type SourceSpan as cT, type SourceSpanPoint as cU, type StateBody as cV, type StateFloatingNote as cW, type StateMutationOp as cX, type StateNode as cY, type StateTransition as cZ, type StateValidDiagram as c_, RENDER_OUTPUT_DESCRIPTORS as ca, type RadarBody as cb, type RadarBodyAxis as cc, type RadarBodyCurve as cd, type RadarMutationOp as ce, type RadarValidDiagram as cf, type RailroadBody as cg, type RailroadMutationOp as ch, type RailroadNode as ci, type Notation as cj, type RailroadRule as ck, type RailroadValidDiagram as cl, RenderCapabilityError as cm, type RenderOutputDescriptor as cn, type RenderOutputTransports as co, type RenderedLabelBounds as cp, type RenderedLayout as cq, type RenderedLayoutEdge as cr, type RenderedLayoutGroup as cs, type RenderedLayoutLabel as ct, type RenderedLayoutNode as cu, type RenderedRegionKind as cv, type RequirementBody as cw, type RequirementMutationOp as cx, type RequirementValidDiagram as cy, type Result as cz, type AgentflowMapping as d, asIshikawa as d$, type SwimlaneMutationOp as d0, type SwimlaneValidDiagram as d1, type Tier1WarningCode as d2, type Tier2WarningCode as d3, type TimelineBody as d4, type TimelineEvent as d5, type TimelineMutationOp as d6, type TimelinePeriod as d7, type TimelineSection as d8, type TimelineValidDiagram as d9, type WardleyValidDiagram as dA, type WarningCode as dB, type WarningSeverity as dC, type WarningTier as dD, type XyChartAxis as dE, type XyChartAxisSpec as dF, type XyChartBody as dG, type XyChartMutationOp as dH, type XyChartSeries as dI, type XyChartValidDiagram as dJ, type ZenUMLBody as dK, type ZenUMLBranch as dL, type ZenUMLMutationOp as dM, type ZenUMLParticipant as dN, type ZenUMLStatement as dO, type ZenUMLValidDiagram as dP, asAgentflow as dQ, asArchitecture as dR, asBlock as dS, asC4 as dT, asClass as dU, asCynefin as dV, asEr as dW, asEventModeling as dX, asFlowchart as dY, asGantt as dZ, asGitGraph as d_, type TreemapBody as da, type TreemapMutationOp as db, type TreemapValidDiagram as dc, type TreeviewBody as dd, type TreeviewMutationOp as de, type TreeviewNode as df, type TreeviewValidDiagram as dg, UNREGISTERED_FAMILY_CAPABILITY_STATES as dh, type UsecaseBody as di, type UsecaseModel as dj, type UsecaseMutationOp as dk, type GraphStatement as dl, type UsecaseValidDiagram as dm, type ValidDiagram as dn, type ValidDiagramMeta as dp, type ValidDiagramPayload as dq, type VennBody as dr, type VennMutationOp as ds, type VennValidDiagram as dt, type VerifyOptions as du, type VerifyResult as dv, WARNING_SEVERITY as dw, WARNING_TIER as dx, type WardleyBody as dy, type WardleyMutationOp as dz, type AgentflowMutationOp as e, type CoreScenePrimitive as e$, asJourney as e0, asKanban as e1, asMindmap as e2, asPacket as e3, asPie as e4, asQuadrant as e5, asRadar as e6, asRailroad as e7, asRequirement as e8, asSankey as e9, semVerSatisfies as eA, sharedRenderOptionsJsonSchema as eB, styleInputJsonSchema as eC, terminalConnectorCapabilityClaims as eD, toFinite as eE, validatePrimitiveCapabilities as eF, validateSerializableRenderOptions as eG, type TerminalProjectionDiagnosticCode as eH, type TerminalProjectionDiagnostic as eI, type ZenUMLFragmentType as eJ, type ConnectorDirection as eK, type PrimitiveCapabilityClaim as eL, OUTPUT_SECURITY_POLICY_VERSION as eM, type ColorMode as eN, type AsciiTheme as eO, type ResolvedTerminalStyle as eP, type MindmapDiagram as eQ, type GitGraphDiagram as eR, type MarkPaint as eS, type Geometry as eT, type ScenePoint as eU, type LinearGradientDescriptor as eV, type CapabilityValidationResult as eW, type ConnectorDash as eX, type ConnectorEndpointAnchor as eY, type CoreSceneFeature as eZ, type CoreSceneOperation as e_, asSequence as ea, asState as eb, asSwimlane as ec, asTimeline as ed, asTreemap as ee, asTreeview as ef, asUsecase as eg, asVenn as eh, asWardley as ei, asXyChart as ej, asZenUML as ek, builtinFamilyMetadata as el, declareFamilyScenePrimitiveEvidence as em, detectRegisteredFamilyFromFirstLine as en, effectiveFamilyCapabilityState as eo, err as ep, getFamily as eq, getFamilyConformanceReport as er, isBuiltinFamilyId as es, isExternalFamilyId as et, knownBuiltinFamilies as eu, knownFamilies as ev, negotiateCapabilities as ew, negotiateRenderCapabilities as ex, ok as ey, parseSemVer as ez, type AgentflowValidDiagram as f, type DocumentMark as f0, ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES as f1, ESSENTIAL_SCENE_PRIMITIVE_OPERATIONS as f2, type EssentialScenePrimitiveCapability as f3, type EssentialScenePrimitiveOperation as f4, type GitGraphBranch as f5, type GitGraphCommit as f6, type GitGraphCommitType as f7, type GroupMark as f8, type MarkerShape as f9, renderContractDigest as fA, verifySvgDocumentEnvelope as fB, type MindmapNode as fa, type MindmapShape as fb, type OutputSecurityDiagnostic as fc, type OutputSecurityMode as fd, type OutputSecurityResult as fe, ParsedDiagramFamilyMismatchError as ff, type PositionedGitGraphDiagram as fg, type PositionedMindmapDiagram as fh, type PrimitiveRealization as fi, type RenderOutput as fj, type SceneBox as fk, type SceneFeature as fl, type SceneNodeBase as fm, type SceneOperation as fn, type ScenePrimitive as fo, type ShapeMark as fp, type SvgRelationSemantics as fq, type SvgSemanticAccessibility as fr, type SvgSemanticIdentity as fs, TERMINAL_STYLE_VERSION as ft, type TerminalConnectorProjection as fu, type TerminalConnectorProjectionReceipt as fv, type TerminalProjectionSecurityContext as fw, type TextMark as fx, applyOutputSecurityPolicy as fy, essentialScenePrimitiveOperation as fz, type AnyMutationOp as g, type ArchitectureBody as h, type ArchitectureEdge as i, type ArchitectureEndpoint as j, type ArchitectureEndpointBoundary as k, type ArchitectureGroup as l, type ArchitectureJunction as m, type ArchitectureMutationOp as n, type ArchitectureService as o, type ArchitectureSide as p, type ArchitectureValidDiagram as q, BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND as r, type BlockBody as s, type BlockMutationOp as t, type BlockValidDiagram as u, verifyNoExternalRefs as v, type BuiltinFamilyId as w, type BuiltinFamilyMetadata as x, type C4ArgumentInput as y, type C4Body as z };
