/**
 * Identity metadata shared by the kind-specific extension registries.
 *
 * This module deliberately does not provide a global extension registry:
 * families, styles, backends, resources, and roles retain their own typed
 * registries and share only naming, provenance, version, and collision rules.
 */
interface ExtensionCompatibility {
    readonly [contract: string]: string | undefined;
    /** Compatible Agentic Mermaid core contract/range. */
    readonly core?: string;
    /** Compatible Scene contract/range, when the extension consumes Scene. */
    readonly scene?: string;
}
interface ExtensionProvenance {
    /** Stable owner/package identifier, not a display label. */
    readonly owner: string;
    /** Where the registration came from (for example `built-in` or `host`). */
    readonly source: string;
    /** Optional source URL, package reference, or build receipt. */
    readonly reference?: string;
}
interface ExtensionIdentity<Kind extends string = string> {
    /** Collision-safe `${kind}:${local-name}` identifier. */
    readonly id: `${Kind}:${string}`;
    readonly kind: Kind;
    readonly version: string;
    readonly compatibility: ExtensionCompatibility;
    readonly provenance: ExtensionProvenance;
}
/** Host contract versions understood by this runtime. Requirements for other
 * namespaced contracts are retained but deliberately deferred to their owner. */
declare const KNOWN_EXTENSION_CONTRACT_VERSIONS: Readonly<{
    readonly core: "0.5.7";
    readonly scene: "2.0.0";
}>;
interface ExtensionCompatibilityResolution {
    readonly contract: string;
    readonly range: string;
    readonly status: 'compatible' | 'incompatible' | 'deferred' | 'invalid';
    readonly version?: string;
    readonly diagnostic?: string;
}
interface ExtensionCompatibilityDecision {
    readonly accepted: boolean;
    readonly resolutions: readonly ExtensionCompatibilityResolution[];
}
/**
 * Evaluate every identity kind through one compatibility policy. Known core
 * and Scene ranges are enforced now; valid unknown namespaced requirements
 * remain visible and deferred for forward-compatible hosts.
 */
declare function evaluateExtensionCompatibility(identity: Pick<ExtensionIdentity, 'id' | 'compatibility'>): ExtensionCompatibilityDecision;
interface ExtensionRegistration<Value, Kind extends string = string> {
    readonly identity: ExtensionIdentity<Kind>;
    readonly value: Value;
}
declare function canonicalExtensionId<Kind extends string>(kind: Kind, localId: string): `${Kind}:${string}`;
declare function parseExtensionId(id: string): {
    kind: string;
    localId: string;
} | undefined;
declare function createExtensionIdentity<Kind extends string>(input: {
    id: string;
    kind: Kind;
    version: string;
    compatibility?: ExtensionCompatibility;
    provenance: ExtensionProvenance;
}): ExtensionIdentity<Kind>;
declare class ExtensionCollisionError extends Error {
    readonly incoming: ExtensionIdentity;
    readonly existing: ExtensionIdentity;
    readonly code = "EXTENSION_ID_COLLISION";
    constructor(incoming: ExtensionIdentity, existing: ExtensionIdentity);
}
/** Register into one existing kind-specific registry without implicit replace. */
declare function registerExtension<Value, Kind extends string>(registry: Map<string, ExtensionRegistration<Value, Kind>>, registration: ExtensionRegistration<Value, Kind>): void;

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
declare const EXACT_STYLE_SCENE_ROLES: readonly ("node" | "edge" | "group" | "group-header" | "label" | "actor" | "relationship" | "pie-slice" | "legend" | "bar" | "series" | "point" | "task" | "milestone")[];
declare const BINDABLE_SCENE_ROLES: readonly BindableSceneRole[];
/** Closed union of leaves that at least one executable category-binding role
 * can consume. Role-free bindings must intersect this set after stack merge. */
declare const BINDABLE_ROLE_STYLE_PROPERTIES: readonly ("fontFamily" | "fontSize" | "fontWeight" | "letterSpacing" | "textTransform" | "textColor" | "paddingX" | "paddingY" | "cornerRadius" | "lineWidth" | "bendRadius" | "fillColor" | "borderColor" | "strokeColor" | "cue")[];
type RoleStyleFor<Role extends BuiltinSceneRole> = Role extends ExactStyleSceneRole ? Pick<RoleStyleSpec, (typeof EXACT_ROLE_STYLE_CONTRACT)[Role]['properties'][number]> : never;
type RoleStyles = {
    [Role in ExactStyleSceneRole]?: Readonly<RoleStyleFor<Role>>;
};

type BrandConstraintAction = 'warn' | 'error';
type BrandConstraintWarningCode = 'BRAND_CONSTRAINT_WARNING' | 'BRAND_CONSTRAINT_ERROR';
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
declare const BRAND_CONSTRAINT_KINDS: readonly ("contrast" | "accent-area" | "mono-role")[];
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
declare const BRAND_CONSTRAINT_WARNING_POLICY: Readonly<{
    warn: Readonly<{
        code: "BRAND_CONSTRAINT_WARNING";
        severity: "warning";
        tier: "lint";
    }>;
    error: Readonly<{
        code: "BRAND_CONSTRAINT_ERROR";
        severity: "error";
        tier: "lint";
    }>;
}>;

/**
 * The persisted StyleSpec wire format. Inputs may omit the version; registry
 * and stack resolution normalize it to this value before returning a spec.
 */
declare const STYLE_SPEC_FORMAT_VERSION: 1;
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
/**
 * Validate untrusted JSON-like input against the canonical field manifest.
 * Style data is declarative by construction: it cannot carry markup or URLs,
 * and colors must pass the shared non-fetching CSS-color policy.
 */
declare function validateStyleSpec(value: unknown): string[];
type JsonSchema = Readonly<Record<string, unknown>>;
/** JSON Schema projected from the same descriptors used at runtime. */
declare function styleSpecJsonSchema(): JsonSchema;

/** Private renderer defaults for built-in looks. This is intentionally not
 *  part of the public StyleSpec schema, registerStyle boundary, or docs. */
interface InternalStyleFace {
    /** Complete admitted public role/policy view retained for family lowering. */
    roles?: Readonly<RoleStyles>;
    semanticSlots?: SemanticSlots;
    bindings?: readonly SemanticBinding[];
    constraints?: readonly BrandConstraint[];
    text?: InternalTextFace;
    node?: InternalNodeFace;
    edge?: InternalEdgeFace;
    group?: InternalGroupFace;
}
/** Runtime census authority: the private face is only a compiled projection of
 * these admitted public role records and cannot own an extra expressive leaf. */
declare const INTERNAL_STYLE_FACE_PROJECTION: Readonly<{
    text: Readonly<{
        sourceRole: "label";
        fields: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor"];
    }>;
    node: Readonly<{
        sourceRole: "node";
        fields: readonly ("fontSize" | "fontWeight" | "letterSpacing" | "textTransform" | "textColor" | "paddingX" | "paddingY" | "cornerRadius" | "lineWidth" | "fillColor" | "borderColor")[];
    }>;
    edge: Readonly<{
        sourceRole: "edge";
        fields: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "lineWidth", "bendRadius", "strokeColor"];
    }>;
    group: Readonly<{
        sourceRole: "group";
        fields: readonly ["fontSize", "fontWeight", "letterSpacing", "textTransform", "textColor", "paddingX", "paddingY", "cornerRadius", "lineWidth", "fillColor", "borderColor", "fontFamily", "headerFillColor"];
    }>;
}>;
type InternalTextFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.text.fields)[number]>;
type InternalNodeFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.node.fields)[number]>;
type InternalEdgeFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.edge.fields)[number]>;
type InternalGroupFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.group.fields)[number]>;
/** What RenderOptions.style accepts: a registered name, an inline spec, or a
 *  stack of either (merged left → right). */
type StyleInput = string | StyleSpec;
type StyleRegistryKind = 'look' | 'palette';
interface StyleRegistrationOptions {
    readonly version?: string;
    readonly compatibility?: ExtensionCompatibility;
    readonly provenance?: ExtensionProvenance;
}
interface StyleDescriptor {
    readonly identity: ExtensionIdentity<StyleRegistryKind>;
    readonly spec: StyleSpec;
    /** Stable preferred input. */
    readonly inputName: string;
    /** Stable label shared by CLI, editor, website, MCP, and generated docs. */
    readonly displayLabel: string;
    readonly kind: StyleRegistryKind;
    readonly isDefault: boolean;
}
interface StyleReferenceResolution {
    readonly canonicalId: string;
    readonly spec: StyleSpec;
}
/**
 * Register a reusable declarative style. New registrations use an explicit
 * `look:` or `palette:` identity. Third-party registrations cannot create
 * unqualified inputs or compatibility aliases.
 */
declare function registerStyle(spec: StyleSpec, options?: StyleRegistrationOptions): () => boolean;
declare function resolveStyleReference(name: string): StyleReferenceResolution | undefined;
declare function getStyle(name: string): StyleSpec | undefined;
declare function knownStyles(): string[];
declare function knownStyleDescriptors(): readonly StyleDescriptor[];
/** Which backend a style needs, derived from what it asks for — authors
 *  describe the look, the engine picks the machinery. */
declare function inferBackend(spec: StyleSpec): 'default' | 'rough' | 'hybrid';
declare function resolveStyleStack(input: StyleInput | StyleInput[] | undefined): StyleSpec | undefined;

/**
 * Stable role vocabulary shared by every Scene backend.  Built-in roles keep
 * their existing rendering policy, while extensions must use a namespace
 * (`vendor:role`) so they cannot accidentally acquire new core semantics.
 */

type CoreSceneRole = 'node' | 'edge' | 'edge-label' | 'group' | 'group-header' | 'label' | 'title' | 'defs' | 'prelude' | 'chrome';
type BuiltinSceneRole = CoreSceneRole | 'actor' | 'lifeline' | 'activation' | 'message' | 'block' | 'note' | 'class-box' | 'member' | 'entity' | 'attribute' | 'relationship' | 'cardinality' | 'pie-slice' | 'legend' | 'bar' | 'series' | 'point' | 'axis' | 'grid' | 'plate' | 'section' | 'task' | 'milestone' | 'marker-line' | 'rail' | 'period' | 'event' | 'score' | 'actor-pill' | 'service' | 'junction' | 'icon';
type NamespacedSceneRole = `${string}:${string}`;
type SceneRole = BuiltinSceneRole | NamespacedSceneRole;
type SceneMarkKind = 'image' | 'shape' | 'connector' | 'text' | 'group' | 'document';
type SceneSketchPolicy = 'shape' | 'connector' | 'none';
type SceneRoleStyleFallback = 'node' | 'edge' | 'group' | 'label';
interface SceneRoleTraits {
    /** Scene mark kinds on which the role is meaningful. */
    applicableKinds: readonly SceneMarkKind[];
    /** Public brand archetype inherited by this semantic role. */
    styleFallback: SceneRoleStyleFallback;
    /** Whether an exact role record has an implemented family projection. */
    styleConsumption: 'exact' | 'fallback-only';
    /** Additional role-specific leaves with an implemented family projection. */
    styleExtras: readonly (keyof RoleStyleSpec)[];
    /** Optional exact applicable set when the fallback archetype is broader. */
    styleProperties?: readonly (keyof RoleStyleSpec)[];
    /** Built-in families that resolve semantic bindings for this exact role. */
    styleBindingFamilies: readonly string[];
    /** Whether structured SVG receives the stable data-id/data-role contract. */
    domIdentity: boolean;
    /** Whether endpoint-bearing marks receive relation accessibility semantics. */
    relation: boolean;
    /** Styled-backend realization policy. */
    sketch: SceneSketchPolicy;
    /** Whether text receives the cartographic readability halo. */
    textHalo: boolean;
}
/** Exact built-in policy. Backends consume this table; exact style properties
 * and binding-family admission are projected from EXACT_ROLE_STYLE_CONTRACT. */
declare const BUILTIN_SCENE_ROLE_TRAITS: Readonly<Record<BuiltinSceneRole, SceneRoleTraits>>;
interface ResolvedSceneRoleTraits {
    traits: SceneRoleTraits;
    source: 'builtin' | 'namespaced-safe';
}
type RoleStyleProperty = keyof RoleStyleSpec;
interface SceneRoleStyleDescriptor {
    readonly fallbackRole: SceneRoleStyleFallback;
    readonly applicableProperties: readonly RoleStyleProperty[];
}
interface SceneRoleDescriptor {
    readonly identity: ExtensionIdentity<'role'>;
    readonly role: BuiltinSceneRole;
    readonly traits: SceneRoleTraits;
    readonly style: SceneRoleStyleDescriptor;
}
/** Canonical discovery/identity/style projection derived from the trait authority. */
declare const SCENE_ROLE_DESCRIPTORS: readonly SceneRoleDescriptor[];
/**
 * Resolve extension behavior deterministically. Namespaced roles always get
 * the inert identity-only policy. Their local names never inherit current or
 * future core semantics implicitly; a versioned trait-registration contract
 * can be added later if a concrete extension needs one.
 */
declare function resolveSceneRoleTraits(role: SceneRole): ResolvedSceneRoleTraits;
declare function sceneRoleTraits(role: SceneRole): SceneRoleTraits;

export { type ExtensionCompatibilityResolution as $, type StyleRegistrationOptions as A, BINDABLE_ROLE_STYLE_PROPERTIES as B, type StyleSpec as C, createExtensionIdentity as D, EXACT_ROLE_STYLE_CONTRACT as E, getStyle as F, inferBackend as G, knownStyleDescriptors as H, knownStyles as I, registerStyle as J, resolveSceneRoleTraits as K, resolveStyleReference as L, resolveStyleStack as M, sceneRoleTraits as N, styleSpecJsonSchema as O, validateStyleSpec as P, type InternalStyleFace as Q, ROLE_STYLE_PROPERTY_DESCRIPTORS as R, type StyleInput as S, BRAND_CONSTRAINT_WARNING_POLICY as T, type BrandConstraintWarningCode as U, type ExtensionCompatibility as V, type ExtensionProvenance as W, type BuiltinSceneRole as X, type CoreSceneRole as Y, ExtensionCollisionError as Z, type ExtensionCompatibilityDecision as _, BINDABLE_SCENE_ROLES as a, type ExtensionRegistration as a0, KNOWN_EXTENSION_CONTRACT_VERSIONS as a1, type NamespacedSceneRole as a2, type ResolvedSceneRoleTraits as a3, type SceneMarkKind as a4, type SceneRoleDescriptor as a5, type SceneRoleTraits as a6, type SceneSketchPolicy as a7, type StyleRegistryKind as a8, canonicalExtensionId as a9, evaluateExtensionCompatibility as aa, parseExtensionId as ab, registerExtension as ac, BRAND_CONSTRAINT_DESCRIPTORS as b, BRAND_CONSTRAINT_KINDS as c, BUILTIN_SCENE_ROLE_TRAITS as d, type BindableSceneRole as e, type BrandConstraint as f, type BrandConstraintAction as g, type BrandConstraintKind as h, EXACT_STYLE_SCENE_ROLES as i, type ExactStyleSceneRole as j, type ExtensionIdentity as k, type RoleStyleFor as l, type RoleStyleSpec as m, type RoleStyles as n, SCENE_ROLE_DESCRIPTORS as o, SEMANTIC_BINDING_CHANNELS as p, STYLE_COLOR_TOKEN_DESCRIPTORS as q, STYLE_SPEC_FIELD_DESCRIPTORS as r, STYLE_SPEC_FORMAT_VERSION as s, type SceneRole as t, type SemanticBinding as u, type SemanticBindingChannel as v, type SemanticSlots as w, type StyleColors as x, type StyleDescriptor as y, type StyleReferenceResolution as z };
