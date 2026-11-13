// One declarative option contract for validators, metadata and render admission.
// Importing it does not register graphical backends or load their Scene writers.
import type { RenderOptions } from './types.ts'
import type { ArchitectureVisualConfig } from './architecture/config.ts'
import type { FamilyDescriptor } from './agent/families.ts'
import type { DiagramKind, FamilyId } from './agent/types.ts'
import { validateJsonSchema, type SchemaProblem, type JsonSchema } from './shared/schema-validation.ts'
import { resolveStyleStack } from './scene/style-registry.ts'
import { STYLE_OPTION_SCHEMA, renderOptionSchemaRoot, styleSchemaDefinitions } from './render-style-option-schema.ts'
import { cssColorSpellings, isRecognizableCssColor, safeCssColor, safeCssPaint } from './shared/css-color.ts'
import { safeCssFontFamily } from './shared/css-font.ts'
import { limitJsonConfigDiagnostics, validateJsonConfigAdmission } from './shared/json-config-admission.ts'
import { deepFreeze, isPlainRecord } from './shared/plain-data.ts'

export const NON_SERIALIZABLE_RENDER_OPTION_FIELDS = ['onConfigDiagnostic'] as const satisfies readonly (keyof RenderOptions)[]
type NonSerializableRenderOptionField = typeof NON_SERIALIZABLE_RENDER_OPTION_FIELDS[number]
type SerializableRenderOptionField = Exclude<keyof RenderOptions, NonSerializableRenderOptionField>

export type TerminalFieldApplicability = 'consumed' | 'projected' | 'not-applicable'
export type JsonSchemaNode = Readonly<Record<string, unknown>>

export interface SharedRenderOptionFieldDescriptor {
  readonly typeScript: string
  readonly description: string
  /** Markdown-ready effective default used by the generated API reference. */
  readonly defaultLabel: string
  /** Human-readable fallback when a value fails at the field boundary. */
  readonly validationExpectation: string
  /** Exact schema fragment consumed by both runtime validation and JSON Schema projection. */
  readonly schema: JsonSchemaNode
  /** Canonical terminal projection decision; adapters must not infer this independently. */
  readonly terminal: TerminalFieldApplicability
  readonly terminalNote?: string
  /** Built-in families whose implementations consume this field. External
   * descriptors declare adoption through `applicableRenderOptions`. */
  readonly applicableBuiltinFamilies?: readonly DiagramKind[]
}

const stringSchema = (description: string, defaultValue?: string): JsonSchemaNode => ({
  type: 'string', description, ...(defaultValue === undefined ? {} : { default: defaultValue }),
})
const numberSchema = (
  description: string,
  defaultValue?: number,
  bounds: Readonly<{ minimum?: number; exclusiveMinimum?: number; maximum?: number }> = {},
): JsonSchemaNode => ({
  type: 'number', description, ...(defaultValue === undefined ? {} : { default: defaultValue }), ...bounds,
})
const nonNegativeNumberSchema = (description: string, defaultValue?: number): JsonSchemaNode =>
  numberSchema(description, defaultValue, { minimum: 0 })
const positiveNumberSchema = (description: string, defaultValue?: number): JsonSchemaNode =>
  numberSchema(description, defaultValue, { exclusiveMinimum: 0 })
const fontWeightSchema = (description: string): JsonSchemaNode =>
  numberSchema(description, undefined, { minimum: 1, maximum: 1_000 })
const booleanSchema = (description: string, defaultValue?: boolean): JsonSchemaNode => ({
  type: 'boolean', description, ...(defaultValue === undefined ? {} : { default: defaultValue }),
})
const paintSchema = (description: string, defaultValue?: string): JsonSchemaNode => ({
  ...stringSchema(description, defaultValue), 'x-agentic-mermaid-runtime-validator': 'safeCssPaint',
})
const fontFamilySchema = (description: string, defaultValue?: string): JsonSchemaNode => ({
  ...stringSchema(description, defaultValue), 'x-agentic-mermaid-runtime-validator': 'safeCssFontFamily',
})
const closedObjectSchema = (
  properties: Readonly<Record<string, JsonSchemaNode>>,
  description: string,
  required: readonly string[] = [],
): JsonSchemaNode => ({
  type: 'object',
  description,
  additionalProperties: false,
  properties,
  ...(required.length === 0 ? {} : { required }),
})

const TEXT_TRANSFORM_SCHEMA = {
  type: 'string', enum: ['uppercase', 'lowercase', 'capitalize'],
} as const satisfies JsonSchemaNode

const ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES = {
  groupHeaderHeight: positiveNumberSchema('Requested minimum Architecture group-header height; expands to fit measured title text.'),
  groupFontSize: positiveNumberSchema('Architecture group-label font size.'),
  groupFontWeight: fontWeightSchema('Architecture group-label font weight.'),
  groupLetterSpacing: numberSchema('Architecture group-label letter spacing.'),
  groupFont: fontFamilySchema('Architecture group-label font family.'),
  groupTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture group-label text transform.' },
  groupPaddingX: nonNegativeNumberSchema('Horizontal padding inside architecture groups.'),
  groupPaddingY: nonNegativeNumberSchema('Vertical padding inside architecture groups.'),
  groupLabelPaddingX: nonNegativeNumberSchema('Horizontal padding around architecture group labels.'),
  groupCornerRadius: nonNegativeNumberSchema('Architecture group corner radius.'),
  groupLineWidth: nonNegativeNumberSchema('Architecture group border width.'),
  groupText: paintSchema('Architecture group-label color.'),
  serviceFontSize: positiveNumberSchema('Architecture service-label font size.'),
  serviceFontWeight: fontWeightSchema('Architecture service-label font weight.'),
  serviceLetterSpacing: numberSchema('Architecture service-label letter spacing.'),
  serviceTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture service-label text transform.' },
  servicePaddingX: nonNegativeNumberSchema('Horizontal padding inside architecture services.'),
  servicePaddingY: nonNegativeNumberSchema('Vertical padding inside architecture services.'),
  serviceCornerRadius: nonNegativeNumberSchema('Architecture service corner radius.'),
  serviceLineWidth: nonNegativeNumberSchema('Architecture service border width.'),
  serviceText: paintSchema('Architecture service-label color.'),
  edgeFontSize: positiveNumberSchema('Architecture connector-label font size.'),
  edgeFontWeight: fontWeightSchema('Architecture connector-label font weight.'),
  edgeLetterSpacing: numberSchema('Architecture connector-label letter spacing.'),
  edgeTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture connector-label text transform.' },
  edgeLineWidth: nonNegativeNumberSchema('Architecture connector width.'),
  edgeBendRadius: nonNegativeNumberSchema('Architecture connector bend radius.'),
  edgeStroke: paintSchema('Architecture connector color.'),
  edgeText: paintSchema('Architecture connector-label color.'),
  iconSize: positiveNumberSchema('Architecture group icon size.'),
  serviceIconSize: positiveNumberSchema('Architecture service icon size.'),
  junctionOuterRadius: positiveNumberSchema('Architecture junction outer radius.'),
  junctionInnerRadius: nonNegativeNumberSchema('Architecture junction inner radius.'),
  groupSurface: paintSchema('Architecture group surface color.'),
  groupHeaderSurface: paintSchema('Architecture group-header surface color.'),
  groupBorder: paintSchema('Architecture group border color.'),
  serviceSurface: paintSchema('Architecture service surface color.'),
  serviceBorder: paintSchema('Architecture service border color.'),
} as const satisfies Readonly<Record<keyof ArchitectureVisualConfig, JsonSchemaNode>>

const ARCHITECTURE_VISUAL_SCHEMA = {
  ...closedObjectSchema(
    ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES,
    'Sparse architecture visual overrides merged over resolved defaults.',
  ),
  'x-agentic-mermaid-runtime-validator': 'architectureVisual',
} as const satisfies JsonSchemaNode

export const JSON_VALUE_SCHEMA = {
  anyOf: [
    { type: 'null' },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
    { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
  ],
  description: 'A finite, acyclic JSON value without prototype keys.',
  'x-agentic-mermaid-validation-expectation': 'a finite, acyclic JSON value without prototype keys',
} as const satisfies JsonSchemaNode

const GRAPH_LAYOUT_OPTION_FAMILIES = [
  'flowchart', 'state', 'class', 'er', 'architecture', 'c4',
] as const satisfies readonly DiagramKind[]

const SHADOW_OPTION_FAMILIES = [
  'flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey', 'sankey', 'c4', 'zenuml', 'swimlane', 'agentflow',
] as const satisfies readonly DiagramKind[]

/**
 * The single checked manifest for fields shared by first-party adapters.
 * Output adapters may add their own fields (PNG scale/fontDirs, terminal
 * width/encoding), but must not re-declare or hand-forward this set.
 */
const GRAPH_LAYOUT_QUALITY_FIELDS = { quality: { type: 'string', enum: ['balanced'] }, viewport: closedObjectSchema({ width: positiveNumberSchema('Target viewport width.'), height: positiveNumberSchema('Target viewport height.') }, 'Flowchart target viewport.', ['width', 'height']) } as const

export const SHARED_RENDER_OPTION_FIELD_DESCRIPTORS = deepFreeze({
  fontMetrics: { typeScript: "'estimate' | 'bundled-inter'", description: 'Optional pinned Inter ASCII advances and pair corrections. Does not load fonts; unsupported runs retain estimates.', defaultLabel: '`estimate`', validationExpectation: 'be estimate or bundled-inter', schema: { type: 'string', enum: ['estimate', 'bundled-inter'] }, terminal: 'not-applicable', terminalNote: 'terminal cells do not use font advances' },
  layoutHints: { typeScript: '{ ranks?: Record<string, number>; adjacent?: string[][]; shortEdges?: string[] }', description: 'Relative ranks, sibling adjacency and short-edge preferences.', defaultLabel: 'unset', validationExpectation: 'contain integer ranks, node groups and edge IDs', schema: { type: 'object', additionalProperties: false, properties: { ranks: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 10000 } }, adjacent: { type: 'array', items: { type: 'array', minItems: 2, items: { type: 'string' } } }, shortEdges: { type: 'array', items: { type: 'string' } } } }, terminal: 'not-applicable', terminalNote: 'not used by terminals', applicableBuiltinFamilies: ['flowchart', 'state', 'usecase', 'swimlane', 'agentflow'] },
  graphLayout: { typeScript: "{ backend: 'elk' | 'agentic'; fallback?: 'none' | 'elk'; quality?: 'balanced'; viewport?: { width: number; height: number } }", description: 'Graph geometry producer with explicit ELK fallback.', defaultLabel: '`elk`, no fallback', validationExpectation: 'be a graph layout selection object', schema: { anyOf: [closedObjectSchema({ ...GRAPH_LAYOUT_QUALITY_FIELDS, backend: { type: 'string', const: 'elk' }, fallback: { type: 'string', enum: ['none'] } }, 'ELK graph layout.', ['backend']), closedObjectSchema({ ...GRAPH_LAYOUT_QUALITY_FIELDS, backend: { type: 'string', const: 'agentic' }, fallback: { type: 'string', enum: ['none', 'elk'] } }, 'Owned graph layout with optional ELK fallback.', ['backend'])] }, terminal: 'projected', terminalNote: 'selects pixel placement and optional graphical companion evidence, not terminal-cell placement', applicableBuiltinFamilies: ['flowchart', 'state', 'architecture', 'class', 'er', 'requirement'] },
  layoutSafety: { typeScript: "'report' | 'strict'", description: 'Report bounded layout evidence, still drawing a layout that fails certification only on drawable checks (verify then fails), or require a passed final certificate. Strict mode rejects missing, unverified or failed evidence.', defaultLabel: '`report`', validationExpectation: 'be report or strict', schema: { type: 'string', enum: ['report', 'strict'], default: 'report', description: 'Require a passed final native layout certificate.' }, terminal: 'consumed' },
  bg: { typeScript: 'string', description: 'Background color or CSS variable.', defaultLabel: '`#FFFFFF`', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Background color or CSS variable.', '#FFFFFF'), terminal: 'consumed' },
  fg: { typeScript: 'string', description: 'Primary foreground and text color.', defaultLabel: '`#27272A`', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Primary foreground and text color.', '#27272A'), terminal: 'consumed' },
  line: { typeScript: 'string', description: 'Connector and secondary-line color.', defaultLabel: 'derived', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Connector and secondary-line color.'), terminal: 'consumed' },
  accent: { typeScript: 'string', description: 'Arrowhead, highlight, and data accent color.', defaultLabel: 'derived', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Arrowhead, highlight, and data accent color.'), terminal: 'consumed' },
  muted: { typeScript: 'string', description: 'Secondary text and label color.', defaultLabel: 'derived', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Secondary text and label color.'), terminal: 'projected', terminalNote: 'terminal themes have no dedicated muted-text role' },
  surface: { typeScript: 'string', description: 'Node and group surface color.', defaultLabel: 'derived', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Node and group surface color.'), terminal: 'projected', terminalNote: 'terminal cells do not paint graphical surfaces' },
  border: { typeScript: 'string', description: 'Node and group border color.', defaultLabel: 'derived', validationExpectation: 'be a safe non-fetching CSS paint', schema: paintSchema('Node and group border color.'), terminal: 'consumed' },
  font: { typeScript: 'string', description: 'CSS font family or stack.', defaultLabel: '`Inter`', validationExpectation: 'be a safe non-fetching CSS font family or stack', schema: fontFamilySchema('CSS font family or stack.', 'Inter'), terminal: 'projected', terminalNote: 'the host terminal owns the font face' },
  style: { typeScript: 'StyleInput | StyleInput[]', description: 'Registered Style/Palette name, inline StyleSpec, or left-to-right stack.', defaultLabel: '`crisp`', validationExpectation: 'be a registered Style name or StyleSpec, or an array of them', schema: STYLE_OPTION_SCHEMA, terminal: 'consumed' },
  padding: { typeScript: 'number', description: 'Canvas padding in SVG user units.', defaultLabel: '`40`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Canvas padding in SVG user units.', 40), terminal: 'not-applicable', terminalNote: 'terminal output uses paddingX, paddingY, and boxBorderPadding', applicableBuiltinFamilies: ['flowchart', 'state', 'architecture', 'c4', 'requirement', 'block', 'packet', 'kanban', 'eventmodeling', 'usecase', 'wardley', 'cynefin', 'swimlane', 'agentflow'] },
  nodeSpacing: { typeScript: 'number', description: 'Horizontal spacing between sibling nodes.', defaultLabel: '`24`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Horizontal spacing between sibling nodes.', 24), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract', applicableBuiltinFamilies: [...GRAPH_LAYOUT_OPTION_FAMILIES, 'eventmodeling', 'swimlane'] },
  layerSpacing: { typeScript: 'number', description: 'Vertical spacing between graph layers.', defaultLabel: '`40`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Vertical spacing between graph layers.', 40), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract', applicableBuiltinFamilies: [...GRAPH_LAYOUT_OPTION_FAMILIES, 'requirement', 'usecase', 'agentflow'] },
  wrappingWidth: { typeScript: 'number', description: 'Flowchart measured-label wrapping budget in pixels.', defaultLabel: 'unset', validationExpectation: 'be a positive finite number', schema: positiveNumberSchema('Flowchart measured-label wrapping budget in pixels.'), terminal: 'not-applicable', terminalNote: 'terminal output uses maxWidth or targetWidth', applicableBuiltinFamilies: ['flowchart'] },
  componentSpacing: { typeScript: 'number', description: 'Spacing between disconnected graph components for compatible extension families; no built-in family currently consumes it.', defaultLabel: 'extension-defined', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Spacing between disconnected graph components for compatible extension families; no built-in family currently consumes it.'), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract', applicableBuiltinFamilies: [] },
  transparent: { typeScript: 'boolean', description: 'Omit the painted SVG canvas background.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Omit the painted SVG canvas background.', false), terminal: 'projected', terminalNote: 'terminal output has no painted canvas background' },
  interactive: { typeScript: 'boolean', description: 'Enable hover tooltips for supported chart data points.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Enable hover tooltips for supported chart data points.', false), terminal: 'projected', terminalNote: 'terminal output is a static semantic projection', applicableBuiltinFamilies: ['xychart', 'pie', 'quadrant'] },
  shadow: { typeScript: 'boolean', description: 'Paint explicit drop shadows on node shapes.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Paint explicit drop shadows on node shapes.', false), terminal: 'projected', terminalNote: 'elevation projects to borders and labels', applicableBuiltinFamilies: SHADOW_OPTION_FAMILIES },
  class: { typeScript: '{ hierarchicalNamespaces?: boolean }', description: 'Class-diagram rendering controls.', defaultLabel: '`hierarchicalNamespaces: true`', validationExpectation: 'be a class options object', schema: closedObjectSchema({ hierarchicalNamespaces: booleanSchema('Nest namespace compounds.', true) }, 'Class-diagram rendering controls.'), terminal: 'not-applicable', terminalNote: 'this option configures graphical class layout', applicableBuiltinFamilies: ['class'] },
  kanban: { typeScript: '{ maxWidth?: number }', description: 'Opt-in Kanban column wrapping with readable column widths.', defaultLabel: '`maxWidth`: unset', validationExpectation: 'be a kanban options object', schema: closedObjectSchema({ maxWidth: positiveNumberSchema('Best-effort width budget for wrapping whole Kanban columns into rows.') }, 'Kanban layout controls.'), terminal: 'not-applicable', terminalNote: 'terminal layout uses its own targetWidth', applicableBuiltinFamilies: ['kanban'] },
  pie: { typeScript: '{ maxWidth?: number }', description: 'Opt-in Pie title and legend fitting without shrinking typography.', defaultLabel: '`maxWidth`: unset', validationExpectation: 'be a pie options object', schema: closedObjectSchema({ maxWidth: positiveNumberSchema('Best-effort graphical width budget; authored legend placement retains precedence.') }, 'Pie layout controls.'), terminal: 'not-applicable', terminalNote: 'terminal layout uses its own targetWidth', applicableBuiltinFamilies: ['pie'] },
  radar: { typeScript: '{ maxWidth?: number }', description: 'Opt-in Radar plot and legend fitting without shrinking typography.', defaultLabel: '`maxWidth`: unset', validationExpectation: 'be a radar options object', schema: closedObjectSchema({ maxWidth: positiveNumberSchema('Best-effort graphical width budget; authored frames retain precedence.') }, 'Radar layout controls.'), terminal: 'not-applicable', terminalNote: 'terminal layout uses its own targetWidth', applicableBuiltinFamilies: ['radar'] },
  architecture: { typeScript: '{ visual?: ArchitectureVisualOverrides }', description: 'Sparse architecture renderer visual metric and paint overrides.', defaultLabel: 'built-in metrics', validationExpectation: 'be an architecture options object', schema: closedObjectSchema({ visual: ARCHITECTURE_VISUAL_SCHEMA }, 'Architecture renderer visual metric and paint overrides.'), terminal: 'not-applicable', terminalNote: 'this option configures graphical architecture rendering', applicableBuiltinFamilies: ['architecture'] },
  timeline: { typeScript: '{ maxWidth?: number }', description: 'Timeline layout controls.', defaultLabel: '`maxWidth`: unset', validationExpectation: 'be a timeline options object', schema: closedObjectSchema({ maxWidth: positiveNumberSchema('Best-effort width budget for horizontal timelines.') }, 'Timeline layout controls.'), terminal: 'not-applicable', terminalNote: 'terminal output uses maxWidth or targetWidth', applicableBuiltinFamilies: ['timeline'] },
  journey: { typeScript: '{ experienceCurve?: boolean }', description: 'User-journey graphical controls.', defaultLabel: '`experienceCurve: true`', validationExpectation: 'be a journey options object', schema: closedObjectSchema({ experienceCurve: booleanSchema('Connect journey score markers with an experience curve.', true) }, 'User-journey graphical controls.'), terminal: 'not-applicable', terminalNote: 'experience curves are graphical-only', applicableBuiltinFamilies: ['journey'] },
  gantt: { typeScript: '{ dependencyArrows?: boolean; criticalPath?: boolean }', description: 'Gantt dependency and critical-path overlays.', defaultLabel: 'both `false`', validationExpectation: 'be a Gantt options object', schema: closedObjectSchema({ dependencyArrows: booleanSchema('Draw scheduled dependency connectors.', false), criticalPath: booleanSchema('Emphasize critical-path tasks and connectors.', false) }, 'Gantt dependency and critical-path overlays.'), terminal: 'not-applicable', terminalNote: 'graphical Gantt connector emphasis is not represented in cells', applicableBuiltinFamilies: ['gantt'] },
  mermaidConfig: { typeScript: 'MermaidRuntimeConfig', description: 'Mermaid-style recursive runtime configuration.', defaultLabel: 'source config', validationExpectation: 'be a plain JSON object', schema: { type: 'object', description: 'Mermaid-style recursive runtime configuration.', additionalProperties: { $ref: '#/$defs/jsonValue' } }, terminal: 'consumed' },
  embedFontImport: { typeScript: 'boolean', description: 'Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization.', false), terminal: 'not-applicable', terminalNote: 'terminal output embeds no web-font import' },
  compact: { typeScript: 'boolean', description: 'Compact SVG serialization while preserving agent hooks.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Compact SVG serialization while preserving agent hooks.', false), terminal: 'not-applicable', terminalNote: 'compact controls SVG serialization' },
  idPrefix: { typeScript: 'string', description: 'Non-empty namespace for generated SVG definition IDs and local references.', defaultLabel: 'unset', validationExpectation: 'be non-empty and contain only ASCII letters, digits, underscore, hyphen, dot, and colon', schema: { ...stringSchema('Non-empty namespace for generated SVG definition IDs and local references.'), pattern: '^[A-Za-z0-9_.:-]+$' }, terminal: 'not-applicable', terminalNote: 'terminal output has no SVG definition ids' },
  security: { typeScript: "'default' | 'strict'", description: 'Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.', defaultLabel: '`default`', validationExpectation: 'be default or strict', schema: { type: 'string', enum: ['default', 'strict'], description: 'Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.', default: 'default' }, terminal: 'not-applicable', terminalNote: 'terminal text has its own control-character and HTML-color safety projection' },
  ganttToday: { typeScript: 'string', description: 'Explicit deterministic date for the Gantt today marker.', defaultLabel: 'unset', validationExpectation: 'be a string', schema: stringSchema('Explicit deterministic date for the Gantt today marker.'), terminal: 'consumed', applicableBuiltinFamilies: ['gantt'] },
  seed: { typeScript: 'number', description: 'Deterministic re-roll seed for stochastic Styles.', defaultLabel: '`0`', validationExpectation: 'be a finite number', schema: numberSchema('Deterministic re-roll seed for stochastic Styles.', 0), terminal: 'not-applicable', terminalNote: 'terminal glyph geometry is deterministic and has no stochastic ink' },
} as const satisfies Readonly<Record<SerializableRenderOptionField, SharedRenderOptionFieldDescriptor>>)

export type SharedRenderOptionField = keyof typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS

export const SHARED_RENDER_OPTION_FIELDS: readonly SharedRenderOptionField[] = Object.freeze(
  Object.keys(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS) as SharedRenderOptionField[],
)

/** Shared fields whose effect depends on the selected family implementation. */
export type FamilyScopedRenderOptionField = {
  [Field in SharedRenderOptionField]:
    (typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS)[Field] extends {
      readonly applicableBuiltinFamilies: readonly DiagramKind[]
    }
      ? Field
      : never
}[SharedRenderOptionField]

/** Canonical family-scoped field manifest. Built-in and extension
 * applicability decisions must project from this exact list. */
export const FAMILY_SCOPED_RENDER_OPTION_FIELDS: readonly FamilyScopedRenderOptionField[] = Object.freeze(
  SHARED_RENDER_OPTION_FIELDS.filter((field): field is FamilyScopedRenderOptionField =>
    'applicableBuiltinFamilies' in SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]),
)

/** Validate the declarative extension adoption list after the family registry
 * has snapshotted it, but before any executable conformance callback runs. */
export function assertFamilyScopedRenderOptionDeclaration(
  family: Pick<FamilyDescriptor, 'id' | 'applicableRenderOptions'>,
): void {
  const declared = family.applicableRenderOptions
  if (declared === undefined) return
  if (!Array.isArray(declared)) {
    throw new TypeError(`Family "${family.id}" applicableRenderOptions must be an array`)
  }
  const seen = new Set<string>()
  for (const field of declared as readonly unknown[]) {
    if (typeof field !== 'string'
      || !FAMILY_SCOPED_RENDER_OPTION_FIELDS.includes(field as FamilyScopedRenderOptionField)) {
      throw new Error(
        `Family "${family.id}" applicableRenderOptions contains unknown family-scoped field "${String(field)}"`,
      )
    }
    if (seen.has(field)) {
      throw new Error(`Family "${family.id}" applicableRenderOptions repeats "${field}"`)
    }
    seen.add(field)
  }
}

/** Effective family-scoped applicability used by runtime diagnostics and
 * capability reporting. Built-ins derive from the field manifest; extensions
 * opt in explicitly and otherwise consume none of these fields. */
export function applicableFamilyScopedRenderOptions(
  family: Pick<FamilyDescriptor, 'id' | 'applicableRenderOptions'>,
): readonly FamilyScopedRenderOptionField[] {
  if (family.id.startsWith('family:')) {
    return Object.freeze([...(family.applicableRenderOptions ?? [])])
  }
  const builtInFamily = family.id as DiagramKind
  return Object.freeze(FAMILY_SCOPED_RENDER_OPTION_FIELDS.filter(field => {
    const applicable: readonly DiagramKind[] =
      SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field].applicableBuiltinFamilies
    return applicable.includes(builtInFamily)
  }))
}

type AllRenderFieldsAccountedFor = Exclude<keyof RenderOptions, SharedRenderOptionField | typeof NON_SERIALIZABLE_RENDER_OPTION_FIELDS[number]> extends never
  ? true
  : never

/** Compile-time tripwire: adding a RenderOptions field requires a manifest decision. */
export const ALL_RENDER_FIELDS_ACCOUNTED_FOR: AllRenderFieldsAccountedFor = true

/** TypeScript-shaped projection consumed by the Code Mode SDK declaration. */
export function sharedRenderOptionsTypeScriptDeclaration(): string {
  const fields = SHARED_RENDER_OPTION_FIELDS.map(field =>
    `  ${field}?: ${SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field].typeScript}`)
  return `interface SharedRenderOptions {\n${fields.join('\n')}\n}`
}

function schemaTypeScript(schema: JsonSchemaNode): string {
  if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  return 'unknown'
}

/** Code Mode declaration projected from the nested sparse-override authority. */
export function architectureVisualOverridesTypeScriptDeclaration(): string {
  const fields = Object.entries(ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES).map(([field, schema]) =>
    `  ${field}?: ${schemaTypeScript(schema)}`)
  return `interface ArchitectureVisualOverrides {\n${fields.join('\n')}\n}`
}

function cloneSchema(schema: JsonSchemaNode): Record<string, unknown> {
  const cloneValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cloneValue)
    if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]))
    return value
  }
  return cloneValue(schema) as Record<string, unknown>
}

function optionPath(path: readonly (string | number)[]): string {
  let result = String(path[0] ?? '')
  for (const part of path.slice(1)) result += typeof part === 'number' ? `[${part}]` : `.${part}`
  return `render option "${result}"`
}

export function renderOptionsAdmissionMessages(value: unknown): string[] {
  return limitJsonConfigDiagnostics(validateJsonConfigAdmission(value).map(problem =>
    problem.path.length > 0
      ? `${optionPath(problem.path)} ${problem.message}`
      : `render options ${problem.message}`), 'render options')
}

/** Domain rules shared by render fields and tool-schema projections. */
export function renderSchemaProblems(value: unknown, schema: JsonSchema, path: readonly (string | number)[]): SchemaProblem[] {
  const runtimeValidator = schema['x-agentic-mermaid-runtime-validator']
  if (runtimeValidator === 'safeCssColor' && safeCssColor(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS color', generic: false }]
  }
  if (runtimeValidator === 'safeCssPaint' && safeCssPaint(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS paint', generic: false }]
  }
  if ((runtimeValidator === 'safeCssColor' || runtimeValidator === 'safeCssPaint') && !isRecognizableCssColor(value as string)) {
    return [{ path, message: `must be a CSS color, not ${JSON.stringify(value)} (use ${cssColorSpellings(runtimeValidator === 'safeCssPaint')})`, generic: false }]
  }
  if (runtimeValidator === 'safeCssFontFamily' && safeCssFontFamily(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS font family or stack', generic: false }]
  }
  if (runtimeValidator === 'styleInput') {
    try {
      resolveStyleStack(value as RenderOptions['style'])
    } catch (error) {
      return [{ path, message: `is invalid: ${error instanceof Error ? error.message : String(error)}`, generic: false }]
    }
  }
  if (runtimeValidator === 'architectureVisual' && isPlainRecord(value)) {
    const outer = value.junctionOuterRadius
    const inner = value.junctionInnerRadius
    // A sparse input can be checked here only when both sides are explicit.
    // resolveArchitectureVisualConfig repeats the invariant after merging the
    // actual request-derived defaults.
    if (typeof outer === 'number' && typeof inner === 'number' && inner > outer) {
      return [{
        path: [...path, 'junctionInnerRadius'],
        message: 'must not exceed junctionOuterRadius',
        generic: false,
      }]
    }
  }
  return []
}

let validationRootSchema: JsonSchemaNode | undefined

/** Option names callers guess for settings that live elsewhere. */
const MISPLACED_RENDER_OPTION_HINTS: Readonly<Record<string, string>> = Object.freeze({
  theme: 'set a Mermaid theme with mermaidConfig.theme, or a registered Style or Palette with style',
  themeVariables: 'set Mermaid theme variables with mermaidConfig.themeVariables',
})

/** Where an unknown render option's setting lives, when it is a known guess. */
export function misplacedRenderOptionHint(field: string): string | undefined {
  return Object.hasOwn(MISPLACED_RENDER_OPTION_HINTS, field) ? MISPLACED_RENDER_OPTION_HINTS[field] : undefined
}

/** Validate the shared advanced JSON object used by CLI/MCP/editor adapters. */
export function validateSerializableRenderOptions(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['render options must be a plain JSON object']
  const admissionProblems = renderOptionsAdmissionMessages(value)
  if (admissionProblems.length > 0) return admissionProblems
  const problems: string[] = []
  // Selected field fragments already own their exact schemas. Their only
  // enclosing references are the recursive JSON value definition; retaining
  // another full public schema duplicates every field and expanded StyleSpec.
  const rootSchema = validationRootSchema ??= deepFreeze({ $defs: { jsonValue: cloneSchema(JSON_VALUE_SCHEMA) } })
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!Object.hasOwn(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS, field)) {
      const hint = misplacedRenderOptionHint(field)
      problems.push(`unknown render option "${field}"${hint ? `; ${hint}` : ''}`)
      continue
    }
    if (fieldValue === null) {
      problems.push(`render option "${field}" must be omitted instead of null`)
      continue
    }
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field as SharedRenderOptionField]
    const schemaProblems = validateJsonSchema(fieldValue, descriptor.schema, renderOptionSchemaRoot(field, rootSchema), [field], { diagnostics: 'field', validateRuntime: renderSchemaProblems })
    if (schemaProblems.length > 0 && schemaProblems.every(problem => problem.generic && problem.path.length === 1)) {
      problems.push(`render option "${field}" must ${descriptor.validationExpectation}`)
    } else {
      problems.push(...schemaProblems.map(problem => `${optionPath(problem.path)} ${problem.message}`))
    }
  }
  return limitJsonConfigDiagnostics(problems, 'render options')
}

/** JSON Schema projection generated from the same field manifest. */
export function sharedRenderOptionsJsonSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const field of SHARED_RENDER_OPTION_FIELDS) {
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
    const terminalNote = 'terminalNote' in descriptor ? descriptor.terminalNote : undefined
    const applicableBuiltinFamilies = 'applicableBuiltinFamilies' in descriptor
      ? descriptor.applicableBuiltinFamilies
      : undefined
    properties[field] = {
      ...cloneSchema(descriptor.schema),
      'x-agentic-mermaid-terminal': descriptor.terminal,
      ...(terminalNote === undefined ? {} : { 'x-agentic-mermaid-terminal-note': terminalNote }),
      ...(applicableBuiltinFamilies === undefined
        ? {}
        : { 'x-agentic-mermaid-applicable-builtin-families': [...applicableBuiltinFamilies] }),
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agentic-mermaid.dev/schemas/render-options.schema.json',
    type: 'object',
    additionalProperties: false,
    properties,
    $defs: renderOptionsSchemaDefinitions(),
  }
}

/** The local definitions `sharedRenderOptionsJsonSchema()` references by
 * `#/$defs/<name>`. A schema that embeds the render options object without
 * its root (an MCP tool's `options` argument) places these at its own root. */
export function renderOptionsSchemaDefinitions(): Record<string, unknown> {
  return {
    jsonValue: cloneSchema(JSON_VALUE_SCHEMA),
    ...Object.fromEntries(Object.entries(styleSchemaDefinitions()).map(([name, definition]) => [name, cloneSchema(definition)])),
  }
}

/** Public StyleInput projection reused by advanced and convenience adapters.
 * Self-contained: it carries the StyleSpec definitions its references name. */
export function styleInputJsonSchema(description?: string): Record<string, unknown> {
  return {
    ...cloneSchema(STYLE_OPTION_SCHEMA),
    ...(description === undefined ? {} : { description }),
    $defs: Object.fromEntries(Object.entries(styleSchemaDefinitions()).map(([name, definition]) => [name, cloneSchema(definition)])),
  }
}
