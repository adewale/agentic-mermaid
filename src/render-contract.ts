// ============================================================================
// Canonical render-request waist.
//
// Public adapters may have output-specific controls, but every renderer first
// enters through this module. Source/config/style/color/font/security are
// normalized exactly once and the immutable result is what layout, Scene
// lowering, graphical backends, rasterization, and terminal projection share.
// ============================================================================

import type { RenderOptions } from './types.ts'
import { decodeXML } from 'entities'
import type { ArchitectureVisualConfig } from './architecture/config.ts'
import type { DiagramColors } from './theme.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import { normalizeMermaidSourceWithOverrides } from './mermaid-source.ts'
import { CHANNEL_THEME_KEYS, readThemeValue, resolveDiagramColors } from './color-resolver.ts'
import {
  inferBackend,
  isStyledSpec,
  resolveStyleReference,
  resolveStyleStack,
  styleFaceOf,
  type InternalStyleFace,
  type StyleSpec,
} from './scene/style-registry.ts'
import { styleSpecJsonSchema } from './scene/style-spec.ts'
import { safeCssColor } from './shared/css-color.ts'
import { validateRawThemeCss } from './output-security.ts'
import { negotiateRenderCapabilityTuple, type CapabilityDecision } from './capability-negotiation.ts'
import type {
  CapabilityId,
  CapabilityOffer,
  CapabilityRequirement,
  CapabilityResolution,
} from './capability-negotiation.ts'
import { getFamily } from './agent/families.ts'
import type { FamilyDescriptor } from './agent/families.ts'
import { requireRegisteredMermaidFamily } from './family-detection.ts'
import { getBackendDescriptor } from './scene/backend.ts'
import type { BackendDescriptor, HostBackendPolicy } from './scene/backend.ts'
import { RENDER_OUTPUTS, type RenderOutput } from './render-outputs.ts'
export { RENDER_OUTPUTS } from './render-outputs.ts'
export type { RenderOutput } from './render-outputs.ts'

export const RENDER_CONTRACT_VERSION = 1 as const

export type RenderTransportAvailability = 'direct' | 'projected' | 'indirect' | 'unavailable'

export interface RenderTransportClaim<A extends RenderTransportAvailability = RenderTransportAvailability> {
  readonly availability: A
  /** Concrete public entry point, or `none` when the product does not expose the output. */
  readonly entrypoint: string
  /** Option/value or route that selects this logical output when an entry point is shared. */
  readonly selector?: string
  readonly reason?: string
  /** Repository paths that prove this particular product/output cell. */
  readonly evidence: readonly string[]
}

export type LibraryRenderTransport = RenderTransportClaim<'direct' | 'projected'>

export type CliRenderTransport =
  | (RenderTransportClaim<'direct'> & {
      /** Public CLI spelling. Layout deliberately retains its historical `json` alias. */
      readonly format: string
      readonly order: number
      readonly help: string
      readonly default?: true
    })
  | RenderTransportClaim<'unavailable'>

export type CodeModeRenderTransport =
  | (RenderTransportClaim<'direct' | 'projected'> & {
      readonly method: string
      readonly optionsType: 'SvgRenderOptions' | 'AsciiRenderOptions' | 'LayoutRenderOptions'
      readonly returnType: 'RenderedSvg' | 'RenderedAscii' | 'RenderedLayoutArtifact'
    })
  | RenderTransportClaim<'unavailable'>

export type ProductRenderTransport = RenderTransportClaim

export interface RenderOutputTransports {
  readonly library: LibraryRenderTransport
  readonly cli: CliRenderTransport
  readonly codeMode: CodeModeRenderTransport
  readonly localMcp: ProductRenderTransport
  readonly hostedMcp: ProductRenderTransport
  readonly editor: ProductRenderTransport
  readonly website: ProductRenderTransport
}

export interface RenderOutputDescriptor {
  readonly id: RenderOutput
  /** Public means at least one documented public transport can produce it. */
  readonly availability: 'public' | 'internal' | 'reserved'
  readonly security: 'enforced' | 'not-applicable' | 'reserved'
  readonly color: 'srgb' | 'terminal-projected' | 'not-applicable' | 'reserved'
  readonly terminal: 'projected' | 'not-applicable' | 'reserved'
  readonly transports: RenderOutputTransports
  readonly evidence: readonly string[]
}

const OUTPUT_DESCRIPTOR_BY_ID = {
  svg: {
    availability: 'public', security: 'enforced', color: 'srgb', terminal: 'not-applicable',
    transports: {
      library: { availability: 'direct', entrypoint: 'renderMermaidSVG', evidence: ['src/index.ts'] },
      cli: { availability: 'direct', entrypoint: 'am render', selector: '--format svg', evidence: ['src/cli/index.ts'], format: 'svg', order: 0, help: 'SVG markup', default: true },
      codeMode: { availability: 'direct', entrypoint: 'mermaid.renderMermaidSVGWithReceipt', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'renderMermaidSVGWithReceipt', optionsType: 'SvgRenderOptions', returnType: 'RenderedSvg' },
      localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.renderMermaidSVGWithReceipt', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
      hostedMcp: { availability: 'direct', entrypoint: 'render_svg', evidence: ['src/mcp/hosted-server.ts'] },
      editor: { availability: 'direct', entrypoint: 'diagram preview / Save SVG', selector: 'renderMermaidSVGWithReceipt', evidence: ['editor/js/rendering.js', 'editor/js/export.js'] },
      website: { availability: 'direct', entrypoint: 'website build-time renderMermaidSVG', selector: 'embedded examples and diagram assets', evidence: ['website/build.ts'] },
    },
    evidence: ['output-security@2', 'render-contract@1'],
  },
  png: {
    availability: 'public', security: 'enforced', color: 'srgb', terminal: 'not-applicable',
    transports: {
      library: { availability: 'direct', entrypoint: 'renderMermaidPNG', evidence: ['src/agent/png.ts'] },
      cli: { availability: 'direct', entrypoint: 'am render', selector: '--format png', evidence: ['src/cli/index.ts'], format: 'png', order: 3, help: 'PNG bytes; requires --output <file.png>; no watch/multi-input' },
      codeMode: { availability: 'unavailable', entrypoint: 'none', reason: 'PNG rasterization is a host tool, not a sandbox SDK method', evidence: ['src/mcp/sdk-decl.ts', 'src/mcp/facade.ts'] },
      localMcp: { availability: 'direct', entrypoint: 'render_png', evidence: ['src/mcp/server.ts'] },
      hostedMcp: { availability: 'direct', entrypoint: 'render_png', evidence: ['src/mcp/hosted-server.ts'] },
      editor: { availability: 'direct', entrypoint: 'Save PNG / Copy PNG', selector: 'renderMermaidPNGInBrowserWithReceipt', evidence: ['editor/js/export.js', 'src/browser-png.ts'] },
      website: { availability: 'unavailable', entrypoint: 'none', reason: 'The site build copies curated PNG assets but exposes no PNG render adapter', evidence: ['website/build.ts'] },
    },
    evidence: ['output-security@2', 'output-color-profile@1', 'png-output-policy@1', 'render-contract@1'],
  },
  ascii: {
    availability: 'public', security: 'enforced', color: 'terminal-projected', terminal: 'projected',
    transports: {
      library: { availability: 'direct', entrypoint: 'renderMermaidASCII', selector: 'useAscii: true', evidence: ['src/ascii/index.ts'] },
      cli: { availability: 'direct', entrypoint: 'am render', selector: '--format ascii', evidence: ['src/cli/index.ts'], format: 'ascii', order: 1, help: '7-bit ASCII art (also via --ascii)' },
      codeMode: { availability: 'direct', entrypoint: 'mermaid.renderMermaidASCIIWithReceipt', selector: 'useAscii: true', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'renderMermaidASCIIWithReceipt', optionsType: 'AsciiRenderOptions', returnType: 'RenderedAscii' },
      localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.renderMermaidASCIIWithReceipt({ useAscii: true })', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
      hostedMcp: { availability: 'direct', entrypoint: 'render_ascii', selector: 'useAscii: true', evidence: ['src/mcp/hosted-server.ts'] },
      editor: { availability: 'direct', entrypoint: 'ASCII canvas tab', selector: 'renderMermaidASCII({ useAscii: true })', evidence: ['editor/js/rendering.js', 'editor/html/right-panel.html'] },
      website: { availability: 'unavailable', entrypoint: 'none', reason: 'The site build emits one Unicode diagram asset but no 7-bit ASCII output', evidence: ['website/build.ts'] },
    },
    evidence: ['terminal-style@1', 'terminal-output-policy@1', 'terminal-control-sanitization', 'render-contract@1'],
  },
  unicode: {
    availability: 'public', security: 'enforced', color: 'terminal-projected', terminal: 'projected',
    transports: {
      library: { availability: 'direct', entrypoint: 'renderMermaidASCII', selector: 'useAscii: false (default)', evidence: ['src/ascii/index.ts'] },
      cli: { availability: 'direct', entrypoint: 'am render', selector: '--format unicode', evidence: ['src/cli/index.ts'], format: 'unicode', order: 2, help: 'Unicode box-drawing text' },
      codeMode: { availability: 'direct', entrypoint: 'mermaid.renderMermaidASCIIWithReceipt', selector: 'useAscii: false (default)', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'renderMermaidASCIIWithReceipt', optionsType: 'AsciiRenderOptions', returnType: 'RenderedAscii' },
      localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.renderMermaidASCIIWithReceipt({ useAscii: false })', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
      hostedMcp: { availability: 'direct', entrypoint: 'render_ascii', selector: 'useAscii: false (default)', evidence: ['src/mcp/hosted-server.ts'] },
      editor: { availability: 'direct', entrypoint: 'Unicode canvas tab', selector: 'renderMermaidASCII({ useAscii: false })', evidence: ['editor/js/rendering.js', 'editor/html/right-panel.html'] },
      website: { availability: 'direct', entrypoint: 'website build-time renderMermaidASCII', selector: 'diagrams/workflow.txt; useAscii: false', evidence: ['website/build.ts'] },
    },
    evidence: ['terminal-style@1', 'terminal-output-policy@1', 'terminal-control-sanitization', 'render-contract@1'],
  },
  html: {
    availability: 'public', security: 'enforced', color: 'terminal-projected', terminal: 'projected',
    transports: {
      library: { availability: 'projected', entrypoint: 'renderMermaidASCII', selector: "colorMode: 'html'", evidence: ['src/ascii/index.ts'] },
      cli: { availability: 'unavailable', entrypoint: 'none', reason: 'HTML text is not a standalone CLI format', evidence: ['src/cli/index.ts'] },
      codeMode: { availability: 'projected', entrypoint: 'mermaid.renderMermaidASCIIWithReceipt', selector: "colorMode: 'html' (terminal projection; not a standalone CLI format)", evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'renderMermaidASCIIWithReceipt', optionsType: 'AsciiRenderOptions', returnType: 'RenderedAscii' },
      localMcp: { availability: 'indirect', entrypoint: 'execute', selector: "mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })", evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
      hostedMcp: { availability: 'indirect', entrypoint: 'execute', selector: "mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })", evidence: ['src/mcp/hosted-server.ts', 'src/mcp/facade.ts'] },
      editor: { availability: 'unavailable', entrypoint: 'none', reason: 'The editor exposes diagram, Unicode and ASCII canvas tabs only', evidence: ['editor/js/buttons.js', 'editor/html/right-panel.html'] },
      website: { availability: 'unavailable', entrypoint: 'none', reason: 'The site does not emit terminal-HTML diagram artifacts', evidence: ['website/build.ts'] },
    },
    evidence: ['terminal-style@1', 'terminal-output-policy@1', 'terminal-control-sanitization', 'html-text-escaping', 'render-contract@1'],
  },
  layout: {
    availability: 'public', security: 'not-applicable', color: 'not-applicable', terminal: 'not-applicable',
    transports: {
      library: { availability: 'direct', entrypoint: 'layoutMermaid', evidence: ['src/agent/core.ts'] },
      cli: { availability: 'direct', entrypoint: 'am render', selector: '--format json', evidence: ['src/cli/index.ts'], format: 'json', order: 4, help: 'Layout JSON (nodes, edges, groups, bounds)' },
      codeMode: { availability: 'direct', entrypoint: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'layoutMermaidWithReceipt', optionsType: 'LayoutRenderOptions', returnType: 'RenderedLayoutArtifact' },
      localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
      hostedMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/hosted-server.ts', 'src/mcp/facade.ts'] },
      editor: { availability: 'indirect', entrypoint: 'verification panel', selector: 'verifyMermaid(source).layout (consumed, not exported)', evidence: ['editor/js/rendering.js'] },
      website: { availability: 'unavailable', entrypoint: 'none', reason: 'Website verification consumes layout internally but publishes no layout artifact', evidence: ['website/build.ts'] },
    },
    evidence: ['positioned-artifact@1', 'render-contract@1'],
  },
} as const satisfies Record<RenderOutput, Omit<RenderOutputDescriptor, 'id'>>

function freezeTransport<T extends RenderTransportClaim>(transport: T): T {
  return Object.freeze({
    ...transport,
    evidence: Object.freeze([...transport.evidence]),
  }) as T
}

export const RENDER_TRANSPORT_SURFACES = Object.freeze([
  'library', 'cli', 'codeMode', 'localMcp', 'hostedMcp', 'editor', 'website',
] as const satisfies readonly (keyof RenderOutputTransports)[])

/** Output capability authority in the same deterministic order as RENDER_OUTPUTS. */
export const RENDER_OUTPUT_DESCRIPTORS: readonly RenderOutputDescriptor[] = Object.freeze(
  RENDER_OUTPUTS.map(id => {
    const descriptor = OUTPUT_DESCRIPTOR_BY_ID[id]
    return Object.freeze({
      id,
      ...descriptor,
      transports: Object.freeze({
        library: freezeTransport(descriptor.transports.library),
        cli: freezeTransport(descriptor.transports.cli),
        codeMode: freezeTransport(descriptor.transports.codeMode),
        localMcp: freezeTransport(descriptor.transports.localMcp),
        hostedMcp: freezeTransport(descriptor.transports.hostedMcp),
        editor: freezeTransport(descriptor.transports.editor),
        website: freezeTransport(descriptor.transports.website),
      }),
      evidence: Object.freeze([...descriptor.evidence]),
    })
  }),
)

type DirectCliOutputDescriptor = RenderOutputDescriptor & {
  readonly transports: RenderOutputTransports & { readonly cli: Extract<CliRenderTransport, { availability: 'direct' }> }
}

/** CLI discovery projection. HTML is intentionally absent; layout is `json`. */
export const CLI_RENDER_OUTPUT_DESCRIPTORS: readonly DirectCliOutputDescriptor[] = Object.freeze(
  RENDER_OUTPUT_DESCRIPTORS
    .filter((descriptor): descriptor is DirectCliOutputDescriptor => descriptor.transports.cli.availability === 'direct')
    .sort((left, right) => left.transports.cli.order - right.transports.cli.order),
)

type RawOutputDescriptor = typeof OUTPUT_DESCRIPTOR_BY_ID[RenderOutput]
export type CliRenderFormat = Extract<RawOutputDescriptor['transports']['cli'], { availability: 'direct' }>['format']

/** Backward-compatible CLI spellings, generated from the output descriptors. */
export const CLI_RENDER_FORMATS: readonly CliRenderFormat[] = Object.freeze(
  CLI_RENDER_OUTPUT_DESCRIPTORS.map(descriptor => descriptor.transports.cli.format as CliRenderFormat),
)

const DEFAULT_CLI_RENDER_OUTPUTS = CLI_RENDER_OUTPUT_DESCRIPTORS.filter(descriptor => descriptor.transports.cli.default)
if (DEFAULT_CLI_RENDER_OUTPUTS.length !== 1) throw new Error('Render output contract must declare exactly one default CLI format')
export const DEFAULT_CLI_RENDER_FORMAT = DEFAULT_CLI_RENDER_OUTPUTS[0]!.transports.cli.format as CliRenderFormat

export function isCliRenderFormat(value: string): value is CliRenderFormat {
  return CLI_RENDER_FORMATS.includes(value as CliRenderFormat)
}

export function renderOutputForCliFormat(value: string): DirectCliOutputDescriptor | undefined {
  return CLI_RENDER_OUTPUT_DESCRIPTORS.find(descriptor => descriptor.transports.cli.format === value)
}

export function cliRenderFormatHelpLines(indent = '  '): string {
  const width = Math.max(...CLI_RENDER_FORMATS.map(format => format.length))
  return CLI_RENDER_OUTPUT_DESCRIPTORS
    .map(descriptor => {
      const cli = descriptor.transports.cli
      return `${indent}--format ${cli.format.padEnd(width)}  ${cli.help}`
    })
    .join('\n')
}

export function cliRenderFormatJsonSchema(): { type: 'string'; enum: CliRenderFormat[] } {
  return { type: 'string', enum: [...CLI_RENDER_FORMATS] }
}

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
}

const stringSchema = (description: string, defaultValue?: string): JsonSchemaNode => ({
  type: 'string', description, ...(defaultValue === undefined ? {} : { default: defaultValue }),
})
const numberSchema = (description: string, defaultValue?: number): JsonSchemaNode => ({
  type: 'number', description, ...(defaultValue === undefined ? {} : { default: defaultValue }),
})
const booleanSchema = (description: string, defaultValue?: boolean): JsonSchemaNode => ({
  type: 'boolean', description, ...(defaultValue === undefined ? {} : { default: defaultValue }),
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
  groupHeaderHeight: numberSchema('Architecture group-header height.'),
  groupFontSize: numberSchema('Architecture group-label font size.'),
  groupFontWeight: numberSchema('Architecture group-label font weight.'),
  groupLetterSpacing: numberSchema('Architecture group-label letter spacing.'),
  groupFont: stringSchema('Architecture group-label font family.'),
  groupTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture group-label text transform.' },
  groupPaddingX: numberSchema('Horizontal padding inside architecture groups.'),
  groupPaddingY: numberSchema('Vertical padding inside architecture groups.'),
  groupLabelPaddingX: numberSchema('Horizontal padding around architecture group labels.'),
  groupCornerRadius: numberSchema('Architecture group corner radius.'),
  groupLineWidth: numberSchema('Architecture group border width.'),
  groupText: stringSchema('Architecture group-label color.'),
  serviceFontSize: numberSchema('Architecture service-label font size.'),
  serviceFontWeight: numberSchema('Architecture service-label font weight.'),
  serviceLetterSpacing: numberSchema('Architecture service-label letter spacing.'),
  serviceTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture service-label text transform.' },
  servicePaddingX: numberSchema('Horizontal padding inside architecture services.'),
  servicePaddingY: numberSchema('Vertical padding inside architecture services.'),
  serviceCornerRadius: numberSchema('Architecture service corner radius.'),
  serviceLineWidth: numberSchema('Architecture service border width.'),
  serviceText: stringSchema('Architecture service-label color.'),
  edgeFontSize: numberSchema('Architecture connector-label font size.'),
  edgeFontWeight: numberSchema('Architecture connector-label font weight.'),
  edgeLetterSpacing: numberSchema('Architecture connector-label letter spacing.'),
  edgeTextTransform: { ...TEXT_TRANSFORM_SCHEMA, description: 'Architecture connector-label text transform.' },
  edgeLineWidth: numberSchema('Architecture connector width.'),
  edgeBendRadius: numberSchema('Architecture connector bend radius.'),
  edgeStroke: stringSchema('Architecture connector color.'),
  edgeText: stringSchema('Architecture connector-label color.'),
  iconSize: numberSchema('Architecture group icon size.'),
  serviceIconSize: numberSchema('Architecture service icon size.'),
  junctionOuterRadius: numberSchema('Architecture junction outer radius.'),
  junctionInnerRadius: numberSchema('Architecture junction inner radius.'),
  groupSurface: stringSchema('Architecture group surface color.'),
  groupHeaderSurface: stringSchema('Architecture group-header surface color.'),
  groupBorder: stringSchema('Architecture group border color.'),
  serviceSurface: stringSchema('Architecture service surface color.'),
  serviceBorder: stringSchema('Architecture service border color.'),
} as const satisfies Readonly<Record<keyof ArchitectureVisualConfig, JsonSchemaNode>>

type RequiredKeys<Value> = {
  [Key in keyof Value]-?: Record<string, never> extends Pick<Value, Key> ? never : Key
}[keyof Value]
type RequiredArchitectureVisualField = RequiredKeys<ArchitectureVisualConfig>

const ARCHITECTURE_VISUAL_REQUIRED_FIELDS = Object.freeze([
  'groupHeaderHeight', 'groupFontSize', 'groupFontWeight', 'groupLetterSpacing',
  'groupPaddingX', 'groupPaddingY', 'groupLabelPaddingX', 'groupCornerRadius', 'groupLineWidth',
  'serviceFontSize', 'serviceFontWeight', 'serviceLetterSpacing', 'servicePaddingX', 'servicePaddingY',
  'serviceCornerRadius', 'serviceLineWidth', 'edgeFontSize', 'edgeFontWeight', 'edgeLetterSpacing',
  'edgeLineWidth', 'edgeBendRadius', 'iconSize', 'serviceIconSize', 'junctionOuterRadius', 'junctionInnerRadius',
] as const satisfies readonly RequiredArchitectureVisualField[])

type MissingRequiredArchitectureVisualField = Exclude<RequiredArchitectureVisualField, typeof ARCHITECTURE_VISUAL_REQUIRED_FIELDS[number]>
const ALL_REQUIRED_ARCHITECTURE_VISUAL_FIELDS_ACCOUNTED_FOR: MissingRequiredArchitectureVisualField extends never ? true : never = true
void ALL_REQUIRED_ARCHITECTURE_VISUAL_FIELDS_ACCOUNTED_FOR

const STYLE_SPEC_SCHEMA = (() => {
  const { $schema: _dialect, $id: _id, title: _title, ...fragment } = styleSpecJsonSchema()
  return fragment
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

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * The single checked manifest for fields shared by first-party adapters.
 * Output adapters may add their own fields (PNG scale/fontDirs, terminal
 * width/encoding), but must not re-declare or hand-forward this set.
 */
export const SHARED_RENDER_OPTION_FIELD_DESCRIPTORS = deepFreeze({
  bg: { typeScript: 'string', description: 'Background color or CSS variable.', defaultLabel: '`#FFFFFF`', validationExpectation: 'be a string', schema: stringSchema('Background color or CSS variable.', '#FFFFFF'), terminal: 'consumed' },
  fg: { typeScript: 'string', description: 'Primary foreground and text color.', defaultLabel: '`#27272A`', validationExpectation: 'be a string', schema: stringSchema('Primary foreground and text color.', '#27272A'), terminal: 'consumed' },
  line: { typeScript: 'string', description: 'Connector and secondary-line color.', defaultLabel: 'derived', validationExpectation: 'be a string', schema: stringSchema('Connector and secondary-line color.'), terminal: 'consumed' },
  accent: { typeScript: 'string', description: 'Arrowhead, highlight, and data accent color.', defaultLabel: 'derived', validationExpectation: 'be a string', schema: stringSchema('Arrowhead, highlight, and data accent color.'), terminal: 'consumed' },
  muted: { typeScript: 'string', description: 'Secondary text and label color.', defaultLabel: 'derived', validationExpectation: 'be a string', schema: stringSchema('Secondary text and label color.'), terminal: 'projected', terminalNote: 'terminal themes have no dedicated muted-text role' },
  surface: { typeScript: 'string', description: 'Node and group surface color.', defaultLabel: 'derived', validationExpectation: 'be a string', schema: stringSchema('Node and group surface color.'), terminal: 'projected', terminalNote: 'terminal cells do not paint graphical surfaces' },
  border: { typeScript: 'string', description: 'Node and group border color.', defaultLabel: 'derived', validationExpectation: 'be a string', schema: stringSchema('Node and group border color.'), terminal: 'consumed' },
  font: { typeScript: 'string', description: 'CSS font family or stack.', defaultLabel: '`Inter`', validationExpectation: 'be a string', schema: stringSchema('CSS font family or stack.', 'Inter'), terminal: 'projected', terminalNote: 'the host terminal owns the font face' },
  style: { typeScript: 'StyleInput | StyleInput[]', description: 'Registered Style/Palette name, inline StyleSpec, or left-to-right stack.', defaultLabel: '`crisp`', validationExpectation: 'be a registered Style name or StyleSpec, or an array of them', schema: STYLE_OPTION_SCHEMA, terminal: 'consumed' },
  padding: { typeScript: 'number', description: 'Canvas padding in SVG user units.', defaultLabel: '`40`', validationExpectation: 'be a finite number', schema: numberSchema('Canvas padding in SVG user units.', 40), terminal: 'not-applicable', terminalNote: 'terminal output uses paddingX, paddingY, and boxBorderPadding' },
  nodeSpacing: { typeScript: 'number', description: 'Horizontal spacing between sibling nodes.', defaultLabel: '`24`', validationExpectation: 'be a finite number', schema: numberSchema('Horizontal spacing between sibling nodes.', 24), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract' },
  layerSpacing: { typeScript: 'number', description: 'Vertical spacing between graph layers.', defaultLabel: '`40`', validationExpectation: 'be a finite number', schema: numberSchema('Vertical spacing between graph layers.', 40), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract' },
  wrappingWidth: { typeScript: 'number', description: 'Flowchart measured-label wrapping budget in pixels.', defaultLabel: 'unset', validationExpectation: 'be a finite number', schema: numberSchema('Flowchart measured-label wrapping budget in pixels.'), terminal: 'not-applicable', terminalNote: 'terminal output uses maxWidth or targetWidth' },
  componentSpacing: { typeScript: 'number', description: 'Spacing between disconnected graph components.', defaultLabel: '`nodeSpacing` (`24`)', validationExpectation: 'be a finite number', schema: numberSchema('Spacing between disconnected graph components; defaults to nodeSpacing (24).'), terminal: 'not-applicable', terminalNote: 'terminal layout has a cell-grid spacing contract' },
  transparent: { typeScript: 'boolean', description: 'Omit the painted SVG canvas background.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Omit the painted SVG canvas background.', false), terminal: 'projected', terminalNote: 'terminal output has no painted canvas background' },
  interactive: { typeScript: 'boolean', description: 'Enable hover tooltips for supported chart data points.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Enable hover tooltips for supported chart data points.', false), terminal: 'projected', terminalNote: 'terminal output is a static semantic projection' },
  shadow: { typeScript: 'boolean', description: 'Paint explicit drop shadows on node shapes.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Paint explicit drop shadows on node shapes.', false), terminal: 'projected', terminalNote: 'elevation projects to borders and labels' },
  class: { typeScript: '{ hierarchicalNamespaces?: boolean }', description: 'Class-diagram rendering controls.', defaultLabel: '`hierarchicalNamespaces: true`', validationExpectation: 'be a class options object', schema: closedObjectSchema({ hierarchicalNamespaces: booleanSchema('Nest namespace compounds.', true) }, 'Class-diagram rendering controls.'), terminal: 'not-applicable', terminalNote: 'this option configures graphical class layout' },
  architecture: { typeScript: '{ visual?: ArchitectureVisualConfig }', description: 'Architecture renderer visual metrics and paint overrides.', defaultLabel: 'built-in metrics', validationExpectation: 'be an architecture options object', schema: closedObjectSchema({ visual: closedObjectSchema(ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES, 'Complete architecture visual configuration.', ARCHITECTURE_VISUAL_REQUIRED_FIELDS) }, 'Architecture renderer visual metrics and paint overrides.'), terminal: 'not-applicable', terminalNote: 'this option configures graphical architecture rendering' },
  timeline: { typeScript: '{ maxWidth?: number }', description: 'Timeline layout controls.', defaultLabel: '`maxWidth`: unset', validationExpectation: 'be a timeline options object', schema: closedObjectSchema({ maxWidth: numberSchema('Best-effort width budget for horizontal timelines.') }, 'Timeline layout controls.'), terminal: 'not-applicable', terminalNote: 'terminal output uses maxWidth or targetWidth' },
  journey: { typeScript: '{ experienceCurve?: boolean }', description: 'User-journey graphical controls.', defaultLabel: '`experienceCurve: true`', validationExpectation: 'be a journey options object', schema: closedObjectSchema({ experienceCurve: booleanSchema('Connect journey score markers with an experience curve.', true) }, 'User-journey graphical controls.'), terminal: 'not-applicable', terminalNote: 'experience curves are graphical-only' },
  gantt: { typeScript: '{ dependencyArrows?: boolean; criticalPath?: boolean }', description: 'Gantt dependency and critical-path overlays.', defaultLabel: 'both `false`', validationExpectation: 'be a Gantt options object', schema: closedObjectSchema({ dependencyArrows: booleanSchema('Draw scheduled dependency connectors.', false), criticalPath: booleanSchema('Emphasize critical-path tasks and connectors.', false) }, 'Gantt dependency and critical-path overlays.'), terminal: 'not-applicable', terminalNote: 'graphical Gantt connector emphasis is not represented in cells' },
  mermaidConfig: { typeScript: 'MermaidRuntimeConfig', description: 'Mermaid-style recursive runtime configuration.', defaultLabel: 'source config', validationExpectation: 'be a plain JSON object', schema: { type: 'object', description: 'Mermaid-style recursive runtime configuration.', additionalProperties: { $ref: '#/$defs/jsonValue' } }, terminal: 'consumed' },
  embedFontImport: { typeScript: 'boolean', description: 'Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization.', defaultLabel: '`true` (SVG)', validationExpectation: 'be a boolean', schema: booleanSchema('Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization.', true), terminal: 'not-applicable', terminalNote: 'terminal output embeds no web-font import' },
  compact: { typeScript: 'boolean', description: 'Compact SVG serialization while preserving agent hooks.', defaultLabel: '`false`', validationExpectation: 'be a boolean', schema: booleanSchema('Compact SVG serialization while preserving agent hooks.', false), terminal: 'not-applicable', terminalNote: 'compact controls SVG serialization' },
  idPrefix: { typeScript: 'string', description: 'Namespace generated SVG definition IDs and local references.', defaultLabel: "`''`", validationExpectation: 'be a string', schema: stringSchema('Namespace generated SVG definition IDs and local references.', ''), terminal: 'not-applicable', terminalNote: 'terminal output has no SVG definition ids' },
  security: { typeScript: "'default' | 'strict'", description: 'Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.', defaultLabel: '`default`', validationExpectation: 'be default or strict', schema: { type: 'string', enum: ['default', 'strict'], description: 'Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes.', default: 'default' }, terminal: 'not-applicable', terminalNote: 'terminal text has its own control-character and HTML-color safety projection' },
  ganttToday: { typeScript: 'string', description: 'Explicit deterministic date for the Gantt today marker.', defaultLabel: 'unset', validationExpectation: 'be a string', schema: stringSchema('Explicit deterministic date for the Gantt today marker.'), terminal: 'consumed' },
  seed: { typeScript: 'number', description: 'Deterministic re-roll seed for stochastic Styles.', defaultLabel: '`0`', validationExpectation: 'be a finite number', schema: numberSchema('Deterministic re-roll seed for stochastic Styles.', 0), terminal: 'not-applicable', terminalNote: 'terminal glyph geometry is deterministic and has no stochastic ink' },
} as const satisfies Readonly<Record<SerializableRenderOptionField, SharedRenderOptionFieldDescriptor>>)

export type SharedRenderOptionField = keyof typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS

export const SHARED_RENDER_OPTION_FIELDS: readonly SharedRenderOptionField[] = Object.freeze(
  Object.keys(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS) as SharedRenderOptionField[],
)

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

/** Code Mode declaration projected from the nested architecture schema authority. */
export function architectureVisualConfigTypeScriptDeclaration(): string {
  const required = new Set<string>(ARCHITECTURE_VISUAL_REQUIRED_FIELDS)
  const fields = Object.entries(ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES).map(([field, schema]) =>
    `  ${field}${required.has(field) ? '' : '?'}: ${schemaTypeScript(schema)}`)
  return `interface ArchitectureVisualConfig {\n${fields.join('\n')}\n}`
}

function plainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

interface SchemaProblem {
  readonly path: readonly (string | number)[]
  readonly message: string
  /** Generic failures may use the field descriptor's clearer expectation. */
  readonly generic: boolean
}

function schemaRecord(value: unknown): JsonSchemaNode | undefined {
  return plainJsonObject(value) ? value : undefined
}

function cloneSchema(schema: JsonSchemaNode): Record<string, unknown> {
  const cloneValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cloneValue)
    if (plainJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]))
    return value
  }
  return cloneValue(schema) as Record<string, unknown>
}

function optionPath(path: readonly (string | number)[]): string {
  let result = String(path[0] ?? '')
  for (const part of path.slice(1)) result += typeof part === 'number' ? `[${part}]` : `.${part}`
  return `render option "${result}"`
}

function dereferenceSchema(schema: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode | undefined {
  const reference = schema.$ref
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined
  let cursor: unknown = root
  for (const encoded of reference.slice(2).split('/')) {
    if (!plainJsonObject(cursor)) return undefined
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    cursor = cursor[key]
  }
  return schemaRecord(cursor)
}

function schemaMatchesRuntimeKind(value: unknown, schema: JsonSchemaNode, root: JsonSchemaNode): boolean {
  const resolved = dereferenceSchema(schema, root)
  if (resolved) return schemaMatchesRuntimeKind(value, resolved, root)
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.map(schemaRecord).filter((entry): entry is JsonSchemaNode => entry !== undefined) : []
  if (anyOf.length > 0) return anyOf.some(candidate => schemaMatchesRuntimeKind(value, candidate, root))
  switch (schema.type) {
    case 'null': return value === null
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'integer': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value)
    case 'object': return plainJsonObject(value)
    default: return true
  }
}

function validateSchemaValue(
  value: unknown,
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
  path: readonly (string | number)[],
  ancestors: Set<object>,
): SchemaProblem[] {
  const resolved = dereferenceSchema(schema, root)
  if (schema.$ref !== undefined) {
    if (!resolved) return [{ path, message: 'uses an unresolved schema reference', generic: false }]
    return validateSchemaValue(value, resolved, root, path, ancestors)
  }

  const anyOf = Array.isArray(schema.anyOf)
    ? schema.anyOf.map(schemaRecord).filter((entry): entry is JsonSchemaNode => entry !== undefined)
    : []
  if (anyOf.length > 0) {
    const compatible = anyOf.filter(candidate => schemaMatchesRuntimeKind(value, candidate, root))
    const candidates = compatible.length > 0 ? compatible : anyOf
    const branchProblems = candidates.map(candidate => validateSchemaValue(value, candidate, root, path, ancestors))
    if (!branchProblems.some(problems => problems.length === 0)) {
      const expectation = schema['x-agentic-mermaid-validation-expectation']
      if (compatible.length === 0 && typeof expectation === 'string') return [{ path, message: `must be ${expectation}`, generic: true }]
      return branchProblems.sort((left, right) => left.length - right.length)[0]
        ?? [{ path, message: 'must match an allowed shape', generic: true }]
    }
  }

  if ('const' in schema && value !== schema.const) {
    return [{ path, message: `must equal ${String(schema.const)}`, generic: true }]
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [{ path, message: `must be one of ${schema.enum.map(String).join(' | ')}`, generic: true }]
  }

  const type = schema.type
  const typeIsValid = type === undefined
    || (type === 'null' && value === null)
    || (type === 'string' && typeof value === 'string')
    || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (type === 'integer' && typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))
    || (type === 'boolean' && typeof value === 'boolean')
    || (type === 'array' && Array.isArray(value))
    || (type === 'object' && plainJsonObject(value))
  if (!typeIsValid) {
    const expected = type === 'number' ? 'a finite number'
      : type === 'integer' ? 'a finite integer'
        : type === 'object' ? 'a plain JSON object'
          : type === 'array' ? 'an array'
            : type === 'null' ? 'null'
              : `a ${String(type)}`
    return [{ path, message: `must be ${expected}`, generic: true }]
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return [{ path, message: `must be at least ${schema.minimum}`, generic: true }]
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return [{ path, message: `must be greater than ${schema.exclusiveMinimum}`, generic: true }]
    if (typeof schema.maximum === 'number' && value > schema.maximum) return [{ path, message: `must be at most ${schema.maximum}`, generic: true }]
  }

  if (Array.isArray(value) && type === 'array') {
    if (ancestors.has(value)) return [{ path, message: 'must be acyclic', generic: false }]
    const items = schemaRecord(schema.items)
    if (items) {
      ancestors.add(value)
      try {
        const problems = value.flatMap((item, index) => validateSchemaValue(item, items, root, [...path, index], ancestors))
        if (problems.length > 0) return problems
      } finally {
        ancestors.delete(value)
      }
    }
  }

  if (plainJsonObject(value) && type === 'object') {
    if (ancestors.has(value)) return [{ path, message: 'must be acyclic', generic: false }]
    ancestors.add(value)
    try {
      const properties = schemaRecord(schema.properties) ?? {}
      const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : []
      const problems: SchemaProblem[] = []
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) problems.push({ path: [...path, key], message: 'is required', generic: false })
      }
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
          problems.push({ path: [...path, key], message: 'uses a forbidden prototype key', generic: false })
          continue
        }
        const propertySchema = schemaRecord(properties[key])
        if (propertySchema) {
          problems.push(...validateSchemaValue(child, propertySchema, root, [...path, key], ancestors))
          continue
        }
        if (schema.additionalProperties === false) {
          problems.push({ path: [...path, key], message: 'is not allowed', generic: false })
          continue
        }
        const additionalSchema = schemaRecord(schema.additionalProperties)
        if (additionalSchema) problems.push(...validateSchemaValue(child, additionalSchema, root, [...path, key], ancestors))
      }
      if (problems.length > 0) return problems
    } finally {
      ancestors.delete(value)
    }
  }

  const runtimeValidator = schema['x-agentic-mermaid-runtime-validator']
  if (runtimeValidator === 'safeCssColor' && safeCssColor(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS color', generic: false }]
  }
  if (runtimeValidator === 'styleInput') {
    try {
      resolveStyleStack(value as RenderOptions['style'])
    } catch (error) {
      return [{ path, message: `is invalid: ${error instanceof Error ? error.message : String(error)}`, generic: false }]
    }
  }
  return []
}

/** Validate the shared advanced JSON object used by CLI/MCP/editor adapters. */
export function validateSerializableRenderOptions(value: unknown): string[] {
  if (!plainJsonObject(value)) return ['render options must be a plain JSON object']
  const problems: string[] = []
  const allowed = new Set<string>(SHARED_RENDER_OPTION_FIELDS)
  const rootSchema = sharedRenderOptionsJsonSchema()
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!allowed.has(field)) {
      problems.push(`unknown render option "${field}"`)
      continue
    }
    if (fieldValue === null) {
      problems.push(`render option "${field}" must be omitted instead of null`)
      continue
    }
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field as SharedRenderOptionField]
    const schemaProblems = validateSchemaValue(fieldValue, descriptor.schema, rootSchema, [field], new Set())
    if (schemaProblems.length > 0 && schemaProblems.every(problem => problem.generic && problem.path.length === 1)) {
      problems.push(`render option "${field}" must ${descriptor.validationExpectation}`)
    } else {
      problems.push(...schemaProblems.map(problem => `${optionPath(problem.path)} ${problem.message}`))
    }
  }
  return problems
}

/** JSON Schema projection generated from the same field manifest. */
export function sharedRenderOptionsJsonSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const field of SHARED_RENDER_OPTION_FIELDS) {
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
    const terminalNote = 'terminalNote' in descriptor ? descriptor.terminalNote : undefined
    properties[field] = {
      ...cloneSchema(descriptor.schema),
      'x-agentic-mermaid-terminal': descriptor.terminal,
      ...(terminalNote === undefined ? {} : { 'x-agentic-mermaid-terminal-note': terminalNote }),
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

export const SHARED_RENDER_OPTIONS_DOC_START = '<!-- BEGIN GENERATED SHARED RENDER OPTIONS -->'
export const SHARED_RENDER_OPTIONS_DOC_END = '<!-- END GENERATED SHARED RENDER OPTIONS -->'

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

/** API field inventory generated from the same descriptors as validation and schema. */
export function sharedRenderOptionsMarkdownTable(): string {
  const rows = SHARED_RENDER_OPTION_FIELDS.map(field => {
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
    const terminalNote = 'terminalNote' in descriptor ? descriptor.terminalNote : undefined
    const terminal = descriptor.terminal === 'consumed'
      ? 'consumed'
      : `${descriptor.terminal}${terminalNote ? ` — ${terminalNote}` : ''}`
    return `| \`${field}\` | \`${markdownCell(descriptor.typeScript)}\` | ${descriptor.defaultLabel} | ${markdownCell(descriptor.description)} | ${markdownCell(terminal)} |`
  })
  return [
    '| Option | Type | Effective default | Meaning | Terminal |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

const RESOLVED_APPEARANCE = Symbol.for('agentic-mermaid.resolved-appearance.v1')

export interface ResolvedAppearance {
  readonly version: typeof RENDER_CONTRACT_VERSION
  readonly colors: Readonly<DiagramColors>
  readonly font: string
  /** Resolved left-to-right Style stack, never an unresolved public input. */
  readonly style?: Readonly<StyleSpec>
  readonly face?: Readonly<InternalStyleFace>
  readonly styled: boolean
  readonly inferredBackend: string
  /** Canonical identities and compatibility diagnostics for named stack entries. */
  readonly styleReferences: readonly ResolvedStyleReference[]
  readonly digest: string
}

export interface ResolvedStyleReference {
  readonly input: string
  readonly canonicalId: string
  readonly diagnostic?: {
    readonly code: string
    readonly message: string
    readonly removal: { readonly release: string; readonly date: string }
  }
}

export interface ResolvedRenderRequest {
  readonly version: typeof RENDER_CONTRACT_VERSION
  readonly output: RenderOutput
  readonly source: Readonly<NormalizedMermaidSource>
  /** Normalized compatibility projection consumed by existing family code. */
  readonly renderOptions: Readonly<RenderOptions>
  readonly appearance: ResolvedAppearance
  /** Version/range decisions made at the request boundary. */
  readonly capabilityDecision: CapabilityDecision
  /** Authored public fields, retained so output projections diagnose only user intent. */
  readonly explicitOptionFields: readonly SharedRenderOptionField[]
  /** Output-agnostic digest used for transport-parity comparisons. */
  readonly sharedRequestDigest: string
  /** Full digest including output adapter and normalized output-only controls. */
  readonly requestDigest: string
}

export interface RenderRequestReceipt {
  version: typeof RENDER_CONTRACT_VERSION
  output: RenderOutput
  sharedRequestDigest: string
  requestDigest: string
  appearanceDigest: string
  /** Present on receipts emitted by this version; optional for host-supplied compatibility fixtures. */
  capabilityDecision?: CapabilityDecision
  /** Output-policy decisions made after request resolution. */
  diagnostics?: readonly RenderArtifactDiagnostic[]
  /** Digest of the secured graphical projection emitted by this execution. */
  graphicalProjectionDigest?: string
  /** Family/backend selected at execution, including trusted host policy. */
  executionDecision?: RenderExecutionDecision
}

export interface RenderExecutionDecision {
  readonly family: { readonly id: string; readonly version: string }
  readonly backend:
    | { readonly mode: 'scene'; readonly requestedId: string; readonly selectedId: string; readonly version: string; readonly hostPolicy: boolean }
    | { readonly mode: 'family-svg' }
  readonly digest: string
}

/** Trusted, non-serializable inputs used while freezing an execution plan. */
export interface RenderExecutionResolutionOptions {
  readonly backendPolicy?: HostBackendPolicy
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
  readonly capabilityDecision: CapabilityDecision
  readonly executionDecision?: RenderExecutionDecision
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

export function receiptOf(
  request: ResolvedRenderRequest,
  diagnostics: readonly RenderArtifactDiagnostic[] = [],
): RenderRequestReceipt {
  const executionDecision = EXECUTION_PLAN_BY_REQUEST.get(request)?.executionDecision
  return Object.freeze({
    version: request.version,
    output: request.output,
    sharedRequestDigest: request.sharedRequestDigest,
    requestDigest: request.requestDigest,
    appearanceDigest: request.appearance.digest,
    capabilityDecision: request.capabilityDecision,
    diagnostics: Object.freeze(diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))),
    ...(executionDecision ? { executionDecision } : {}),
  })
}

interface RenderOptionsWithResolution extends RenderOptions {
  [RESOLVED_APPEARANCE]?: ResolvedAppearance
}

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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Stable, browser-safe FNV-1a-64 receipt (not a security primitive). */
export function renderContractDigest(value: unknown): string {
  const text = canonicalJson(value)
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

/**
 * Clone and deeply freeze one request snapshot. Shared references are allowed;
 * cycles are not, because receipts must have a finite canonical form.
 */
function immutableSnapshot<T>(value: T, path = '$', ancestors = new Set<object>()): T {
  if (value === null || typeof value !== 'object') return value
  if (ancestors.has(value)) throw new TypeError(`render request contains a cycle at ${path}`)
  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError(`render request contains a non-JSON object at ${path}`)
  }
  ancestors.add(value)
  const clone: unknown = Array.isArray(value)
    ? value.map((item, index) => immutableSnapshot(item, `${path}[${index}]`, ancestors))
    : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) =>
        [key, immutableSnapshot(child, `${path}.${key}`, ancestors)]))
  ancestors.delete(value)
  return Object.freeze(clone) as T
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
      ...(resolution.diagnostic ? { diagnostic: resolution.diagnostic } : {}),
    }]
  }))
}

const EXECUTION_CAPABILITY_VERSION = '1.0.0'

function executionOffer(id: CapabilityId, available: boolean, version = EXECUTION_CAPABILITY_VERSION): CapabilityOffer[] {
  return available ? [{ id, version }] : []
}

function executionRequirement(id: CapabilityId, range = `^${EXECUTION_CAPABILITY_VERSION}`): CapabilityRequirement {
  return { id, range, level: 'required' }
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

function resolveExecutionPlan(
  source: NormalizedMermaidSource,
  appearance: ResolvedAppearance,
  output: RenderOutput,
  resolutionOptions: RenderExecutionResolutionOptions,
): InternalRenderExecutionPlan {
  // Capture the family before invoking host policy. A policy callback may
  // mutate registries, but this request continues with the descriptor that
  // supplied the capability offer negotiated below.
  const familyId = requireRegisteredMermaidFamily(
    source.lines[0] ?? source.firstLine,
    source.originalText,
  )
  const family = getFamily(familyId)
  if (!family) throw new Error(`Registered Mermaid family "${familyId}" has no immutable descriptor`)

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

  const offers: CapabilityOffer[] = [
    { id: family.identity.id, version: family.identity.version },
    ...executionOffer('operation:layout', family.layout !== undefined),
    ...executionOffer('operation:project-positioned', family.projectPositioned !== undefined),
    ...executionOffer('operation:lower-scene', family.lowerScene !== undefined),
    ...executionOffer('operation:render-svg', family.renderSvg !== undefined),
    ...executionOffer('operation:render-terminal', family.renderAscii !== undefined),
    ...executionOffer('core:scene', mode === 'scene'),
    ...executionOffer('backend:scene-renderer', backend !== undefined, backend?.identity.version),
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
      )
      outputAvailable = Boolean(family.layout && family.lowerScene && backend)
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

  const capabilityDecision = negotiateRenderCapabilityTuple(output, {
    offers,
    requirements,
    outputAvailable,
  })
  if (!capabilityDecision.accepted) {
    throw executionCapabilityError(output, family, appearance, mode, backend, capabilityDecision)
  }

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
    }
    executionDecision = Object.freeze({
      ...decisionBody,
      digest: renderContractDigest(decisionBody),
    })
  }

  return Object.freeze({
    output,
    mode,
    family,
    ...(backend ? { backend } : {}),
    ...(requestedBackendId ? { requestedBackendId } : {}),
    capabilityDecision,
    ...(executionDecision ? { executionDecision } : {}),
  })
}

function isSharedCapabilityResolution(resolution: CapabilityResolution): boolean {
  return !resolution.id.startsWith('output:')
    && !resolution.id.startsWith('operation:')
    && !resolution.id.startsWith('backend:')
    && resolution.id !== 'core:scene'
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
  // Keep StyleInput's established public error boundary. The shared options
  // schema still validates the field below (and every host surface uses that
  // validator), but resolving it first means an invalid inline StyleSpec is
  // reported as `Invalid style spec` instead of being relabelled as a generic
  // RenderOptions failure. It also avoids resolving mutable registry state
  // twice while constructing one canonical request.
  const style = resolveStyleStack(options.style)
  const serializableOptionsCandidate = Object.fromEntries(
    Object.entries(options).filter(([field, value]) =>
      value !== undefined
      && !(NON_SERIALIZABLE_RENDER_OPTION_FIELDS as readonly string[]).includes(field)),
  )
  const optionProblems = validateSerializableRenderOptions(serializableOptionsCandidate)
  if (optionProblems.length > 0) {
    throw new TypeError(`Invalid RenderOptions: ${optionProblems.join('; ')}`)
  }

  // Markdown/HTML parsers commonly hand renderers entity-encoded Mermaid.
  // Decode at the shared request waist so SVG, PNG, layout and terminal
  // transports agree on semantic text; retain authored bytes separately.
  const decodedText = decodeXML(text)
  const normalizedSource = normalizeMermaidSourceWithOverrides(decodedText, options.mermaidConfig ?? {})
  // Parsing consumes decoded semantic text, while provenance retains the
  // exact authored boundary bytes. Equivalent encodings may render alike but
  // must not collapse to the same request identity.
  const source: NormalizedMermaidSource = Object.freeze({ ...normalizedSource, originalText: text })
  const themeCssProblem = validateRawThemeCss(source.config.themeCSS, options.security ?? 'default')
  if (themeCssProblem) throw new TypeError(themeCssProblem)
  const explicitOptionFields = Object.freeze(SHARED_RENDER_OPTION_FIELDS.filter(field => options[field] !== undefined))
  let effective: RenderOptions = options.security === 'strict'
    ? { ...options, embedFontImport: false }
    : { ...options }

  const styled = style !== undefined && isStyledSpec(style)
  if (styled) effective = applyStyleDefaults(effective, style, source.config.themeVariables)

  const font = options.font
    ?? source.config.fontFamily
    ?? readThemeValue(source.config.themeVariables, 'fontFamily')
    ?? effective.font
    ?? 'Inter'
  // ResolvedAppearance is output-independent. Terminal-specific degradation
  // belongs to projectTerminalStyle and must never change the shared digest.
  const colors = immutableSnapshot({ ...resolveDiagramColors(effective, source.config, font) })
  const face = immutableSnapshot(styleFaceOf(options.style))
  const styleReferences = namedStyleReferences(options.style)
  const appearanceReceipt = {
    version: RENDER_CONTRACT_VERSION,
    colors,
    font,
    style: immutableSnapshot(style),
    face,
    styled,
    inferredBackend: style ? inferBackend(style) : 'default',
    styleReferences,
  }
  const appearance: ResolvedAppearance = immutableSnapshot({
    ...appearanceReceipt,
    digest: renderContractDigest(appearanceReceipt),
  })

  const renderOptions: RenderOptionsWithResolution = immutableSnapshot({
    ...effective,
    font,
    mermaidConfig: immutableSnapshot(source.config),
  })
  // immutableSnapshot has frozen the data. Rebuild only the shallow shell so
  // the non-enumerable resolved-appearance bridge can be installed before the
  // final freeze without exposing mutable nested values.
  const bridgedRenderOptions: RenderOptionsWithResolution = { ...renderOptions }
  Object.defineProperty(bridgedRenderOptions, RESOLVED_APPEARANCE, {
    value: appearance,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  Object.freeze(bridgedRenderOptions)

  const executionPlan = resolveExecutionPlan(source, appearance, output, resolutionOptions)
  const capabilityDecision = executionPlan.capabilityDecision

  // The shared receipt deliberately excludes the output-specific resolution:
  // callers use its digest to prove that SVG, PNG, terminal and layout
  // transports received the same source and appearance request. The full
  // request receipt below restores the exact output negotiation decision.
  const sharedCapabilityDecision: CapabilityDecision = Object.freeze({
    version: capabilityDecision.version,
    accepted: capabilityDecision.resolutions
      .filter(isSharedCapabilityResolution)
      .every(resolution => resolution.level !== 'required' || resolution.status === 'selected'),
    resolutions: Object.freeze(capabilityDecision.resolutions
      .filter(isSharedCapabilityResolution)),
  })
  const sharedRequestReceipt = {
    version: RENDER_CONTRACT_VERSION,
    authoredSource: source.originalText,
    source: source.text,
    options: serializableOptions(bridgedRenderOptions),
    appearance: appearance.digest,
    capabilities: sharedCapabilityDecision,
  }
  const sharedRequestDigest = renderContractDigest(sharedRequestReceipt)
  const requestReceipt = {
    ...sharedRequestReceipt,
    output,
    outputOptions,
    capabilities: capabilityDecision,
  }
  const request: ResolvedRenderRequest = Object.freeze({
    version: RENDER_CONTRACT_VERSION,
    output,
    source: immutableSnapshot(source),
    renderOptions: bridgedRenderOptions,
    appearance,
    capabilityDecision,
    explicitOptionFields,
    sharedRequestDigest,
    requestDigest: renderContractDigest(requestReceipt),
  })
  EXECUTION_PLAN_BY_REQUEST.set(request, executionPlan)
  return request
}

/** Internal bridge for family modules while RenderOptions remains public. */
export function resolvedAppearanceOf(options: RenderOptions): ResolvedAppearance | undefined {
  return (options as RenderOptionsWithResolution)[RESOLVED_APPEARANCE]
}

/** Family style resolution must consume the boundary result, never re-merge raw input. */
export function resolvedStyleFaceOf(options: RenderOptions): InternalStyleFace | undefined {
  return resolvedAppearanceOf(options)?.face
}
