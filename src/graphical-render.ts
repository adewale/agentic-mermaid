// Internal resolved-request + positioned-artifact graphical execution.
//
// This module is intentionally absent from every public package barrel. It is
// the private seam that lets the public renderer position once and lets
// verification prove renderability from the exact artifact it already
// inspected, without serializing, parsing, or laying out again.

import './render-family-hooks.ts'
import './scene/rough-backend.ts'
import './scene/hybrid-backend.ts'

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
  resolvedRenderExecutionPlanOf,
  type RenderExecutionDecision,
  type RenderExecutionResolutionOptions,
  type RenderRequestReceipt,
  type ResolvedRenderRequest,
} from './render-contract.ts'
import { applyOutputSecurityPolicy } from './output-security.ts'
import type { OutputSecurityDiagnostic } from './output-security.ts'
import { explicitFamilyConfigDiagnostics } from './shared/family-config-diagnostics.ts'
import { admitFamilyScene } from './scene/admission.ts'

export interface ResolvedGraphicalExecution {
  readonly svg: string
  readonly executionDecision: RenderExecutionDecision
}

/** Private receipt-bearing artifact consumed by public SVG and PNG adapters. */
export interface GraphicalSvgArtifact {
  readonly svg: string
  readonly receipt: RenderRequestReceipt
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
  return svg.replace(/<svg\b([^>]*)>/, (full, attrs: string) => {
    if (/\baria-(?:labelledby|describedby)=/.test(attrs)) return full
    const add = `${/\brole=/.test(attrs) ? '' : ' role="img"'} ${rootAttrs.join(' ')}`
    return `<svg${attrs}${add}>${children.join('')}`
  })
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
  const appearanceColors = request.appearance.colors as DiagramColors
  // PNG cannot consume a remote CSS @import. This output-only projection does
  // not alter the shared request or appearance receipt.
  const colors = request.output === 'png' && appearanceColors.embedFontImport !== false
    ? { ...appearanceColors, embedFontImport: false }
    : appearanceColors
  const family = executionPlan.family
  const context: RenderContext<PositionedDiagram> = {
    positioned: layout.positioned,
    colors,
    options: effectiveOptions,
  }
  let rawSvg: string
  if (executionPlan.mode === 'scene') {
    const scene = admitFamilyScene(family, family.lowerScene!(context))
    rawSvg = executionPlan.backend!.backend.render(scene, {
      seed: effectiveOptions.seed ?? 0,
      ...(request.appearance.styled ? { style: request.appearance.style } : {}),
    })
  } else {
    rawSvg = family.renderSvg!(context)
  }

  let svg = inlineResolvedColors(rawSvg, colors)
  const idPrefix = effectiveOptions.idPrefix ?? ''
  if (idPrefix) svg = namespaceSvgIds(svg, idPrefix)
  const accessibility = request.source.accessibility
  if ((layout.injectAccessibility ?? true) && (accessibility.title || accessibility.descr)) {
    svg = injectAccessibility(svg, accessibility, idPrefix)
  }
  const secured = applyOutputSecurityPolicy(svg, effectiveOptions.security)
  securityDiagnostics.push(...secured.diagnostics)
  svg = effectiveOptions.compact ? compactSvg(secured.svg) : secured.svg
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
  if (options.mermaidConfig) {
    const report = options.onConfigDiagnostic ?? ((diagnostic) => console.warn(diagnostic.message))
    for (const diagnostic of explicitFamilyConfigDiagnostics(executionPlan.family.id, options.mermaidConfig)) report(diagnostic)
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
