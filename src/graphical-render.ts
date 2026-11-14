// Internal resolved-request + positioned-artifact graphical execution.
//
// This module is intentionally absent from every public package barrel. It is
// the private seam that lets the public renderer position once and lets
// verification prove renderability from the exact artifact it already
// inspected, without serializing, parsing, or laying out again.

import './scene/default-backend.ts'

import { isBuiltInBackend, isOriginalEnrolledDefaultBackend } from './scene/backend.ts'
import { isOwnedFamily } from './experimental/owned-family.ts'
import { compactSvg, formatSvgNumbers, namespaceSvgIds } from './svg-postprocess.ts'
import { fitUncalibratedSvgText } from './custom-font-geometry.ts'
import type { FamilyLayoutResult } from './agent/families.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { inlineResolvedColors } from './theme.ts'
import { positionFamilyForNativeRender } from './positioning.ts'
import {
  receiptOf,
  canonicalTextDigest,
  resolveRenderRequestForExecution,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  selectSourceSceneFallback,
  RenderConfigError,
  type RenderExecutionDecision,
  type RenderExecutionResolutionOptions,
  type RenderRequestReceipt,
  type ResolvedRenderRequest,
} from './render-contract.ts'
import { applyOutputSecurityPolicy, applyWrittenOutputSecurityPolicy } from './output-security.ts'
import type { OutputSecurityDiagnostic } from './output-security.ts'
import { decodedSvgAttributeValue, replaceSvgRootStartTag, scanSvgStartTags, svgAttribute, svgRootStartTag } from './svg-structure.ts'
import { scopeSvgStyles } from './svg-style-scope.ts'
import { emitResolvedConfigDiagnostics } from './render-config-diagnostics.ts'
import { finishedNativeDrawing, retainFinishedNativeDrawing } from './experimental/position-cache.ts'
import { retainedPositionedScene, actualPositionedSceneWriteEligible, retainedNativeDrawing, positionedPaintCertification, beginPositionedBackendEmission, finishPositionedBackendEmission } from './scene/positioned.ts'
import { PaintLayoutCertificationError, paintFailureIsDrawable, MAX_OCCLUSION_OPERATIONS, MAX_OCCLUSION_PAIRS, type PaintLayoutCertification, type PaintViewport } from './scene/paint-certification.ts'
import { assertFinalSvgByteBudget } from './scene/scene-validation-core.ts'
import type { SceneDoc, SceneNode } from './scene/ir.ts'
import { IMAGE_SCENE_PRIMITIVE_CAPABILITIES } from './scene/capabilities.ts'
import { sceneHasOnlyPreparedText } from './scene/serialization.ts'
import { withTextMeasurementExecution } from './text-measurement-profile.ts'
import { withSvgInspectionCache } from './svg-inspection-cache.ts'
import { measureRenderStage } from './render-stages.ts'
import { sanitizeDisplayLines, xmlCarriableText } from './shared/text-controls.ts'
import type { ScenePartCapture } from './scene/part-capture.ts'

export interface ResolvedGraphicalExecution {
  readonly svg: string
  readonly executionDecision: RenderExecutionDecision
  readonly layoutCertification?: PaintLayoutCertification
}

/** Private receipt-bearing artifact consumed by public SVG and PNG adapters. */
export interface GraphicalSvgArtifact {
  readonly svg: string
  readonly receipt: RenderRequestReceipt
}

/** Internal projections consume owned positioning, never public evidence. */
export interface GraphicalLayoutConsumer {
  validate(request: ResolvedRenderRequest): void
  consume(request: ResolvedRenderRequest, layout: FamilyLayoutResult): void
}

/** Internal receipt digest for a completed graphical output. SVG already has
 * its own byte budget; request-data snapshot limits do not constrain artifacts.
 * Primitive strings cannot change between admission and hashing. */
export function renderedSvgDigest(value: unknown): string {
  assertFinalSvgByteBudget(value, 'graphical projection digest input')
  return canonicalTextDigest(JSON.stringify(value))
}

function renderContextForPositionedFamily(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
): RenderContext<PositionedDiagram> {
  const appearanceColors = request.appearance.colors as DiagramColors
  // PNG cannot consume a remote CSS @import. This output-only projection does
  // not alter the shared request or appearance receipt.
  const colors = request.output === 'png' && appearanceColors.embedFontImport !== false
    ? { ...appearanceColors, embedFontImport: false }
    : appearanceColors
  return {
    positioned: layout.positioned,
    colors,
    resolved: resolvedFamilyRenderContextOf(request),
  }
}

/** Internal canonical Scene witness used by rendering and family registration
 * conformance. Keeping admission here prevents a second context/lowering path. */
export function lowerPositionedFamilyScene(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
): SceneDoc {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if (executionPlan.mode !== 'scene') throw new Error(`Resolved ${request.output} request has no Scene execution plan`)
  return retainedPositionedScene(request, layout)
}

/** Accessible names are display text: controls and code points no output can
 * carry become the inert characters labels draw. */
function escapeXmlText(value: string): string {
  return sanitizeDisplayLines(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectAccessibility(
  svg: string,
  accessibility: { title?: string; descr?: string },
  idPrefix: string,
  fallbackName?: string,
): string {
  if (!accessibility.title && !accessibility.descr && !fallbackName) return svg
  const root = svgRootStartTag(svg)
  if (!root) return svg
  if (svgAttribute(root, 'aria-labelledby') || svgAttribute(root, 'aria-describedby')) return svg
  const ids = new Set<string>()
  if (accessibility.title || accessibility.descr) for (const tag of scanSvgStartTags(svg)) {
    const id = decodedSvgAttributeValue(tag, 'id')
    if (id !== undefined) ids.add(id)
  }
  const allocate = (base: string): string => {
    let id = base, suffix = 0
    while (ids.has(id)) id = `${base}-${++suffix}`
    ids.add(id)
    return id
  }
  const titleId = accessibility.title ? allocate(`${idPrefix}svg-title`) : ''
  const descId = accessibility.descr ? allocate(`${idPrefix}svg-desc`) : ''
  const rootAttrs: string[] = []
  const children: string[] = []
  if (accessibility.title) {
    rootAttrs.push(`aria-labelledby="${titleId}"`)
    children.push(`<title id="${titleId}">${escapeXmlText(accessibility.title)}</title>`)
  }
  if (accessibility.descr) {
    rootAttrs.push(`aria-describedby="${descId}"`)
    children.push(`<desc id="${descId}">${escapeXmlText(accessibility.descr)}</desc>`)
  }
  if (fallbackName && !accessibility.title && !svgAttribute(root, 'aria-label')) rootAttrs.push(`aria-label="${escapeXmlText(fallbackName).replace(/"/g, '&quot;')}"`)
  const add = `${svgAttribute(root, 'role') ? '' : ' role="img"'} ${rootAttrs.join(' ')}`
  const open = svg.slice(root.start, root.end)
  return replaceSvgRootStartTag(svg, root, `${open.slice(0, -1)}${add}>${children.join('')}`)
}

function expandSvgViewport(svg: string, viewport: PaintViewport): string {
  const root = svgRootStartTag(svg)
  if (!root) throw new Error('Cannot certify a graphical output with no SVG root')
  const original = svg.slice(root.start, root.end)
  const rewritten = original.replace(/\sviewBox="[^"]*"/g, '')
  const attrs = ` viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}"`
  return replaceSvgRootStartTag(svg, root, rewritten.slice(0, -1) + attrs + '>')
}

/** The one render decision on a final paint proof. Strict layout safety needs
 * a passed proof. Report safety refuses a failed default-backend proof only
 * when paint may be clipped; other failures (covered text or markers, a
 * connector across a card, text past its region) render and verify reports
 * them (see `reportedPaintFailure`), as rough backends already rendered. */
export function paintCertificationRefuses(request: ResolvedRenderRequest, certification: PaintLayoutCertification): boolean {
  if (request.renderOptions.layoutSafety === 'strict') return certification.status !== 'passed'
  return certification.status === 'failed' && (resolvedRenderExecutionPlanOf(request).consumer?.kind === 'native-drawing' || resolvedRenderExecutionPlanOf(request).backend?.inputName === 'default') && !paintFailureIsDrawable(certification)
}

/** A failed default-backend paint proof report safety drew anyway. */
export function reportedPaintFailure(request: ResolvedRenderRequest, certification: PaintLayoutCertification | undefined): boolean {
  return certification !== undefined && request.renderOptions.layoutSafety !== 'strict' && certification.status === 'failed'
    && (resolvedRenderExecutionPlanOf(request).consumer?.kind === 'native-drawing' || resolvedRenderExecutionPlanOf(request).backend?.inputName === 'default') && paintFailureIsDrawable(certification)
}

/** Render an exact descriptor layout result; this function never positions. */
export function renderPositionedMermaidSVG(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
  securityDiagnostics: OutputSecurityDiagnostic[],
  capture?: ScenePartCapture,
): ResolvedGraphicalExecution {
  const rendered = renderPositionedConsumer(request, layout, securityDiagnostics, capture)
  if (!rendered) throw new Error('The source Native consumer requires asynchronous Scene acquisition')
  return rendered
}

function renderPositionedConsumer(request: ResolvedRenderRequest, layout: FamilyLayoutResult, securityDiagnostics: OutputSecurityDiagnostic[], capture?: ScenePartCapture): ResolvedGraphicalExecution | undefined {
  const plan = resolvedRenderExecutionPlanOf(request)
  return withTextMeasurementExecution(plan.textMeasurement, () =>
    renderPositionedWithTextMeasurement(request, layout, securityDiagnostics, capture), request.appearance.font)
}

// A previously closed request cannot lend its proof to a new actual write.
// Refuse before another proof attempt; no allowance or leaf facts are reset.
function unavailableActualBackendWrite(scene: SceneDoc): PaintLayoutCertification {
  return Object.freeze({ version: 1, unit: 'px', scope: 'native-scene', status: 'unverified',
    viewport: { x: 0, y: 0, width: scene.width, height: scene.height }, attempts: 1, repairs: [],
    coverage: { measured: 0, unmeasured: 0, preparedText: 0, fallbackText: 0, conditional: 0 },
    checks: { primitives: 0, labels: 0, occlusionPairs: 0, maxOcclusionPairs: MAX_OCCLUSION_PAIRS, operations: 8, maxOperations: MAX_OCCLUSION_OPERATIONS, markers: 0 },
    issues: [{ code: 'OUTPUT_SCOPE', message: 'This actual backend write has no open same-emission receipt' }], limitations: [],
  } as const)
}

function containsImage(part: SceneNode): boolean {
  return part.kind === 'image' || part.kind === 'group' && part.children.some(child => containsImage(child.node))
}

function renderPositionedWithTextMeasurement(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
  securityDiagnostics: OutputSecurityDiagnostic[],
  capture?: ScenePartCapture,
): ResolvedGraphicalExecution | undefined {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if ((executionPlan.mode !== 'scene' && executionPlan.mode !== 'family-svg') || !executionPlan.executionDecision) {
    throw new Error(`Resolved ${request.output} request has no graphical execution plan`)
  }
  const effectiveOptions = request.renderOptions as RenderOptions
  const family = executionPlan.family
  const context = renderContextForPositionedFamily(request, layout)
  let rawSvg: string
  let preparedText = false
  let layoutCertification: PaintLayoutCertification | undefined
  let drawing: ReturnType<typeof retainedNativeDrawing>
  if (executionPlan.mode === 'scene') {
    drawing = capture || executionPlan.consumer?.kind === 'scene-backend' ? undefined : measureRenderStage('drawing', () => retainedNativeDrawing(request, layout))
    if (!drawing && executionPlan.consumer?.kind === 'native-drawing') return undefined
    const actualWrite = !drawing && !capture && actualPositionedSceneWriteEligible(request)
    const scene = drawing ? undefined : measureRenderStage('scene', () => lowerPositionedFamilyScene(request, layout))
    layoutCertification = measureRenderStage('paint-certification', () => positionedPaintCertification(request, layout))
    if (paintCertificationRefuses(request, layoutCertification)) throw new PaintLayoutCertificationError(layoutCertification)
    let actualWriteBound = false
    rawSvg = drawing?.svg ?? measureRenderStage('backend', () => {
      const backendContext = {
        seed: effectiveOptions.seed ?? 0,
        ...(request.appearance.styled ? { style: request.appearance.style } : {}),
      }
      capture?.begin(backendContext, scene!)
      if (actualWrite) actualWriteBound = beginPositionedBackendEmission(request, layout, backendContext, layoutCertification!)
      let completed = false
      try {
        const selected = executionPlan.backend!.backend
        if (!IMAGE_SCENE_PRIMITIVE_CAPABILITIES.every(required => selected.capabilities.some(claim => claim.primitive === 'image'
          && claim.feature === required.feature && claim.operation === required.operation && claim.realization !== 'unsupported'))
          && scene!.parts.some(containsImage)) throw new RenderConfigError(`Backend "${selected.id}" does not support image delivery`)
        const svg = executionPlan.backend!.backend.render(scene!, backendContext)
        if (actualWriteBound) layoutCertification = finishPositionedBackendEmission(request, layout, { kind: 'complete', proof: layoutCertification! }) ?? unavailableActualBackendWrite(scene!)
        completed = true
        return svg
      } finally {
        if (actualWriteBound && !completed) finishPositionedBackendEmission(request, layout, { kind: 'abort' })
      }
    })
    if (actualWrite) {
      if (!actualWriteBound) layoutCertification = unavailableActualBackendWrite(scene!)
      if (paintCertificationRefuses(request, layoutCertification)) throw new PaintLayoutCertificationError(layoutCertification)
    }
    preparedText = (executionPlan.consumer?.kind === 'native-drawing' || executionPlan.backend?.inputName === 'default')
      && !family.id.startsWith('family:') && (drawing?.preparedText ?? sceneHasOnlyPreparedText(scene!))
  } else {
    if (effectiveOptions.layoutSafety === 'strict') throw new RenderConfigError('Strict layout safety requires native Scene evidence')
    rawSvg = measureRenderStage('backend', () => family.renderSvg!(context))
  }
  assertFinalSvgByteBudget(rawSvg, 'backend/family SVG output')

  // Typed identities and family data attributes keep authored text verbatim
  // through the Scene; the bytes we emit cannot hold what XML cannot carry,
  // so those characters are written as the inert ones display text draws.
  // Only core producers are repaired: a host backend or extension family that
  // emits such characters stays under the output-security refusal.
  const trustedProducer = !family.id.startsWith('family:')
    && (executionPlan.mode !== 'scene' || !executionPlan.backend || isBuiltInBackend(executionPlan.backend.backend))
  const idPrefix = effectiveOptions.idPrefix ?? ''
  const accessibility = request.source.accessibility
  const fallbackName = family.id === 'c4' ? 'C4 architecture diagram' : undefined
  const outputSecurity = request.output === 'png' ? 'strict' : effectiveOptions.security
  const securityPolicy = isOwnedFamily(family) && (executionPlan.consumer?.kind === 'native-drawing' || isOriginalEnrolledDefaultBackend(executionPlan.backend?.backend)) ? applyWrittenOutputSecurityPolicy : applyOutputSecurityPolicy
  // Everything below is a pure function of the backend bytes and these inputs.
  // A retained drawing keeps its finished output, so a repeat with the same
  // inputs skips finishing and the security gate its exact bytes passed.
  const finishingIdentity = drawing ? JSON.stringify([
    trustedProducer, context.colors,
    layoutCertification?.repairs.length && (executionPlan.consumer?.kind === 'native-drawing' || executionPlan.backend?.inputName === 'default') ? layoutCertification.viewport : null,
    preparedText ? null : request.appearance.font, idPrefix, accessibility.title ?? null, accessibility.descr ?? null, fallbackName ?? null,
    layout.injectAccessibility ?? true, effectiveOptions.compact ?? false, outputSecurity ?? null, securityPolicy === applyWrittenOutputSecurityPolicy,
  ]) : undefined
  const finished = drawing && finishingIdentity !== undefined ? finishedNativeDrawing(drawing, finishingIdentity) : undefined
  if (finished) {
    securityDiagnostics.push(...finished.diagnostics)
    return Object.freeze({
      svg: finished.svg,
      executionDecision: executionPlan.executionDecision,
      ...(layoutCertification ? { layoutCertification } : {}),
    })
  }
  let svg = inlineResolvedColors(trustedProducer ? xmlCarriableText(rawSvg) : rawSvg, context.colors)
  if (layoutCertification?.repairs.length && (executionPlan.consumer?.kind === 'native-drawing' || executionPlan.backend?.inputName === 'default')) svg = expandSvgViewport(svg, layoutCertification.viewport)
  assertFinalSvgByteBudget(svg, 'color-resolved SVG output')
  if (!preparedText) svg = fitUncalibratedSvgText(svg, request.appearance.font)
  assertFinalSvgByteBudget(svg, 'font-geometry-fitted SVG output')
  if (idPrefix) {
    svg = namespaceSvgIds(svg, idPrefix)
    assertFinalSvgByteBudget(svg, 'namespaced SVG output')
  }
  if ((layout.injectAccessibility ?? true) && (accessibility.title || accessibility.descr || fallbackName)) {
    svg = injectAccessibility(svg, accessibility, idPrefix, fallbackName)
    assertFinalSvgByteBudget(svg, 'accessibility-projected SVG output')
  }
  if (capture) svg = capture.finish(svg)
  // Scope identity belongs to the canonical written numbers, including late
  // viewport repairs, so equivalent drawing/Scene paths share identical CSS.
  svg = scopeSvgStyles(formatSvgNumbers(svg))
  assertFinalSvgByteBudget(svg, 'style-scoped SVG output')
  // Every byte-changing projection must run before the final output-security
  // gate. In particular, compaction must never be able to join an inert split
  // attribute (for example `on\n load`) into executable active content after
  // validation.
  if (effectiveOptions.compact) {
    svg = compactSvg(svg)
    assertFinalSvgByteBudget(svg, 'compacted SVG output')
  }
  // Raster outputs are offline artifacts in every caller mode. This is an
  // output-only projection: the shared request receipt retains authored
  // security intent, while no native/WASM/browser rasterizer can receive a
  // fetching reference from a conditional host backend.
  const secured = measureRenderStage('svg-security', () => securityPolicy(svg, outputSecurity))
  securityDiagnostics.push(...secured.diagnostics)
  svg = secured.svg
  assertFinalSvgByteBudget(svg, 'final SVG output')
  if (drawing && finishingIdentity !== undefined) {
    retainFinishedNativeDrawing(drawing, { identity: finishingIdentity, svg, diagnostics: Object.freeze(secured.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))) })
  }
  return Object.freeze({
    svg,
    executionDecision: executionPlan.executionDecision,
    ...(layoutCertification ? { layoutCertification } : {}),
  })
}

/** Public-renderer adapter: position once, then consume that exact result. */
export function renderResolvedMermaidSVG(
  request: ResolvedRenderRequest,
  securityDiagnostics: OutputSecurityDiagnostic[],
  consumeLayout?: GraphicalLayoutConsumer,
): ResolvedGraphicalExecution {
  const layout = measureRenderStage('layout', () => positionFamilyForNativeRender(request))
  consumeLayout?.consume(request, layout)
  return renderPositionedMermaidSVG(request, layout, securityDiagnostics)
}

/**
 * The only raw-source graphical request/receipt executor. It stays private to
 * package internals so PNG adapters can share the secured SVG path without
 * turning executable host policy into a public low-level waist.
 */
export function executeGraphicalRequest(
  text: string,
  options: RenderOptions,
  output: 'svg' | 'png',
  outputOptions?: unknown,
  resolutionOptions: RenderExecutionResolutionOptions = {},
  consumeLayout?: GraphicalLayoutConsumer,
): GraphicalSvgArtifact {
  return withSvgInspectionCache(() => executeInspectedGraphicalRequest(text, options, output, outputOptions, resolutionOptions, consumeLayout))
}

function executeInspectedGraphicalRequest(
  text: string,
  options: RenderOptions,
  output: 'svg' | 'png',
  outputOptions: unknown,
  resolutionOptions: RenderExecutionResolutionOptions,
  consumeLayout?: GraphicalLayoutConsumer,
): GraphicalSvgArtifact {
  const request = measureRenderStage('request', () => resolveRenderRequestForExecution(
    text,
    options,
    output,
    outputOptions,
    resolutionOptions,
  ))
  return consumeResolvedGraphicalRequest(request, consumeLayout)
}

/** Async entries retain one immutable request across dependency loading.
 * Diagnostics and lazy receipts consume that same admitted identity. */
export function executeResolvedGraphicalRequest(request: ResolvedRenderRequest): GraphicalSvgArtifact {
  return withSvgInspectionCache(() => consumeResolvedGraphicalRequest(request))
}

/** Async source adapter: acquire a genuinely needed SPI after positioning,
 * retaining that exact layout and captured request across the await. */
export async function executeResolvedSourceGraphicalRequest(request: ResolvedRenderRequest, loadSceneBackend: () => Promise<void>): Promise<GraphicalSvgArtifact> {
  const plan = resolvedRenderExecutionPlanOf(request)
  if (plan.consumer?.kind !== 'native-drawing') return executeResolvedGraphicalRequest(request)
  emitResolvedConfigDiagnostics(request)
  const layout = measureRenderStage('layout', () => positionFamilyForNativeRender(request))
  const securityDiagnostics: OutputSecurityDiagnostic[] = []
  let rendered = withSvgInspectionCache(() => renderPositionedConsumer(request, layout, securityDiagnostics))
  // Only the actual unavailable-consumer return can acquire the SPI. Caller
  // exceptions propagate unchanged, including undefined and Symbol values.
  if (!rendered) {
    await loadSceneBackend()
    selectSourceSceneFallback(request)
    rendered = withSvgInspectionCache(() => renderPositionedMermaidSVG(request, layout, securityDiagnostics))
  }
  return graphicalSvgArtifact(request, rendered, securityDiagnostics)
}

function consumeResolvedGraphicalRequest(request: ResolvedRenderRequest, consumeLayout?: GraphicalLayoutConsumer): GraphicalSvgArtifact {
  emitResolvedConfigDiagnostics(request)
  consumeLayout?.validate(request)
  const securityDiagnostics: OutputSecurityDiagnostic[] = []
  const rendered = renderResolvedMermaidSVG(request, securityDiagnostics, consumeLayout)
  return graphicalSvgArtifact(request, rendered, securityDiagnostics)
}

/** Complete an already-rendered private request without positioning again. */
export function graphicalSvgArtifact(
  request: ResolvedRenderRequest,
  rendered: ResolvedGraphicalExecution,
  securityDiagnostics: OutputSecurityDiagnostic[],
): GraphicalSvgArtifact {
  const layoutCertification = Object.hasOwn(rendered, 'layoutCertification') ? rendered.layoutCertification : undefined
  return lazyGraphicalArtifact(rendered.svg, () => {
    const outputDigest = renderedSvgDigest(rendered.svg)
    return Object.freeze({
      ...receiptOf(request, securityDiagnostics),
      graphicalProjectionDigest: outputDigest,
      executionDecision: rendered.executionDecision,
      ...(layoutCertification ? { layoutCertification: Object.freeze({ ...layoutCertification, outputDigest }) } : {}),
    })
  })
}

/** Keep the getter in a separate closure so a consumed artifact releases the
 * request, positioned evidence and diagnostics captured by its builder. */
function lazyGraphicalArtifact(svg: string, build: () => RenderRequestReceipt): GraphicalSvgArtifact {
  let pending: (() => RenderRequestReceipt) | undefined = build
  let receipt: RenderRequestReceipt | undefined
  return Object.freeze({
    svg,
    get receipt() {
      if (receipt === undefined) {
        receipt = pending!()
        pending = undefined
      }
      return receipt
    },
  })
}
