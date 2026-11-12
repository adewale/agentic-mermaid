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

/** Closed brand-neutral leaves available to applicable Scene roles. */
declare const ROLE_STYLE_PROPERTY_DESCRIPTORS: Readonly<{
    readonly fontFamily: {
        readonly kind: "font";
        readonly description: "Safe font family/stack for roles whose descriptor exposes family-specific typography.";
    };
    readonly fontSize: {
        readonly kind: "number";
        readonly minimum: 1;
        readonly maximum: 256;
        readonly expected: "between 1 and 256";
        readonly description: "Font size in SVG user units.";
    };
    readonly fontWeight: {
        readonly kind: "number";
        readonly minimum: 1;
        readonly maximum: 1000;
        readonly expected: "between 1 and 1000";
        readonly description: "CSS numeric font weight.";
    };
    readonly letterSpacing: {
        readonly kind: "number";
        readonly minimum: -2;
        readonly maximum: 4;
        readonly expected: "between -2 and 4";
        readonly description: "Letter spacing in SVG user units.";
    };
    readonly textTransform: {
        readonly kind: "enum";
        readonly values: readonly ["uppercase", "lowercase", "capitalize"];
        readonly description: "Text transformation.";
    };
    readonly textColor: {
        readonly kind: "color";
        readonly description: "Text paint.";
    };
    readonly paddingX: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 256;
        readonly expected: "between 0 and 256";
        readonly description: "Horizontal role padding.";
    };
    readonly paddingY: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 256;
        readonly expected: "between 0 and 256";
        readonly description: "Vertical role padding.";
    };
    readonly cornerRadius: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 256;
        readonly expected: "between 0 and 256";
        readonly description: "Applicable corner radius.";
    };
    readonly lineWidth: {
        readonly kind: "number";
        readonly exclusiveMinimum: 0;
        readonly maximum: 20;
        readonly expected: "greater than 0 and at most 20";
        readonly description: "Border or connector width.";
    };
    readonly bendRadius: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 256;
        readonly expected: "between 0 and 256";
        readonly description: "Applicable connector bend radius.";
    };
    readonly fillColor: {
        readonly kind: "color";
        readonly description: "Surface fill paint.";
    };
    readonly borderColor: {
        readonly kind: "color";
        readonly description: "Border paint.";
    };
    readonly strokeColor: {
        readonly kind: "color";
        readonly description: "Connector stroke paint.";
    };
    readonly headerFillColor: {
        readonly kind: "color";
        readonly description: "Group header surface paint.";
    };
    readonly cue: {
        readonly kind: "enum";
        readonly values: readonly ["none", "outline", "double-line", "pattern"];
        readonly description: "Non-color semantic cue on roles whose family renderer exposes a cue projection.";
    };
}>;
type RolePropertyValue<D> = D extends {
    readonly kind: 'number';
} ? number : D extends {
    readonly kind: 'font' | 'color';
} ? string : D extends {
    readonly kind: 'enum';
    readonly values: readonly (infer V)[];
} ? V : never;
type RoleStyleSpec = {
    -readonly [K in keyof typeof ROLE_STYLE_PROPERTY_DESCRIPTORS]?: RolePropertyValue<(typeof ROLE_STYLE_PROPERTY_DESCRIPTORS)[K]>;
};
/**
 * The single exact-role styling authority. Runtime role descriptors, public
 * TypeScript, JSON Schema, binding admission, docs, and the executable census
 * all project from this record.
 */
declare const EXACT_ROLE_STYLE_CONTRACT: Readonly<{
    readonly node: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "paddingX", "paddingY", "cornerRadius", "lineWidth", "fillColor", "borderColor"];
    }>;
    readonly edge: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "lineWidth", "bendRadius", "strokeColor"];
    }>;
    readonly group: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "paddingX", "paddingY", "cornerRadius", "lineWidth", "fillColor", "borderColor", "fontFamily", "headerFillColor"];
    }>;
    readonly 'group-header': Readonly<{
        properties: readonly ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "fillColor", "borderColor", "strokeColor", "lineWidth", "cue"];
        bindingFamilies: readonly ["journey"];
    }>;
    readonly label: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor"];
    }>;
    readonly actor: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "paddingX", "paddingY", "cornerRadius", "lineWidth", "fillColor", "borderColor"];
        bindingFamilies: readonly ["sequence"];
    }>;
    readonly relationship: Readonly<{
        properties: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "lineWidth", "bendRadius", "strokeColor"];
        bindingFamilies: readonly ["er"];
    }>;
    readonly 'pie-slice': Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth", "cue"];
        bindingFamilies: readonly ["pie", "radar"];
    }>;
    readonly legend: Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth", "textColor"];
        bindingFamilies: readonly ["radar"];
    }>;
    readonly bar: Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth"];
        bindingFamilies: readonly ["xychart", "sankey", "treemap"];
    }>;
    readonly series: Readonly<{
        properties: readonly ["borderColor", "strokeColor", "lineWidth"];
        bindingFamilies: readonly ["xychart"];
    }>;
    readonly point: Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth"];
        bindingFamilies: readonly ["radar", "xychart"];
    }>;
    readonly task: Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth", "cue"];
        bindingFamilies: readonly ["gantt"];
    }>;
    readonly milestone: Readonly<{
        properties: readonly ["fillColor", "borderColor", "strokeColor", "lineWidth", "cue"];
        bindingFamilies: readonly ["gantt"];
    }>;
}>;
type ExactStyleSceneRole = keyof typeof EXACT_ROLE_STYLE_CONTRACT;
type BindableSceneRole = {
    [Role in ExactStyleSceneRole]: (typeof EXACT_ROLE_STYLE_CONTRACT)[Role] extends {
        readonly bindingFamilies: readonly [string, ...string[]];
    } ? Role : never;
}[ExactStyleSceneRole];
type RoleStyleFor<Role extends BuiltinSceneRole> = Role extends ExactStyleSceneRole ? Pick<RoleStyleSpec, (typeof EXACT_ROLE_STYLE_CONTRACT)[Role]['properties'][number]> : never;
type RoleStyles = {
    [Role in ExactStyleSceneRole]?: Readonly<RoleStyleFor<Role>>;
};

type BrandConstraintAction = 'warn' | 'error';
type BrandConstraintFieldDescriptor = {
    readonly kind: 'role';
    readonly required?: true;
} | {
    readonly kind: 'number';
    readonly minimum: number;
    readonly maximum: number;
    readonly required?: true;
};
/**
 * Single payload-shape authority for every public Brand constraint. Public
 * TypeScript, runtime admission, JSON Schema, diagnostics, and evaluator
 * exhaustiveness project from this record.
 */
declare const BRAND_CONSTRAINT_DESCRIPTORS: Readonly<{
    readonly contrast: Readonly<{
        properties: Readonly<{
            role: Readonly<{
                readonly kind: "role";
            }>;
            minimum: Readonly<{
                readonly kind: "number";
                readonly minimum: 1;
                readonly maximum: 21;
            }>;
        }>;
        recovery: "Choose an authored text/surface pair that meets the requested ratio, or remove the rule; the renderer will not repaint it.";
    }>;
    readonly 'accent-area': Readonly<{
        properties: Readonly<{
            maxFraction: Readonly<{
                readonly kind: "number";
                readonly minimum: 0;
                readonly maximum: 1;
                readonly required: true;
            }>;
        }>;
        recovery: "Reduce authored accent-filled area or raise the declared maximum; the renderer will not rewrite fills.";
    }>;
    readonly 'mono-role': Readonly<{
        properties: Readonly<{
            role: Readonly<{
                readonly kind: "role";
                readonly required: true;
            }>;
        }>;
        recovery: "Use measurable monochrome paint for the named role or remove the rule; the renderer will not rewrite paint.";
    }>;
}>;
type BrandConstraintKind = keyof typeof BRAND_CONSTRAINT_DESCRIPTORS;
type FieldValue<Descriptor extends BrandConstraintFieldDescriptor> = Descriptor['kind'] extends 'role' ? BuiltinSceneRole : number;
type PropertiesOf<Kind extends BrandConstraintKind> = (typeof BRAND_CONSTRAINT_DESCRIPTORS)[Kind]['properties'];
type RequiredPropertyNames<Kind extends BrandConstraintKind> = {
    [Field in keyof PropertiesOf<Kind>]: PropertiesOf<Kind>[Field] extends {
        readonly required: true;
    } ? Field : never;
}[keyof PropertiesOf<Kind>];
type OptionalPropertyNames<Kind extends BrandConstraintKind> = Exclude<keyof PropertiesOf<Kind>, RequiredPropertyNames<Kind>>;
type ConstraintPayload<Kind extends BrandConstraintKind> = {
    readonly [Field in RequiredPropertyNames<Kind>]: PropertiesOf<Kind>[Field] extends BrandConstraintFieldDescriptor ? FieldValue<PropertiesOf<Kind>[Field]> : never;
} & {
    readonly [Field in OptionalPropertyNames<Kind>]?: PropertiesOf<Kind>[Field] extends BrandConstraintFieldDescriptor ? FieldValue<PropertiesOf<Kind>[Field]> : never;
};
type BrandConstraint = {
    [Kind in BrandConstraintKind]: Readonly<{
        kind: Kind;
        action: BrandConstraintAction;
    } & ConstraintPayload<Kind>>;
}[BrandConstraintKind];

/**
 * One authority for the public palette vocabulary. The runtime validator,
 * TypeScript type, JSON Schema, and generated field reference all project
 * from this record.
 */
declare const STYLE_COLOR_TOKEN_DESCRIPTORS: {
    readonly bg: {
        readonly description: "Diagram page background.";
    };
    readonly fg: {
        readonly description: "Primary text and foreground paint.";
    };
    readonly line: {
        readonly description: "Connector and secondary line paint.";
    };
    readonly accent: {
        readonly description: "Accent paint for emphasis and data series.";
    };
    readonly muted: {
        readonly description: "Muted text and secondary data paint.";
    };
    readonly surface: {
        readonly description: "Node and group surface fill.";
    };
    readonly border: {
        readonly description: "Node and group border paint.";
    };
};
type StyleColors = {
    -readonly [Key in keyof typeof STYLE_COLOR_TOKEN_DESCRIPTORS]?: string;
};
declare const SEMANTIC_BINDING_CHANNELS: readonly ["category"];
type SemanticBindingChannel = typeof SEMANTIC_BINDING_CHANNELS[number];
interface SemanticBinding {
    readonly channel: SemanticBindingChannel;
    readonly value: string;
    readonly slot: string;
    readonly role?: BindableSceneRole;
}
type SemanticSlots = Readonly<Record<string, Readonly<RoleStyleSpec>>>;
/**
 * One authority for every public StyleSpec field and constraint. Keep
 * renderer-private face defaults out of this manifest: they are not part of
 * the external style contract.
 */
declare const STYLE_SPEC_FIELD_DESCRIPTORS: {
    readonly formatVersion: {
        readonly kind: "const";
        readonly value: 1;
        readonly group: "metadata";
        readonly description: "Persisted wire-format version. Optional on input and normalized to 1 on output.";
    };
    readonly $schema: {
        readonly kind: "string";
        readonly group: "metadata";
        readonly description: "Optional JSON Schema pointer for file-backed styles; ignored while rendering.";
    };
    readonly name: {
        readonly kind: "string";
        readonly group: "metadata";
        readonly description: "Canonical look:name or palette:name identity; required only when registering a style.";
    };
    readonly blurb: {
        readonly kind: "string";
        readonly group: "metadata";
        readonly description: "Short human-readable description used by discovery surfaces.";
    };
    readonly colors: {
        readonly kind: "colors";
        readonly group: "palette";
        readonly description: "Partial palette of safe, non-fetching CSS color tokens.";
    };
    readonly font: {
        readonly kind: "string";
        readonly runtimeValidator: "safeCssFontFamily";
        readonly group: "typography";
        readonly description: "Safe, non-fetching CSS font family or stack; the rendering environment supplies the font face.";
    };
    readonly roles: {
        readonly kind: "roles";
        readonly group: "roles";
        readonly description: "Partial semantic SceneRole defaults. Family-authored styling remains authoritative.";
    };
    readonly semanticSlots: {
        readonly kind: "semanticSlots";
        readonly group: "policy";
        readonly description: "Named brand-neutral role-style slots selected by semantic bindings.";
    };
    readonly bindings: {
        readonly kind: "bindings";
        readonly group: "policy";
        readonly description: "Ordered equality bindings from authored/domain meaning to semantic slots.";
    };
    readonly constraints: {
        readonly kind: "constraints";
        readonly group: "policy";
        readonly description: "Closed inspect-only brand constraints with warn or error actions.";
    };
    readonly stroke: {
        readonly kind: "enum";
        readonly values: readonly ["crisp", "jittered", "freehand"];
        readonly group: "stroke";
        readonly description: "Stroke treatment; crisp is the default renderer.";
    };
    readonly roughness: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 10;
        readonly expected: "between 0 and 10";
        readonly group: "stroke";
        readonly description: "Rough.js stroke irregularity.";
    };
    readonly bowing: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 10;
        readonly expected: "between 0 and 10";
        readonly group: "stroke";
        readonly description: "Rough.js line bowing.";
    };
    readonly passes: {
        readonly kind: "integer";
        readonly minimum: 1;
        readonly maximum: 8;
        readonly expected: "an integer from 1 through 8";
        readonly group: "stroke";
        readonly description: "Number of sketch strokes; 1 is single-pass and 2 is the usual double stroke.";
    };
    readonly strokeWidth: {
        readonly kind: "number";
        readonly exclusiveMinimum: 0;
        readonly maximum: 20;
        readonly expected: "greater than 0 and at most 20";
        readonly group: "stroke";
        readonly description: "Base stroke width in SVG user units.";
    };
    readonly fill: {
        readonly kind: "enum";
        readonly values: readonly ["none", "hachure", "solid", "wash"];
        readonly group: "fill";
        readonly description: "Fill policy for rough/hybrid rendering; none and solid require a final stack that activates one of those backends.";
    };
    readonly hachureAngle: {
        readonly kind: "number";
        readonly minimum: -360;
        readonly maximum: 360;
        readonly expected: "between -360 and 360";
        readonly group: "fill";
        readonly description: "Hachure line angle in degrees; requires fill hachure in the final stack.";
    };
    readonly hachureGap: {
        readonly kind: "number";
        readonly exclusiveMinimum: 0;
        readonly maximum: 100;
        readonly expected: "greater than 0 and at most 100";
        readonly group: "fill";
        readonly description: "Gap between hachure lines; requires fill hachure in the final stack.";
    };
    readonly fillWeight: {
        readonly kind: "number";
        readonly exclusiveMinimum: 0;
        readonly maximum: 20;
        readonly expected: "greater than 0 and at most 20";
        readonly group: "fill";
        readonly description: "Hachure line weight; requires fill hachure in the final stack.";
    };
    readonly washOpacity: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 1;
        readonly expected: "between 0 and 1";
        readonly group: "fill";
        readonly description: "Watercolor glaze opacity; requires fill wash in the final stack.";
    };
    readonly washEdge: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 1;
        readonly expected: "between 0 and 1";
        readonly group: "fill";
        readonly description: "Watercolor edge-darkening opacity; requires fill wash in the final stack.";
    };
    readonly backdrop: {
        readonly kind: "enum";
        readonly values: readonly ["plain", "paper-ruled", "grid"];
        readonly group: "page";
        readonly description: "Flat page furniture drawn behind the diagram.";
    };
    readonly intent: {
        readonly kind: "enum";
        readonly values: readonly ["premium", "draft", "lofi"];
        readonly group: "advisory";
        readonly description: "Advisory intent metadata for pickers and quality tooling.";
    };
    readonly mono: {
        readonly kind: "boolean";
        readonly group: "advisory";
        readonly description: "Advisory monochrome contract: express tone through shading and weight.";
    };
};
type DescriptorValue<Descriptor> = Descriptor extends {
    readonly kind: 'const';
    readonly value: infer Value;
} ? Value : Descriptor extends {
    readonly kind: 'string';
} ? string : Descriptor extends {
    readonly kind: 'boolean';
} ? boolean : Descriptor extends {
    readonly kind: 'number' | 'integer';
} ? number : Descriptor extends {
    readonly kind: 'enum';
    readonly values: readonly (infer Value)[];
} ? Value : Descriptor extends {
    readonly kind: 'colors';
} ? StyleColors : Descriptor extends {
    readonly kind: 'roles';
} ? RoleStyles : Descriptor extends {
    readonly kind: 'semanticSlots';
} ? SemanticSlots : Descriptor extends {
    readonly kind: 'bindings';
} ? readonly SemanticBinding[] : Descriptor extends {
    readonly kind: 'constraints';
} ? readonly BrandConstraint[] : never;
/** A partial, composable public description of how diagrams look. */
type StyleSpec = {
    -readonly [Key in keyof typeof STYLE_SPEC_FIELD_DESCRIPTORS]?: DescriptorValue<(typeof STYLE_SPEC_FIELD_DESCRIPTORS)[Key]>;
};

/** What RenderOptions.style accepts: a registered name, an inline spec, or a
 *  stack of either (merged left → right). */
type StyleInput = string | StyleSpec;

/**
 * Stable role vocabulary shared by every Scene backend.  Built-in roles keep
 * their existing rendering policy, while extensions must use a namespace
 * (`vendor:role`) so they cannot accidentally acquire new core semantics.
 */

type CoreSceneRole = 'node' | 'edge' | 'edge-label' | 'group' | 'group-header' | 'label' | 'title' | 'defs' | 'prelude' | 'chrome';
type BuiltinSceneRole = CoreSceneRole | 'actor' | 'lifeline' | 'activation' | 'message' | 'block' | 'note' | 'class-box' | 'member' | 'entity' | 'attribute' | 'relationship' | 'cardinality' | 'pie-slice' | 'legend' | 'bar' | 'series' | 'point' | 'axis' | 'grid' | 'plate' | 'section' | 'task' | 'milestone' | 'marker-line' | 'rail' | 'period' | 'event' | 'score' | 'actor-pill' | 'service' | 'junction' | 'icon';

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

type MermaidConfigScalar = string | number | boolean | null;
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | MermaidConfigMap;
interface MermaidConfigMap {
    [key: string]: MermaidConfigValue | undefined;
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
interface RenderArtifactDiagnostic {
    readonly code: string;
    readonly message?: string;
    readonly reference?: string;
    readonly feature?: string;
}

interface RenderedSvg {
    readonly svg: string;
    readonly receipt: RenderRequestReceipt;
}

declare class BrowserFamilyDetectionError extends Error {
    readonly code = "UNSUPPORTED_FAMILY";
    constructor(firstLine: string);
}
/** Render SVG while downloading only the selected diagram family on demand.
 * The classic synchronous `agentic-mermaid/browser` entry remains available
 * for script-tag consumers that prefer one all-in-one file. */
declare function renderMermaidSVGAsync(source: string, options?: RenderOptions): Promise<string>;
/** Receipt-bearing lazy rendering retains the complete canonical contract. */
declare function renderMermaidSVGWithReceiptAsync(source: string, options?: RenderOptions): Promise<RenderedSvg>;

export { BrowserFamilyDetectionError, type RenderOptions, renderMermaidSVGAsync, renderMermaidSVGWithReceiptAsync };
