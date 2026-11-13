import { S as StyleInput, Q as InternalStyleFace } from './svg-styles-24_BFqX1.js';

/** One final-geometry check a drawn but uncertified layout fails. `kind` is
 * the check: a hard rubric metric (`endpointApproaches`, `nodeOverlaps`, …),
 * `groupHeaderBand`, `groupBreaches` or `groupOverlaps`. `targets` are the
 * authored ids involved, edges as `source->target`; for `groupBreaches` they
 * are the group, then the escaping member. */
interface LayoutCertificationViolation {
    readonly kind: string;
    readonly targets: readonly string[];
    readonly detail: string;
}
/** Report-mode evidence that the drawn geometry did not pass certification.
 * No bounded candidate certified; `strategy` names the candidate drawn,
 * chosen by fewest misleading violations, then fewest violations, then
 * candidate order (src/layout/certification.ts). Strict layout safety refuses
 * instead. */
interface UncertifiedLayoutReceipt {
    readonly status: 'uncertified';
    readonly strategy: string;
    readonly attempts: number;
    readonly violations: readonly LayoutCertificationViolation[];
}

/** Trusted pixel metrics. Executable profiles never enter diagram/config data. */
interface TextMeasurementProfileIdentity {
    readonly id: string;
    readonly version: string;
}
interface ProfileTextMeasurementInput {
    readonly text: string;
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly fontWeight: number;
    readonly fontStyle: 'normal' | 'italic';
    readonly monospace: boolean;
}
/** Actual shaped ink, before fitting or tracking, relative to its baseline origin.
 * A host supplies the same resolved fonts and shaping to the output consumer. */
interface ProfileTextInkMeasurement {
    readonly advance: number;
    readonly bounds: {
        readonly x0: number;
        readonly y0: number;
        readonly x1: number;
        readonly y1: number;
    } | null;
}
/** A host must keep a profile's metrics stable for its id/version and fonts. */
interface TextMeasurementProfile extends TextMeasurementProfileIdentity {
    readonly measure: (input: Readonly<ProfileTextMeasurementInput>) => number;
    /** Undefined leaves ink unmeasured; null bounds mean the run paints no ink. */
    readonly measureInk?: (input: Readonly<ProfileTextMeasurementInput>) => ProfileTextInkMeasurement | undefined;
}
declare const DEFAULT_TEXT_MEASUREMENT_PROFILE: TextMeasurementProfileIdentity;

interface TextBreak {
    readonly kind: 'authored' | 'wrap' | 'hyphen';
    readonly sourceOffset: number;
    readonly replacedText?: string;
}
interface PixelTextLine {
    readonly runs: readonly DisplayRun[];
    readonly text: string;
    readonly width: number;
    readonly baseline: number;
    readonly originX: number;
    /** ASCII tracking and styled runs use these exact allocations during emission. */
    readonly fragments?: readonly PixelTextFragment[];
    /** Host-shaped ink for the single continuously fitted line. */
    readonly ink?: ProfileTextInkMeasurement;
}
interface PixelTextFragment {
    readonly runIndex: number;
    readonly text: string;
    readonly x: number;
    readonly width: number;
    readonly ink?: ProfileTextInkMeasurement;
}
interface PixelTextBlock {
    readonly unit: 'px';
    readonly prepared: PreparedDisplayText;
    readonly text: string;
    readonly lines: string[];
    readonly lineBlocks: readonly PixelTextLine[];
    readonly breaks: readonly TextBreak[];
    readonly width: number;
    readonly height: number;
    readonly lineHeight: number;
    readonly fontSize: number;
    readonly fontWeight: number;
    readonly letterSpacing: number;
    readonly monospace: boolean;
    readonly safeFont: boolean;
    readonly fontFamily?: string;
}

/**
 * How a context displays a normalized label. In both, `\n` breaks the line
 * and tag-like text other than the formatting tags (`a<c>d`) is text.
 * - `formatted`: the formatting tags (<b>/<strong>, <i>/<em>, <u>, <s>/<del>)
 *   style runs and are not text (renderMultilineText's default).
 * - `literal`: every character is text, formatting tags included (Pie,
 *   Timeline, Gantt, XYChart and GitGraph draw labels as written).
 */
type LabelDisplay = 'formatted' | 'literal';

interface StyledSegment {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
}

interface DisplayRun extends Readonly<StyledSegment> {
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly clusters?: readonly {
        text: string;
        sourceStart: number;
        sourceEnd: number;
    }[];
}
interface PreparedDisplayText {
    readonly source: string;
    readonly display: LabelDisplay;
    readonly transform?: TextTransform;
    readonly lines: readonly (readonly DisplayRun[])[];
    readonly lineStarts: readonly number[];
}
/** A family's public string and the display reading that produced it. The
 * snapshot prevents a later direct string edit from reusing stale runs. */
interface LabelContent {
    readonly value: string;
    readonly prepared: PreparedDisplayText;
    /** Family lexical payload before display/entity normalization, with its
     * quoting removed. This is not an original diagram source coordinate. */
    readonly authored?: string;
}

interface DiagramColors {
    /** Background color → CSS variable --bg */
    bg: string;
    /** Foreground / primary text color → CSS variable --fg */
    fg: string;
    /** Edge/connector color → CSS variable --line */
    line?: string;
    /** Arrow heads, highlights, special nodes → CSS variable --accent */
    accent?: string;
    /** Secondary text, edge labels → CSS variable --muted */
    muted?: string;
    /** Node/box fill tint → CSS variable --surface */
    surface?: string;
    /** Base node/group stroke color → --border; automatic outlines repair contrast. */
    border?: string;
    /** Optional explicit drop shadows on node shapes. Default: false */
    shadow?: boolean;
    /**
     * Font family for all text. Emitted on the SVG root as `--font`, so the family
     * stays overridable post-render via inline style. Default: 'Inter'.
     *
     * Accepts a plain family name ('Inter'), a CSS variable reference
     * ('var(--brand-font)'), or a multi-family stack ('Inter, system-ui').
     * Only plain names get a Google Fonts `@import`; var() references and
     * stacks are emitted as-is (unquoted) and never fetched.
     */
    font?: string;
    /**
     * Whether to embed the Google Fonts `@import` line in the SVG `<style>` block.
     * Default: `false`. Set `true` explicitly when a fetching font import is
     * appropriate for the target document.
     *
     * PNG paths keep this disabled to render offline.
     * The CSS variable `--font` is always emitted on the SVG root regardless,
     * so the family stays overridable post-render even when the @import is gone.
     */
    embedFontImport?: boolean;
}
/** Default bg/fg when no colors are provided (zinc light) */
declare const DEFAULTS: Readonly<{
    bg: string;
    fg: string;
}>;
/**
 * Minimal subset of Shiki's ThemeRegistrationResolved that we need.
 * We don't import from shiki to avoid a hard dependency.
 */
interface ShikiThemeLike {
    type?: string;
    colors?: Record<string, string>;
    tokenColors?: Array<{
        scope?: string | string[];
        settings?: {
            foreground?: string;
        };
    }>;
}
/**
 * Extract diagram colors from a Shiki theme object.
 * Works with any VS Code / TextMate theme loaded by Shiki.
 *
 * Maps editor UI colors to diagram roles:
 *   editor.background         → bg
 *   editor.foreground         → fg
 *   editorLineNumber.fg       → line (optional)
 *   focusBorder / keyword     → accent (optional)
 *   comment token             → muted (optional)
 *   editor.selectionBackground→ surface (optional)
 *   editorWidget.border       → border (optional)
 *
 * @example
 * ```ts
 * import { getSingletonHighlighter } from 'shiki'
 * import { fromShikiTheme } from 'agentic-mermaid'
 *
 * const hl = await getSingletonHighlighter({ themes: ['tokyo-night'] })
 * const colors = fromShikiTheme(hl.getTheme('tokyo-night'))
 * const svg = renderMermaidSVG(code, colors)
 * ```
 */
declare function fromShikiTheme(theme: ShikiThemeLike): DiagramColors;
/**
 * All derived diagram colors resolved to concrete hex values.
 * Mirrors the CSS variable derivation system in buildStyleBlock().
 */
interface ResolvedColors {
    bg: string;
    fg: string;
    text: string;
    textSec: string;
    textMuted: string;
    textFaint: string;
    line: string;
    arrow: string;
    nodeFill: string;
    nodeStroke: string;
    groupFill: string;
    groupHdr: string;
    innerStroke: string;
    keyBadge: string;
}
/**
 * Resolve all derived colors from a DiagramColors to concrete hex values.
 * Starts from the CSS color-mix() derivations in buildStyleBlock(), then repairs
 * concrete text, connector and outline tones against their known backgrounds.
 */
declare function resolveColors(colors: DiagramColors): ResolvedColors;
/**
 * Resolve all CSS var() and color-mix() expressions in an SVG string to
 * concrete hex color values. This makes the SVG render correctly in
 * non-browser renderers (resvg, librsvg, etc.) that don't support CSS
 * custom properties or color-mix().
 *
 * Operates via iterative string replacement:
 *   1. Replace var(--name) with known resolved values
 *   2. Replace var(--name, fallback) — use value if known, else fallback
 *   3. Resolve color-mix(in srgb, #hex P%, #hex) to computed hex
 *   4. Extract CSS variable definitions from <style> and resolve remaining refs
 *   5. Repeat until stable
 *
 * When bg/fg cannot be resolved (e.g. CSS variables for live theming), the SVG
 * is returned as-is since the eventual host supplies their values.
 */
declare function inlineResolvedColors(svg: string, colors: DiagramColors): string;

/** A title placed on the canvas: its display text centered at (x, y). */
interface PositionedDiagramTitle {
    text: string;
    x: number;
    y: number;
    block?: PixelTextBlock;
}

interface LayoutPreferenceScore {
    unreadableTitles: 0 | 1;
    edgeCrossings: number;
    labelConflicts: number;
    totalBends: number;
    nonCanonicalEndpointRate: number;
    peerBarycenterDelta: number;
    /** Candidate canvas before document title-band projection. */
    area: number;
}
type PreferenceCriterion = keyof LayoutPreferenceScore;
interface LayoutPreferenceEvidence {
    /** Score of the returned geometry, including the optional final route choice. */
    selectedScore: LayoutPreferenceScore;
    /** Placement-strategy decision, before the optional final route comparison. */
    reason: PreferenceCriterion | 'candidate-order' | 'first-certified' | 'work-budget' | 'no-alternative' | 'alternative-invalid' | 'non-regressing';
    /** Certified placement scores before the optional final route comparison. */
    compared: readonly {
        strategy: string;
        score: LayoutPreferenceScore;
    }[];
    /** Final bundled/unbundled decision using the selected placement's ELK result.
     * Its selected score describes the same final geometry as selectedScore above. */
    routing?: {
        strategy: 'bundled' | 'without-generic-bundling';
        preference: Omit<LayoutPreferenceEvidence, 'routing'>;
    };
}
interface LayoutCertificationReceipt {
    status: 'passed';
    strategy: string;
    /** Placement-production attempts; an optional final routing comparison is separate. */
    attempts: number;
    hardViolations: 0;
    preference: LayoutPreferenceEvidence;
}

interface GraphLayoutDecision {
    readonly requested: 'elk' | 'agentic';
    readonly fallback: 'none' | 'elk';
    readonly selected: 'elk' | 'agentic';
    readonly reason?: string;
    readonly attempts: readonly {
        readonly backend: 'elk' | 'agentic';
        readonly outcome: 'selected' | 'unsupported' | 'candidate-rejected';
        readonly reason?: string;
    }[];
    readonly implementation: string;
    readonly role?: 'primary' | 'companion';
}
declare class GraphLayoutUnsupportedError extends Error {
    readonly reason: string;
    readonly code = "GRAPH_LAYOUT_UNSUPPORTED";
    constructor(reason: string, backend?: 'Agentic' | 'ELK');
}

interface StateScope {
    parent: string;
    /** Zero-based concurrent region; absent for an ordinary composite. */
    region?: number;
}
/** A named annotation in its own scope, with no attachment to a state. Its
 * identity is in the note namespace, independently of authored state IDs. */
interface FloatingStateNote {
    id: string;
    text: string;
    textContent?: LabelContent;
    scope?: StateScope;
}

type MermaidCleanupView = 'text' | 'payloadText' | 'authoredPayloadText' | 'lineText' | 'upstreamText' | 'prepassedText';
type MermaidCleanupReason = 'line-ending' | 'xml-entity' | 'html-attribute-quotes' | 'style-semicolon' | 'native-accessibility';
/** Offsets are UTF-16 boundaries, matching String.slice and public source spans. */
interface MermaidCleanupEdit {
    readonly originalStart: number;
    readonly originalEnd: number;
    readonly cleanedStart: number;
    readonly cleanedEnd: number;
}
/** One sparse transformation. Coordinates refer to this pass's input/output. */
interface MermaidCleanupMapping {
    readonly edits: readonly MermaidCleanupEdit[];
}
interface MermaidCleanupChange extends MermaidCleanupEdit {
    readonly reason: MermaidCleanupReason;
    readonly view: MermaidCleanupView;
    readonly line: number;
    readonly col: number;
}
/** Immutable data only: safe to retain in normalized sources and request snapshots. */
interface MermaidCleanup {
    readonly originalText: string;
    /** Generous rendering convention: XML decode once and normalize line endings. */
    readonly text: string;
    /** CRLF normalized, lone CR retained for grammar-owned payload identities. */
    readonly payloadText: string;
    /** The same payload-aware line endings without transport XML decoding. */
    readonly authoredPayloadText: string;
    /** Authored grammar spelling with CRLF and lone CR normalized. */
    readonly lineText: string;
    /** Mermaid's cleanupText result: normalized line endings and tag quotes.
     * The generous grammar preserves authored quotes instead. */
    readonly upstreamText: string;
    /** Authored spelling after line endings and the style/classDef semicolon pass. */
    readonly prepassedText: string;
    readonly changes: readonly MermaidCleanupChange[];
    readonly mappings: readonly MermaidCleanupMapping[];
    readonly lineMappings: readonly MermaidCleanupMapping[];
    readonly upstreamMappings: readonly MermaidCleanupMapping[];
    readonly prepassedMappings: readonly MermaidCleanupMapping[];
}

interface MermaidAccessibility {
    title?: string;
    descr?: string;
}
interface AccessibilityFieldProjection {
    accessibilityTitle?: string;
    accessibilityDescription?: string;
}

type MermaidConfigScalar = string | number | boolean | null;
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | MermaidConfigMap;
interface MermaidConfigMap {
    [key: string]: MermaidConfigValue | undefined;
}
interface MermaidFrontmatterMap extends MermaidConfigMap {
}
interface MermaidThemeVariables extends MermaidConfigMap {
    fontFamily?: string;
}
interface TimelineRuntimeConfig extends MermaidConfigMap {
    disableMulticolor?: boolean;
    sectionFills?: string[];
    sectionColours?: string[];
}
/** Mermaid stateDiagram config. Faithful ELK/measured-text fields are wired; unsupported fields warn. */
interface StateRuntimeConfig extends MermaidConfigMap {
    titleTopMargin?: number;
    arrowMarkerAbsolute?: boolean;
    dividerMargin?: number;
    sizeUnit?: number;
    padding?: number;
    textHeight?: number;
    titleShift?: number;
    noteMargin?: number;
    nodeSpacing?: number;
    rankSpacing?: number;
    forkWidth?: number;
    forkHeight?: number;
    miniPadding?: number;
    fontSizeFactor?: number;
    fontSize?: number;
    labelHeight?: number;
    edgeLengthFactor?: string;
    compositTitleSize?: number;
    radius?: number;
    defaultRenderer?: 'dagre-d3' | 'dagre-wrapper' | 'elk';
    layout?: string;
    look?: string;
    minNodeWidth?: number;
    theme?: string;
    wrappingWidth?: number;
}
interface XyChartRuntimeConfig extends MermaidConfigMap {
    width?: number;
    height?: number;
    useMaxWidth?: boolean;
    useWidth?: number;
    titleFontSize?: number;
    titlePadding?: number;
    chartOrientation?: 'vertical' | 'horizontal';
    plotReservedSpacePercent?: number;
    showDataLabel?: boolean;
    showDataLabelOutsideBar?: boolean;
    showTitle?: boolean;
    showLegend?: boolean;
    legendFontSize?: number;
    legendPadding?: number;
    xAxis?: MermaidConfigMap;
    yAxis?: MermaidConfigMap;
}
interface PieRuntimeConfig extends MermaidConfigMap {
    textPosition?: number;
    donutHole?: number;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    highlightSlice?: string;
    useMaxWidth?: boolean;
    useWidth?: number;
}
interface SankeyRuntimeConfig extends MermaidConfigMap {
    width?: number;
    height?: number;
    linkColor?: 'source' | 'target' | 'gradient' | string;
    nodeAlignment?: 'justify' | 'center' | 'left' | 'right';
    showValues?: boolean;
    prefix?: string;
    suffix?: string;
    labelStyle?: 'legacy' | 'outlined';
    nodeWidth?: number;
    nodePadding?: number;
    nodeColors?: Record<string, string>;
    useMaxWidth?: boolean;
}
interface RadarRuntimeConfig extends MermaidConfigMap {
    width?: number;
    height?: number;
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    axisScaleFactor?: number;
    axisLabelFactor?: number;
    curveTension?: number;
    useMaxWidth?: boolean;
    useWidth?: number;
    /** Agentic extension: draw the ring value labels (default off). */
    tickLabels?: boolean;
}
interface QuadrantRuntimeConfig extends MermaidConfigMap {
    chartWidth?: number;
    chartHeight?: number;
    titleFontSize?: number;
    titlePadding?: number;
    quadrantPadding?: number;
    quadrantLabelFontSize?: number;
    xAxisLabelFontSize?: number;
    yAxisLabelFontSize?: number;
    xAxisLabelPadding?: number;
    yAxisLabelPadding?: number;
    pointLabelFontSize?: number;
    pointRadius?: number;
    pointTextPadding?: number;
    quadrantInternalBorderStrokeWidth?: number;
    quadrantExternalBorderStrokeWidth?: number;
    useMaxWidth?: boolean;
    quadrantTextTopPadding?: number;
    xAxisPosition?: string;
    yAxisPosition?: string;
    useWidth?: number;
}
interface JourneyRuntimeConfig extends MermaidConfigMap {
    diagramMarginX?: number;
    diagramMarginY?: number;
    leftMargin?: number;
    maxLabelWidth?: number;
    width?: number;
    height?: number;
    boxMargin?: number;
    boxTextMargin?: number;
    noteMargin?: number;
    messageMargin?: number;
    messageAlign?: 'left' | 'center' | 'right';
    bottomMarginAdj?: number;
    useMaxWidth?: boolean;
    rightAngles?: boolean;
    taskFontSize?: string | number;
    taskFontFamily?: string;
    taskMargin?: number;
    activationWidth?: number;
    textPlacement?: string;
    actorColours?: string[];
    sectionFills?: string[];
    sectionColours?: string[];
    titleColor?: string;
    titleFontFamily?: string;
    titleFontSize?: string | number;
}
interface GanttRuntimeConfig extends MermaidConfigMap {
    displayMode?: string;
    barHeight?: number;
    topAxis?: boolean;
    tickInterval?: string;
    barGap?: number;
    topPadding?: number;
    leftPadding?: number;
    gridLineStartPadding?: number;
    fontSize?: number;
    sectionFontSize?: number;
    numberSectionStyles?: number;
    axisFormat?: string;
    todayMarker?: string;
    weekday?: string;
}
/** Wired deterministic mindmap layout fields. */
interface MindmapRuntimeConfig extends MermaidConfigMap {
    padding?: number;
    maxNodeWidth?: number;
}
/** Wired GitGraph presentation and replay fields. */
interface GitGraphRuntimeConfig extends MermaidConfigMap {
    showBranches?: boolean;
    showCommitLabel?: boolean;
    mainBranchName?: string;
    mainBranchOrder?: number;
    parallelCommits?: boolean;
    rotateCommitLabel?: boolean;
}
/**
 * Mermaid's documented classDiagram config shape (wire-or-warn, P4):
 * nodeSpacing/rankSpacing are wired into the ELK layout
 * (src/class/layout.ts resolveClassRenderOptions); every other documented
 * key is accepted for config-shape compatibility and named by verify's
 * INEFFECTIVE_CONFIG lint (the family's config.noopKeys in src/agent/families.ts).
 */
interface ClassRuntimeConfig extends MermaidConfigMap {
    nodeSpacing?: number;
    rankSpacing?: number;
    titleTopMargin?: number;
    arrowMarkerAbsolute?: boolean;
    dividerMargin?: number;
    padding?: number;
    textHeight?: number;
    defaultRenderer?: string;
    diagramPadding?: number;
    htmlLabels?: boolean;
    hideEmptyMembersBox?: boolean;
    hierarchicalNamespaces?: boolean;
}
/**
 * Mermaid's documented er config shape (wire-or-warn, P4): layoutDirection +
 * nodeSpacing/rankSpacing are wired (src/er/layout.ts
 * applyErFrontmatterConfig); the rest emit INEFFECTIVE_CONFIG
 * (the family's config.noopKeys in src/agent/families.ts).
 */
interface ErRuntimeConfig extends MermaidConfigMap {
    layoutDirection?: string;
    nodeSpacing?: number;
    rankSpacing?: number;
    titleTopMargin?: number;
    diagramPadding?: number;
    minEntityWidth?: number;
    minEntityHeight?: number;
    entityPadding?: number;
    stroke?: string;
    fill?: string;
    fontSize?: number;
}
/**
 * Mermaid's documented architecture config shape (wire-or-warn, P4): padding,
 * iconSize, fontSize, nodeSeparation, and idealEdgeLengthMultiplier are wired
 * (src/architecture/config.ts); the fcose simulation knobs — edgeElasticity,
 * numIter, seed, randomize — have no meaning in the deterministic layout and
 * emit INEFFECTIVE_CONFIG (the family's config.noopKeys in
 * src/agent/families.ts).
 */
interface ArchitectureRuntimeConfig extends MermaidConfigMap {
    padding?: number;
    iconSize?: number;
    fontSize?: number;
    nodeSeparation?: number;
    idealEdgeLengthMultiplier?: number;
    edgeElasticity?: number;
    numIter?: number;
    seed?: number;
    randomize?: boolean;
}
/**
 * Mermaid's documented flowchart config shape (wire-or-warn, P4):
 * nodeSpacing/rankSpacing/wrappingWidth are wired
 * (src/flowchart-config.ts resolveFlowchartRenderOptions); every other
 * documented key is accepted for config-shape compatibility and named by
 * verify's INEFFECTIVE_CONFIG lint (the family's config.noopKeys in
 * src/agent/families.ts).
 */
interface FlowchartRuntimeConfig extends MermaidConfigMap {
    nodeSpacing?: number;
    rankSpacing?: number;
    wrappingWidth?: number;
    titleTopMargin?: number;
    subGraphTitleMargin?: MermaidConfigMap;
    arrowMarkerAbsolute?: boolean;
    diagramPadding?: number;
    htmlLabels?: boolean;
    curve?: string;
    padding?: number;
    defaultRenderer?: string;
    inheritDir?: boolean;
}
/**
 * Mermaid's documented sequence config shape (wire-or-warn, P4): actorMargin,
 * width, height, diagramMarginX/Y, messageMargin, noteMargin, activationWidth,
 * and showSequenceNumbers are wired (src/sequence/config.ts
 * resolveSequenceConfig → src/sequence/layout.ts); every other documented key
 * is accepted for config-shape compatibility and named by verify's
 * INEFFECTIVE_CONFIG lint (the family's config.noopKeys in
 * src/agent/families.ts).
 */
interface SequenceRuntimeConfig extends MermaidConfigMap {
    actorMargin?: number;
    width?: number;
    height?: number;
    diagramMarginX?: number;
    diagramMarginY?: number;
    messageMargin?: number;
    noteMargin?: number;
    activationWidth?: number;
    showSequenceNumbers?: boolean;
    boxMargin?: number;
    boxTextMargin?: number;
    messageAlign?: 'left' | 'center' | 'right';
    mirrorActors?: boolean;
    bottomMarginAdj?: number;
    rightAngles?: boolean;
    wrap?: boolean;
    wrapPadding?: number;
    labelBoxWidth?: number;
    labelBoxHeight?: number;
    hideUnusedParticipants?: boolean;
    forceMenus?: boolean;
    arrowMarkerAbsolute?: boolean;
    noteAlign?: 'left' | 'center' | 'right';
    actorFontSize?: string | number;
    actorFontFamily?: string;
    actorFontWeight?: string | number;
    noteFontSize?: string | number;
    noteFontFamily?: string;
    noteFontWeight?: string | number;
    messageFontSize?: string | number;
    messageFontFamily?: string;
    messageFontWeight?: string | number;
}
/** C4 spacing is pixel-space; terminal layout allocates its own cell geometry. */
interface C4RuntimeConfig extends MermaidConfigMap {
    /** Reflow budget in pixels; minimum legible geometry may exceed it with a diagnostic. */
    maxWidth?: number;
    /** Compact independently measured pixel and terminal layouts. */
    compact?: boolean;
    /** Automatic semantic type legend; authored legend directives remain independent. */
    typeLegend?: boolean;
    diagramMarginX?: number;
    diagramMarginY?: number;
    c4ShapeMargin?: number;
    c4ShapePadding?: number;
    width?: number;
    height?: number;
    boxMargin?: number;
    nextLinePaddingX?: number;
    c4ShapeInRow?: number;
    c4BoundaryInRow?: number;
    wrap?: boolean;
    wrapPadding?: number;
    useMaxWidth?: boolean;
}
interface MermaidRuntimeConfig extends MermaidConfigMap {
    theme?: string;
    fontFamily?: string;
    themeVariables?: MermaidThemeVariables;
    flowchart?: FlowchartRuntimeConfig;
    state?: StateRuntimeConfig;
    timeline?: TimelineRuntimeConfig;
    journey?: JourneyRuntimeConfig;
    xyChart?: XyChartRuntimeConfig;
    pie?: PieRuntimeConfig;
    quadrantChart?: QuadrantRuntimeConfig;
    radar?: RadarRuntimeConfig;
    sankey?: SankeyRuntimeConfig;
    c4?: C4RuntimeConfig;
    gantt?: GanttRuntimeConfig;
    sequence?: SequenceRuntimeConfig;
    class?: ClassRuntimeConfig;
    er?: ErRuntimeConfig;
    architecture?: ArchitectureRuntimeConfig;
    mindmap?: MindmapRuntimeConfig;
    gitGraph?: GitGraphRuntimeConfig;
    useMaxWidth?: boolean;
    useWidth?: number;
    themeCSS?: string;
}
interface MermaidSourceInitDirective {
    raw: string;
    parsed: MermaidFrontmatterMap;
}
interface MermaidSourceComment {
    text: string;
    line: number;
}
interface MermaidSourceAccessibility extends MermaidAccessibility {
}
interface NormalizedMermaidSource {
    /** Original bytes supplied at the public boundary. */
    originalText: string;
    /** Shared cleanup receipt, with offsets back to the exact input. */
    cleanup?: MermaidCleanup;
    /** Authored grammar view retained when transport decoding changes source. */
    authoredFamilyLines?: string[];
    /** Indentation-preserving grammar view for field-owned XML interpretation. */
    authoredFamilyBody?: string;
    authoredHeader?: string;
    authoredWrapperLength?: number;
    text: string;
    body: string;
    lines: string[];
    /** Line-preserving body presented to family grammars after universal
     * accessibility directives have been removed. */
    familyBody: string;
    /** Trimmed logical family grammar view. */
    familyText: string;
    /** Family grammar view with universal accessibility directives removed. */
    familyLines: string[];
    firstLine: string;
    config: MermaidRuntimeConfig;
    frontmatter: MermaidFrontmatterMap;
    /** Lossless universal wrapper before the family header, when present. */
    wrapperSource?: string;
    initDirectives: MermaidSourceInitDirective[];
    comments: MermaidSourceComment[];
    accessibility: MermaidSourceAccessibility;
}

interface ArchitectureVisualConfig {
    groupHeaderHeight: number;
    groupFontSize: number;
    groupFontWeight: number;
    groupLetterSpacing: number;
    groupFont?: string;
    groupTextTransform?: TextTransform;
    groupPaddingX: number;
    groupPaddingY: number;
    groupLabelPaddingX: number;
    groupCornerRadius: number;
    groupLineWidth: number;
    groupText?: string;
    serviceFontSize: number;
    serviceFontWeight: number;
    serviceLetterSpacing: number;
    serviceTextTransform?: TextTransform;
    servicePaddingX: number;
    servicePaddingY: number;
    serviceCornerRadius: number;
    serviceLineWidth: number;
    serviceText?: string;
    edgeFontSize: number;
    edgeFontWeight: number;
    edgeLetterSpacing: number;
    edgeTextTransform?: TextTransform;
    edgeLineWidth: number;
    edgeBendRadius: number;
    edgeStroke?: string;
    edgeText?: string;
    iconSize: number;
    serviceIconSize: number;
    junctionOuterRadius: number;
    junctionInnerRadius: number;
    groupSurface?: string;
    groupHeaderSurface?: string;
    groupBorder?: string;
    serviceSurface?: string;
    serviceBorder?: string;
}
/** Sparse public input merged over the complete request-resolved visual
 * configuration. Callers can change one metric without copying internal
 * defaults; renderers continue to consume ArchitectureVisualConfig only. */
type ArchitectureVisualOverrides = Partial<ArchitectureVisualConfig>;

interface MermaidGraph {
    direction: Direction;
    nodes: Map<string, MermaidNode>;
    edges: MermaidEdge[];
    subgraphs: MermaidSubgraph[];
    classDefs: Map<string, Record<string, string>>;
    /** Maps node/edge IDs to authored class names in assignment order, separated by spaces. */
    classAssignments: Map<string, string>;
    /** Maps node IDs to inline styles (from `style X fill:#f00,stroke:#333`) */
    nodeStyles: Map<string, Record<string, string>>;
    /** Maps edge indices (or 'default') to inline styles from `linkStyle` directives */
    linkStyles: Map<number | 'default', Record<string, string>>;
    /** Legacy linkStyle interpolation, separate from CSS and edge-ID metadata. */
    linkCurves?: Map<number | 'default', string>;
    /** State diagrams only: `note left|right of X` annotations, in source order.
     *  Placed by a post-layout pass (layout-engine placeStateNotes); flowcharts
     *  never populate this. */
    stateNotes?: StateNoteSpec[];
    /** Floating annotations remain distinct from states and attached notes;
     * their physical node participates in ordinary scoped layout. */
    floatingStateNotes?: Array<FloatingStateNote & {
        nodeId: string;
    }>;
}
/** A state-diagram note (`note left of X : text` / block form). ONE grammar
 *  models these for the render parser and the agent body alike —
 *  src/state/parse-core.ts (plan §State 1, repo #118). */
interface StateNoteSpec {
    /** Stable id (`note#<i>` in source order). */
    id: string;
    /** The state (or composite) the note is anchored to. */
    target: string;
    /** Declared side — the placement invariant is that the note box sits on
     *  this side of its target's box (upstream's own placement bug: #3782). */
    side: 'left' | 'right';
    /** Note text; block-note body lines are joined with '\n'. */
    text: string;
    textContent?: LabelContent;
}
type Direction = 'TD' | 'TB' | 'LR' | 'BT' | 'RL';
interface MermaidNode {
    id: string;
    label: string;
    labelContent?: LabelContent;
    /** Runtime pixel wrapping; the authored label and its display runs stay intact. */
    labelBlock?: PixelTextBlock;
    shape: NodeShape;
    /** Authored rectangle border sides: l, r, t, b; absent means all sides. */
    borders?: string;
    /** Authored note identity when this physical node is a floating annotation. */
    floatingNoteId?: string;
    /** Mermaid v11 `@{ shape: ... }` semantic shape, normalized to the canonical
     *  short name (e.g. 'sl-rect' for `manual-input`). Set only for
     *  metadata-declared nodes; `shape` stays the rendering geometry
     *  (src/flowchart-shapes.ts is the one mapping table). */
    semanticShape?: string;
    /** The authored v11 shape spelling (alias preserved verbatim, e.g.
     *  'manual-input') — the serializer re-emits exactly this. */
    authoredShape?: string;
    /** True when the label came from a Mermaid markdown string. */
    markdownLabel?: true;
    /** Safe local icon token from v11 node metadata. */
    icon?: string;
    /** Authored image reference. Explicitly sized inline PNGs draw offline; other URLs stay inert. */
    image?: string;
    imageWidth?: number;
    imageHeight?: number;
    imageConstraint?: 'on' | 'off';
    iconForm?: 'square' | 'circle' | 'rounded';
    /** Safe inert interaction metadata; callbacks and unsafe schemes never enter SVG. */
    href?: string;
}
type NodeShape = 'rectangle' | 'service' | 'rounded' | 'diamond' | 'stadium' | 'circle' | 'ellipse' | 'subroutine' | 'doublecircle' | 'hexagon' | 'cylinder' | 'asymmetric' | 'trapezoid' | 'trapezoid-alt' | 'lean-r' | 'lean-l' | 'state-start' | 'state-end' | 'state-fork' | 'state-join' | 'state-choice' | 'state-history' | 'state-note';
interface MermaidEdge {
    source: string;
    target: string;
    /** Authored Mermaid v11.6 edge ID (`e1@-->`): stable edge identity.
     *  Round-trips verbatim, emitted as the SVG edge's data-id, and accepted
     *  by remove_edge/set_label as a target selector. */
    id?: string;
    label?: string;
    labelContent?: LabelContent;
    style: EdgeStyle;
    /** Whether to render a marker at the start (source end) of the edge */
    hasArrowStart: boolean;
    /** Whether to render a marker at the end (target end) of the edge */
    hasArrowEnd: boolean;
    /** Marker shape at start when hasArrowStart=true. Defaults to 'arrow' if undefined. */
    startMarker?: EdgeMarker;
    /** Marker shape at end when hasArrowEnd=true. Defaults to 'arrow' if undefined. */
    endMarker?: EdgeMarker;
    /** Authored v11 edge presentation metadata. */
    curve?: string;
    animate?: boolean;
    animation?: 'fast' | 'slow';
    /** Mermaid link length (rank-distance intent): 1 = base operator, 2 = one
     *  extra shaft unit (`--->`, `-..->`, `====>`, `~~~~`), etc. Undefined ≡ 1,
     *  so base-form edges serialize byte-identically. Preserved through
     *  round-trip; layout honors this conservatively for simple primary-forward
     *  no-subgraph DAGs and leaves grouped/cyclic cases to ELK. */
    length?: number;
}
/** 'invisible' is Mermaid's `~~~` link: it participates in layout ordering
 *  but draws no stroke. */
type EdgeStyle = 'solid' | 'dotted' | 'thick' | 'invisible';
type EdgeMarker = 'arrow' | 'circle' | 'cross';
interface MermaidSubgraph {
    id: string;
    label: string;
    labelContent?: LabelContent;
    /** State diagrams only: a composite state, whose classes' classDef paint
     *  is drawn on its body, as Mermaid draws it. */
    stateComposite?: true;
    nodeIds: string[];
    children: MermaidSubgraph[];
    /** Optional direction override for this subgraph's internal layout */
    direction?: Direction;
    /** State diagrams only: this subgraph is one concurrency region of its
     *  parent composite (`--` separators, plan §State 2c). Regions draw no box
     *  of their own; the renderer draws dashed separators between siblings. */
    concurrencyRegion?: true;
    /** Where the family draws the group's title, from the group's left edge,
     *  when something comes first (an architecture group's icon). Defaults to
     *  the style's group label padding. */
    titleOffset?: number;
    /** @internal Family projection request; measured text can require more. */
    headerMinHeight?: number;
}
interface PositionedDiagram {
    width: number;
    height: number;
}
/** Explicit request-boundary data consumed by family layout/render code. */
interface ResolvedFamilyRenderContext {
    readonly renderOptions: Readonly<RenderOptions>;
    readonly styleFace?: Readonly<InternalStyleFace>;
    /** Actual frozen graphical backend, or the nominal Style backend modeled
     * by an unpainted layout projection. Graphical host policy wins. */
    readonly paintBackendId?: string;
    readonly familyConfig?: Readonly<Record<string, unknown>>;
    readonly familyAppearance?: Readonly<Record<string, unknown>>;
}
interface RenderContext<TPositioned extends PositionedDiagram = PositionedDiagram> {
    positioned: TPositioned;
    colors: DiagramColors;
    resolved: ResolvedFamilyRenderContext;
}
interface PositionedGraph extends PositionedDiagram {
    /** Deterministic evidence for the graph geometry producer. */
    layoutDecision?: GraphLayoutDecision;
    width: number;
    height: number;
    nodes: PositionedNode[];
    edges: PositionedEdge[];
    groups: PositionedGroup[];
    /** State-diagram notes with final placement (present only when the source
     *  graph carried stateNotes). Invariants enforced by construction in
     *  placeStateNotes: the box sits on the declared side of its target and
     *  overlaps no node/group box. */
    notes?: PositionedStateNote[];
    /** The diagram's frontmatter title, in its band above the graph. */
    title?: PositionedDiagramTitle;
    /** Final hard-geometry certification, after bounded layout alternatives. */
    certification?: LayoutCertificationReceipt;
    /** Instead of `certification`: report layout safety drew this graph from its
     * best drawable candidate although none certified. */
    uncertifiedLayout?: UncertifiedLayoutReceipt;
}
/** A placed state-diagram note box. */
interface PositionedStateNote {
    textBlock?: PixelTextBlock;
    id: string;
    target: string;
    side: 'left' | 'right';
    text: string;
    textContent?: LabelContent;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface PositionedNode {
    /** Family-measured image caption center relative to the body center. */
    imageCaptionOffset?: number;
    labelBlock?: PixelTextBlock;
    iconFallbackBlock?: PixelTextBlock;
    id: string;
    label: string;
    labelContent?: LabelContent;
    shape: NodeShape;
    borders?: string;
    floatingNoteId?: string;
    /** Mermaid v11 semantic shape id when the node was declared via
     *  `@{ shape: ... }` metadata — emitted as the SVG data-semantic-shape. */
    semanticShape?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Inline styles resolved from classDef + explicit `style` statements — override theme defaults */
    inlineStyle?: Record<string, string>;
    /** User-assigned Mermaid class names (from `class X myClass` / `:::myClass`). Emitted as SVG CSS classes so external stylesheets can target them. */
    classNames?: string[];
    icon?: string;
    image?: string;
    imageWidth?: number;
    imageHeight?: number;
    imageConstraint?: 'on' | 'off';
    iconForm?: 'square' | 'circle' | 'rounded';
    href?: string;
}
interface PositionedEdge {
    labelBlock?: PixelTextBlock;
    source: string;
    target: string;
    /** Authored Mermaid v11.6 edge ID (`e1@-->`) — SVG identity (data-id). */
    id?: string;
    label?: string;
    labelContent?: LabelContent;
    style: EdgeStyle;
    hasArrowStart: boolean;
    hasArrowEnd: boolean;
    /** Marker shape at start when hasArrowStart=true. Defaults to 'arrow' if undefined. */
    startMarker?: EdgeMarker;
    /** Marker shape at end when hasArrowEnd=true. Defaults to 'arrow' if undefined. */
    endMarker?: EdgeMarker;
    /** Full path including bends — array of {x, y} points */
    points: Point[];
    /** Layout-computed label center position (avoids label-label collisions) */
    labelPosition?: Point;
    /** Inline styles resolved from edge-ID classDef and `linkStyle` directives — override theme defaults */
    inlineStyle?: Record<string, string>;
    /** Authored edge-ID classes for external CSS targeting. */
    classNames?: string[];
    /** Index into MermaidGraph.edges this positioned edge was extracted from */
    edgeIndex?: number;
    /** Authored edge presentation metadata. */
    curve?: string;
    animate?: boolean;
    animation?: 'fast' | 'slow';
    /** Route contract certificate attached by the layout pipeline (docs/design/system/route-contracts.md) */
    routeCertificate?: RouteCertificate;
}
type RouteClass = 'primary-forward' | 'feedback' | 'self-loop' | 'container' | 'cross-hierarchy';
type LayoutRouteClass = RouteClass | 'family-layout';
/** The four canonical connection points of a shape (Visio connection-point /
 *  yFiles port-candidate model). For every Mermaid shape these lie at the
 *  bbox side midpoints: the diamond's vertices, the rectangle's side
 *  midpoints, and the boundary extremes of circles, stadiums, hexagons and
 *  cylinders are the same four points, because each shape is symmetric and
 *  inscribed in its bbox. */
type PortSide = 'N' | 'E' | 'S' | 'W';
/** Diamond facet-midpoints: the four points halfway along each slanted edge
 *  (NE/SE/SW/NW). They lie exactly on the diamond outline and serve as
 *  designated attachment points alongside the four cardinal vertices, but are
 *  diamond-only — shapePorts() stays four-cardinal for every shape. */
type DiamondFacet = 'NE' | 'SE' | 'SW' | 'NW';
/** A port an endpoint may sit on: a cardinal vertex/side-midpoint, or — on a
 *  diamond — a facet-midpoint. */
type AnyPort = PortSide | DiamondFacet;
type PortSemanticRole = 'flow-source' | 'flow-target' | 'feedback-source' | 'feedback-target' | 'self-loop-source' | 'self-loop-target' | 'container-source' | 'container-target' | 'cross-hierarchy-source' | 'cross-hierarchy-target';
/** Dynamic port allocation metadata: which side an endpoint semantically uses,
 *  its deterministic order among the endpoints on that side, and why it is
 *  there. This extends `sourcePort`/`targetPort` without changing their V1
 *  vocabulary: exact endpoint ports remain `AnyPort`, while the allocation
 *  records side-level slot/role intent for pre-layout and debugging. */
interface RoutePortAssignment {
    side: PortSide;
    /** 0-based deterministic order along the side (N/S: left→right; E/W: top→bottom). */
    slotIndex: number;
    /** Number of endpoints allocated to this node side. */
    slotCount: number;
    role: PortSemanticRole;
    /** Exact designated port when the final endpoint landed on one. */
    port?: AnyPort;
}
interface RouteBlocker {
    kind: 'node' | 'label' | 'channel' | 'span' | 'crossing' | 'port' | 'group-header';
    id: string;
}
type RouteInvariant = 'straight' | 'explained-detour' | 'bundle' | 'outer-feedback' | 'feedback-detour' | 'self-loop' | 'container-attach' | 'unverified-shape';
interface RouteCertificateBase {
    /** Index into MermaidGraph.edges */
    edgeIndex: number;
    routeClass: RouteClass;
    bendCount: number;
    directLaneClear?: boolean;
    directLaneBlockedBy?: RouteBlocker[];
    /** Set when the endpoint sits exactly on a port: a cardinal side-midpoint
     *  for every shape, or a diamond facet-midpoint (NE/SE/SW/NW). */
    sourcePort?: AnyPort;
    /** Set when the endpoint sits exactly on a port: a cardinal side-midpoint
     *  for every shape, or a diamond facet-midpoint (NE/SE/SW/NW). */
    targetPort?: AnyPort;
    /** Dynamic side/slot/role allocation for the source endpoint. */
    sourcePortAssignment?: RoutePortAssignment;
    /** Dynamic side/slot/role allocation for the target endpoint. */
    targetPortAssignment?: RoutePortAssignment;
    /** Self-loop routes only: the node side the loop departs from and returns
     *  to. Part of the self-loop certificate vocabulary (plan §State 6) — the
     *  arc leaves and re-enters this side at distinct boundary points. */
    loopSide?: PortSide;
}
type StraightRouteCertificate = RouteCertificateBase & {
    invariant: 'straight';
    /** True when the certifying straightener collapsed this route */
    straightened?: true;
};
type NonStraightRouteCertificate = RouteCertificateBase & {
    invariant: Exclude<RouteInvariant, 'straight'>;
    /** Non-straight certificates cannot claim a straightening happened. */
    straightened?: never;
};
type RouteCertificate = StraightRouteCertificate | NonStraightRouteCertificate;
type FamilyEdgeRouteCertificate = {
    family: 'class' | 'er';
    edgeIndex: number;
    routeClass: 'family-layout';
    invariant: 'orthogonal-box' | 'unverified-family-route';
    bendCount: number;
    orthogonal: boolean;
    sourceBoundary: boolean;
    targetBoundary: boolean;
} | {
    family: 'architecture';
    edgeIndex: number;
    routeClass: 'family-layout';
    invariant: 'side-anchored' | 'unverified-family-route';
    bendCount: number;
    orthogonal: boolean;
    sourceSide: 'L' | 'R' | 'T' | 'B';
    targetSide: 'L' | 'R' | 'T' | 'B';
    sourceBoundary: 'item' | 'group';
    targetBoundary: 'item' | 'group';
    sourceAnchored: boolean;
    targetAnchored: boolean;
    /** Authored endpoint half-plane constraints after deterministic placement. */
    placement: 'satisfied' | 'conflicted';
    sourceFacesTarget: boolean;
    targetFacesSource: boolean;
    /** Every route segment clears non-incident service, junction, and group interiors. */
    obstacleFree: boolean;
} | {
    family: 'sequence' | 'zenuml';
    edgeIndex: number;
    routeClass: 'family-layout';
    invariant: 'lifeline-message' | 'self-message' | 'unverified-family-route';
    bendCount: number;
    horizontal: boolean;
    sourceLifeline: boolean;
    targetLifeline: boolean;
    selfMessage: boolean;
};
type RegionContainmentCertificate = {
    family: 'timeline' | 'xychart' | 'pie' | 'quadrant' | 'gantt';
    elementId: string;
    routeClass: 'family-layout';
    invariant: 'timeline-interval' | 'plot-contained' | 'legend-contained' | 'section-contained' | 'unverified-family-layout';
    /** Node/mark box in layout coordinates; included so cert consumers do not have to join back to nodes. */
    bounds: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** Center point used by plot/region-mark containment certs. */
    center: {
        x: number;
        y: number;
    };
    /** Whether the cert proves the full box or the semantic mark center is contained. */
    containment: 'bounds' | 'center';
    withinBounds: boolean;
    groupId?: string;
    withinGroup?: boolean;
};
type EdgeRouteCertificate = RouteCertificate | FamilyEdgeRouteCertificate;
type FamilyRouteCertificate = FamilyEdgeRouteCertificate | RegionContainmentCertificate;
type LayoutRouteCertificate = EdgeRouteCertificate | RegionContainmentCertificate;
interface Point {
    x: number;
    y: number;
}
interface PositionedGroup {
    /** Authored direct leaf ownership, retained independently of geometry. */
    nodeIds?: string[];
    headerHeight?: number;
    /** @internal Retained family placement request; absent on ordinary graphs. */
    headerMinHeight?: number;
    labelBlock?: PixelTextBlock;
    id: string;
    label: string;
    labelContent?: LabelContent;
    x: number;
    y: number;
    width: number;
    height: number;
    children: PositionedGroup[];
    /** State diagrams only: this group is a concurrency region (drawn as dashed
     *  separators between siblings instead of its own box). */
    concurrencyRegion?: true;
    /** A State composite's classDef paint (fill, stroke, stroke-width, color),
     *  drawn on its body and outline, and color on its title. */
    inlineStyle?: Record<string, string>;
}
type TextTransform = 'uppercase' | 'lowercase' | 'capitalize';
/** A deterministic warning for accepted configuration that cannot affect output. */
interface ConfigDiagnostic {
    code: 'INEFFECTIVE_CONFIG';
    /** Fully-qualified config path, for example `state.titleTopMargin`. */
    field: string;
    message: string;
}
interface GraphLayoutHints {
    /** Ordered ELK partitions; unlisted nodes use partition zero. These are relative ranks, not pixel coordinates. */
    ranks?: Record<string, number>;
    /** Preferred consecutive model order within one container; geometry remains certified. */
    adjacent?: readonly (readonly string[])[];
    /** Authored edge IDs or from->to / from->to#k occurrence IDs to prioritize for short routes. */
    shortEdges?: readonly string[];
}
interface GraphLayoutOptions {
    backend: 'elk' | 'agentic';
    /** Native may explicitly fall back to ELK; omitted means none. */
    fallback?: 'none' | 'elk';
    /** Bounded certified alternatives; omitted preserves existing geometry. */
    quality?: 'balanced';
    /** Flowchart-only target for selecting wrapping, never output stretching. */
    viewport?: {
        width: number;
        height: number;
    };
}
interface RenderOptions {
    /** Opt-in pinned Inter ASCII advance/pair metrics; other faces/scripts use the estimator. Does not load fonts. */
    fontMetrics?: 'estimate' | 'bundled-inter';
    /** Explicit deterministic Flowchart/State placement preferences; included in render receipts. */
    layoutHints?: GraphLayoutHints;
    /** Graph geometry producer; omitted preserves the existing ELK pipeline. */
    graphLayout?: GraphLayoutOptions;
    /** Require complete native layout evidence, or report explicit limitations. */
    layoutSafety?: 'report' | 'strict';
    /** Background color → CSS variable --bg. Default: '#FFFFFF' */
    bg?: string;
    /** Foreground / primary text color → CSS variable --fg. Default: '#27272A' */
    fg?: string;
    /** Edge/connector color → CSS variable --line */
    line?: string;
    /** Arrow heads, highlights → CSS variable --accent */
    accent?: string;
    /** Secondary text, edge labels → CSS variable --muted */
    muted?: string;
    /** Node/box fill tint → CSS variable --surface */
    surface?: string;
    /** Node/group stroke color → CSS variable --border */
    border?: string;
    /** Font family for all text. Default: 'Inter' */
    font?: string;
    /**
     * How the diagram looks: a registered style name ('hand-drawn',
     * 'tufte', or any registered Palette input name like 'dracula'),
     * an inline StyleSpec, or a STACK
     * of either merged left-to-right ({ style: ['hand-drawn', 'dracula'] } is
     * hand-drawn geometry with the dracula palette). A colors-only style is a
     * palette.
     * Precedence: defaults < style stack < themeVariables < explicit color
     * options. Unknown names throw. Unset (or 'crisp') = the default renderer.
     */
    style?: StyleInput | StyleInput[];
    /** Canvas padding in px. Default: 40 */
    padding?: number;
    /** Horizontal spacing between sibling nodes. Default: 24 */
    nodeSpacing?: number;
    /** Vertical spacing between layers. Default: 40 */
    layerSpacing?: number;
    /**
     * Flowchart-only: measured-pixel auto-wrap budget for node labels (mermaid's
     * `flowchart.wrappingWidth`). Unset = no wrapping for regular labels;
     * markdown-string labels always wrap at the upstream default of 200.
     * Explicit option wins over frontmatter config. Other families ignore it.
     */
    wrappingWidth?: number;
    /** Spacing between disconnected components. Default: nodeSpacing (24) */
    componentSpacing?: number;
    /** Render with transparent background (no background style on SVG). Default: false */
    transparent?: boolean;
    /** Enable hover tooltips on chart data points (xychart, quadrant, and pie). Default: false */
    interactive?: boolean;
    /** Optional explicit drop shadows on node shapes. Default: false */
    shadow?: boolean;
    /** Family-specific class-diagram options. */
    class?: {
        /** Nest namespace compounds (default true); false lays them out compactly as siblings. */
        hierarchicalNamespaces?: boolean;
    };
    /** Opt-in graphical Kanban layout controls; source order and card membership remain unchanged. */
    kanban?: {
        /** Wrap whole columns into rows within this best-effort pixel width, retaining readable column widths. */
        maxWidth?: number;
    };
    /** Opt-in graphical fitting; selected typography and slice meaning are retained. */
    pie?: {
        /** Best-effort pixel width; explicit legend placement retains precedence. */
        maxWidth?: number;
    };
    /** Opt-in graphical fitting; authored frames and radar scale meaning are retained. */
    radar?: {
        /** Best-effort pixel width with a bounded plot/legend arrangement search. */
        maxWidth?: number;
    };
    /** Family-specific SVG renderer options for architecture-beta diagrams. */
    architecture?: {
        visual?: ArchitectureVisualOverrides;
    };
    /** Family-specific layout options for timeline diagrams. */
    timeline?: {
        /**
         * Best-effort width budget (px) for HORIZONTAL timelines: when the chart
         * would exceed it, the per-column wrap caps compress proportionally so
         * labels wrap tighter instead of the canvas growing (13 periods stop
         * rendering 2,400+px wide). No-op when the chart already fits — the
         * default layout stays byte-identical — and ignored in `timeline TD`
         * mode (vertical timelines are inherently narrow). Unbreakable tokens
         * and extra-wide section headers can still exceed the budget.
         */
        maxWidth?: number;
    };
    /** Family-specific SVG renderer options for user-journey diagrams. */
    journey?: {
        /**
         * Draw the experience-curve line connecting score markers in task order.
         * Default: `true`. Set `false` for the marker-only Mermaid-classic look.
         */
        experienceCurve?: boolean;
    };
    /** Family-specific SVG renderer options for gantt diagrams. */
    gantt?: {
        /**
         * Draw dependency connectors — deterministic elbow arrows from each
         * predecessor bar's end to its successor bar's start — for every
         * `after`/`until` reference. No new Mermaid syntax: the edges come from
         * the scheduler's dependency graph. Default: `false`.
         */
        dependencyArrows?: boolean;
        /**
         * Emphasize the critical path from the scheduler's analysis
         * (GanttScheduleAnalysis.criticalPathTaskIds): stronger stroke on
         * critical-path bars/milestones and, when `dependencyArrows` is also on,
         * on the connectors along the path. Default: `false`.
         */
        criticalPath?: boolean;
    };
    /** Optional Mermaid-style runtime config (analogous to initialize/frontmatter config). */
    mermaidConfig?: MermaidRuntimeConfig;
    /**
     * Receives warnings for explicit config that cannot affect output. Installing
     * a collector never changes SVG bytes. Without one, explicit ineffective
     * config is reported through `console.warn` rather than accepted silently.
     */
    onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void;
    /**
     * Whether to embed the Google Fonts `@import` line in the SVG `<style>` block.
     * Default: `false`; opt in only when the target permits a network font import.
     *
     * CLI / PNG paths set `false` explicitly to render offline / CSP-friendly.
     * The CSS variable `--font` is always emitted on the SVG root regardless,
     * so the family stays overridable post-render even when the @import is gone.
     */
    embedFontImport?: boolean;
    /**
     * Compact SVG output. Default `false`. When true:
     *  - Formatting newlines between structural SVG elements are collapsed.
     *  - Geometry, authored text, accessibility content, attribute boundaries,
     *    and whitespace inside `<style>` are preserved exactly.
     *  - `data-*` and `class=` attributes are preserved (agent inspection hooks).
     *
     * Useful for the PNG render path (no need for human-readable indentation)
     * and for bandwidth-sensitive consumers without changing diagram semantics.
     */
    compact?: boolean;
    /**
     * Namespace prefix for all generated SVG def ids (markers, filters) and
     * their `url(#…)` references. Omit it to leave ids unprefixed. Set a distinct
     * non-empty prefix per diagram when rendering
     * multiple diagrams onto one HTML page so their `<defs>` don't collide
     * (e.g. two `arrowhead` markers — the browser dedupes by id and the second
     * diagram's arrows break). `am batch` auto-assigns per-line prefixes.
     * Must be deterministic per call site to preserve render determinism.
     */
    idPrefix?: string;
    /**
     * Security posture for the rendered output. Default `'default'`.
     * `'strict'` (agent / untrusted-diagram mode): guarantees no external-fetch
     * references in the SVG — forces `embedFontImport` off (no Google Fonts
     * `@import`), so the SVG renders with no network calls. The `--font` CSS
     * variable still declares the family. Use `verifyNoExternalRefs(svg)` to
     * assert the guarantee. Agent/untrusted SVG callers should opt into strict
     * mode explicitly. See SECURITY.md.
     */
    security?: 'default' | 'strict';
    /**
     * Explicit "today" for the Gantt `todayMarker` (a date in the diagram's
     * `dateFormat`, or ISO `YYYY-MM-DD`). Gantt rendering never reads the wall
     * clock; without this value the today marker is simply not drawn, and
     * `todayMarker off` disables it even when a clock is supplied.
     */
    ganttToday?: string;
    /**
     * Deterministic re-roll seed for stochastic styles.
     * The same source + options + seed always produces identical bytes; it
     * re-rolls ink wobble only — layout never moves. The crisp path ignores
     * it. Default 0.
     */
    seed?: number;
}

export { type MindmapRuntimeConfig as $, type AnyPort as A, type EdgeStyle as B, type ConfigDiagnostic as C, type DiamondFacet as D, type EdgeRouteCertificate as E, type FamilyEdgeRouteCertificate as F, type GraphLayoutDecision as G, type MermaidNode as H, type MermaidRuntimeConfig as I, type AccessibilityFieldProjection as J, type C4RuntimeConfig as K, type LabelContent as L, type MermaidEdge as M, type NormalizedMermaidSource as N, DEFAULTS as O, type PortSemanticRole as P, DEFAULT_TEXT_MEASUREMENT_PROFILE as Q, type RenderOptions as R, type GitGraphRuntimeConfig as S, type TextMeasurementProfile as T, type UncertifiedLayoutReceipt as U, type GraphLayoutHints as V, type GraphLayoutOptions as W, GraphLayoutUnsupportedError as X, type JourneyRuntimeConfig as Y, type LayoutCertificationReceipt as Z, type MermaidThemeVariables as _, type ArchitectureVisualOverrides as a, type PieRuntimeConfig as a0, type PositionedGraph as a1, type ProfileTextInkMeasurement as a2, type ProfileTextMeasurementInput as a3, type QuadrantRuntimeConfig as a4, type RadarRuntimeConfig as a5, type ResolvedColors as a6, type SankeyRuntimeConfig as a7, type StateRuntimeConfig as a8, type TimelineRuntimeConfig as a9, type XyChartRuntimeConfig as aa, fromShikiTheme as ab, inlineResolvedColors as ac, resolveColors as ad, type DisplayRun as b, type FamilyRouteCertificate as c, type LayoutRouteCertificate as d, type LayoutRouteClass as e, type PortSide as f, type PreparedDisplayText as g, type RegionContainmentCertificate as h, type RouteBlocker as i, type RouteCertificate as j, type RouteClass as k, type RoutePortAssignment as l, type Direction as m, type PositionedDiagram as n, type LabelDisplay as o, type PixelTextBlock as p, type DiagramColors as q, type TextMeasurementProfileIdentity as r, type ResolvedFamilyRenderContext as s, type RenderContext as t, type MermaidGraph as u, type PositionedDiagramTitle as v, type MermaidFrontmatterMap as w, type MermaidConfigMap as x, type FloatingStateNote as y, type NodeShape as z };
