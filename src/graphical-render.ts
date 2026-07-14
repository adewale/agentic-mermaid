// Internal resolved-request + positioned-artifact graphical execution.
//
// This module is intentionally absent from every public package barrel. It is
// the private seam that lets the public renderer position once and lets
// verification prove renderability from the exact artifact it already
// inspected, without serializing, parsing, or laying out again.

import './scene/builtin-backends.ts'

import { compactSvg, namespaceSvgIds } from './renderer.ts'
import type { FamilyLayoutResult } from './agent/families.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { inlineResolvedColors } from './theme.ts'
import { positionResolvedFamily } from './positioning.ts'
import {
  receiptOf,
  renderContractDigest,
  resolveRenderRequestForExecution,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  type RenderExecutionDecision,
  type RenderExecutionResolutionOptions,
  type RenderRequestReceipt,
  type ResolvedRenderRequest,
} from './render-contract.ts'
import { applyOutputSecurityPolicy } from './output-security.ts'
import type { OutputSecurityDiagnostic } from './output-security.ts'
import { replaceSvgRootStartTag, svgAttribute, svgRootStartTag } from './svg-structure.ts'
import { explicitFamilyConfigDiagnostics } from './shared/family-config-diagnostics.ts'
import { admitFamilyScene } from './scene/admission.ts'
import { assertFinalSvgByteBudget } from './scene/scene-validation.ts'
import type { SceneDoc } from './scene/ir.ts'

export interface ResolvedGraphicalExecution {
  readonly svg: string
  readonly executionDecision: RenderExecutionDecision
}

/** Private receipt-bearing artifact consumed by public SVG and PNG adapters. */
export interface GraphicalSvgArtifact {
  readonly svg: string
  readonly receipt: RenderRequestReceipt
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
  if (executionPlan.mode !== 'scene') {
    throw new Error(`Resolved ${request.output} request has no Scene execution plan`)
  }
  const family = executionPlan.family
  return admitFamilyScene(family, family.lowerScene!(renderContextForPositionedFamily(request, layout)))
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectAccessibility(
  svg: string,
  accessibility: { title?: string; descr?: string },
  idPrefix: string,
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
  if (children.length === 0) return svg
  const root = svgRootStartTag(svg)
  if (!root) return svg
  if (svgAttribute(root, 'aria-labelledby') || svgAttribute(root, 'aria-describedby')) return svg
  const add = `${svgAttribute(root, 'role') ? '' : ' role="img"'} ${rootAttrs.join(' ')}`
  const open = svg.slice(root.start, root.end)
  return replaceSvgRootStartTag(svg, root, `${open.slice(0, -1)}${add}>${children.join('')}`)
}

/** Render an exact descriptor layout result; this function never positions. */
export function renderPositionedMermaidSVG(
  request: ResolvedRenderRequest,
  layout: FamilyLayoutResult,
  securityDiagnostics: OutputSecurityDiagnostic[],
): ResolvedGraphicalExecution {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if ((executionPlan.mode !== 'scene' && executionPlan.mode !== 'family-svg') || !executionPlan.executionDecision) {
    throw new Error(`Resolved ${request.output} request has no graphical execution plan`)
  }
  const effectiveOptions = request.renderOptions as RenderOptions
  const family = executionPlan.family
  const context = renderContextForPositionedFamily(request, layout)
  let rawSvg: string
  if (executionPlan.mode === 'scene') {
    const scene = lowerPositionedFamilyScene(request, layout)
    rawSvg = executionPlan.backend!.backend.render(scene, {
      seed: effectiveOptions.seed ?? 0,
      ...(request.appearance.styled ? { style: request.appearance.style } : {}),
    })
  } else {
    rawSvg = family.renderSvg!(context)
  }
  assertFinalSvgByteBudget(rawSvg, 'backend/family SVG output')

  let svg = inlineResolvedColors(rawSvg, context.colors)
  assertFinalSvgByteBudget(svg, 'color-resolved SVG output')
  const idPrefix = effectiveOptions.idPrefix ?? ''
  if (idPrefix) {
    svg = namespaceSvgIds(svg, idPrefix)
    assertFinalSvgByteBudget(svg, 'namespaced SVG output')
  }
  const accessibility = request.source.accessibility
  if ((layout.injectAccessibility ?? true) && (accessibility.title || accessibility.descr)) {
    svg = injectAccessibility(svg, accessibility, idPrefix)
    assertFinalSvgByteBudget(svg, 'accessibility-projected SVG output')
  }
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
  const secured = applyOutputSecurityPolicy(svg, outputSecurity)
  securityDiagnostics.push(...secured.diagnostics)
  svg = secured.svg
  assertFinalSvgByteBudget(svg, 'final SVG output')
  return Object.freeze({
    svg,
    executionDecision: executionPlan.executionDecision,
  })
}

/** Public-renderer adapter: position once, then consume that exact result. */
export function renderResolvedMermaidSVG(
  request: ResolvedRenderRequest,
  securityDiagnostics: OutputSecurityDiagnostic[],
): ResolvedGraphicalExecution {
  const familyId = resolvedRenderExecutionPlanOf(request).family.id
  return renderPositionedMermaidSVG(
    request,
    positionResolvedFamily(familyId, request),
    securityDiagnostics,
  )
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
): GraphicalSvgArtifact {
  const request = resolveRenderRequestForExecution(
    text,
    options,
    output,
    outputOptions,
    resolutionOptions,
  )
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  if (executionPlan.explicitMermaidConfig) {
    const report = executionPlan.onConfigDiagnostic ?? ((diagnostic) => console.warn(diagnostic.message))
    for (const diagnostic of explicitFamilyConfigDiagnostics(
      executionPlan.family.id,
      executionPlan.explicitMermaidConfig,
    )) report(diagnostic)
  }
  const securityDiagnostics: OutputSecurityDiagnostic[] = []
  const rendered = renderResolvedMermaidSVG(request, securityDiagnostics)
  const receipt = receiptOf(request, securityDiagnostics)
  return Object.freeze({
    svg: rendered.svg,
    receipt: Object.freeze({
      ...receipt,
      graphicalProjectionDigest: renderContractDigest(rendered.svg),
      executionDecision: rendered.executionDecision,
    }),
  })
}
