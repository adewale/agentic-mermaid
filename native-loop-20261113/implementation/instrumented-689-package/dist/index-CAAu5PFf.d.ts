import { eL as PrimitiveCapabilityClaim, eM as OUTPUT_SECURITY_POLICY_VERSION, cG as SceneNode, cF as SceneDoc, cz as Result, a as ParsedDiagram, bW as ParseError, c as AgentflowBody, dj as UsecaseModel, eN as ColorMode, eO as AsciiTheme, b6 as FamilyId, eI as TerminalProjectionDiagnostic, R as RenderRequestReceipt, eP as ResolvedTerminalStyle, eQ as MindmapDiagram, eR as GitGraphDiagram, cS as SourcePreservationReceipt, cH as SemanticChannels, ah as ConnectorGeometry, eS as MarkPaint, eK as ConnectorDirection, aj as ConnectorLabelDescriptor, eT as Geometry, bK as MarkerDescriptor, ak as ConnectorMark, eU as ScenePoint, eV as LinearGradientDescriptor } from './paint-certification-D4KXvaqY.js';
import { R as RenderOptions, I as MermaidRuntimeConfig, q as DiagramColors, m as Direction, L as LabelContent, J as AccessibilityFieldProjection, u as MermaidGraph, T as TextMeasurementProfile } from './types-CNsEXVPT.js';
import { k as ExtensionIdentity, C as StyleSpec, V as ExtensionCompatibility, W as ExtensionProvenance, t as SceneRole } from './svg-styles-24_BFqX1.js';

type ResolvedSceneFeature = 'paint-server' | 'css' | 'geometry' | 'filter' | 'clip-path' | 'mask' | 'marker-mid' | 'nested-svg' | 'text-element' | 'marker' | 'scene-lowering' | 'ownership';
/** A resolved projection is atomic: unsupported ink never becomes a partial scene. */
declare class ResolvedSceneError extends Error {
    readonly code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK' | 'RESOLVED_SCENE_UNAVAILABLE';
    readonly partId: string;
    readonly feature: ResolvedSceneFeature;
    readonly name = "ResolvedSceneError";
    constructor(code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK' | 'RESOLVED_SCENE_UNAVAILABLE', partId: string, feature: ResolvedSceneFeature, message: string);
}

/** Numeric wire version and semantic compatibility version from one source. */
declare const SCENE_CONTRACT_VERSION: 2;

/**
 * Measure the pixel width of a text string.
 *
 * Uses character class buckets for more accurate width estimation
 * than uniform character width assumptions.
 *
 * @param text - The text to measure
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight (affects width slightly)
 * @returns Estimated width in pixels
 */
interface TextMeasurementContract {
    version: 4;
    unit: 'px';
    fontCalibration: 'Inter-compatible proportional estimate';
    monospaceCalibration: '0.6em-per-cell';
    wideCodepoints: 'src/shared/unicode-ranges.ts';
    emojiDetection: 'Emoji_Presentation-or-Extended_Pictographic';
    ambiguousWidth: 'single-cell';
    paintedAdvanceProjection: 'prepared-positions-or-svg-textLength-spacingAndGlyphs';
    naturalAdvanceExemptions: 'prepared-non-ascii-shaping-runs';
}
declare const TEXT_MEASUREMENT_CONTRACT: TextMeasurementContract;
interface TextMeasurementInput {
    text: string;
    fontSize: number;
    fontWeight: number;
    fontStyle?: 'normal' | 'italic';
    fontFamily?: string;
}
interface TextMeasurementResult {
    contract: TextMeasurementContract;
    width: number;
    charWidthUnits: number;
    codePointCount: number;
    fontSize: number;
    fontWeight: number;
    baseRatio: number;
    minPadding: number;
}
declare function measureText(input: TextMeasurementInput): TextMeasurementResult;
declare function measureTextWidth(text: string, fontSize: number, fontWeight: number, fontStyle?: 'normal' | 'italic', fontFamily?: string): number;

type RubricMetric = 'hard' | 'crossings' | 'bends' | 'straight' | 'portRate' | 'symErr' | 'parallelOverlaps' | 'endpointApproaches' | 'opposingOverlaps';
/** A broken pass contract must escape candidate fallback unchanged. */
declare class LayoutPassContractError extends Error {
    readonly pass: string;
    readonly contract: 'ordering' | 'freeze' | 'certificate' | 'measurement' | 'metric-budget';
    readonly code: string;
    constructor(pass: string, contract: 'ordering' | 'freeze' | 'certificate' | 'measurement' | 'metric-budget', message: string);
}
/** A pass exceeded its declared allowance on the geometry it actually produced. */
declare class LayoutMetricBudgetError extends LayoutPassContractError {
    readonly metric: RubricMetric;
    readonly before: number;
    readonly after: number;
    readonly allowance: number;
    readonly code = "LAYOUT_METRIC_BUDGET_EXCEEDED";
    constructor(pass: string, metric: RubricMetric, before: number, after: number, allowance: number);
}

interface LayoutCertificationAttempt {
    strategy: string;
    violations: string[];
}
/** Shared by graph certification and the family-neutral final geometry veto. */
declare class LayoutCertificationError extends Error {
    readonly attempts: readonly LayoutCertificationAttempt[];
    readonly code = "LAYOUT_CERTIFICATION_FAILED";
    constructor(attempts: readonly LayoutCertificationAttempt[]);
}

declare const BACKEND_CONFORMANCE_VERSION: 4;
declare const BACKEND_CONFORMANCE_FIXTURE_ID: "backend-claim-matrix@4";
declare const BACKEND_CONFORMANCE_CHECK_IDS: readonly ["draw-node-determinism", "draw-node-semantics", "document-determinism", "single-svg-document", "finite-serialization", "output-security", "document-semantics", "container-semantics", "shape-semantics", "text-semantics", "connector-semantics", "marker-semantics", "data-mark-semantics", "capability-claims"];
type BackendConformanceCheckId = (typeof BACKEND_CONFORMANCE_CHECK_IDS)[number];
interface BackendConformanceCheck {
    readonly id: BackendConformanceCheckId;
    readonly passed: boolean;
    readonly diagnostic?: string;
}
type BackendCapabilityConformanceStatus = 'passed' | 'failed' | 'unverified-extension';
/** A flattened, JSON-safe result for one exact declared claim. */
interface BackendCapabilityConformanceResult {
    readonly claimKey: string;
    readonly target: string;
    readonly primitive: PrimitiveCapabilityClaim['primitive'];
    readonly feature: PrimitiveCapabilityClaim['feature'];
    readonly operation: PrimitiveCapabilityClaim['operation'];
    readonly realization: PrimitiveCapabilityClaim['realization'];
    /** The declaration's required explanation for a lossy/unsupported cell. */
    readonly limitation?: string;
    /** Stable executable witness identity; absent only for namespaced extensions. */
    readonly witnessId?: string;
    readonly status: BackendCapabilityConformanceStatus;
    readonly observation?: string;
    /** Failure/unverified explanation, distinct from the declared limitation. */
    readonly diagnostic?: string;
}
interface BackendConformanceReport {
    readonly version: typeof BACKEND_CONFORMANCE_VERSION;
    readonly fixtureId: typeof BACKEND_CONFORMANCE_FIXTURE_ID;
    readonly backendId: string;
    readonly contracts: {
        readonly scene: typeof SCENE_CONTRACT_VERSION;
        readonly outputSecurity: typeof OUTPUT_SECURITY_POLICY_VERSION;
    };
    /** StyleBackend is an SVG consumer/serializer; PNG is a downstream adapter. */
    readonly directOutputs: readonly ['svg'];
    readonly passed: boolean;
    readonly checks: readonly BackendConformanceCheck[];
    readonly claims: readonly BackendCapabilityConformanceResult[];
}
/** Execute the frozen document and claim fixtures against a backend. */
declare function runBackendConformance(backend: StyleBackend, canonicalId?: string): BackendConformanceReport;

interface StyleBackendContext {
    /** User-supplied deterministic re-roll seed (RenderOptions.seed). */
    seed: number;
    /** The selected style (undefined on the default path). */
    style?: StyleSpec;
}
interface StyleBackend {
    id: string;
    /** Versioned, feature/operation-level support claims for this Scene consumer. */
    readonly capabilities: readonly PrimitiveCapabilityClaim[];
    /** Serialize one top-level mark (recursing through groups). */
    drawNode(node: SceneNode, ctx: StyleBackendContext): string;
    /** Serialize the whole document. */
    render(doc: SceneDoc, ctx: StyleBackendContext): string;
}
interface BackendRegistrationOptions {
    readonly version?: string;
    readonly compatibility: ExtensionCompatibility & {
        readonly core: string;
        readonly scene: string;
    };
    readonly provenance?: ExtensionProvenance;
}
interface BackendDescriptor {
    readonly identity: ExtensionIdentity<'backend'>;
    readonly backend: StyleBackend;
    /** Stable preferred input for first-party backends. */
    readonly inputName: string;
    /** Claim-keyed executable SVG conformance: run at registration for a host
     * backend, and at first use (draw, render or this read) for a built-in. */
    readonly conformance: BackendConformanceReport;
}
interface HostBackendSelection {
    /** Backend capability inferred from declarative appearance. */
    readonly requestedId: string;
    /** Canonical registry identity, when the requested backend is registered. */
    readonly canonicalId?: string;
    readonly registered: readonly BackendDescriptor[];
}
/**
 * Trusted, in-process backend selection escape hatch. The callback makes this
 * capability non-serializable by construction: it cannot enter StyleSpec,
 * BrandPack, CLI, MCP, or editor payloads.
 */
interface HostBackendPolicy {
    readonly selectBackend: (selection: HostBackendSelection) => string | null | undefined;
}
/** Styled documents carry an explicit page rect after the prelude — resvg
 *  does not paint the root style="background:…" CSS (SPEC §10). Emitted by
 *  every backend when a style is active and the document isn't transparent. */
declare const DefaultBackend: StyleBackend;
/** Register a host backend by canonical `backend:*` identity. */
declare function registerBackend(backend: StyleBackend, options: BackendRegistrationOptions): () => void;
declare function knownBackendDescriptors(): readonly BackendDescriptor[];
declare function getBackend(id: string, policy?: HostBackendPolicy): StyleBackend | undefined;

/** Optional synchronous observation at native parser consumption/build boundaries.
 * Events describe each parser's own language; their kinds are not Mermaid's
 * lexer token numbers or its yy method protocol.
 */
interface ParserObservationSource {
    line?: number;
    column?: number;
    offset?: number;
    endOffset?: number;
    /** Coordinates refer to supplied physical text or a parser's normalized view. */
    unit?: 'physical' | 'normalized';
}
type ParserObservationValue = null | boolean | number | string | ParserObservationValue[] | {
    [key: string]: ParserObservationValue;
};
interface ParserObservation {
    family: string;
    unit: 'token' | 'statement' | 'mutation';
    kind: string;
    text?: string;
    value?: ParserObservationValue;
    source?: ParserObservationSource;
}
type ParserObserver = (event: Readonly<ParserObservation>) => void;
/** Nested scopes replace, then restore, their caller's observer. Async work is
 * deliberately outside this contract: no parser context survives a promise.
 */
declare function withParserObservation<T>(family: string, observer: ParserObserver, parse: () => T, options?: {
    mutations?: readonly string[];
}): T;

/**
 * The internal color waist: every public color dialect is normalized to
 * DiagramColors before layout/render code sees it.
 */
declare function resolveDiagramColors(options: RenderOptions, config: MermaidRuntimeConfig, font?: string, preserveUnsafeThemePaints?: boolean): DiagramColors;

/** Descriptor-dispatched parser with a forward-compatible extension envelope. */
declare function parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>;

/** Parsed class diagram — logical structure from mermaid text */
interface ClassDiagram {
    /** The diagram's title (frontmatter `title:`). */
    title?: string;
    /** Optional accessibility title (Mermaid accTitle) */
    accessibilityTitle?: string;
    /** Optional accessibility description (Mermaid accDescr) */
    accessibilityDescription?: string;
    /** Layout direction from a `direction TB|BT|LR|RL` statement (default TB). */
    direction?: Direction;
    /** All class definitions */
    classes: ClassNode[];
    /** Mermaid classDef paint declarations. */
    classDefs: Map<string, Record<string, string>>;
    /** Relationships between classes */
    relationships: ClassRelationship[];
    /** UML notes, optionally anchored to one class. */
    notes: ClassNote[];
    /** Top-level namespace groupings (each may nest children) */
    namespaces: ClassNamespace[];
}
interface ClassNode {
    /** Independent named lollipop endpoint, with no class compartments. */
    isInterface?: boolean;
    /** Stable bare identity; Mermaid `~T~` parameters are stored separately. */
    id: string;
    label: string;
    labelContent?: LabelContent;
    /** Generic type parameter text from `ClassName~T~`. */
    generic?: string;
    /** Annotation like <<interface>>, <<abstract>>, <<service>>, <<enumeration>> */
    annotation?: string;
    /** Class attributes (fields/properties) */
    attributes: ClassMember[];
    /** Class methods (functions) */
    methods: ClassMember[];
    /** Ordered, space-separated classDef names (`A:::hot`, `class`, `cssClass`). */
    className?: string;
    /** Inline `style A ...` paint. */
    inlineStyle?: Record<string, string>;
    /** Safe inert link metadata; callbacks are never executable. */
    href?: string;
    /** Optional authored hover text for a safe inert link. */
    tooltip?: string;
}
interface ClassMember {
    /** Visibility: + public, - private, # protected, ~ package */
    visibility: '+' | '-' | '#' | '~' | '';
    /** Member name */
    name: string;
    /** Authored attribute text; display preserves Mermaid's member order and punctuation. */
    sourceText?: string;
    /** Type annotation (e.g., "String", "int", "void") */
    type?: string;
    /** Whether the member is static (underlined in UML) */
    isStatic?: boolean;
    /** Whether the member is abstract (italic in UML) */
    isAbstract?: boolean;
    /** Whether the member is a method (renders with parentheses) */
    isMethod?: boolean;
    /** Method parameters (e.g., "data", "key, val") — only for methods */
    params?: string;
}
/** Relationship types following UML conventions */
interface ClassNote {
    text: string;
    textContent?: LabelContent;
    for?: string;
}
type RelationshipType = 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization' | 'link-solid' | 'link-dashed' | 'lollipop';
interface ClassRelationship {
    from: string;
    to: string;
    type: RelationshipType;
    /** Explicit shaft style when endpoint kinds alone do not describe it. */
    lineStyle?: 'solid' | 'dashed';
    /**
     * Which end of the relationship line has the UML marker (triangle, diamond, arrow).
     * Determined by the arrow syntax direction:
     *   - Prefix markers like `<|--`, `*--`, `o--` → 'from' (marker on left/from side)
     *   - Suffix markers like `..|>`, `-->`, `..>`, `--*`, `--o` → 'to' (marker on right/to side)
     */
    markerAt: 'from' | 'to' | 'both' | 'none';
    /** Exact endpoint marker types when a two-way relation uses different ends. */
    fromType?: RelationshipType;
    toType?: RelationshipType;
    /** Label on the relationship line */
    label?: string;
    labelContent?: LabelContent;
    /** Cardinality at the "from" end (e.g., "1", "*", "0..1") */
    fromCardinality?: string;
    fromCardinalityContent?: LabelContent;
    /** Cardinality at the "to" end */
    toCardinality?: string;
    toCardinalityContent?: LabelContent;
}
/**
 * A namespace grouping (upstream: `namespace X { class A }`). Nesting follows
 * upstream Mermaid: syntactic (`namespace A { namespace B { … } }`) and dot
 * notation (`namespace A.B.C` auto-creates `A` and `A.B` as parents). `name`
 * is the SEGMENT name; the full path is the ancestor chain joined with dots.
 */
interface ClassNamespace {
    name: string;
    /** Optional display label from `namespace X["Label"]` (upstream v11.15+). */
    label?: string;
    labelContent?: LabelContent;
    /** Ids of classes declared directly in this namespace. */
    classIds: string[];
    /** Nested child namespaces. */
    children: ClassNamespace[];
}

/** Parsed ER diagram — logical structure from mermaid text */
interface ErDiagram {
    /** The diagram's title (frontmatter `title:`). */
    title?: string;
    /** Optional accessibility title (Mermaid accTitle) */
    accessibilityTitle?: string;
    /** Optional accessibility description (Mermaid accDescr) */
    accessibilityDescription?: string;
    /**
     * Layout direction from a `direction TB|BT|LR|RL` statement (upstream
     * v11.4+). Default is LR — this fork's deliberate divergence from
     * upstream's TB default (documented in docs/design/families/er.md).
     */
    direction?: Direction;
    /** All entity definitions */
    entities: ErEntity[];
    /** Mermaid classDef paint declarations. */
    classDefs: Map<string, Record<string, string>>;
    /** Relationships between entities or subgraph boundaries. */
    relationships: ErRelationship[];
    /** Nested ER frames and their authored membership. */
    groups: ErGroup[];
}
interface ErGroup {
    id: string;
    label: string;
    labelContent?: LabelContent;
    parentId?: string;
    direction?: Direction;
    entityIds: string[];
}
interface ErEntity {
    id: string;
    /** Display name (same as id unless aliased) */
    label: string;
    labelContent?: LabelContent;
    /** Entity attributes (columns) */
    attributes: ErAttribute[];
    /** Applied CSS class names in source order, separated by spaces. */
    className?: string;
    inlineStyle?: Record<string, string>;
    groupId?: string;
}
interface ErAttribute {
    /** Data type (string, int, varchar, etc.) */
    type: string;
    /** Attribute name */
    name: string;
    /** Key constraints: PK, FK, UK */
    keys: Array<'PK' | 'FK' | 'UK'>;
    /** Optional comment */
    comment?: string;
    commentContent?: LabelContent;
}
/**
 * Cardinality notation (crow's foot):
 *   'one'       ||  exactly one
 *   'zero-one'  |o  zero or one
 *   'many'      }|  one or more
 *   'zero-many' o{  zero or more
 */
type Cardinality = 'one' | 'zero-one' | 'many' | 'zero-many' | 'parent';
interface ErRelationship {
    entity1: string;
    entity2: string;
    /** Cardinality at entity1's end */
    cardinality1: Cardinality;
    /** Cardinality at entity2's end */
    cardinality2: Cardinality;
    /** Relationship verb/label (e.g., "places", "contains") */
    label: string;
    labelContent?: LabelContent;
    /** Whether the relationship is identifying (solid line) or non-identifying (dashed) */
    identifying: boolean;
}

/** Parsed sequence diagram — logical structure from mermaid text */
interface SequenceDiagram {
    /** The diagram's title (`title` statement, or frontmatter `title:`). */
    title?: string;
    titleContent?: LabelContent;
    /** Optional accessibility title (Mermaid accTitle) */
    accessibilityTitle?: string;
    /** Optional accessibility description (Mermaid accDescr) */
    accessibilityDescription?: string;
    /** Ordered list of actors/participants */
    actors: Actor[];
    /** Messages between actors in chronological order */
    messages: Message[];
    /** Structural blocks (loop, alt, opt, par, critical) */
    blocks: Block[];
    /** Notes attached to actors */
    notes: Note[];
    /** Ordered standalone activate/deactivate commands, anchored at the next
     * message boundary (messages.length at the source position). */
    activationEvents?: SequenceActivationEvent[];
    /** `box <color?> <label?> ... end` participant groups (upstream §Grouping/Box).
     *  Optional for hand-built diagrams; the parser always populates it. */
    boxes?: SequenceBoxGroup[];
}
type SequenceActorType = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue';
type SequenceMessageHead = 'none' | 'filled' | 'open' | 'cross' | 'half-top' | 'half-bottom' | 'stick-top' | 'stick-bottom';
interface Actor {
    /** An incoming endpoint outside the authored participants; no header/lifeline. */
    external?: true;
    wrap?: boolean;
    id: string;
    label: string;
    labelContent?: LabelContent;
    /** Closed official participant-glyph vocabulary. */
    type: SequenceActorType;
    /** Safe actor-menu links; callbacks and unsafe schemes are rejected. */
    links?: Record<string, string>;
    /** Index into `SequenceDiagram.boxes` of the box that frames this actor:
     *  the one open when a statement first met it inside a box (upstream's
     *  `actor.box`). */
    box?: number;
    /** Index of the message this actor is created at (`create participant …`);
     *  its header box + lifeline start there instead of the diagram top. */
    createMessageIndex?: number;
    /** Index of the message this actor is destroyed at (`destroy …`); the
     *  lifeline ends there with an X cross. */
    destroyMessageIndex?: number;
}
/** A `box … end` group of participants. */
interface SequenceBoxGroup {
    wrap?: boolean;
    /** Title text drawn at the top of the box (may be absent). */
    label?: string;
    labelContent?: LabelContent;
    /** Explicit CSS color from the source (named color, #hex, rgb()/rgba(),
     *  hsl()/hsla(), or 'transparent'). Absent = theme-derived fill. */
    color?: string;
    /** Upstream's `actorKeys`: each declaration inside the box that created or
     *  renamed an actor, in order (a repeat naming declaration repeats the id).
     *  A bare declaration of an actor created earlier places it in the box
     *  (`Actor.box`) without listing it here. */
    actorIds: string[];
}
interface SequenceActivationEvent {
    actorId: string;
    kind: 'activate' | 'deactivate';
    messageIndex: number;
}
interface Message {
    /** Identity and lexical fragment supplied by another native sequence language. */
    id?: string;
    parentId?: string;
    /** Effective soft-wrap control; absent retains the renderer's default. */
    wrap?: boolean;
    from: string;
    to: string;
    label: string;
    labelContent?: LabelContent;
    /** Arrow style: solid line or dashed line */
    lineStyle: 'solid' | 'dashed';
    /** Exact source and target endpoint semantics. */
    startHead: SequenceMessageHead;
    endHead: SequenceMessageHead;
    centralStart: boolean;
    centralEnd: boolean;
    /** Activate the target lifeline (+) */
    activate?: boolean;
    /** Deactivate the source lifeline (-) */
    deactivate?: boolean;
    /** Sequence number assigned by `autonumber` (absent when numbering is off).
     *  Display surfaces prefix it to the label ("1. label"). */
    number?: number;
}
interface Block {
    id?: string;
    parentId?: string;
    wrap?: boolean;
    /** Block type keyword */
    type: 'loop' | 'alt' | 'opt' | 'par' | 'par_over' | 'critical' | 'break' | 'rect';
    /** Label for the block header */
    label: string;
    labelContent?: LabelContent;
    /** Source-controlled background paint for a `rect` block. */
    color?: string;
    /** Index of the first message inside this block */
    startIndex: number;
    /** Index of the last message inside this block (inclusive) */
    endIndex: number;
    /** For alt/par blocks: indices where "else"/"and" dividers appear (message indices) */
    dividers: Array<{
        index: number;
        label: string;
        labelContent?: LabelContent;
        wrap?: boolean;
    }>;
}
interface Note {
    id?: string;
    parentId?: string;
    wrap?: boolean;
    /** Which actor(s) the note is attached to */
    actorIds: string[];
    /** Note text content */
    text: string;
    textContent?: LabelContent;
    /** Position relative to the actor(s) */
    position: 'left' | 'right' | 'over';
    /** Message index after which this note appears */
    afterIndex: number;
}

interface MermaidSyntaxErrorLocation {
    /** One-based position in the source supplied to the parser. */
    line?: number;
    column?: number;
    diagramType?: string;
}
declare class LocatedParserError extends Error {
    readonly line?: number;
    readonly column?: number;
    readonly diagramType?: string;
    constructor(message: string, location?: MermaidSyntaxErrorLocation);
}
declare class MermaidSyntaxError extends LocatedParserError {
    readonly code: string;
    constructor(message: string, location?: MermaidSyntaxErrorLocation);
}

/** Parse UseCase declarations and source occurrences without layout or the
 * editor's opaque fallback. Spans index the returned model.source: the authored
 * family payload after frontmatter and universal init directives are removed. */
declare function parseUsecaseModel(source: string): UsecaseModel;
/** Parse AgentFlow graph, metadata and complete container ranges. Mapping
 * coordinates address the authored family payload after wrapper/init removal. */
declare function parseAgentflowModel(source: string): AgentflowBody;
/** Parse complete Mermaid source, including front matter, without running layout. */
declare function parseClassDiagram(source: string): ClassDiagram & AccessibilityFieldProjection;
/** Parse ER attributes into separate type, name, key and comment fields. */
declare function parseErDiagram(source: string): ErDiagram & AccessibilityFieldProjection;
/** Parse sequence notes, activations, boxes, lifecycle bindings and messages. */
declare function parseSequenceDiagram(source: string): SequenceDiagram & AccessibilityFieldProjection;

/** Tiny shared evidence constants. Keeping these separate prevents an SVG-only
 * entry from importing the executable PNG and terminal policy graphs merely
 * to describe the complete public output matrix. */
declare const PNG_OUTPUT_POLICY_VERSION: 4;
declare const TERMINAL_OUTPUT_POLICY_VERSION: 1;
/** Logical PNG projection scale shared with lightweight CLI help. */
declare const PNG_DEFAULT_SCALE: 2;

/** Logical terminal projection policy shared by every ASCII/Unicode/HTML adapter. */
declare const TERMINAL_DEFAULT_PADDING_X: 5;
declare const TERMINAL_BOUNDED_PADDING_X: 1;
declare const TERMINAL_DEFAULT_PADDING_Y: 5;
declare const TERMINAL_DEFAULT_BOX_BORDER_PADDING: 1;
type AsciiRenderColorMode = ColorMode | 'auto';
interface TerminalOutputPolicyInput {
    useAscii?: boolean;
    paddingX?: number;
    paddingY?: number;
    boxBorderPadding?: number;
    colorMode?: AsciiRenderColorMode;
    theme?: Partial<AsciiTheme>;
    maxWidth?: number;
    targetWidth?: number;
}
interface ResolvedTerminalOutputPolicy {
    readonly version: typeof TERMINAL_OUTPUT_POLICY_VERSION;
    readonly useAscii: boolean;
    readonly paddingX: number;
    readonly paddingY: number;
    readonly boxBorderPadding: number;
    /** `auto` is resolved at the request boundary; execution never re-detects it. */
    readonly colorMode: ColorMode;
    /** Structurally validated overrides. Paint safety is projected with diagnostics. */
    readonly theme: Readonly<Partial<AsciiTheme>>;
    readonly maxWidth?: number;
    readonly targetWidth?: number;
}
declare class TerminalOutputPolicyError extends TypeError {
    readonly code: 'INVALID_INPUT' | 'INVALID_FIELD' | 'WIDTH_CONFLICT';
    constructor(code: 'INVALID_INPUT' | 'INVALID_FIELD' | 'WIDTH_CONFLICT', message: string);
}
/** Normalize terminal controls and defaults before either hashing or execution. */
declare function resolveTerminalOutputPolicy(input?: TerminalOutputPolicyInput): ResolvedTerminalOutputPolicy;

type AsciiWidthErrorReason = 'UNBREAKABLE_GRAPHEME' | 'MINIMUM_GEOMETRY' | 'INVALID_WIDTH';
declare class AsciiWidthError extends Error {
    readonly requestedWidth: number;
    readonly requiredWidth: number;
    readonly family: FamilyId;
    readonly reason: AsciiWidthErrorReason;
    readonly code = "ASCII_TARGET_WIDTH_IMPOSSIBLE";
    constructor(requestedWidth: number, requiredWidth: number, family: FamilyId, reason: AsciiWidthErrorReason);
}

interface AsciiRenderOptions extends RenderOptions, TerminalOutputPolicyInput {
    /** true = ASCII chars (+,-,|,>), false = Unicode box-drawing (┌,─,│,►). Default: false */
    useAscii?: boolean;
    /** Horizontal spacing between nodes. Default: 5 */
    paddingX?: number;
    /** Vertical spacing between nodes. Default: 5 */
    paddingY?: number;
    /** Padding inside node boxes. Default: 1 */
    boxBorderPadding?: number;
    /**
     * Color mode for output.
     * - 'none': No colors (plain text)
     * - 'auto': Auto-detect (terminal ANSI capabilities, or HTML in browsers)
     * - 'ansi16': 16-color ANSI
     * - 'ansi256': 256-color xterm
     * - 'truecolor': 24-bit RGB
     * - 'html': HTML <span> tags with inline color styles (for browser rendering)
     * Default: 'auto'
     */
    colorMode?: ColorMode | 'auto';
    /** Theme colors for ASCII output. Uses default theme if not provided. */
    theme?: Partial<AsciiTheme>;
    /**
     * Loop 9 M13: cap output width in characters. When set, node labels wrap
     * at word boundaries to fit within `maxWidth / 3` per node. Single words
     * longer than `maxWidth / 2` render anyway (with a console.warn). The
     * overall canvas may still exceed `maxWidth` if the diagram has many
     * parallel columns; this is best-effort wrapping, not hard truncation.
     */
    maxWidth?: number;
    /** Hard maximum output width in terminal display cells. */
    targetWidth?: number;
    /** Receives explicit graphical-to-terminal projection losses. */
    onProjectionDiagnostic?: (diagnostic: TerminalProjectionDiagnostic) => void;
}
/**
 * Render Mermaid diagram text to an ASCII/Unicode string.
 *
 * Synchronous — no async layout engine needed (unlike the SVG renderer).
 * Auto-detects diagram type from the header line and dispatches to
 * the appropriate renderer.
 *
 * @param text - Mermaid source text (any supported diagram type)
 * @param options - Rendering options
 * @returns Multi-line ASCII/Unicode string
 *
 * @example
 * ```ts
 * const result = renderMermaidASCII(`
 *   graph LR
 *     A --> B --> C
 * `, { useAscii: true })
 *
 * // Output:
 * // +---+     +---+     +---+
 * // |   |     |   |     |   |
 * // | A |---->| B |---->| C |
 * // |   |     |   |     |   |
 * // +---+     +---+     +---+
 * ```
 */
declare function renderMermaidASCII(text: ParsedDiagram | string, options?: AsciiRenderOptions): string;
interface RenderedAscii {
    text: string;
    receipt: RenderRequestReceipt;
    terminalStyle: ResolvedTerminalStyle;
    outputPolicy: ResolvedTerminalOutputPolicy;
}
declare function renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, options?: AsciiRenderOptions): RenderedAscii;

type ArchitectureAlignmentAxis = 'row' | 'column';
interface ArchitectureAlignment {
    axis: ArchitectureAlignmentAxis;
    /** Declared services/junctions, in source order (≥2, unique per directive). */
    members: string[];
}

type ArchitectureSide = 'L' | 'R' | 'T' | 'B';
type ArchitectureEndpointBoundary = 'item' | 'group';
interface ArchitectureChildRef {
    kind: 'group' | 'service' | 'junction';
    id: string;
}
interface ArchitectureGroup {
    id: string;
    label: string;
    icon?: string;
    parentId?: string;
    children: ArchitectureChildRef[];
}
interface ArchitectureService {
    id: string;
    label: string;
    icon?: string;
    /** Literal STRING icon, distinct from a bundled icon name. */
    iconText?: string;
    parentId?: string;
}
interface ArchitectureJunction {
    id: string;
    parentId?: string;
}
interface ArchitectureEndpoint {
    id: string;
    side: ArchitectureSide;
    boundary: ArchitectureEndpointBoundary;
}
interface ArchitectureEdge {
    source: ArchitectureEndpoint;
    target: ArchitectureEndpoint;
    label?: string;
    hasArrowStart: boolean;
    hasArrowEnd: boolean;
}
interface ArchitectureDiagram {
    /** Visible diagram heading from `title ...` (distinct from accTitle). */
    title?: string;
    groups: ArchitectureGroup[];
    services: ArchitectureService[];
    junctions: ArchitectureJunction[];
    edges: ArchitectureEdge[];
    /**
     * `align row|column` directives (upstream v11.16.0), in source order.
     * Parsed, preserved, and honored as deterministic placement constraints.
     */
    alignments: ArchitectureAlignment[];
    rootChildren: ArchitectureChildRef[];
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}

declare function parseArchitectureDiagram(lines: string[]): ArchitectureDiagram;
declare function architectureToMermaidGraph(diagram: ArchitectureDiagram): MermaidGraph;

declare class MindmapParseError extends LocatedParserError {
    constructor(message: string, line?: number);
}
/** @deprecated No longer thrown: a repeated node identity is read as a
 * separate node with an occurrence id (see assignMindmapIdentities). Kept
 * for API compatibility. */
declare class MindmapDuplicateIdError extends MindmapParseError {
    readonly id: string;
    readonly code = "MINDMAP_DUPLICATE_ID";
    constructor(id: string, line: number);
}
/** Parse the indentation-sensitive source from the untrimmed normalized body. */
declare function parseMindmap(source: string): MindmapDiagram;
declare function serializeMindmap(diagram: MindmapDiagram): string;

declare class GitGraphParseError extends LocatedParserError {
    constructor(message: string, line?: number);
}
declare class GitGraphDuplicateCommitError extends GitGraphParseError {
    readonly id: string;
    readonly code = "GITGRAPH_DUPLICATE_COMMIT_ID";
    constructor(id: string, line: number);
}
interface GitGraphParseOptions {
    mainBranchName?: string;
    mainBranchOrder?: number;
    title?: string;
}
declare function parseGitGraph(source: string, options?: GitGraphParseOptions): GitGraphDiagram;
declare function serializeGitGraph(diagram: GitGraphDiagram): string;

interface ResolvedArchitectureIcon {
    canonicalName: `mdi:${string}`;
    viewBox: '0 0 24 24';
    path: string;
    source: '@iconify-json/mdi@1.2.3';
    license: 'Apache-2.0';
}
declare const ARCHITECTURE_ICON_LIMITS: Readonly<{
    maxIcons: 32;
    maxNameBytes: 128;
    maxPathBytes: 4096;
}>;
declare function resolveArchitectureIcon(icon: string): ResolvedArchitectureIcon | null;
/** Read-only test/docs manifest; callers cannot mutate the registry. */
declare function architectureIconManifest(): readonly ResolvedArchitectureIcon[];

type AgenticHeaderStatus = 'native' | 'unsupported' | 'inventory-only';
interface UpstreamHeaderDescriptor {
    value: string;
    agenticStatus: AgenticHeaderStatus;
}
interface UpstreamFamilyDescriptor {
    id: string;
    headers: UpstreamHeaderDescriptor[];
}
/** Header routing for every public family of the pinned Mermaid version,
 * written by scripts/generate-upstream-family-index.ts. */
interface UpstreamMermaidFamilyIndex {
    schemaVersion: 2;
    provenance: {
        version: string;
    };
    families: UpstreamFamilyDescriptor[];
}
interface UpstreamHeaderMatch {
    family: UpstreamFamilyDescriptor;
    header: UpstreamHeaderDescriptor;
}
declare const UPSTREAM_MERMAID_FAMILY_INDEX: UpstreamMermaidFamilyIndex;
/** Longest-header-first lookup prevents an alias prefix claiming a dialect. */
declare function findUpstreamFamilyByHeader(firstLine: string, index?: Pick<UpstreamMermaidFamilyIndex, 'families'>): UpstreamHeaderMatch | null;

type MermaidFamilyClassification = {
    kind: 'registered';
    familyId: FamilyId;
} | {
    kind: 'upstream';
    match: UpstreamHeaderMatch;
} | {
    kind: 'unknown';
    header: string;
};
interface FamilyDetectionDiagnostic {
    code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH';
    message: string;
    line: 1;
    preservation: SourcePreservationReceipt;
    help: string;
}
declare function classifyMermaidFamilyFromFirstLine(firstLine: string, mode?: 'strict' | 'loose'): MermaidFamilyClassification;
declare class MermaidFamilyDetectionError extends Error {
    readonly name = "MermaidFamilyDetectionError";
    readonly code: FamilyDetectionDiagnostic['code'];
    readonly line: 1;
    readonly preservation: SourcePreservationReceipt;
    readonly help: string;
    constructor(diagnostic: FamilyDetectionDiagnostic);
    toJSON(): FamilyDetectionDiagnostic;
}

/** Increment when a resolved field changes meaning or is removed. */
declare const RESOLVED_SCENE_VERSION: 2;
type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];
interface ResolvedScene {
    version: typeof RESOLVED_SCENE_VERSION;
    /** Registered family of the input diagram, independent of shared Scene lowering. */
    family: string;
    width: number;
    height: number;
    /** Byte-identical to renderMermaidSVG with the same input and options. */
    svg: string;
    colors: DiagramColors;
    /** Identified Scene parts paired with the artwork painted for each part. */
    parts: ResolvedPart[];
    /** Resolved primitives outside those parts, including style backdrops. */
    frame: ResolvedPrimitive[];
}
/** One Scene part and its backend-painted paths/text; not a source node. */
interface ResolvedPart {
    /** Scene part ID; source-facing identity, when available, is node.identity. */
    id: string;
    role: SceneRole;
    kind: SceneNode['kind'];
    node: SceneNode;
    primitives: ResolvedPrimitive[];
}
/** A painted path or text run, distinct from pre-paint Scene geometry.
 * No independent stable ID. Entries in part.primitives are part-associated;
 * entries in scene.frame have no containing part. */
type ResolvedPrimitive = ResolvedPath | ResolvedText;
interface ResolvedPaint {
    fill: string;
    fillOpacity: number;
    stroke: string;
    strokeOpacity: number;
    strokeWidth: number;
    opacity: number;
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'miter' | 'round' | 'bevel' | 'arcs' | 'miter-clip';
    miterLimit: number;
    fillRule: 'nonzero' | 'evenodd';
    paintOrder: string;
    dashArray?: number[];
    dashOffset?: number;
}
interface ResolvedPath {
    kind: 'path';
    d: string;
    matrix: Matrix;
    paint: ResolvedPaint;
    marker?: true;
}
interface ResolvedText {
    kind: 'text';
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fontFamily: string[];
    fontWeight: number;
    fontStyle: 'normal' | 'italic' | 'oblique';
    anchor: 'start' | 'middle' | 'end';
    baseline?: string;
    textLength?: number;
    lengthAdjust?: 'spacing' | 'spacingAndGlyphs';
    letterSpacing?: number;
    matrix: Matrix;
    paint: ResolvedPaint;
}

/**
 * Render a diagram as final backend-painted paths and text, in root user
 * space, with no DOM, network, asynchronous work or remaining CSS dependency.
 * Unsupported artwork fails with its owning part id instead of being omitted.
 */
declare function renderResolvedScene(text: ParsedDiagram | string, options?: RenderOptions): ResolvedScene;

/**
 * Safe, declarative Scene construction for external diagram families.
 *
 * SVG serialization is deliberately not an input here. This compiler owns
 * the backend-private projection so
 * extensions cannot smuggle markup, CSS, or fetching references into a
 * backend. The result is the same SceneDoc consumed by built-in backends; this
 * is a construction surface, not a parallel rendering pipeline.
 */

/** Version of the declarative external Scene builder input contract. */
declare const EXTERNAL_SCENE_API_VERSION: 1;
type ExternalSceneGeometry = Extract<Geometry, {
    kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'polyline';
}>;
/** External Scene v1 keeps connector paths to one explicitly routed linear
 * M/L[/Z] contour whose vertices exactly equal `points`.
 * Core Scene may carry richer multi-subpath topology, but exposing it here
 * requires a future version whose declarative input can prove `d`/topology
 * agreement rather than creating two geometry authorities. */
type ExternalSceneConnectorGeometry = Extract<ConnectorGeometry, {
    kind: 'line' | 'polyline';
}> | Omit<Extract<ConnectorGeometry, {
    kind: 'path';
}>, 'subpaths' | 'markerMidpoints'>;
interface ExternalSceneNodeBase {
    readonly id: string;
    readonly role: SceneRole;
    readonly channels?: SemanticChannels;
}
interface ExternalSceneShape extends ExternalSceneNodeBase {
    readonly kind: 'shape';
    readonly geometry: ExternalSceneGeometry;
    readonly paint?: MarkPaint;
}
/** A quantitative shape. `value` makes the emitted mark claim both the
 * `shape` and `data-mark` primitives in the descriptor ledger. */
interface ExternalSceneDataMark extends ExternalSceneNodeBase {
    readonly kind: 'data-mark';
    readonly geometry: ExternalSceneGeometry;
    readonly value: number;
    readonly paint?: MarkPaint;
}
interface ExternalSceneText extends ExternalSceneNodeBase {
    readonly kind: 'text';
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly fontSize: number;
    readonly anchor?: 'start' | 'middle' | 'end';
    readonly paint?: MarkPaint;
}
interface ExternalSceneContainer extends ExternalSceneNodeBase {
    readonly kind: 'container';
    readonly children: readonly ExternalSceneNode[];
}
interface ExternalSceneConnector extends ExternalSceneNodeBase {
    readonly kind: 'connector';
    readonly geometry: ExternalSceneConnectorGeometry;
    readonly from: string;
    readonly to: string;
    readonly lineStyle?: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible';
    readonly paint?: MarkPaint;
    /** Typed topology for the one path contour exposed by external Scene v1. */
    readonly closed?: boolean;
    readonly startMarker?: string;
    /** One marker resource repeated at every typed interior route point. */
    readonly midMarker?: string;
    readonly endMarker?: string;
    readonly relationship?: {
        readonly kind: string;
        readonly direction?: ConnectorDirection;
    };
    readonly labels?: readonly ExternalSceneConnectorLabel[];
}
type ExternalSceneConnectorLabel = Pick<ConnectorLabelDescriptor, 'id' | 'text' | 'anchor' | 'bounds' | 'halo' | 'clearance' | 'paint' | 'fontSize' | 'textAnchor'>;
type ExternalSceneNode = ExternalSceneShape | ExternalSceneDataMark | ExternalSceneText | ExternalSceneContainer | ExternalSceneConnector;
/** Typed marker resource. Marker geometry is declarative; SVG is never an
 * extension input. Unlike shape marks, markers may use path/compound geometry
 * because their bounded viewport and reference point remain explicit. */
type ExternalSceneMarker = MarkerDescriptor & Required<Pick<MarkerDescriptor, 'geometry' | 'size' | 'ref'>>;
interface ExternalSceneDocument {
    readonly title: string;
    readonly description?: string;
    readonly transparent?: boolean;
}
interface ExternalSceneInput {
    readonly version: typeof EXTERNAL_SCENE_API_VERSION;
    /** A registered `family:*` id. Admission later checks exact descriptor ownership. */
    readonly family: string;
    readonly width: number;
    readonly height: number;
    readonly colors: DiagramColors;
    readonly metadata: ExternalSceneDocument;
    readonly markers?: readonly ExternalSceneMarker[];
    readonly parts: readonly ExternalSceneNode[];
}
/** Compile declarative external primitives into the one canonical SceneDoc. */
declare function buildExternalScene(untrustedInput: ExternalSceneInput): SceneDoc;

declare const SCENE_VALIDATION_LIMITS: Readonly<{
    readonly maxExtent: 1000000;
    readonly maxNodes: 100000;
    readonly maxDepth: 64;
    readonly maxTextLength: 1000000;
    readonly maxTextBytes: 2000000;
    readonly maxPoints: 50000;
    readonly maxSerializationBytesPerNode: 5000000;
    readonly maxAggregateSerializationBytes: 16000000;
    readonly maxFinalSvgBytes: 8000000;
}>;

declare const SCENE_VALIDATION_VERSION: 2;
type SceneValidationDiagnosticCode = 'SCENE_DOCUMENT' | 'SCENE_FINITE' | 'SCENE_BOUNDS' | 'SCENE_ID' | 'SCENE_ROLE' | 'SCENE_PAINT' | 'SCENE_MARKER' | 'SCENE_REFERENCE' | 'SCENE_SECURITY' | 'SCENE_FIDELITY' | 'SCENE_PRIMITIVE_CLAIM' | 'SCENE_CHANNEL_CLAIM';
interface SceneValidationDiagnostic {
    readonly code: SceneValidationDiagnosticCode;
    readonly path: string;
    readonly message: string;
}
interface SceneValidationResult {
    readonly valid: boolean;
    readonly diagnostics: readonly SceneValidationDiagnostic[];
}
interface SceneValidationOptions {
    /** `auto` applies strict rules to a valid `family:*` document id. */
    readonly mode?: 'auto' | 'internal' | 'external';
}
declare class SceneValidationError extends Error {
    readonly diagnostics: readonly SceneValidationDiagnostic[];
    readonly code = "SCENE_VALIDATION_FAILED";
    constructor(diagnostics: readonly SceneValidationDiagnostic[]);
}

/** Validate an unknown value against the current Scene behavioral contract. */
declare function validateSceneDoc(value: unknown, options?: SceneValidationOptions): SceneValidationResult;
declare function assertValidSceneDoc(value: unknown, options?: SceneValidationOptions): asserts value is SceneDoc;

interface SceneConnectorHit {
    readonly id: string;
    readonly role: ConnectorMark['role'];
    readonly connector: ConnectorMark;
    readonly distance: number;
}
declare function connectorHitDistance(connector: ConnectorMark, point: ScenePoint): number | undefined;
declare function hitTestConnector(connector: ConnectorMark, point: ScenePoint, tolerance?: number): boolean;
/** Hit-test every connector using only typed Scene hit geometry. */
declare function hitTestSceneConnectors(scene: SceneDoc, point: ScenePoint, tolerance?: number): readonly SceneConnectorHit[];

/** A marker resource is renderable only when its geometry, viewport, and
 * reference point are explicit. Connector references reuse this descriptor. */
type RenderableMarkerDescriptor = MarkerDescriptor & Required<Pick<MarkerDescriptor, 'geometry' | 'size' | 'ref'>>;
interface MarkerSerializationOptions {
    readonly indent?: number;
}
declare function assertRenderableMarker(marker: MarkerDescriptor): asserts marker is RenderableMarkerDescriptor;
declare function serializeMarkerResource(marker: MarkerDescriptor, options?: MarkerSerializationOptions): string;
declare function serializeMarkerResources(markers: readonly MarkerDescriptor[], options?: MarkerSerializationOptions): string;

/** Validate a typed, same-document gradient resource before serialization. */
declare function assertRenderableLinearGradient(gradient: LinearGradientDescriptor): void;
declare function serializeLinearGradientResource(gradient: LinearGradientDescriptor, options?: {
    indent?: number;
}): string;
declare function serializeLinearGradientResources(gradients: readonly LinearGradientDescriptor[], options?: {
    indent?: number;
}): string;

declare const RESOURCE_MANIFEST_VERSION: 1;
interface ResourceLicense {
    /** SPDX identifier or a stable project-local licence identifier. */
    readonly spdx: string;
    /** POSIX path, relative to the installed package root, containing the notice. */
    readonly noticePath: string;
}
interface ResourceManifestEntry {
    readonly identity: ExtensionIdentity<'resource'>;
    /** POSIX path relative to the installed package root. */
    readonly path: string;
    /** Declared content type; a host must install an explicit verifier for it. */
    readonly mediaType: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly license: ResourceLicense;
    readonly required: boolean;
    /** Installed resources never fall back to an ambient network fetch. */
    readonly network: 'forbidden';
}
interface ResourceManifest {
    readonly version: typeof RESOURCE_MANIFEST_VERSION;
    readonly resources: readonly ResourceManifestEntry[];
}
type ResourceMediaTypeVerifier = (bytes: Uint8Array) => boolean;
/**
 * Validate and defensively copy a manifest into the immutable representation
 * consumed by host resolvers. Caller mutation can never alter this snapshot.
 */
declare function snapshotResourceManifest(manifest: unknown): ResourceManifest;
/** Browser/Worker byte verifier used by bundled in-memory resources. */
declare function verifyResourceBytes(entry: ResourceManifestEntry, bytes: Uint8Array, options?: {
    readonly mediaTypes?: Readonly<Record<string, ResourceMediaTypeVerifier>>;
    readonly digest?: (bytes: Uint8Array) => Promise<string>;
}): Promise<void>;

interface HostedFontFace {
    family: string;
    file: string;
    weight: string;
    style: string;
}
interface HostedFontResource extends HostedFontFace, ResourceManifestEntry {
}
/** Canonical installed-resource view. */
declare const HOSTED_FONT_RESOURCES: readonly HostedFontResource[];
declare const RESOURCE_MANIFEST: ResourceManifest;
/** Browser-safe structural checks; byte integrity is enforced by each host resolver. */
declare function validateResourceManifest(manifest?: unknown): string[];
declare function hostedFontResource(file: string): HostedFontResource;

declare const OUTPUT_COLOR_PROFILE: Readonly<{
    version: 1;
    id: "srgb";
    svgColorInterpolation: "sRGB";
    gamutMapping: "clip-to-srgb";
    png: Readonly<{
        sRGBRenderingIntent: 0;
        cICP: readonly [1, 13, 0, 1];
        iCCP: "absent-when-sRGB-is-present";
        precedence: readonly ["cICP", "iCCP", "sRGB", "gAMA+cHRM"];
    }>;
}>;
interface PngColorProfileReceipt {
    chunks: readonly string[];
    sRGBRenderingIntent?: number;
    cICP?: readonly number[];
    hasICC: boolean;
    profile: typeof OUTPUT_COLOR_PROFILE.id;
}
interface PngDimensions {
    readonly width: number;
    readonly height: number;
}
/** Read validated PNG IHDR dimensions. The whole stream is checked first. */
declare function inspectPngDimensions(bytes: Uint8Array): PngDimensions;
declare function inspectPngColorProfile(bytes: Uint8Array): PngColorProfileReceipt;
declare function applyPngColorProfile(bytes: Uint8Array): Uint8Array;

/** Logical PNG projection policy shared by every first-party raster adapter. */
declare const PNG_DEFAULT_FONT_FAMILY: "Inter";
/** ~16.7 megapixels / ~64 MiB of raw RGBA before encoder overhead. */
declare const MAX_PNG_PIXELS: 16777216;
/** Defends pathological one-pixel-wide/tall rasters that fit the pixel cap. */
declare const MAX_PNG_RASTER_DIMENSION: 16384;
/** Hosted WASM stays below the shared native/browser allocation ceiling. */
declare const MAX_HOSTED_PNG_PIXELS: 4194304;
/** Bounds the hosted response and its unavoidable base64 representation. */
declare const MAX_HOSTED_PNG_BYTES: 8388608;
declare const MAX_PNG_FONT_DIRECTORIES: 16;
declare const MAX_PNG_FONT_DIRECTORY_LENGTH: 4096;
type PngFitTo = {
    readonly width: number;
    readonly height?: never;
} | {
    readonly width?: never;
    readonly height: number;
};
/** Provisional general screen-diagram policy, not a universal readability or
 * accessibility standard. Callers with known viewing conditions should set a
 * task-specific effective-text floor. 0 disables the gate. */
declare const PNG_DEFAULT_MIN_LABEL_PX: 9;
interface PortablePngOutputOptions {
    scale?: number;
    background?: string;
    fitTo?: PngFitTo;
    minLabelPx?: number;
}
interface PngOutputPolicyInput extends PortablePngOutputOptions {
    fontDirs?: readonly string[];
    loadSystemFonts?: boolean;
}
type PngOutputOptionScope = 'portable' | 'native-host-only';
type PngOutputOptionInputKind = 'serializable' | 'callback';
type PngOutputOptionPolicyState = 'included' | 'excluded';
type PngOutputOptionReceiptState = 'included' | 'excluded';
interface PngOutputOptionFieldDescriptor {
    readonly scope: PngOutputOptionScope;
    readonly input: PngOutputOptionInputKind;
    readonly policy: PngOutputOptionPolicyState;
    readonly receipt: PngOutputOptionReceiptState;
    readonly typeScript: string;
    readonly description: string;
    readonly schema?: Readonly<Record<string, unknown>>;
    readonly runtimeValidator?: 'portablePngBackground';
}
declare const PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS: {
    readonly scale: {
        readonly typeScript: "number";
        readonly description: "Positive output scale used when no fitTo constraint is supplied.";
        readonly schema: {
            readonly default: 2;
            readonly type: "number";
            readonly exclusiveMinimum: 0;
        };
        readonly scope: "portable";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly background: {
        readonly typeScript: "string";
        readonly description: "Portable basic color or hex color painted behind the raster artifact.";
        readonly schema: {
            readonly type: "string";
            readonly minLength: 1;
            readonly pattern: string;
        };
        readonly runtimeValidator: "portablePngBackground";
        readonly scope: "portable";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly fitTo: {
        readonly typeScript: "{ width: number; height?: never } | { width?: never; height: number }";
        readonly description: "Exactly one output width or height constraint.";
        readonly schema: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly width: {
                    readonly description: "Exact output width in integer pixels.";
                    readonly type: "integer";
                    readonly minimum: 1;
                };
                readonly height: {
                    readonly description: "Exact output height in integer pixels.";
                    readonly type: "integer";
                    readonly minimum: 1;
                };
            };
            readonly oneOf: readonly [{
                readonly required: readonly ["width"];
            }, {
                readonly required: readonly ["height"];
            }];
            readonly description: "Exactly one positive output width or height.";
        };
        readonly scope: "portable";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly minLabelPx: {
        readonly typeScript: "number";
        readonly description: "Legibility floor in effective px: the render warns (BELOW_READABLE_SIZE) when fitTo/scale rasterizes the smallest configured text below it. 0 disables.";
        readonly schema: {
            readonly type: "number";
            readonly minimum: 0;
            readonly default: 9;
        };
        readonly scope: "portable";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly fontDirs: {
        readonly typeScript: "readonly string[]";
        readonly description: "Trusted native host directories searched for additional fonts.";
        readonly schema: {
            readonly type: "array";
            readonly maxItems: 16;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
                readonly maxLength: 4096;
                readonly pattern: "\\S";
            };
        };
        readonly scope: "native-host-only";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly loadSystemFonts: {
        readonly typeScript: "boolean";
        readonly description: "Allow the native rasterizer to load machine-dependent system fonts.";
        readonly schema: {
            readonly type: "boolean";
            readonly default: false;
        };
        readonly scope: "native-host-only";
        readonly input: "serializable";
        readonly policy: "included";
        readonly receipt: "included";
    };
    readonly onWarning: {
        readonly typeScript: "(warning: PngRasterWarning) => void";
        readonly description: "Native host callback for glyph-coverage and raster-legibility warnings; never serialized or receipted.";
        readonly scope: "native-host-only";
        readonly input: "callback";
        readonly policy: "excluded";
        readonly receipt: "excluded";
    };
};
type PngOutputOptionField = keyof typeof PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS;
type PortablePngOutputOptionField = keyof PortablePngOutputOptions;
type NativePngOutputPolicyField = keyof PngOutputPolicyInput;
type NativePngHostOnlyOptionField = Exclude<PngOutputOptionField, PortablePngOutputOptionField>;
declare const PNG_OUTPUT_OPTION_FIELDS: readonly PngOutputOptionField[];
declare const PORTABLE_PNG_OUTPUT_OPTION_FIELDS: readonly PortablePngOutputOptionField[];
/** Serializable fields accepted by the native output-policy resolver. */
declare const NATIVE_PNG_OUTPUT_POLICY_FIELDS: readonly NativePngOutputPolicyField[];
/** Native-only font inputs plus the non-serializable warning callback. */
declare const NATIVE_PNG_HOST_ONLY_OPTION_FIELDS: readonly NativePngHostOnlyOptionField[];
/** Closed JSON Schema projection for portable or native PNG policy inputs. */
declare function pngOutputOptionsJsonSchema(substrate?: 'portable' | 'native'): Record<string, unknown>;
interface ResolvedPngOutputPolicy {
    readonly version: typeof PNG_OUTPUT_POLICY_VERSION;
    readonly scale: number;
    readonly background: {
        readonly mode: 'artifact';
        readonly fallback: '#ffffff';
    } | {
        readonly mode: 'explicit';
        readonly value: string;
    };
    readonly fitTo: {
        readonly mode: 'zoom';
        readonly value: number;
    } | {
        readonly mode: 'width' | 'height';
        readonly value: number;
    };
    readonly minLabelPx: number;
    readonly fonts: {
        readonly defaultFamily: typeof PNG_DEFAULT_FONT_FAMILY;
        readonly bundledResources: readonly string[];
        readonly callerDirectories: readonly string[];
        readonly loadSystemFonts: boolean;
    };
}
interface PngRasterDimensions {
    readonly width: number;
    readonly height: number;
    readonly pixels: number;
}
type PngRasterBudgetPolicy = number | Pick<ResolvedPngOutputPolicy, 'scale' | 'fitTo'>;
/**
 * Read the dimensions a rasterizer will actually allocate from the SVG root.
 * The viewBox remains an integrity cross-check: mismatched aspect ratios are
 * rejected rather than letting a custom backend hide a large intrinsic canvas
 * behind a small viewBox.
 */
declare function svgIntrinsicDimensions(svg: string): {
    readonly width: number;
    readonly height: number;
};
/** Compute conservative final integer dimensions before a rasterizer allocates. */
declare function pngRasterDimensions(svg: string, output: PngRasterBudgetPolicy): PngRasterDimensions;
/**
 * Pin the SVG intrinsic canvas to the already-budgeted integer dimensions.
 * Native and WASM resvg then render at zoom 1, while browser Canvas receives
 * the same dimensions in its callback context. This avoids backend-specific
 * rounding of fitTo ratios.
 */
declare function prepareSvgForPngRasterization(svg: string, dimensions: PngRasterDimensions): string;
/** Shared allocation gate for native, browser, WASM, CLI, and MCP PNG paths. */
declare function assertPngRasterBudget(svg: string, output: PngRasterBudgetPolicy): PngRasterDimensions;
/** Hosted pre-allocation gate layered over the substrate-neutral dimensions. */
declare function assertHostedPngRasterBudget(dimensions: PngRasterDimensions): PngRasterDimensions;
/** Canonical portable explicit-background intersection understood identically
 * by Canvas and resvg. Keep this narrower admission contract separate from the
 * artifact background, whose safe CSS paint has already passed render-option
 * validation and is resolved to concrete bytes below. */
declare function normalizePortablePngBackground(value: unknown): string | undefined;
/** Pick only portable PNG fields from a combined render/transport options bag. */
declare function projectPortablePngOutputOptions(input: Readonly<Record<string, unknown>>): PortablePngOutputOptions;
/** Pick serializable native PNG policy fields from a combined options bag. */
declare function projectNativePngOutputPolicyInput(input: Readonly<Record<string, unknown>>): PngOutputPolicyInput;
/** Remove every canonical PNG adapter field, including the host callback. */
declare function omitPngOutputOptions<T extends Readonly<Record<string, unknown>>>(input: T): Omit<T, PngOutputOptionField>;
/** Normalize portable controls used by browser/WASM/hosted raster adapters. */
declare function resolvePortablePngOutputPolicy(input?: PortablePngOutputOptions): ResolvedPngOutputPolicy;
/** Normalize native controls and defaults before they participate in a receipt. */
declare function resolvePngOutputPolicy(input?: PngOutputPolicyInput): ResolvedPngOutputPolicy;
declare const PNG_FONT_SOURCES: readonly ["verified-files", "verified-buffers", "caller-directories", "system-fonts", "embedded-data-uri", "unavailable"];
type PngFontSource = typeof PNG_FONT_SOURCES[number];
/** Runtime provenance is artifact metadata, never part of the logical request digest. */
interface PngRuntimeProvenance {
    readonly engine: 'resvg';
    readonly engineVersion: '2.6.2';
    readonly binding: 'napi' | 'wasm';
    /** Every class of font input that could affect the produced bytes. */
    readonly fontSources: readonly PngFontSource[];
    /** Whether every byte-affecting resource is identified by content in the runtime contract. */
    readonly reproducibility: 'content-addressed' | 'host-dependent';
}
declare const PNG_NAPI_RUNTIME: PngRuntimeProvenance;
declare const PNG_WASM_RUNTIME: PngRuntimeProvenance;
/** Add host-controlled font inputs to the N-API artifact provenance. */
declare function pngNapiRuntimeProvenance(input?: {
    readonly callerDirectories?: readonly string[];
    readonly loadSystemFonts?: boolean;
}): PngRuntimeProvenance;

declare const BROWSER_CANVAS_RUNTIME: BrowserPngRuntimeProvenance;

interface PngLegibilityWarning {
    code: 'BELOW_READABLE_SIZE';
    naturalWidth: number;
    naturalHeight: number;
    /** Final raster height / SVG viewBox height. Font-size follows this vertical
     * user-unit scale after PNG projection pins the root dimensions. */
    effectiveScale: number;
    baseMinLabelPx: number;
    effectiveMinLabelPx: number;
    floorPx: number;
    cause: 'fitTo' | 'scale';
    message: string;
}

interface BrowserPngHostDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly resource?: string;
}
/** Shared projection warnings retain their structured evidence; injected
 * rasterizers may append host-specific diagnostics. */
type BrowserPngDiagnostic = PngLegibilityWarning | BrowserPngHostDiagnostic;
interface BrowserPngRasterContext {
    readonly outputPolicy: ResolvedPngOutputPolicy;
    /** Exact integer canvas dimensions approved by the shared raster budget. */
    readonly rasterDimensions: PngRasterDimensions;
    /** Canonical portable color after explicit/artifact/fallback precedence. */
    readonly rasterBackground: string;
    readonly receipt: RenderRequestReceipt;
}
interface BrowserPngRasterResult {
    readonly png: Uint8Array;
    readonly diagnostics?: readonly BrowserPngDiagnostic[];
    /** Host-reported font inputs. Omission is recorded as unavailable evidence. */
    readonly fontSources?: readonly BrowserPngFontSource[];
}
type BrowserPngRasterizer = (securedSvg: string, context: BrowserPngRasterContext) => Promise<BrowserPngRasterResult>;
interface RenderedBrowserPng {
    readonly png: Uint8Array;
    readonly receipt: RenderRequestReceipt;
    readonly diagnostics: readonly BrowserPngDiagnostic[];
    readonly colorProfile: ReturnType<typeof inspectPngColorProfile>;
    /** Host provenance is artifact metadata and never changes the logical receipt. */
    readonly runtime: BrowserPngRuntimeProvenance;
}
type BrowserPngFontSource = Extract<PngFontSource, 'verified-buffers' | 'embedded-data-uri' | 'unavailable'>;
interface BrowserPngRuntimeProvenance {
    readonly engine: 'canvas';
    readonly binding: 'browser';
    readonly fontSources: readonly BrowserPngFontSource[];
    /** Browser callbacks do not expose content identities for every byte-affecting resource. */
    readonly reproducibility: 'host-dependent';
}
/** Trusted browser host inputs; neither callback nor policy is serializable. */
interface MermaidBrowserPNGRendererHostOptions {
    readonly rasterize: BrowserPngRasterizer;
    readonly backendPolicy?: HostBackendPolicy;
    readonly textMeasurement?: TextMeasurementProfile;
}
interface MermaidBrowserPNGRenderer {
    renderMermaidPNG(source: ParsedDiagram | string, options?: RenderOptions, output?: number | PortablePngOutputOptions): Promise<Uint8Array>;
    renderMermaidPNGWithReceipt(source: ParsedDiagram | string, options?: RenderOptions, output?: number | PortablePngOutputOptions): Promise<RenderedBrowserPng>;
}
/** Bind an injected browser rasterizer to one trusted graphical backend policy. */
declare function createMermaidBrowserPNGRenderer(hostOptions: MermaidBrowserPNGRendererHostOptions): MermaidBrowserPNGRenderer;
declare function renderMermaidPNGInBrowserWithReceipt(source: ParsedDiagram | string, options: RenderOptions, output: number | PortablePngOutputOptions, rasterize: BrowserPngRasterizer): Promise<RenderedBrowserPng>;

/**
 * Render Mermaid diagram text to an SVG string — synchronously.
 *
 * Uses elk.bundled.js with a direct FakeWorker bypass (no setTimeout(0) delay).
 * The ELK singleton is created lazily on first use and cached forever.
 *
 * Use this in React components with useMemo() to avoid flash:
 *   const svg = useMemo(() => renderMermaidSVG(code, opts), [code])
 *
 * @param text - Mermaid source text
 * @param options - Rendering options (colors, font, spacing)
 * @returns A self-contained SVG string
 *
 * @example
 * ```ts
 * const svg = renderMermaidSVG('graph TD\n  A --> B')
 *
 * // With theme
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: '#1a1b26', fg: '#a9b1d6'
 * })
 *
 * // With CSS variables (for live theme switching)
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: 'var(--background)', fg: 'var(--foreground)', transparent: true
 * })
 * ```
 */
declare function renderMermaidSVG(text: ParsedDiagram | string, options?: RenderOptions): string;
interface RenderedSvg {
    svg: string;
    receipt: RenderRequestReceipt;
}
/**
 * Trusted host-only renderer construction options. These values are never
 * copied into RenderOptions, CLI/MCP payloads, or editor state. Receipts contain
 * only the selected measurement profile's id/version, never its callback.
 */
interface MermaidRendererHostOptions {
    readonly backendPolicy?: HostBackendPolicy;
    readonly textMeasurement?: TextMeasurementProfile;
}
/** A renderer bound to trusted in-process host policy. */
interface MermaidRenderer {
    renderMermaidSVG(text: ParsedDiagram | string, options?: RenderOptions): string;
    renderMermaidSVGWithReceipt(text: ParsedDiagram | string, options?: RenderOptions): RenderedSvg;
}
/**
 * Construct a trusted in-process renderer. A custom backend is selectable only
 * through this host object; serializable appearance data still describes the
 * requested look and cannot name or smuggle executable backend machinery.
 */
declare function createMermaidRenderer(hostOptions?: MermaidRendererHostOptions): MermaidRenderer;
declare function renderMermaidSVGWithReceipt(text: ParsedDiagram | string, options?: RenderOptions): RenderedSvg;
/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
declare function renderMermaidSVGAsync(text: ParsedDiagram | string, options?: RenderOptions): Promise<string>;

export { MermaidSyntaxError as $, type AsciiRenderOptions as A, BACKEND_CONFORMANCE_CHECK_IDS as B, type ClassDiagram as C, DefaultBackend as D, EXTERNAL_SCENE_API_VERSION as E, type ExternalSceneContainer as F, type ExternalSceneDataMark as G, type HostBackendPolicy as H, type ExternalSceneDocument as I, type ExternalSceneGeometry as J, type ExternalSceneInput as K, type ExternalSceneMarker as L, type ExternalSceneNode as M, type ExternalSceneNodeBase as N, type ExternalSceneShape as O, type PngLegibilityWarning as P, type ExternalSceneText as Q, type FamilyDetectionDiagnostic as R, HOSTED_FONT_RESOURCES as S, MAX_HOSTED_PNG_BYTES as T, MAX_HOSTED_PNG_PIXELS as U, MAX_PNG_FONT_DIRECTORIES as V, MAX_PNG_FONT_DIRECTORY_LENGTH as W, MAX_PNG_PIXELS as X, MAX_PNG_RASTER_DIMENSION as Y, type MermaidFamilyClassification as Z, MermaidFamilyDetectionError as _, type PngOutputPolicyInput as a, type TextMeasurementInput as a$, type MermaidSyntaxErrorLocation as a0, NATIVE_PNG_HOST_ONLY_OPTION_FIELDS as a1, NATIVE_PNG_OUTPUT_POLICY_FIELDS as a2, type NativePngHostOnlyOptionField as a3, type NativePngOutputPolicyField as a4, PNG_DEFAULT_FONT_FAMILY as a5, PNG_DEFAULT_MIN_LABEL_PX as a6, PNG_DEFAULT_SCALE as a7, PNG_FONT_SOURCES as a8, PNG_NAPI_RUNTIME as a9, SCENE_VALIDATION_LIMITS as aA, SCENE_VALIDATION_VERSION as aB, type SceneValidationDiagnostic as aC, type SceneValidationDiagnosticCode as aD, SceneValidationError as aE, type SceneValidationOptions as aF, type SceneValidationResult as aG, type SequenceActivationEvent as aH, type Actor as aI, type SequenceActorType as aJ, type SequenceBoxGroup as aK, type SequenceDiagram as aL, type Block as aM, type Message as aN, type Note as aO, type SequenceMessageHead as aP, type StyleBackend as aQ, type StyleBackendContext as aR, TERMINAL_BOUNDED_PADDING_X as aS, TERMINAL_DEFAULT_BOX_BORDER_PADDING as aT, TERMINAL_DEFAULT_PADDING_X as aU, TERMINAL_DEFAULT_PADDING_Y as aV, TERMINAL_OUTPUT_POLICY_VERSION as aW, TEXT_MEASUREMENT_CONTRACT as aX, TerminalOutputPolicyError as aY, type TerminalOutputPolicyInput as aZ, type TextMeasurementContract as a_, PNG_OUTPUT_OPTION_FIELDS as aa, PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS as ab, PNG_OUTPUT_POLICY_VERSION as ac, PNG_WASM_RUNTIME as ad, PORTABLE_PNG_OUTPUT_OPTION_FIELDS as ae, type PngFitTo as af, type PngFontSource as ag, type PngOutputOptionField as ah, type PngOutputOptionFieldDescriptor as ai, type PngOutputOptionInputKind as aj, type PngOutputOptionPolicyState as ak, type PngOutputOptionReceiptState as al, type PngOutputOptionScope as am, type PngRasterDimensions as an, type PortablePngOutputOptionField as ao, type PortablePngOutputOptions as ap, RESOLVED_SCENE_VERSION as aq, RESOURCE_MANIFEST as ar, RESOURCE_MANIFEST_VERSION as as, type RenderedAscii as at, type ResolvedPngOutputPolicy as au, type ResolvedScene as av, ResolvedSceneError as aw, type ResolvedSceneFeature as ax, type ResolvedTerminalOutputPolicy as ay, SCENE_CONTRACT_VERSION as az, type PngRuntimeProvenance as b, type MermaidBrowserPNGRenderer as b$, type TextMeasurementResult as b0, UPSTREAM_MERMAID_FAMILY_INDEX as b1, type UpstreamFamilyDescriptor as b2, type UpstreamHeaderDescriptor as b3, type UpstreamHeaderMatch as b4, type UpstreamMermaidFamilyIndex as b5, assertHostedPngRasterBudget as b6, assertPngRasterBudget as b7, assertValidSceneDoc as b8, buildExternalScene as b9, runBackendConformance as bA, svgIntrinsicDimensions as bB, validateResourceManifest as bC, validateSceneDoc as bD, verifyResourceBytes as bE, renderMermaidASCII as bF, renderMermaidSVG as bG, type RenderedSvg as bH, ARCHITECTURE_ICON_LIMITS as bI, BROWSER_CANVAS_RUNTIME as bJ, type BrowserPngDiagnostic as bK, type BrowserPngFontSource as bL, type BrowserPngHostDiagnostic as bM, type BrowserPngRasterContext as bN, type BrowserPngRasterResult as bO, type BrowserPngRasterizer as bP, type BrowserPngRuntimeProvenance as bQ, GitGraphDuplicateCommitError as bR, GitGraphParseError as bS, type HostBackendSelection as bT, type HostedFontFace as bU, type HostedFontResource as bV, type LayoutCertificationAttempt as bW, LayoutCertificationError as bX, LayoutMetricBudgetError as bY, type MarkerSerializationOptions as bZ, type Matrix as b_, classifyMermaidFamilyFromFirstLine as ba, findUpstreamFamilyByHeader as bb, getBackend as bc, hostedFontResource as bd, knownBackendDescriptors as be, measureText as bf, measureTextWidth as bg, normalizePortablePngBackground as bh, omitPngOutputOptions as bi, parseAgentflowModel as bj, parseClassDiagram as bk, parseErDiagram as bl, parseRegisteredMermaid as bm, parseSequenceDiagram as bn, parseUsecaseModel as bo, pngNapiRuntimeProvenance as bp, pngOutputOptionsJsonSchema as bq, pngRasterDimensions as br, prepareSvgForPngRasterization as bs, projectNativePngOutputPolicyInput as bt, projectPortablePngOutputOptions as bu, registerBackend as bv, renderResolvedScene as bw, resolvePngOutputPolicy as bx, resolvePortablePngOutputPolicy as by, resolveTerminalOutputPolicy as bz, type AsciiRenderColorMode as c, type MermaidBrowserPNGRendererHostOptions as c0, type MermaidRenderer as c1, type MermaidRendererHostOptions as c2, MindmapDuplicateIdError as c3, MindmapParseError as c4, OUTPUT_COLOR_PROFILE as c5, type ParserObservation as c6, type ParserObservationSource as c7, type ParserObservationValue as c8, type ParserObserver as c9, parseArchitectureDiagram as cA, parseGitGraph as cB, parseMindmap as cC, renderMermaidASCIIWithReceipt as cD, renderMermaidPNGInBrowserWithReceipt as cE, renderMermaidSVGAsync as cF, renderMermaidSVGWithReceipt as cG, resolveArchitectureIcon as cH, resolveDiagramColors as cI, serializeGitGraph as cJ, serializeLinearGradientResource as cK, serializeLinearGradientResources as cL, serializeMarkerResource as cM, serializeMarkerResources as cN, serializeMindmap as cO, snapshotResourceManifest as cP, withParserObservation as cQ, type PngColorProfileReceipt as ca, type PngDimensions as cb, type RenderableMarkerDescriptor as cc, type RenderedBrowserPng as cd, type ResolvedArchitectureIcon as ce, type ResolvedPaint as cf, type ResolvedPart as cg, type ResolvedPath as ch, type ResolvedPrimitive as ci, type ResolvedText as cj, type ResourceLicense as ck, type ResourceManifest as cl, type ResourceManifestEntry as cm, type SceneConnectorHit as cn, applyPngColorProfile as co, architectureIconManifest as cp, architectureToMermaidGraph as cq, assertRenderableLinearGradient as cr, assertRenderableMarker as cs, connectorHitDistance as ct, createMermaidBrowserPNGRenderer as cu, createMermaidRenderer as cv, hitTestConnector as cw, hitTestSceneConnectors as cx, inspectPngColorProfile as cy, inspectPngDimensions as cz, AsciiWidthError as d, type AsciiWidthErrorReason as e, BACKEND_CONFORMANCE_FIXTURE_ID as f, BACKEND_CONFORMANCE_VERSION as g, type BackendCapabilityConformanceResult as h, type BackendCapabilityConformanceStatus as i, type BackendConformanceCheck as j, type BackendConformanceCheckId as k, type BackendConformanceReport as l, type BackendDescriptor as m, type BackendRegistrationOptions as n, type ClassNode as o, type ClassMember as p, type ClassNamespace as q, type ClassRelationship as r, type ErDiagram as s, type ErAttribute as t, type ErEntity as u, type ErGroup as v, type ErRelationship as w, type ExternalSceneConnector as x, type ExternalSceneConnectorGeometry as y, type ExternalSceneConnectorLabel as z };
