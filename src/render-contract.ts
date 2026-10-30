// ============================================================================
// Canonical render-request waist.
//
// Public adapters may have output-specific controls, but every renderer first
// enters through this module. Source/config/style/color/font/security are
// normalized exactly once and the immutable result is what layout, Scene
// lowering, graphical backends, rasterization, and terminal projection share.
// ============================================================================

import { validateJsonSchema, type SchemaProblem, type JsonSchema } from './shared/schema-validation.ts'
import type { ConfigDiagnostic, RenderOptions, ResolvedFamilyRenderContext } from './types.ts'
import type { ArchitectureVisualConfig } from './architecture/config.ts'
import type { DiagramColors } from './theme.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import { normalizeMermaidRenderSource } from './mermaid-source.ts'
import { observeCache } from './performance-observations.ts'
import { CHANNEL_THEME_KEYS, readThemeValue, resolveDiagramColors } from './color-resolver.ts'
import { checkArchitectureRenderOptionColors, checkFamilyConfigColors, checkThemeVariableColors } from './theme-color-admission.ts'
import {
  inferBackend,
  isStyledSpec,
  resolveStyleReference,
  resolveStyleStack,
  resolveStyleStackWithFace,
  type InternalStyleFace,
  type StyleSpec,
} from './scene/style-registry.ts'
import { styleSpecJsonSchema } from './scene/style-spec.ts'
import { cssColorSpellings, isRecognizableCssColor, safeCssColor, safeCssPaint } from './shared/css-color.ts'
import { safeCssFontFamily } from './shared/css-font.ts'
import {
  assertJsonConfigAdmission,
  isForbiddenJsonConfigKey,
  JSON_CONFIG_ADMISSION_LIMITS,
  limitJsonConfigDiagnostics,
  validateJsonConfigAdmission,
} from './shared/json-config-admission.ts'
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
import type { BackendDescriptor, HostBackendPolicy } from './scene/backend.ts'
import {
  ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES,
  type EssentialScenePrimitiveCapability,
} from './scene/capabilities.ts'
import { RENDER_OUTPUTS, type RenderOutput } from './render-outputs.ts'
import { explicitFamilyConfigDiagnostics } from './shared/family-config-diagnostics.ts'
import { deepFreeze, isPlainRecord } from './shared/plain-data.ts'
import { graphLayoutDecisionsOf, type GraphLayoutDecision } from './layout/backend.ts'
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

export const NON_SERIALIZABLE_RENDER_OPTION_FIELDS = ['onConfigDiagnostic'] as const satisfies readonly (keyof RenderOptions)[]
type NonSerializableRenderOptionField = typeof NON_SERIALIZABLE_RENDER_OPTION_FIELDS[number]
type SerializableRenderOptionField = Exclude<keyof RenderOptions, NonSerializableRenderOptionField>

export type TerminalFieldApplicability = 'consumed' | 'projected' | 'not-applicable'
type JsonSchemaNode = Readonly<Record<string, unknown>>

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

const STYLE_SPEC_SCHEMA = (() => {
  const styleSchema = styleSpecJsonSchema() as Record<string, unknown>
  const definitions = styleSchema.$defs as Record<string, Record<string, unknown>> | undefined
  const expandLocalReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expandLocalReferences)
    if (value === null || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    const reference = record.$ref
    if (typeof reference === 'string' && reference.startsWith('#/$defs/')) {
      const definition = definitions?.[reference.slice('#/$defs/'.length)]
      if (!definition) throw new Error(`StyleSpec schema has unresolved local reference ${reference}`)
      return expandLocalReferences(definition)
    }
    return Object.fromEntries(Object.entries(record)
      .filter(([key]) => key !== '$defs')
      .map(([key, child]) => [key, expandLocalReferences(child)]))
  }
  const { $schema: _dialect, $id: _id, title: _title, ...fragment } = styleSchema
  return expandLocalReferences(fragment) as Record<string, unknown>
})()

const STYLE_INPUT_SCHEMA = {
  anyOf: [
    { type: 'string', description: 'Registered Style or Palette name.' },
    STYLE_SPEC_SCHEMA,
  ],
  'x-agentic-mermaid-validation-expectation': 'a registered Style name or StyleSpec',
} as const satisfies JsonSchemaNode

const STYLE_OPTION_SCHEMA = {
  anyOf: [
    STYLE_INPUT_SCHEMA,
    { type: 'array', items: STYLE_INPUT_SCHEMA, description: 'Style stack merged from left to right.' },
  ],
  description: 'A registered name, inline StyleSpec, or left-to-right stack of either.',
  'x-agentic-mermaid-runtime-validator': 'styleInput',
} as const satisfies JsonSchemaNode

const JSON_VALUE_SCHEMA = {
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
  'flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey',
  'xychart', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph', 'sankey',
] as const satisfies readonly DiagramKind[]

/**
 * The single checked manifest for fields shared by first-party adapters.
 * Output adapters may add their own fields (PNG scale/fontDirs, terminal
 * width/encoding), but must not re-declare or hand-forward this set.
 */
export const SHARED_RENDER_OPTION_FIELD_DESCRIPTORS = deepFreeze({
  layoutHints: { typeScript: '{ ranks?: Record<string, number>; adjacent?: string[][]; shortEdges?: string[] }', description: 'Relative ranks, sibling adjacency and short-edge preferences.', defaultLabel: 'unset', validationExpectation: 'contain integer ranks, node groups and edge IDs', schema: { type: 'object', additionalProperties: false, properties: { ranks: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 10000 } }, adjacent: { type: 'array', items: { type: 'array', minItems: 2, items: { type: 'string' } } }, shortEdges: { type: 'array', items: { type: 'string' } } } }, terminal: 'not-applicable', terminalNote: 'not used by terminals', applicableBuiltinFamilies: ['flowchart', 'state'] },
  graphLayout: { typeScript: "{ backend: 'elk' | 'agentic'; fallback?: 'none' | 'elk' }", description: 'Graph geometry producer and explicit Agentic fallback policy.', defaultLabel: '`elk`, no fallback', validationExpectation: 'be a graph layout selection object', schema: { anyOf: [closedObjectSchema({ backend: { type: 'string', const: 'elk' }, fallback: { type: 'string', enum: ['none'] } }, 'ELK graph layout.', ['backend']), closedObjectSchema({ backend: { type: 'string', const: 'agentic' }, fallback: { type: 'string', enum: ['none', 'elk'] } }, 'Owned graph layout with optional ELK fallback.', ['backend'])] }, terminal: 'projected', terminalNote: 'selects pixel placement and optional graphical companion evidence, not terminal-cell placement', applicableBuiltinFamilies: ['flowchart', 'state', 'architecture', 'class', 'er', 'requirement'] },
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
  padding: { typeScript: 'number', description: 'Canvas padding in SVG user units.', defaultLabel: '`40`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Canvas padding in SVG user units.', 40), terminal: 'not-applicable', terminalNote: 'terminal output uses paddingX, paddingY, and boxBorderPadding', applicableBuiltinFamilies: ['flowchart', 'state', 'architecture', 'c4'] },
  nodeSpacing: { typeScript: 'number', description: 'Horizontal spacing between sibling nodes.', defaultLabel: '`24`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Horizontal spacing between sibling nodes.', 24), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract', applicableBuiltinFamilies: GRAPH_LAYOUT_OPTION_FAMILIES },
  layerSpacing: { typeScript: 'number', description: 'Vertical spacing between graph layers.', defaultLabel: '`40`', validationExpectation: 'be a non-negative finite number', schema: nonNegativeNumberSchema('Vertical spacing between graph layers.', 40), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract', applicableBuiltinFamilies: GRAPH_LAYOUT_OPTION_FAMILIES },
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

function renderOptionsAdmissionMessages(value: unknown): string[] {
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

/** Validate the shared advanced JSON object used by CLI/MCP/editor adapters. */
export function validateSerializableRenderOptions(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['render options must be a plain JSON object']
  const admissionProblems = renderOptionsAdmissionMessages(value)
  if (admissionProblems.length > 0) return admissionProblems
  const problems: string[] = []
  // The schema is a projection of frozen module constants: build it once.
  const rootSchema = validationRootSchema ??= deepFreeze(sharedRenderOptionsJsonSchema())
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!Object.hasOwn(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS, field)) {
      problems.push(`unknown render option "${field}"`)
      continue
    }
    if (fieldValue === null) {
      problems.push(`render option "${field}" must be omitted instead of null`)
      continue
    }
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field as SharedRenderOptionField]
    const schemaProblems = validateJsonSchema(fieldValue, descriptor.schema, rootSchema, [field], { diagnostics: 'field', validateRuntime: renderSchemaProblems })
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
    $defs: { jsonValue: cloneSchema(JSON_VALUE_SCHEMA) },
  }
}

/** Public StyleInput projection reused by advanced and convenience adapters. */
export function styleInputJsonSchema(description?: string): Record<string, unknown> {
  return { ...cloneSchema(STYLE_OPTION_SCHEMA), ...(description === undefined ? {} : { description }) }
}

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
  readonly backendPolicy?: HostBackendPolicy
  readonly textMeasurement?: TextMeasurementProfile
  /** Internal identity assertion carried by ParsedDiagram adapters. */
  readonly expectedFamilyId?: FamilyId
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
    ...graphLayoutDecisionsOf(request).flatMap(decision => decision.requested === 'agentic' && decision.selected === 'elk' ? [{
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
    ...(graphLayoutDecisionsOf(request).length ? { layoutDecisions: graphLayoutDecisionsOf(request) } : {}),
  })
}

/** One explicit projection consumed by every family layout/render adapter. */
export function resolvedFamilyRenderContextOf(
  request: ResolvedRenderRequest,
): ResolvedFamilyRenderContext {
  const prior = FAMILY_CONTEXT_BY_REQUEST.get(request)
  if (prior) return prior
  const paintBackendId = EXECUTION_PLAN_BY_REQUEST.get(request)?.backend?.identity.id
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
}

/** Capture compact immutable data under the bounds before schema validation.
 * Opaque leaves remain unbranded for the owner's subsequent rejection. */
function omitUndefinedObjectFields(
  value: unknown,
  path = '$',
  depth = 0,
  ancestors = new Set<object>(),
  budget: FamilyDataNormalizationBudget = { nodes: 0, chars: 0, opaque: false, admission: undefined },
): unknown {
  const admission = budget.admission
  if (admission?.valid) {
    if (++admission.nodes > JSON_CONFIG_ADMISSION_LIMITS.maxNodes || depth > JSON_CONFIG_ADMISSION_LIMITS.maxDepth) admission.valid = false
    switch (typeof value) {
      case 'number':
        if (value - value !== 0) admission.valid = false
        break
      case 'undefined': case 'bigint': case 'symbol': case 'function': admission.valid = false
    }
  }
  if (typeof value === 'string') {
    budget.chars += value.length
    if (budget.chars > FAMILY_DATA_MAX_CHARS) throw new TypeError(`data exceeds the ${FAMILY_DATA_MAX_CHARS}-character aggregate limit at ${path}`)
    return value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth > FAMILY_DATA_MAX_DEPTH) throw new TypeError(`data exceeds maximum depth ${FAMILY_DATA_MAX_DEPTH} at ${path}`)
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
      if (admission && result.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) admission.valid = false
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
        if (admission && (++properties > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer || isForbiddenJsonConfigKey(key))) admission.valid = false
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
function deferredRequestReceiptDigest(receipt: unknown, source: { readonly originalText: string; readonly text: string }): () => string {
  try {
    return deferredRenderContractDigest(receipt)
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
  let snapshot: unknown = admitRenderContractDigestInput(value)
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
      ? omitUndefinedObjectFields(value, '$', 0, new Set(), { nodes: 0, chars: 0, opaque: false, admission })
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

/** Snapshot once before an async feature load. Only this private membership,
 * never a caller's freeze or object identity, authorizes admission reuse. */
export function captureRenderOptions(options: RenderOptions): Readonly<RenderOptions> {
  if (CAPTURED_OPTIONS.has(options)) return options
  const admitted = admitRenderOptionsInput(options)
  const capturedStyle = immutableSnapshot(resolveStyleStackWithFace(admitted.serializable.style))
  const problems = validateSerializableRenderOptions(admitted.serializable)
  if (problems.length) throw new RenderConfigError(`Invalid RenderOptions: ${problems.join('; ')}`)
  const references = namedStyleReferences(admitted.serializable.style)
  const captured = Object.freeze({ ...admitted.serializable, ...(admitted.onConfigDiagnostic ? { onConfigDiagnostic: admitted.onConfigDiagnostic } : {}) })
  CAPTURED_OPTIONS.set(captured, Object.freeze({ ...admitted, capturedStyle }))
  CAPTURED_STYLE_REFERENCES.set(admitted.serializable, references)
  return captured
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
  const decision = negotiateRenderCapabilityTuple(output, { offers, requirements, outputAvailable })
  if (key !== undefined) {
    if (EXECUTION_CAPABILITY_DECISIONS.size < 32) EXECUTION_CAPABILITY_DECISIONS.set(key, decision)
    else observeCache('capability-decision', 'store-skipped', 'capacity')
  }
  return decision
}

function resolveExecutionPlan(
  family: FamilyDescriptor,
  appearance: ResolvedAppearance,
  output: RenderOutput,
  resolutionOptions: RenderExecutionResolutionOptions,
  explicitMermaidConfig?: NonNullable<RenderOptions['mermaidConfig']>,
  onConfigDiagnostic?: NonNullable<RenderOptions['onConfigDiagnostic']>,
): InternalRenderExecutionPlan {
  let mode: InternalRenderExecutionPlan['mode']
  let backend: BackendDescriptor | undefined
  let requestedBackendId: string | undefined
  if (output === 'svg' || output === 'png') {
    mode = appearance.styled || family.lowerScene ? 'scene' : 'family-svg'
    if (mode === 'scene') {
      requestedBackendId = appearance.styled ? appearance.inferredBackend : 'default'
      backend = getBackendDescriptor(requestedBackendId, resolutionOptions.backendPolicy)
    }
  } else if (output === 'layout') {
    mode = 'layout'
  } else {
    mode = 'terminal'
  }

  const backendCapabilityRequirements = mode === 'scene'
    ? requiredBackendCapabilities(family)
    : []
  const backendCapabilityOffers = backend
    ? backendCapabilityRequirements.flatMap(requirement => executionOffer(
        primitiveCapabilityId(requirement),
        backendSupportsCapability(backend, requirement),
      ))
    : []

  const offers: CapabilityOffer[] = [
    { id: family.identity.id, version: family.identity.version },
    ...executionOffer('operation:layout', family.layout !== undefined),
    ...executionOffer('operation:project-positioned', family.projectPositioned !== undefined),
    ...executionOffer('operation:lower-scene', family.lowerScene !== undefined),
    ...executionOffer('operation:render-svg', family.renderSvg !== undefined),
    ...executionOffer('operation:render-terminal', family.renderAscii !== undefined),
    ...executionOffer('core:scene', mode === 'scene'),
    ...executionOffer('backend:scene-renderer', backend !== undefined, backend?.identity.version),
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
        executionRequirement('backend:scene-renderer', backend?.identity.version ?? EXECUTION_CAPABILITY_VERSION),
        ...backendCapabilityRequirements.map(requirement => executionRequirement(primitiveCapabilityId(requirement))),
      )
      outputAvailable = Boolean(
        family.layout
        && family.lowerScene
        && backend
        && backendCapabilityRequirements.every(requirement => backendSupportsCapability(backend, requirement)),
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
  if (!capabilityDecision.accepted) {
    throw executionCapabilityError(output, family, appearance, mode, backend, capabilityDecision)
  }

  const textMeasurement = mode === 'terminal'
    ? undefined
    : createTextMeasurementExecution(resolutionOptions.textMeasurement, appearance.font)
  let executionDecision: RenderExecutionDecision | undefined
  if (mode === 'scene' || mode === 'family-svg') {
    const backendDecision: RenderExecutionDecision['backend'] = mode === 'scene'
      ? Object.freeze({
          mode: 'scene' as const,
          requestedId: requestedBackendId!,
          selectedId: backend!.identity.id,
          version: backend!.identity.version,
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
    ...(requestedBackendId ? { requestedBackendId } : {}),
    ...(configDiagnostics === undefined ? {} : { configDiagnostics }),
    ...(onConfigDiagnostic ? { onConfigDiagnostic } : {}),
    capabilityDecision,
    ...(executionDecision ? { executionDecision } : {}),
    ...(textMeasurement ? { textMeasurement } : {}),
  })
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
  const serializableOptionsCandidate = admittedOptions as Readonly<Record<string, unknown>>
  // Enforce aggregate/depth bounds before Style resolution or any other
  // request-specific walker. Full schema validation remains below so the
  // established StyleInput error boundary is preserved for bounded values.
  const admissionProblems = renderOptionsAdmissionMessages(serializableOptionsCandidate)
  if (admissionProblems.length > 0) {
    throw new RenderConfigError(`Invalid RenderOptions: ${admissionProblems.join('; ')}`)
  }
  // Keep StyleInput's established public error boundary. The shared options
  // schema still validates the field below (and every host surface uses that
  // validator), but resolving it first means an invalid inline StyleSpec is
  // reported as `Invalid style spec` instead of being relabelled as a generic
  // RenderOptions failure. It also avoids resolving mutable registry state
  // twice while constructing one canonical request.
  const resolvedStyle = admitted.capturedStyle ?? resolveStyleStackWithFace(admittedOptions.style)
  const style = resolvedStyle.style
  const face = immutableSnapshot(resolvedStyle.face)
  const optionProblems = admitted.capturedStyle ? [] : validateSerializableRenderOptions(serializableOptionsCandidate)
  if (optionProblems.length > 0) {
    throw new RenderConfigError(`Invalid RenderOptions: ${optionProblems.join('; ')}`)
  }

  // Markdown/HTML parsers commonly hand renderers entity-encoded Mermaid.
  // Decode at the shared request waist so SVG, PNG, layout and terminal
  // transports agree on semantic text; retain authored bytes separately.
  let classification: ReturnType<typeof classifyMermaidFamilyDescriptorFromFirstLine> | undefined
  const normalizedSource = normalizeMermaidRenderSource(text, admittedOptions.mermaidConfig ?? {}, firstLine => {
    if (resolutionOptions.familyDescriptor) return resolutionOptions.familyDescriptor
    classification = classifyMermaidFamilyDescriptorFromFirstLine(firstLine)
    return classification.kind === 'registered' ? classification.family : null
  })
  // Parsing consumes decoded semantic text, while provenance retains the
  // exact authored boundary bytes. Equivalent encodings may render alike but
  // must not collapse to the same request identity.
  const detectedSource: NormalizedMermaidSource = immutableSnapshot(normalizedSource)
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
  const resolvedContext = resolveAppearance({
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
  const sharedRequestDigest = deferredRequestReceiptDigest(sharedRequestReceipt, source)
  const requestReceipt = {
    ...sharedRequestReceipt,
    output,
    outputOptions,
    capabilities: capabilityDecision,
  }
  const requestDigest = deferredRequestReceiptDigest(requestReceipt, source)
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
  return request
}
