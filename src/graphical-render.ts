// Internal resolved-request + positioned-artifact graphical execution.
//
// This module is intentionally absent from every public package barrel. It is
// the private seam that lets the public renderer position once and lets
// verification prove renderability from the exact artifact it already
// inspected, without serializing, parsing, or laying out again.

import './scene/default-backend.ts'

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
  RenderConfigError,
  type RenderExecutionDecision,
  type RenderExecutionResolutionOptions,
  type RenderRequestReceipt,
  type ResolvedRenderRequest,
} from './render-contract.ts'
import { applyOutputSecurityPolicy } from './output-security.ts'
import type { OutputSecurityDiagnostic } from './output-security.ts'
import { replaceSvgRootStartTag, svgAttribute, svgRootStartTag } from './svg-structure.ts'
import { scopeSvgStyles } from './svg-style-scope.ts'
import { emitResolvedConfigDiagnostics } from './render-config-diagnostics.ts'
import { retainedPositionedScene, retainedNativeDrawing, positionedPaintCertification } from './scene/positioned.ts'
import { PaintLayoutCertificationError, type PaintLayoutCertification, type PaintViewport } from './scene/paint-certification.ts'
import { assertFinalSvgByteBudget } from './scene/scene-validation-core.ts'
import type { SceneDoc } from './scene/ir.ts'
import { sceneHasOnlyPreparedText } from './scene/serialization.ts'
import { withTextMeasurementExecution } from './text-measurement-profile.ts'
import { withSvgInspectionCache } from './svg-inspection-cache.ts'
import { measureRenderStage } from './render-stages.ts'
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

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectAccessibility(
  svg: string,
  accessibility: { title?: string; descr?: string },
  idPrefix: string,
  fallbackName?: string,
): string {
  const titleId = `${idPrefix}svg-title`
  const descId = `${idPrefix}svg-desc`
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
  if (children.length === 0 && !fallbackName) return svg
  const root = svgRootStartTag(svg)
  if (!root) return svg
  if (svgAttribute(root, 'aria-labelledby') || svgAttribute(root, 'aria-describedby')) return svg
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

/** Render an exact descriptor layout result; this function never positions. */
export function renderPositionedMermaidSVG(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
  securityDiagnostics: OutputSecurityDiagnostic[],
  capture?: ScenePartCapture,
): ResolvedGraphicalExecution {
  return withTextMeasurementExecution(resolvedRenderExecutionPlanOf(request).textMeasurement, () =>
    renderPositionedWithTextMeasurement(request, layout, securityDiagnostics, capture))
}

function renderPositionedWithTextMeasurement(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
  securityDiagnostics: OutputSecurityDiagnostic[],
  capture?: ScenePartCapture,
): ResolvedGraphicalExecution {
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
  if (executionPlan.mode === 'scene') {
    const drawing = capture ? undefined : measureRenderStage('drawing', () => retainedNativeDrawing(request, layout))
    const scene = drawing ? undefined : measureRenderStage('scene', () => lowerPositionedFamilyScene(request, layout))
    layoutCertification = measureRenderStage('paint-certification', () => positionedPaintCertification(request, layout))
    if ((effectiveOptions.layoutSafety === 'strict' && layoutCertification.status !== 'passed') || (layoutCertification.status === 'failed' && executionPlan.backend?.inputName === 'default')) throw new PaintLayoutCertificationError(layoutCertification)
    rawSvg = drawing?.svg ?? measureRenderStage('backend', () => {
      const backendContext = {
        seed: effectiveOptions.seed ?? 0,
        ...(request.appearance.styled ? { style: request.appearance.style } : {}),
      }
      capture?.begin(backendContext, scene!)
      return executionPlan.backend!.backend.render(scene!, backendContext)
    })
    preparedText = executionPlan.backend?.inputName === 'default'
      && !family.id.startsWith('family:') && (drawing?.preparedText ?? sceneHasOnlyPreparedText(scene!))
  } else {
    if (effectiveOptions.layoutSafety === 'strict') throw new RenderConfigError('Strict layout safety requires native Scene evidence')
    rawSvg = measureRenderStage('backend', () => family.renderSvg!(context))
  }
  assertFinalSvgByteBudget(rawSvg, 'backend/family SVG output')

  let svg = inlineResolvedColors(rawSvg, context.colors)
  if (layoutCertification?.repairs.length && executionPlan.backend?.inputName === 'default') svg = expandSvgViewport(svg, layoutCertification.viewport)
  assertFinalSvgByteBudget(svg, 'color-resolved SVG output')
  if (!preparedText) svg = fitUncalibratedSvgText(svg, request.appearance.font)
  assertFinalSvgByteBudget(svg, 'font-geometry-fitted SVG output')
  const idPrefix = effectiveOptions.idPrefix ?? ''
  if (idPrefix) {
    svg = namespaceSvgIds(svg, idPrefix)
    assertFinalSvgByteBudget(svg, 'namespaced SVG output')
  }
  const accessibility = request.source.accessibility
  const fallbackName = family.id === 'c4' ? 'C4 architecture diagram' : undefined
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
  const outputSecurity = request.output === 'png' ? 'strict' : effectiveOptions.security
  const secured = measureRenderStage('svg-security', () => applyOutputSecurityPolicy(svg, outputSecurity))
  securityDiagnostics.push(...secured.diagnostics)
  svg = secured.svg
  assertFinalSvgByteBudget(svg, 'final SVG output')
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
