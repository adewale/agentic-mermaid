// ============================================================================
// Agentic Mermaid — public API (published as agentic-mermaid)
//
// Renders Mermaid diagrams to styled SVG strings.
// Framework-agnostic, no DOM required. Pure TypeScript.
//
// Supported families are projected from the FamilyDescriptor registry. Do not
// duplicate that inventory here; see knownFamilyDescriptors()/capabilities.
//
// Theming uses CSS custom properties (--bg, --fg, + optional enrichment).
// See src/theme.ts for the full variable system.
//
// Usage:
//   import { renderMermaidSVG } from 'agentic-mermaid'
//   const svg = renderMermaidSVG('graph TD\n  A --> B')
// ============================================================================

export type { RenderOptions, RenderContext, ConfigDiagnostic, MermaidGraph, PositionedDiagram, PositionedGraph, RouteCertificate, EdgeRouteCertificate, FamilyEdgeRouteCertificate, RegionContainmentCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from './types.ts'
export type { DiagramColors, ThemeName, ResolvedColors } from './theme.ts'
export { fromShikiTheme, THEMES, DEFAULTS, resolveColors, inlineResolvedColors } from './theme.ts'
export { resolveDiagramColors } from './color-resolver.ts'
export { parseMermaid } from './parser.ts'
export { parseRegisteredMermaid } from './agent/parse.ts'
export type { ParsedDiagram, ExtensionValidDiagram, ExtensionDiagramBody } from './agent/types.ts'
export { renderMermaidASCII, renderMermaidASCIIWithReceipt, renderMermaidAscii, AsciiWidthError } from './ascii/index.ts'
export type { AsciiRenderOptions, AsciiWidthErrorReason, RenderedAscii } from './ascii/index.ts'
export { TERMINAL_STYLE_VERSION } from './terminal-style.ts'
export type {
  ResolvedTerminalStyle, TerminalProjectionDiagnostic, TerminalProjectionDiagnosticCode,
  TerminalConnectorProjection, TerminalConnectorProjectionReceipt, TerminalProjectionSecurityContext,
} from './terminal-style.ts'
export {
  TERMINAL_OUTPUT_POLICY_VERSION, TERMINAL_DEFAULT_PADDING_X, TERMINAL_BOUNDED_PADDING_X,
  TERMINAL_DEFAULT_PADDING_Y, TERMINAL_DEFAULT_BOX_BORDER_PADDING,
  TerminalOutputPolicyError, resolveTerminalOutputPolicy,
} from './terminal-contract.ts'
export type {
  AsciiRenderColorMode, TerminalOutputPolicyInput, ResolvedTerminalOutputPolicy,
} from './terminal-contract.ts'
export type {
  MermaidRuntimeConfig, MermaidThemeVariables, TimelineRuntimeConfig,
  JourneyRuntimeConfig, StateRuntimeConfig, XyChartRuntimeConfig,
  PieRuntimeConfig, QuadrantRuntimeConfig, MindmapRuntimeConfig, GitGraphRuntimeConfig,
} from './mermaid-source.ts'
export { parseArchitectureDiagram, architectureToMermaidGraph } from './architecture/parser.ts'
export { parseMindmap, serializeMindmap, MindmapDuplicateIdError, MindmapParseError } from './mindmap/parser.ts'
export type { MindmapDiagram, MindmapNode, MindmapShape, PositionedMindmapDiagram } from './mindmap/types.ts'
export { parseGitGraph, serializeGitGraph, GitGraphDuplicateCommitError, GitGraphParseError } from './gitgraph/parser.ts'
export type { GitGraphDiagram, GitGraphCommit, GitGraphBranch, GitGraphCommitType, PositionedGitGraphDiagram } from './gitgraph/types.ts'
export { resolveArchitectureIcon, architectureIconManifest, ARCHITECTURE_ICON_LIMITS } from './architecture/icons.ts'
export type { ResolvedArchitectureIcon } from './architecture/icons.ts'
export { TEXT_MEASUREMENT_CONTRACT, measureText, measureTextWidth } from './text-metrics.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from './text-metrics.ts'
export { MermaidFamilyDetectionError, classifyMermaidFamilyFromFirstLine } from './family-detection.ts'
export type { MermaidFamilyClassification, FamilyDetectionDiagnostic } from './family-detection.ts'

import { compactSvg, namespaceSvgIds } from './renderer.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { inlineResolvedColors } from './theme.ts'
import './render-family-hooks.ts'
import { positionResolvedFamily } from './positioning.ts'
import {
  receiptOf,
  renderContractDigest,
  resolveRenderRequest,
  resolveRenderRequestForExecution,
  resolvedRenderExecutionPlanOf,
  type RenderExecutionDecision,
  type RenderRequestReceipt,
  type ResolvedRenderRequest,
} from './render-contract.ts'
import { explicitFamilyConfigDiagnostics } from './shared/family-config-diagnostics.ts'
import type { HostBackendPolicy } from './scene/backend.ts'
import { applyOutputSecurityPolicy } from './output-security.ts'
import type { OutputSecurityDiagnostic } from './output-security.ts'
import './scene/rough-backend.ts'
import './scene/hybrid-backend.ts'

export {
  registerStyle, getStyle, knownStyles, knownStyleDescriptors, resolveStyleReference,
  validateStyleSpec, resolveStyleStack, inferBackend, TUFTE_STYLE_ALIAS, STYLE_SPEC_FORMAT_VERSION,
  STYLE_SPEC_FIELD_DESCRIPTORS, STYLE_COLOR_TOKEN_DESCRIPTORS, styleSpecJsonSchema,
} from './scene/style-registry.ts'
export type {
  StyleSpec, StyleColors, StyleInput, StyleDescriptor, StyleReferenceResolution,
  StyleRegistrationOptions, StyleRegistryKind,
} from './scene/style-registry.ts'
export {
  renderContractDigest, validateSerializableRenderOptions, RenderCapabilityError,
  sharedRenderOptionsJsonSchema, styleInputJsonSchema, SHARED_RENDER_OPTION_FIELDS, RENDER_CONTRACT_VERSION,
  RENDER_OUTPUTS, RENDER_OUTPUT_DESCRIPTORS,
} from './render-contract.ts'
export {
  CAPABILITY_NEGOTIATION_VERSION, CORE_CAPABILITY_OFFERS,
  negotiateCapabilities, negotiateRenderCapabilities, parseSemVer, semVerSatisfies,
} from './capability-negotiation.ts'
export type {
  CapabilityId, CapabilityOffer, CapabilityRequirement, CapabilityRequirementLevel,
  CapabilityResolution, CapabilityDecision,
} from './capability-negotiation.ts'
export type {
  RenderOutput, RenderOutputDescriptor, RenderOutputTransports, LibraryRenderTransport,
  CliRenderTransport, CodeModeRenderTransport, RenderRequestReceipt,
} from './render-contract.ts'
export { registerBackend, getBackend, knownBackendDescriptors, DefaultBackend } from './scene/backend.ts'
export type {
  StyleBackend, StyleBackendContext, BackendDescriptor, BackendRegistrationOptions,
  HostBackendPolicy, HostBackendSelection,
} from './scene/backend.ts'
export {
  BACKEND_CONFORMANCE_VERSION, BACKEND_CONFORMANCE_FIXTURE_ID,
  BACKEND_CONFORMANCE_CHECK_IDS, runBackendConformance,
} from './scene/backend-conformance.ts'
export type {
  BackendConformanceCheckId, BackendConformanceCheck, BackendConformanceReport,
} from './scene/backend-conformance.ts'
export { SCENE_CONTRACT_VERSION } from './scene/ir.ts'
export type {
  SceneDoc, SceneNode, SceneNodeBase, SemanticChannels, SceneRole, Geometry, MarkPaint,
  ShapeMark, TextMark, GroupMark, RawMark, DocumentMark, PreludeMark, ConnectorMark,
  ConnectorGeometry, ConnectorDirection, ConnectorEndpointAnchor, ConnectorEndpoints,
  ConnectorRelationship, ConnectorRoute, ConnectorDash, ConnectorStroke,
  ConnectorLabelDescriptor, ConnectorHitGeometry, ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss, ConnectorTerminalMarkerProjection, ConnectorTerminalLabelProjection,
  MarkerDescriptor, MarkerRef, MarkerShape, ScenePoint, SceneBox,
} from './scene/ir.ts'
export { connectorHitDistance, hitTestConnector, hitTestSceneConnectors } from './scene/hit-test.ts'
export type { SceneConnectorHit } from './scene/hit-test.ts'
export {
  assertRenderableMarker, serializeMarkerResource, serializeMarkerResources,
} from './scene/marker-resources.ts'
export type { RenderableMarkerDescriptor, MarkerSerializationOptions } from './scene/marker-resources.ts'
export {
  BUILTIN_SCENE_ROLE_TRAITS, SCENE_ROLE_DESCRIPTORS, resolveSceneRoleTraits, sceneRoleTraits,
} from './scene/roles.ts'
export type {
  CoreSceneRole, BuiltinSceneRole, NamespacedSceneRole, SceneRoleTraits,
  ResolvedSceneRoleTraits, SceneRoleDescriptor, SceneMarkKind, SceneSketchPolicy,
} from './scene/roles.ts'
export {
  CORE_SCENE_PRIMITIVES, CORE_SCENE_OPERATIONS, CORE_SCENE_FEATURES,
  PRIMITIVE_REALIZATIONS, validatePrimitiveCapabilities,
} from './scene/capabilities.ts'
export type {
  CoreScenePrimitive, ScenePrimitive, CoreSceneOperation, SceneOperation,
  CoreSceneFeature, SceneFeature, PrimitiveRealization, PrimitiveCapabilityClaim,
  CapabilityValidationResult,
} from './scene/capabilities.ts'
export {
  canonicalExtensionId, parseExtensionId, createExtensionIdentity,
  registerCompatibilityAlias, registerExtension, ExtensionCollisionError,
} from './shared/extension-identity.ts'
export {
  HOSTED_FONT_RESOURCES, HOSTED_FONT_FACES, HOSTED_FONT_FILES,
  RESOURCE_MANIFEST, hostedFontResource, validateResourceManifest,
} from './font-manifest.ts'
export { RESOURCE_MANIFEST_VERSION, snapshotResourceManifest, verifyResourceBytes } from './resource-manifest.ts'
export type {
  HostedFontResource, HostedFontFace, ResourceManifest, ResourceManifestEntry, ResourceLicense,
} from './font-manifest.ts'
export type {
  ExtensionIdentity, ExtensionCompatibility, ExtensionProvenance, ExtensionRegistration,
  CompatibilityAlias, CompatibilityAliasDiagnostic, CompatibilityRemoval,
} from './shared/extension-identity.ts'
export type { SvgSemanticIdentity } from './scene/identity.ts'
export type { SvgSemanticAccessibility, SvgRelationSemantics } from './scene/accessibility.ts'
export { applyOutputSecurityPolicy, verifyNoExternalRefs, verifySvgDocumentEnvelope, OUTPUT_SECURITY_POLICY_VERSION } from './output-security.ts'
export type { OutputSecurityMode, OutputSecurityDiagnostic, OutputSecurityResult } from './output-security.ts'
export { OUTPUT_COLOR_PROFILE, applyPngColorProfile, inspectPngColorProfile } from './output-color-profile.ts'
export type { PngColorProfileReceipt } from './output-color-profile.ts'
export {
  PNG_OUTPUT_POLICY_VERSION, PNG_DEFAULT_SCALE, PNG_DEFAULT_FONT_FAMILY,
  PNG_FONT_SOURCES, PNG_NAPI_RUNTIME, PNG_WASM_RUNTIME,
  pngNapiRuntimeProvenance, resolvePngOutputPolicy,
} from './png-contract.ts'
export type {
  PngFitTo, PngOutputPolicyInput, ResolvedPngOutputPolicy,
  PngFontSource, PngRuntimeProvenance,
} from './png-contract.ts'
export { renderMermaidPNGInBrowserWithReceipt, BROWSER_CANVAS_RUNTIME } from './browser-png.ts'
export type {
  BrowserPngDiagnostic, BrowserPngRasterContext, BrowserPngRasterResult,
  BrowserPngRasterizer, RenderedBrowserPng, BrowserPngFontSource,
  BrowserPngRuntimeProvenance,
} from './browser-png.ts'
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * #7254/#7255: inject `<title>`/`<desc>` + `role="img"` + `aria-labelledby`/
 * `aria-describedby` into the root <svg>. Localized post-pass (mirrors
 * namespaceSvgIds) so we don't thread accessibility through every family
 * renderer. Renderers that do thread it (sequence, class, er, timeline,
 * journey, xychart, architecture) already carry the aria wiring on the root,
 * which is how this pass knows to leave their output alone. The title/desc
 * ids carry the same idPrefix as the rest of the doc to stay collision-free.
 */
function injectAccessibility(svg: string, acc: { title?: string; descr?: string }, idPrefix: string): string {
  const titleId = `${idPrefix}svg-title`
  const descId = `${idPrefix}svg-desc`
  const rootAttrs: string[] = []
  const children: string[] = []
  if (acc.title) { rootAttrs.push(`aria-labelledby="${titleId}"`); children.push(`<title id="${titleId}">${escapeXmlText(acc.title)}</title>`) }
  if (acc.descr) { rootAttrs.push(`aria-describedby="${descId}"`); children.push(`<desc id="${descId}">${escapeXmlText(acc.descr)}</desc>`) }
  if (children.length === 0) return svg
  // Add role + aria references to the opening <svg …> tag (once).
  svg = svg.replace(/<svg\b([^>]*)>/, (full, attrs: string) => {
    // The family renderer already wired accessibility on the root; injecting
    // again would duplicate <title>/<desc> and root attributes (a duplicated
    // attribute is not even well-formed XML).
    if (/\baria-(?:labelledby|describedby)=/.test(attrs)) return full
    const add = `${/\brole=/.test(attrs) ? '' : ' role="img"'} ${rootAttrs.join(' ')}`
    return `<svg${attrs}${add}>${children.join('')}`
  })
  return svg
}

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
export function renderMermaidSVG(
  text: string,
  options: RenderOptions = {}
): string {
  return renderMermaidSVGWithReceipt(text, options).svg
}

export interface RenderedSvg {
  svg: string
  receipt: RenderRequestReceipt
}

/**
 * Trusted host-only renderer construction options. These values are never
 * copied into RenderOptions, receipts, CLI/MCP payloads, or editor state.
 */
export interface MermaidRendererHostOptions {
  readonly backendPolicy?: HostBackendPolicy
}

/** A renderer bound to trusted in-process host policy. */
export interface MermaidRenderer {
  renderMermaidSVG(text: string, options?: RenderOptions): string
  renderMermaidSVGWithReceipt(text: string, options?: RenderOptions): RenderedSvg
}

/**
 * Construct a trusted in-process renderer. A custom backend is selectable only
 * through this host object; serializable appearance data still describes the
 * requested look and cannot name or smuggle executable backend machinery.
 */
export function createMermaidRenderer(hostOptions: MermaidRendererHostOptions = {}): MermaidRenderer {
  const host = Object.freeze({ ...hostOptions })
  return Object.freeze({
    renderMermaidSVG(text: string, options: RenderOptions = {}): string {
      return renderGraphicalSvgWithReceiptForHost(text, options, 'svg', undefined, host).svg
    },
    renderMermaidSVGWithReceipt(text: string, options: RenderOptions = {}): RenderedSvg {
      return renderGraphicalSvgWithReceiptForHost(text, options, 'svg', undefined, host)
    },
  })
}

export function renderMermaidSVGWithReceipt(
  text: string,
  options: RenderOptions = {},
): RenderedSvg {
  return renderGraphicalSvgWithReceipt(text, options, 'svg')
}

/** Internal/publicly inspectable graphical waist used by PNG before rasterization. */
export function renderGraphicalSvgWithReceipt(
  text: string,
  options: RenderOptions,
  output: 'svg' | 'png',
  outputOptions?: unknown,
): RenderedSvg {
  return renderGraphicalSvgWithReceiptForHost(text, options, output, outputOptions, {})
}

function renderGraphicalSvgWithReceiptForHost(
  text: string,
  options: RenderOptions,
  output: 'svg' | 'png',
  outputOptions: unknown,
  hostOptions: MermaidRendererHostOptions,
): RenderedSvg {
  const request = resolveRenderRequestForExecution(text, options, output, outputOptions, {
    backendPolicy: hostOptions.backendPolicy,
  })
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if (options.mermaidConfig) {
    const report = options.onConfigDiagnostic ?? ((diagnostic) => console.warn(diagnostic.message))
    for (const diagnostic of explicitFamilyConfigDiagnostics(executionPlan.family.id, options.mermaidConfig)) report(diagnostic)
  }
  const securityDiagnostics: OutputSecurityDiagnostic[] = []
  const rendered = renderResolvedMermaidSVG(request, securityDiagnostics)
  const baseReceipt = receiptOf(request, securityDiagnostics)
  return {
    svg: rendered.svg,
    receipt: Object.freeze({
      ...baseReceipt,
      graphicalProjectionDigest: renderContractDigest(rendered.svg),
      executionDecision: rendered.executionDecision,
    }),
  }
}

interface ResolvedGraphicalExecution {
  readonly svg: string
  readonly executionDecision: RenderExecutionDecision
}

function renderResolvedMermaidSVG(
  request: ResolvedRenderRequest,
  securityDiagnostics: OutputSecurityDiagnostic[],
): ResolvedGraphicalExecution {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if ((executionPlan.mode !== 'scene' && executionPlan.mode !== 'family-svg') || !executionPlan.executionDecision) {
    throw new Error(`Resolved ${request.output} request has no graphical execution plan`)
  }
  const normalizedSource = request.source
  const effectiveOptions = request.renderOptions as RenderOptions
  const mergedStyle = request.appearance.style
  const styled = request.appearance.styled
  const appearanceColors = request.appearance.colors as DiagramColors
  // PNG cannot consume a remote CSS @import. Treat that as an output
  // projection, not a rewrite of the caller's shared request/appearance
  // receipt, so SVG and PNG remain comparable under default options.
  const colors = request.output === 'png' && appearanceColors.embedFontImport !== false
    ? { ...appearanceColors, embedFontImport: false }
    : appearanceColors
  const family = executionPlan.family
  const diagramType = family.id
  const renderOptions = effectiveOptions
  const renderContext = <TPositioned extends PositionedDiagram>(
    positioned: TPositioned,
    c: DiagramColors = colors,
    opts: RenderOptions = renderOptions,
  ): RenderContext<TPositioned> => ({ positioned, colors: c, options: opts })
  // resolve() inlines CSS variables for non-browser renderers (resvg).
  // When `compact` is on we additionally round coords and collapse whitespace.
  const compact = effectiveOptions.compact ?? false
  const idPrefix = effectiveOptions.idPrefix ?? ''
  const finalizeSvg = (svg: string) => {
    const secured = applyOutputSecurityPolicy(svg, effectiveOptions.security)
    securityDiagnostics.push(...secured.diagnostics)
    return secured.svg
  }
  // #7254/#7255: the universal source envelope owns accessibility parsing.
  // Legacy family renderers receive it through this localized SVG post-pass.
  const acc = normalizedSource.accessibility
  const resolve = (svg: string, c: DiagramColors = colors, injectAcc = true) => {
    let out = inlineResolvedColors(svg, c)
    // #7540: namespace def ids so multiple diagrams on one page don't collide.
    if (idPrefix) out = namespaceSvgIds(out, idPrefix)
    // #7254/#7255: inject <title>/<desc>/role="img"/aria-labelledby for
    // renderers that do not carry accessibility through their family-specific
    // parser. Xychart does, so it opts out below to avoid duplicate ARIA attrs.
    if (injectAcc && (acc.title || acc.descr)) out = injectAccessibility(out, acc, idPrefix)
    out = finalizeSvg(out)
    return compact ? compactSvg(out) : out
  }

  const layout = positionResolvedFamily(diagramType, request)
  const renderColors = layout.colors ?? colors
  const ctx = renderContext(layout.positioned, renderColors, layout.options ?? renderOptions)
  let rawSvg: string
  if (executionPlan.mode === 'scene') {
    // SceneGraph is the normal graphical waist, including crisp rendering.
    // A descriptor that can lower a scene needs no parallel renderSvg hook;
    // styled requests merely select a different serializer for the same scene.
    const backend = executionPlan.backend!.backend
    rawSvg = backend.render(family.lowerScene!(ctx), {
      seed: effectiveOptions.seed ?? 0,
      ...(styled ? { style: mergedStyle } : {}),
    })
  } else {
    rawSvg = family.renderSvg!(ctx)
  }
  return Object.freeze({
    svg: resolve(rawSvg, renderColors, layout.injectAccessibility ?? true),
    executionDecision: executionPlan.executionDecision,
  })
}

/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
export async function renderMermaidSVGAsync(
  text: string,
  options: RenderOptions = {}
): Promise<string> {
  return renderMermaidSVG(text, options)
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use `renderMermaidSVG` */
export const renderMermaidSync = renderMermaidSVG

/** @deprecated Use `renderMermaidSVGAsync` */
export const renderMermaid = renderMermaidSVGAsync
