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

export type { RenderOptions, RenderContext, ConfigDiagnostic, MermaidGraph, PositionedDiagram, PositionedGraph, RouteCertificate, EdgeRouteCertificate, FamilyEdgeRouteCertificate, RegionContainmentCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from './types.ts'
export type { ArchitectureVisualOverrides } from './architecture/config.ts'
export type { DiagramColors, ResolvedColors } from './theme.ts'
export { fromShikiTheme, DEFAULTS, resolveColors, inlineResolvedColors } from './theme.ts'
export { resolveDiagramColors } from './color-resolver.ts'
export { parseRegisteredMermaid } from './agent/parse.ts'
export type {
  ParsedDiagram,
  ExtensionValidDiagram,
  ExtensionDiagramBody,
  PreservedValidDiagram,
  PreservedDiagramBody,
  PreservedSourceSpans,
  SourceSpan,
  SourceSpanPoint,
} from './agent/types.ts'
export { renderMermaidASCII, renderMermaidASCIIWithReceipt, AsciiWidthError } from './ascii/index.ts'
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
  PieRuntimeConfig, QuadrantRuntimeConfig, MindmapRuntimeConfig, GitGraphRuntimeConfig, RadarRuntimeConfig,
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

import type { RenderOptions } from './types.ts'
import type { ParsedDiagram } from './agent/types.ts'
import { prepareRenderInput } from './agent/render-input.ts'
import {
  type RenderRequestReceipt,
} from './render-contract.ts'
import { snapshotHostBackendPolicy, type HostBackendPolicy } from './scene/backend.ts'
import { executeGraphicalRequest } from './graphical-render.ts'

export {
  registerStyle, getStyle, knownStyles, knownStyleDescriptors, resolveStyleReference,
  validateStyleSpec, resolveStyleStack, inferBackend, STYLE_SPEC_FORMAT_VERSION,
  STYLE_SPEC_FIELD_DESCRIPTORS, STYLE_COLOR_TOKEN_DESCRIPTORS, ROLE_STYLE_PROPERTY_DESCRIPTORS,
  EXACT_ROLE_STYLE_CONTRACT, EXACT_STYLE_SCENE_ROLES, BINDABLE_SCENE_ROLES, BINDABLE_ROLE_STYLE_PROPERTIES,
  BRAND_CONSTRAINT_DESCRIPTORS, BRAND_CONSTRAINT_KINDS, SEMANTIC_BINDING_CHANNELS, styleSpecJsonSchema,
} from './scene/style-registry.ts'
export type {
  StyleSpec, StyleColors, BindableSceneRole, ExactStyleSceneRole, RoleStyleFor, RoleStyleSpec, RoleStyles, SemanticSlots, SemanticBinding,
  SemanticBindingChannel, BrandConstraint, BrandConstraintAction, BrandConstraintKind, StyleInput, StyleDescriptor,
  StyleReferenceResolution, StyleRegistrationOptions, StyleRegistryKind,
} from './scene/style-registry.ts'
export {
  renderContractDigest, validateSerializableRenderOptions, RenderCapabilityError, ParsedDiagramFamilyMismatchError,
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
  BackendCapabilityConformanceStatus, BackendCapabilityConformanceResult,
} from './scene/backend-conformance.ts'
export { SCENE_CONTRACT_VERSION } from './scene/ir.ts'
export type {
  SceneDoc, SceneNode, SceneNodeBase, SemanticChannels, SceneRole, Geometry, MarkPaint,
  ShapeMark, TextMark, GroupMark, DocumentMark, ConnectorMark,
  ConnectorGeometry, ConnectorSubpath, ConnectorDirection, ConnectorEndpointAnchor, ConnectorEndpoints,
  ConnectorRelationship, ConnectorRoute, ConnectorContourSemantics, ConnectorDash, ConnectorStroke,
  ConnectorLabelDescriptor, ConnectorHitGeometry, ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss, ConnectorTerminalMarkerProjection, ConnectorTerminalMarkerPlacement, ConnectorTerminalLabelProjection,
  MarkerDescriptor, MarkerShape, ScenePoint, SceneBox,
} from './scene/ir.ts'
export {
  EXTERNAL_SCENE_API_VERSION, buildExternalScene,
} from './scene/external-scene.ts'
export type {
  ExternalSceneGeometry, ExternalSceneConnectorGeometry, ExternalSceneNodeBase, ExternalSceneShape, ExternalSceneDataMark,
  ExternalSceneText, ExternalSceneContainer, ExternalSceneConnector, ExternalSceneConnectorLabel, ExternalSceneNode,
  ExternalSceneMarker, ExternalSceneDocument, ExternalSceneInput,
} from './scene/external-scene.ts'
export {
  SCENE_VALIDATION_VERSION, SCENE_VALIDATION_LIMITS, validateSceneDoc, assertValidSceneDoc, SceneValidationError,
} from './scene/scene-validation.ts'
export type {
  SceneValidationDiagnosticCode, SceneValidationDiagnostic, SceneValidationResult,
  SceneValidationOptions,
} from './scene/scene-validation.ts'
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
  ESSENTIAL_SCENE_PRIMITIVE_OPERATIONS, ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES, PRIMITIVE_REALIZATIONS,
  essentialScenePrimitiveOperation, terminalConnectorCapabilityClaims, validatePrimitiveCapabilities,
} from './scene/capabilities.ts'
export type {
  CoreScenePrimitive, ScenePrimitive, CoreSceneOperation, SceneOperation,
  CoreSceneFeature, SceneFeature, PrimitiveRealization, PrimitiveCapabilityClaim,
  CapabilityValidationResult, EssentialScenePrimitiveOperation, EssentialScenePrimitiveCapability,
} from './scene/capabilities.ts'
export {
  KNOWN_EXTENSION_CONTRACT_VERSIONS, canonicalExtensionId, parseExtensionId,
  createExtensionIdentity, evaluateExtensionCompatibility,
  registerExtension, ExtensionCollisionError,
} from './shared/extension-identity.ts'
export {
  HOSTED_FONT_RESOURCES,
  RESOURCE_MANIFEST, hostedFontResource, validateResourceManifest,
} from './font-manifest.ts'
export { RESOURCE_MANIFEST_VERSION, snapshotResourceManifest, verifyResourceBytes } from './resource-manifest.ts'
export type {
  HostedFontResource, HostedFontFace, ResourceManifest, ResourceManifestEntry, ResourceLicense,
} from './font-manifest.ts'
export type {
  ExtensionIdentity, ExtensionCompatibility, ExtensionProvenance, ExtensionRegistration,
  ExtensionCompatibilityDecision, ExtensionCompatibilityResolution,
} from './shared/extension-identity.ts'
export type { SvgSemanticIdentity } from './scene/identity.ts'
export type { SvgSemanticAccessibility, SvgRelationSemantics } from './scene/accessibility.ts'
export { applyOutputSecurityPolicy, verifyNoExternalRefs, verifySvgDocumentEnvelope, OUTPUT_SECURITY_POLICY_VERSION } from './output-security.ts'
export type { OutputSecurityMode, OutputSecurityDiagnostic, OutputSecurityResult } from './output-security.ts'
export { OUTPUT_COLOR_PROFILE, applyPngColorProfile, inspectPngColorProfile, inspectPngDimensions } from './output-color-profile.ts'
export type { PngColorProfileReceipt, PngDimensions } from './output-color-profile.ts'
export {
  PNG_OUTPUT_POLICY_VERSION, PNG_DEFAULT_SCALE, PNG_DEFAULT_FONT_FAMILY,
  PNG_FONT_SOURCES, PNG_NAPI_RUNTIME, PNG_WASM_RUNTIME,
  MAX_PNG_PIXELS, MAX_PNG_RASTER_DIMENSION, MAX_HOSTED_PNG_PIXELS, MAX_HOSTED_PNG_BYTES,
  MAX_PNG_FONT_DIRECTORIES, MAX_PNG_FONT_DIRECTORY_LENGTH,
  pngRasterDimensions, assertPngRasterBudget, assertHostedPngRasterBudget,
  svgIntrinsicDimensions, prepareSvgForPngRasterization,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS, PNG_OUTPUT_OPTION_FIELDS,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS, NATIVE_PNG_OUTPUT_POLICY_FIELDS,
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS, pngOutputOptionsJsonSchema,
  normalizePortablePngBackground, projectPortablePngOutputOptions,
  projectNativePngOutputPolicyInput, omitPngOutputOptions,
  pngNapiRuntimeProvenance, resolvePngOutputPolicy, resolvePortablePngOutputPolicy,
} from './png-contract.ts'
export type {
  PngFitTo, PngOutputPolicyInput, PortablePngOutputOptions, ResolvedPngOutputPolicy,
  PngOutputOptionFieldDescriptor, PngOutputOptionField, PortablePngOutputOptionField,
  NativePngOutputPolicyField, NativePngHostOnlyOptionField,
  PngOutputOptionScope, PngOutputOptionInputKind, PngOutputOptionPolicyState,
  PngOutputOptionReceiptState, PngFontSource, PngRuntimeProvenance,
  PngRasterDimensions,
} from './png-contract.ts'
export {
  createMermaidBrowserPNGRenderer,
  renderMermaidPNGInBrowserWithReceipt,
  BROWSER_CANVAS_RUNTIME,
} from './browser-png.ts'
export type {
  BrowserPngDiagnostic, BrowserPngRasterContext, BrowserPngRasterResult,
  BrowserPngRasterizer, RenderedBrowserPng, BrowserPngFontSource,
  BrowserPngRuntimeProvenance, MermaidBrowserPNGRenderer,
  MermaidBrowserPNGRendererHostOptions,
} from './browser-png.ts'
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
  text: ParsedDiagram | string,
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

export function renderMermaidSVGWithReceipt(
  text: ParsedDiagram | string,
  options: RenderOptions = {},
): RenderedSvg {
  const input = prepareRenderInput(text)
  return executeGraphicalRequest(input.source, options, 'svg', undefined, { expectedFamilyId: input.expectedFamilyId })
}

/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
export async function renderMermaidSVGAsync(
  text: ParsedDiagram | string,
  options: RenderOptions = {}
): Promise<string> {
  return renderMermaidSVG(text, options)
}
