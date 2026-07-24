// ============================================================================
// Agentic Mermaid — public API (published as agentic-mermaid)
//
// Renders Mermaid diagrams to styled SVG strings.
// Framework-agnostic, no DOM required. Pure TypeScript.
//
// Supported families come from the registry. Do not duplicate that inventory
// here; see knownFamilyDescriptors()/capabilities.
//
// Theming uses CSS custom properties (--bg, --fg, + optional enrichment).
// See src/theme.ts for the full variable system.
//
// Usage:
//   import { renderMermaidSVG } from 'agentic-mermaid'
//   const svg = renderMermaidSVG('graph TD\n  A --> B')
// ============================================================================

export { parseRegisteredMermaid } from './agent/parse.ts'
export type {
  ExtensionDiagramBody,
  ExtensionValidDiagram,
  ParsedDiagram,
  PreservedDiagramBody,
  PreservedSourceSpans,
  PreservedValidDiagram,
  SourceSpan,
  SourceSpanPoint,
} from './agent/types.ts'
export type { ArchitectureVisualOverrides } from './architecture/config.ts'
export type { ResolvedArchitectureIcon } from './architecture/icons.ts'
export { ARCHITECTURE_ICON_LIMITS, architectureIconManifest, resolveArchitectureIcon } from './architecture/icons.ts'
export { architectureToMermaidGraph, parseArchitectureDiagram } from './architecture/parser.ts'
export type { AsciiRenderOptions, AsciiWidthErrorReason, RenderedAscii } from './ascii/index.ts'
export { AsciiWidthError, renderMermaidASCII, renderMermaidASCIIWithReceipt } from './ascii/index.ts'
export { resolveDiagramColors } from './color-resolver.ts'
export type { FamilyDetectionDiagnostic, MermaidFamilyClassification } from './family-detection.ts'
export { classifyMermaidFamilyFromFirstLine, MermaidFamilyDetectionError } from './family-detection.ts'
export { GitGraphDuplicateCommitError, GitGraphParseError, parseGitGraph, serializeGitGraph } from './gitgraph/parser.ts'
export type { GitGraphBranch, GitGraphCommit, GitGraphCommitType, GitGraphDiagram, PositionedGitGraphDiagram } from './gitgraph/types.ts'
export type { GitGraphRuntimeConfig, JourneyRuntimeConfig, MermaidRuntimeConfig, MermaidThemeVariables, MindmapRuntimeConfig, PieRuntimeConfig, QuadrantRuntimeConfig, RadarRuntimeConfig, SankeyRuntimeConfig, StateRuntimeConfig, TimelineRuntimeConfig, XyChartRuntimeConfig } from './mermaid-source.ts'
export { MindmapDuplicateIdError, MindmapParseError, parseMindmap, serializeMindmap } from './mindmap/parser.ts'
export type { MindmapDiagram, MindmapNode, MindmapShape, PositionedMindmapDiagram } from './mindmap/types.ts'
export type {
  AsciiRenderColorMode,
  ResolvedTerminalOutputPolicy,
  TerminalOutputPolicyInput,
} from './terminal-contract.ts'
export { resolveTerminalOutputPolicy, TERMINAL_BOUNDED_PADDING_X, TERMINAL_DEFAULT_BOX_BORDER_PADDING, TERMINAL_DEFAULT_PADDING_X, TERMINAL_DEFAULT_PADDING_Y, TERMINAL_OUTPUT_POLICY_VERSION, TerminalOutputPolicyError } from './terminal-contract.ts'
export type {
  ResolvedTerminalStyle,
  TerminalConnectorProjection,
  TerminalConnectorProjectionReceipt,
  TerminalProjectionDiagnostic,
  TerminalProjectionDiagnosticCode,
  TerminalProjectionSecurityContext,
} from './terminal-style.ts'
export { TERMINAL_STYLE_VERSION } from './terminal-style.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from './text-metrics.ts'
export { measureText, measureTextWidth, TEXT_MEASUREMENT_CONTRACT } from './text-metrics.ts'
export type { DiagramColors, ResolvedColors } from './theme.ts'
export { DEFAULTS, fromShikiTheme, inlineResolvedColors, resolveColors } from './theme.ts'
export type {
  AnyPort,
  ConfigDiagnostic,
  DiamondFacet,
  EdgeRouteCertificate,
  FamilyEdgeRouteCertificate,
  FamilyRouteCertificate,
  LayoutRouteCertificate,
  LayoutRouteClass,
  MermaidGraph,
  PortSemanticRole,
  PortSide,
  PositionedDiagram,
  PositionedGraph,
  RegionContainmentCertificate,
  RenderContext,
  RenderOptions,
  RouteBlocker,
  RouteCertificate,
  RouteClass,
  RoutePortAssignment,
} from './types.ts'

import { prepareRenderInput } from './agent/render-input.ts'
import type { ParsedDiagram } from './agent/types.ts'
import { executeGraphicalRequest } from './graphical-render.ts'
import { type RenderRequestReceipt } from './render-contract.ts'
import { type HostBackendPolicy, snapshotHostBackendPolicy } from './scene/backend.ts'
import type { RenderOptions } from './types.ts'

export type {
  BrowserPngDiagnostic,
  BrowserPngFontSource,
  BrowserPngRasterContext,
  BrowserPngRasterizer,
  BrowserPngRasterResult,
  BrowserPngRuntimeProvenance,
  MermaidBrowserPNGRenderer,
  MermaidBrowserPNGRendererHostOptions,
  RenderedBrowserPng,
} from './browser-png.ts'
export {
  BROWSER_CANVAS_RUNTIME,
  createMermaidBrowserPNGRenderer,
  renderMermaidPNGInBrowserWithReceipt,
} from './browser-png.ts'
export type { CapabilityDecision, CapabilityId, CapabilityOffer, CapabilityRequirement, CapabilityRequirementLevel, CapabilityResolution } from './capability-negotiation.ts'
export {
  CAPABILITY_NEGOTIATION_VERSION,
  CORE_CAPABILITY_OFFERS,
  negotiateCapabilities,
  negotiateRenderCapabilities,
  parseSemVer,
  semVerSatisfies,
} from './capability-negotiation.ts'
export type { HostedFontFace, HostedFontResource, ResourceLicense, ResourceManifest, ResourceManifestEntry } from './font-manifest.ts'
export {
  HOSTED_FONT_RESOURCES,
  hostedFontResource,
  RESOURCE_MANIFEST,
  validateResourceManifest,
} from './font-manifest.ts'
export type { PngColorProfileReceipt, PngDimensions } from './output-color-profile.ts'
export { applyPngColorProfile, inspectPngColorProfile, inspectPngDimensions, OUTPUT_COLOR_PROFILE } from './output-color-profile.ts'
export type { OutputSecurityDiagnostic, OutputSecurityMode, OutputSecurityResult } from './output-security.ts'
export { applyOutputSecurityPolicy, OUTPUT_SECURITY_POLICY_VERSION, verifyNoExternalRefs, verifySvgDocumentEnvelope } from './output-security.ts'
export type {
  NativePngHostOnlyOptionField,
  NativePngOutputPolicyField,
  PngFitTo,
  PngFontSource,
  PngOutputOptionField,
  PngOutputOptionFieldDescriptor,
  PngOutputOptionInputKind,
  PngOutputOptionPolicyState,
  PngOutputOptionReceiptState,
  PngOutputOptionScope,
  PngOutputPolicyInput,
  PngRasterDimensions,
  PngRuntimeProvenance,
  PortablePngOutputOptionField,
  PortablePngOutputOptions,
  ResolvedPngOutputPolicy,
} from './png-contract.ts'
export {
  assertHostedPngRasterBudget,
  assertPngRasterBudget,
  MAX_HOSTED_PNG_BYTES,
  MAX_HOSTED_PNG_PIXELS,
  MAX_PNG_FONT_DIRECTORIES,
  MAX_PNG_FONT_DIRECTORY_LENGTH,
  MAX_PNG_PIXELS,
  MAX_PNG_RASTER_DIMENSION,
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS,
  NATIVE_PNG_OUTPUT_POLICY_FIELDS,
  normalizePortablePngBackground,
  omitPngOutputOptions,
  PNG_DEFAULT_FONT_FAMILY,
  PNG_DEFAULT_SCALE,
  PNG_FONT_SOURCES,
  PNG_NAPI_RUNTIME,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS,
  PNG_OUTPUT_OPTION_FIELDS,
  PNG_OUTPUT_POLICY_VERSION,
  PNG_WASM_RUNTIME,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS,
  pngNapiRuntimeProvenance,
  pngOutputOptionsJsonSchema,
  pngRasterDimensions,
  prepareSvgForPngRasterization,
  projectNativePngOutputPolicyInput,
  projectPortablePngOutputOptions,
  resolvePngOutputPolicy,
  resolvePortablePngOutputPolicy,
  svgIntrinsicDimensions,
} from './png-contract.ts'
export type {
  CliRenderTransport,
  CodeModeRenderTransport,
  LibraryRenderTransport,
  RenderOutput,
  RenderOutputDescriptor,
  RenderOutputTransports,
  RenderRequestReceipt,
} from './render-contract.ts'
export { ParsedDiagramFamilyMismatchError, RENDER_CONTRACT_VERSION, RENDER_OUTPUT_DESCRIPTORS, RENDER_OUTPUTS, RenderCapabilityError, renderContractDigest, SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, styleInputJsonSchema, validateSerializableRenderOptions } from './render-contract.ts'
export { RESOURCE_MANIFEST_VERSION, snapshotResourceManifest, verifyResourceBytes } from './resource-manifest.ts'
export type { SvgRelationSemantics, SvgSemanticAccessibility } from './scene/accessibility.ts'
export type { BackendDescriptor, BackendRegistrationOptions, HostBackendPolicy, HostBackendSelection, StyleBackend, StyleBackendContext } from './scene/backend.ts'
export { DefaultBackend, getBackend, knownBackendDescriptors, registerBackend } from './scene/backend.ts'
export type { BackendCapabilityConformanceResult, BackendCapabilityConformanceStatus, BackendConformanceCheck, BackendConformanceCheckId, BackendConformanceReport } from './scene/backend-conformance.ts'
export {
  BACKEND_CONFORMANCE_CHECK_IDS,
  BACKEND_CONFORMANCE_FIXTURE_ID,
  BACKEND_CONFORMANCE_VERSION,
  runBackendConformance,
} from './scene/backend-conformance.ts'
export type {
  CapabilityValidationResult,
  CoreSceneFeature,
  CoreSceneOperation,
  CoreScenePrimitive,
  EssentialScenePrimitiveCapability,
  EssentialScenePrimitiveOperation,
  PrimitiveCapabilityClaim,
  PrimitiveRealization,
  SceneFeature,
  SceneOperation,
  ScenePrimitive,
} from './scene/capabilities.ts'
export { CORE_SCENE_FEATURES, CORE_SCENE_OPERATIONS, CORE_SCENE_PRIMITIVES, ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES, ESSENTIAL_SCENE_PRIMITIVE_OPERATIONS, essentialScenePrimitiveOperation, PRIMITIVE_REALIZATIONS, terminalConnectorCapabilityClaims, validatePrimitiveCapabilities } from './scene/capabilities.ts'
export type {
  ExternalSceneConnector,
  ExternalSceneConnectorGeometry,
  ExternalSceneConnectorLabel,
  ExternalSceneContainer,
  ExternalSceneDataMark,
  ExternalSceneDocument,
  ExternalSceneGeometry,
  ExternalSceneInput,
  ExternalSceneMarker,
  ExternalSceneNode,
  ExternalSceneNodeBase,
  ExternalSceneShape,
  ExternalSceneText,
} from './scene/external-scene.ts'
export { buildExternalScene, EXTERNAL_SCENE_API_VERSION } from './scene/external-scene.ts'
export type { SceneConnectorHit } from './scene/hit-test.ts'
export { connectorHitDistance, hitTestConnector, hitTestSceneConnectors } from './scene/hit-test.ts'
export type { SvgSemanticIdentity } from './scene/identity.ts'
export type {
  ConnectorContourSemantics,
  ConnectorDash,
  ConnectorDirection,
  ConnectorEndpointAnchor,
  ConnectorEndpoints,
  ConnectorGeometry,
  ConnectorHitGeometry,
  ConnectorLabelDescriptor,
  ConnectorMark,
  ConnectorRelationship,
  ConnectorRoute,
  ConnectorStroke,
  ConnectorSubpath,
  ConnectorTerminalLabelProjection,
  ConnectorTerminalMarkerPlacement,
  ConnectorTerminalMarkerProjection,
  ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss,
  DocumentMark,
  Geometry,
  GroupMark,
  MarkerDescriptor,
  MarkerShape,
  MarkPaint,
  SceneBox,
  SceneDoc,
  SceneNode,
  SceneNodeBase,
  ScenePoint,
  SceneRole,
  SemanticChannels,
  ShapeMark,
  TextMark,
} from './scene/ir.ts'
export { SCENE_CONTRACT_VERSION } from './scene/ir.ts'
export type { MarkerSerializationOptions, RenderableMarkerDescriptor } from './scene/marker-resources.ts'
export {
  assertRenderableMarker,
  serializeMarkerResource,
  serializeMarkerResources,
} from './scene/marker-resources.ts'
export type { BuiltinSceneRole, CoreSceneRole, NamespacedSceneRole, ResolvedSceneRoleTraits, SceneMarkKind, SceneRoleDescriptor, SceneRoleTraits, SceneSketchPolicy } from './scene/roles.ts'
export {
  BUILTIN_SCENE_ROLE_TRAITS,
  resolveSceneRoleTraits,
  SCENE_ROLE_DESCRIPTORS,
  sceneRoleTraits,
} from './scene/roles.ts'
export type { SceneValidationDiagnostic, SceneValidationDiagnosticCode, SceneValidationOptions, SceneValidationResult } from './scene/scene-validation.ts'
export { assertValidSceneDoc, SCENE_VALIDATION_LIMITS, SCENE_VALIDATION_VERSION, SceneValidationError, validateSceneDoc } from './scene/scene-validation.ts'
export type {
  BindableSceneRole,
  BrandConstraint,
  BrandConstraintAction,
  BrandConstraintKind,
  ExactStyleSceneRole,
  RoleStyleFor,
  RoleStyleSpec,
  RoleStyles,
  SemanticBinding,
  SemanticBindingChannel,
  SemanticSlots,
  StyleColors,
  StyleDescriptor,
  StyleInput,
  StyleReferenceResolution,
  StyleRegistrationOptions,
  StyleRegistryKind,
  StyleSpec,
} from './scene/style-registry.ts'
export {
  BINDABLE_ROLE_STYLE_PROPERTIES,
  BINDABLE_SCENE_ROLES,
  BRAND_CONSTRAINT_DESCRIPTORS,
  BRAND_CONSTRAINT_KINDS,
  EXACT_ROLE_STYLE_CONTRACT,
  EXACT_STYLE_SCENE_ROLES,
  getStyle,
  inferBackend,
  knownStyleDescriptors,
  knownStyles,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  registerStyle,
  resolveStyleReference,
  resolveStyleStack,
  SEMANTIC_BINDING_CHANNELS,
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  STYLE_SPEC_FORMAT_VERSION,
  styleSpecJsonSchema,
  validateStyleSpec,
} from './scene/style-registry.ts'
export type { ExtensionCompatibility, ExtensionCompatibilityDecision, ExtensionCompatibilityResolution, ExtensionIdentity, ExtensionProvenance, ExtensionRegistration } from './shared/extension-identity.ts'
export { canonicalExtensionId, createExtensionIdentity, ExtensionCollisionError, evaluateExtensionCompatibility, KNOWN_EXTENSION_CONTRACT_VERSIONS, parseExtensionId, registerExtension } from './shared/extension-identity.ts'
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
export function renderMermaidSVG(text: ParsedDiagram | string, options: RenderOptions = {}): string {
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
  renderMermaidSVG(text: ParsedDiagram | string, options?: RenderOptions): string
  renderMermaidSVGWithReceipt(text: ParsedDiagram | string, options?: RenderOptions): RenderedSvg
}

/**
 * Construct a trusted in-process renderer. A custom backend is selectable only
 * through this host object; serializable appearance data still describes the
 * requested look and cannot name or smuggle executable backend machinery.
 */
export function createMermaidRenderer(hostOptions: MermaidRendererHostOptions = {}): MermaidRenderer {
  const backendPolicy = snapshotHostBackendPolicy(hostOptions.backendPolicy)
  const host = Object.freeze({ ...(backendPolicy ? { backendPolicy } : {}) })
  return Object.freeze({
    renderMermaidSVG(text: ParsedDiagram | string, options: RenderOptions = {}): string {
      const input = prepareRenderInput(text)
      return executeGraphicalRequest(input.source, options, 'svg', undefined, { ...host, expectedFamilyId: input.expectedFamilyId }).svg
    },
    renderMermaidSVGWithReceipt(text: ParsedDiagram | string, options: RenderOptions = {}): RenderedSvg {
      const input = prepareRenderInput(text)
      return executeGraphicalRequest(input.source, options, 'svg', undefined, { ...host, expectedFamilyId: input.expectedFamilyId })
    },
  })
}

export function renderMermaidSVGWithReceipt(text: ParsedDiagram | string, options: RenderOptions = {}): RenderedSvg {
  const input = prepareRenderInput(text)
  return executeGraphicalRequest(input.source, options, 'svg', undefined, { expectedFamilyId: input.expectedFamilyId })
}

/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
export async function renderMermaidSVGAsync(text: ParsedDiagram | string, options: RenderOptions = {}): Promise<string> {
  return renderMermaidSVG(text, options)
}
