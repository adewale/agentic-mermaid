import { RENDER_OUTPUTS, type RenderOutput } from './render-outputs.ts'
import { PNG_OUTPUT_POLICY_VERSION, TERMINAL_OUTPUT_POLICY_VERSION } from './output-policy-versions.ts'

export const RENDER_CONTRACT_VERSION = 2 as const
const RENDER_CONTRACT_EVIDENCE = `render-contract@${RENDER_CONTRACT_VERSION}`

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
      /** Canonical public CLI spelling. */
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

// Browser renderers do not consume transport discovery. Pure factories keep its
// metadata and CLI default validation in bundles that use those public exports.
function outputDescriptorsById() {
  return {
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
      evidence: ['output-security@2', RENDER_CONTRACT_EVIDENCE],
    },
    png: {
      availability: 'public', security: 'enforced', color: 'srgb', terminal: 'not-applicable',
      transports: {
        library: {
          availability: 'direct',
          entrypoint: 'renderMermaidPNG / createMermaidBrowserPNGRenderer',
          selector: 'native Node/Bun or injected browser rasterizer',
          evidence: ['src/agent/png.ts', 'src/browser-png.ts', 'src/index.ts'],
        },
        cli: { availability: 'direct', entrypoint: 'am render', selector: '--format png', evidence: ['src/cli/index.ts'], format: 'png', order: 3, help: 'PNG bytes; requires --output <file.png>; no watch/multi-input' },
        codeMode: { availability: 'unavailable', entrypoint: 'none', reason: 'PNG rasterization is a host tool, not a sandbox SDK method', evidence: ['src/mcp/sdk-decl.ts', 'src/mcp/facade.ts'] },
        localMcp: { availability: 'direct', entrypoint: 'render_png', evidence: ['src/mcp/server.ts'] },
        hostedMcp: { availability: 'direct', entrypoint: 'render_png', evidence: ['src/mcp/hosted-server.ts'] },
        editor: { availability: 'direct', entrypoint: 'Save PNG / Copy PNG', selector: 'renderMermaidPNGInBrowserWithReceipt', evidence: ['editor/js/export.js', 'src/browser-png.ts'] },
        website: { availability: 'unavailable', entrypoint: 'none', reason: 'The site build copies curated PNG assets but exposes no PNG render adapter', evidence: ['website/build.ts'] },
      },
      evidence: ['output-security@2', 'output-color-profile@1', `png-output-policy@${PNG_OUTPUT_POLICY_VERSION}`, RENDER_CONTRACT_EVIDENCE],
    },
    ascii: {
      availability: 'public', security: 'enforced', color: 'terminal-projected', terminal: 'projected',
      transports: {
        library: { availability: 'direct', entrypoint: 'renderMermaidASCII', selector: 'useAscii: true', evidence: ['src/ascii/index.ts'] },
        cli: { availability: 'direct', entrypoint: 'am render', selector: '--format ascii', evidence: ['src/cli/index.ts'], format: 'ascii', order: 1, help: '7-bit ASCII art' },
        codeMode: { availability: 'direct', entrypoint: 'mermaid.renderMermaidASCIIWithReceipt', selector: 'useAscii: true', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'renderMermaidASCIIWithReceipt', optionsType: 'AsciiRenderOptions', returnType: 'RenderedAscii' },
        localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.renderMermaidASCIIWithReceipt({ useAscii: true })', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
        hostedMcp: { availability: 'direct', entrypoint: 'render_ascii', selector: 'useAscii: true', evidence: ['src/mcp/hosted-server.ts'] },
        editor: { availability: 'direct', entrypoint: 'ASCII canvas tab', selector: 'renderMermaidASCII({ useAscii: true })', evidence: ['editor/js/rendering.js', 'editor/html/right-panel.html'] },
        website: { availability: 'unavailable', entrypoint: 'none', reason: 'The site build emits one Unicode diagram asset but no 7-bit ASCII output', evidence: ['website/build.ts'] },
      },
      evidence: ['terminal-style@1', `terminal-output-policy@${TERMINAL_OUTPUT_POLICY_VERSION}`, 'terminal-control-sanitization', RENDER_CONTRACT_EVIDENCE],
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
      evidence: ['terminal-style@1', `terminal-output-policy@${TERMINAL_OUTPUT_POLICY_VERSION}`, 'terminal-control-sanitization', RENDER_CONTRACT_EVIDENCE],
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
      evidence: ['terminal-style@1', `terminal-output-policy@${TERMINAL_OUTPUT_POLICY_VERSION}`, 'terminal-control-sanitization', 'html-text-escaping', RENDER_CONTRACT_EVIDENCE],
    },
    layout: {
      availability: 'public', security: 'not-applicable', color: 'not-applicable', terminal: 'not-applicable',
      transports: {
        library: { availability: 'direct', entrypoint: 'layoutMermaid', evidence: ['src/agent/core.ts'] },
        cli: { availability: 'direct', entrypoint: 'am render', selector: '--format layout', evidence: ['src/cli/index.ts'], format: 'layout', order: 4, help: 'Layout JSON (nodes, edges, groups, bounds)' },
        codeMode: { availability: 'direct', entrypoint: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts'], method: 'layoutMermaidWithReceipt', optionsType: 'LayoutRenderOptions', returnType: 'RenderedLayoutArtifact' },
        localMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/server.ts', 'src/mcp/facade.ts'] },
        hostedMcp: { availability: 'indirect', entrypoint: 'execute', selector: 'mermaid.layoutMermaidWithReceipt', evidence: ['src/mcp/hosted-server.ts', 'src/mcp/facade.ts'] },
        editor: { availability: 'indirect', entrypoint: 'verification panel', selector: 'verifyMermaid(source).layout (consumed, not exported)', evidence: ['editor/js/rendering.js'] },
        website: { availability: 'unavailable', entrypoint: 'none', reason: 'Website verification consumes layout internally but publishes no layout artifact', evidence: ['website/build.ts'] },
      },
      evidence: ['positioned-artifact@1', RENDER_CONTRACT_EVIDENCE],
    },
  } as const satisfies Record<RenderOutput, Omit<RenderOutputDescriptor, 'id'>>
}

const OUTPUT_DESCRIPTOR_BY_ID = /* @__PURE__ */ outputDescriptorsById()

function freezeTransport<T extends RenderTransportClaim>(transport: T): T {
  return Object.freeze({
    ...transport,
    evidence: Object.freeze([...transport.evidence]),
  }) as T
}

export const RENDER_TRANSPORT_SURFACES = Object.freeze([
  'library', 'cli', 'codeMode', 'localMcp', 'hostedMcp', 'editor', 'website',
] as const satisfies readonly (keyof RenderOutputTransports)[])

export type RenderTransportSurface = typeof RENDER_TRANSPORT_SURFACES[number]

/** Output capability authority in the same deterministic order as RENDER_OUTPUTS. */
function createRenderOutputDescriptors() {
  return Object.freeze(
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
}

export const RENDER_OUTPUT_DESCRIPTORS: readonly RenderOutputDescriptor[] = /* @__PURE__ */ createRenderOutputDescriptors()

type DirectCliOutputDescriptor = RenderOutputDescriptor & {
  readonly transports: RenderOutputTransports & { readonly cli: Extract<CliRenderTransport, { availability: 'direct' }> }
}

/** CLI discovery projection. HTML is intentionally absent. */
function createCliRenderOutputDescriptors() {
  return Object.freeze(
    RENDER_OUTPUT_DESCRIPTORS
      .filter((descriptor): descriptor is DirectCliOutputDescriptor => descriptor.transports.cli.availability === 'direct')
      .sort((left, right) => left.transports.cli.order - right.transports.cli.order),
  )
}

export const CLI_RENDER_OUTPUT_DESCRIPTORS: readonly DirectCliOutputDescriptor[] = /* @__PURE__ */ createCliRenderOutputDescriptors()

type RawOutputDescriptor = typeof OUTPUT_DESCRIPTOR_BY_ID[RenderOutput]
export type CliRenderFormat = Extract<RawOutputDescriptor['transports']['cli'], { availability: 'direct' }>['format']

/** Canonical CLI spellings, generated from the output descriptors. */
function cliRenderFormats() {
  return Object.freeze(
    CLI_RENDER_OUTPUT_DESCRIPTORS.map(descriptor => descriptor.transports.cli.format as CliRenderFormat),
  )
}

export const CLI_RENDER_FORMATS: readonly CliRenderFormat[] = /* @__PURE__ */ cliRenderFormats()

function defaultCliRenderFormat(): CliRenderFormat {
  const defaults = CLI_RENDER_OUTPUT_DESCRIPTORS.filter(descriptor => descriptor.transports.cli.default)
  if (defaults.length !== 1) throw new Error('Render output contract must declare exactly one default CLI format')
  return defaults[0]!.transports.cli.format as CliRenderFormat
}

export const DEFAULT_CLI_RENDER_FORMAT = /* @__PURE__ */ defaultCliRenderFormat()

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
