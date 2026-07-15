import type { LayoutWarning } from '../agent/types.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { wcagCssContrastRatio, tryParseCssColor } from '../shared/color-math.ts'
import type { BrandConstraint } from './style-spec.ts'
import { geometryBounds } from './bounds.ts'
import type { SceneDoc, SceneNode } from './ir.ts'

type BrandWarning = Extract<LayoutWarning, { code: 'BRAND_CONSTRAINT_WARNING' | 'BRAND_CONSTRAINT_ERROR' }>

function visit(nodes: readonly SceneNode[], fn: (node: SceneNode) => void): void {
  for (const node of nodes) {
    fn(node)
    if (node.kind === 'group') visit(node.children.map(child => child.node), fn)
  }
}

function resolvedPaint(value: string | undefined, request: ResolvedRenderRequest): string | undefined {
  if (!value) return undefined
  const colors = request.appearance.colors
  const token: Record<string, string | undefined> = {
    'var(--bg)': colors.bg,
    'var(--fg)': colors.fg,
    'var(--line)': colors.line,
    'var(--accent)': colors.accent,
    'var(--muted)': colors.muted,
    'var(--surface)': colors.surface,
    'var(--border)': colors.border,
    'var(--_text)': colors.fg,
    'var(--_text-sec)': colors.muted,
    'var(--_line)': colors.line,
    'var(--_arrow)': colors.line,
    'var(--_node-fill)': colors.surface,
    'var(--_node-stroke)': colors.border,
    'var(--_group-fill)': colors.bg,
  }
  return token[value] ?? value
}

function warning(
  constraint: BrandConstraint,
  fields: Omit<BrandWarning, 'code' | 'constraint'>,
): BrandWarning {
  return {
    code: constraint.action === 'error' ? 'BRAND_CONSTRAINT_ERROR' : 'BRAND_CONSTRAINT_WARNING',
    constraint: constraint.kind,
    ...fields,
  }
}

function contrastConstraint(
  constraint: Extract<BrandConstraint, { kind: 'contrast' }>,
  scene: SceneDoc,
  request: ResolvedRenderRequest,
): BrandWarning {
  const minimum = constraint.minimum ?? 4.5
  if (request.renderOptions.transparent) {
    return warning(constraint, {
      measurement: 'unmeasurable', minimum,
      message: 'Final contrast is unmeasurable for transparent output because the host backdrop is unknown; no ratio was fabricated.',
    })
  }
  const background = resolvedPaint(request.appearance.colors.bg, request)
  let candidate: SceneNode | undefined
  visit(scene.parts, node => {
    if (candidate || node.kind !== 'text' || (constraint.role && node.role !== constraint.role)) return
    candidate = node
  })
  if (!candidate || candidate.kind !== 'text') {
    return warning(constraint, {
      measurement: 'not-applicable', minimum,
      ...(constraint.role ? { role: constraint.role } : {}),
      message: `Contrast constraint has no applicable text mark${constraint.role ? ` for role ${constraint.role}` : ''}.`,
    })
  }
  const foreground = resolvedPaint(candidate.paint.fill, request)
  const ratio = foreground && background ? wcagCssContrastRatio(foreground, background) : null
  if (ratio === null) {
    return warning(constraint, {
      measurement: 'unmeasurable', minimum,
      role: candidate.role, mark: candidate.id,
      ...(foreground ? { foreground } : {}),
      message: 'Final contrast is unmeasurable because the effective paint pair is unresolved; no ratio was fabricated.',
    })
  }
  const rounded = Math.round(ratio * 100) / 100
  return warning(constraint, {
    measurement: 'measurable', minimum, ratio: rounded,
    role: candidate.role, mark: candidate.id, foreground, background,
    message: rounded < minimum
      ? `Final ${candidate.role} contrast is ${rounded}:1; expected at least ${minimum}:1. Paint remains unchanged.`
      : `Final ${candidate.role} contrast is ${rounded}:1 and meets ${minimum}:1.`,
  })
}

function accentAreaConstraint(
  constraint: Extract<BrandConstraint, { kind: 'accent-area' }>,
  scene: SceneDoc,
  request: ResolvedRenderRequest,
): BrandWarning {
  const accent = resolvedPaint(request.appearance.colors.accent, request)
  let total = 0
  let accented = 0
  visit(scene.parts, node => {
    if (node.kind !== 'shape' || node.role === 'chrome') return
    const bounds = geometryBounds(node.geometry)
    if (!bounds) return
    const area = Math.max(0, bounds.x1 - bounds.x0) * Math.max(0, bounds.y1 - bounds.y0)
    total += area
    if (resolvedPaint(node.paint.fill, request) === accent) accented += area
  })
  if (total === 0) return warning(constraint, {
    measurement: 'not-applicable', maximum: constraint.maxFraction,
    message: 'Accent-area constraint has no applicable filled shape area.',
  })
  const actual = Math.round((accented / total) * 10_000) / 10_000
  return warning(constraint, {
    measurement: 'measurable', actual, maximum: constraint.maxFraction,
    message: actual > constraint.maxFraction
      ? `Accent fill covers ${(actual * 100).toFixed(2)}% of applicable shape area; maximum is ${(constraint.maxFraction * 100).toFixed(2)}%. Paint remains unchanged.`
      : `Accent fill area is within the configured maximum.`,
  })
}

function monoRoleConstraint(
  constraint: Extract<BrandConstraint, { kind: 'mono-role' }>,
  scene: SceneDoc,
  request: ResolvedRenderRequest,
): BrandWarning {
  const paints: Array<{ mark: string; value: string }> = []
  visit(scene.parts, node => {
    if (node.role !== constraint.role || !('paint' in node)) return
    for (const value of [node.paint.fill, node.paint.stroke]) {
      const paint = resolvedPaint(value, request)
      if (paint && paint !== 'none') paints.push({ mark: node.id, value: paint })
    }
  })
  if (paints.length === 0) return warning(constraint, {
    measurement: 'not-applicable', role: constraint.role,
    message: `Mono-role constraint has no applicable paint for role ${constraint.role}.`,
  })
  for (const paint of paints) {
    const parsed = tryParseCssColor(paint.value)
    if (!parsed) return warning(constraint, {
      measurement: 'unmeasurable', role: constraint.role, mark: paint.mark,
      message: `Mono-role paint ${paint.value} is unresolved; no monochrome verdict was fabricated.`,
    })
    if (Math.abs(parsed[0] - parsed[1]) > 1 || Math.abs(parsed[1] - parsed[2]) > 1) {
      return warning(constraint, {
        measurement: 'measurable', role: constraint.role, mark: paint.mark, foreground: paint.value,
        message: `Role ${constraint.role} uses chromatic paint ${paint.value}; the mono-role constraint does not repaint it.`,
      })
    }
  }
  return warning(constraint, {
    measurement: 'measurable', role: constraint.role,
    message: `Role ${constraint.role} uses only measurable monochrome paint.`,
  })
}

/** Inspect the exact admitted Scene. Rules report evidence and never mutate it. */
export function evaluateBrandConstraints(scene: SceneDoc, request: ResolvedRenderRequest): LayoutWarning[] {
  const constraints = request.appearance.style?.constraints ?? []
  const results: BrandWarning[] = constraints.map(constraint => {
    if (constraint.kind === 'contrast') return contrastConstraint(constraint, scene, request)
    if (constraint.kind === 'accent-area') return accentAreaConstraint(constraint, scene, request)
    return monoRoleConstraint(constraint, scene, request)
  }).filter(warning => {
    // Passing measurable rules stay silent; explicit unmeasurable/not-applicable
    // states remain observable because the caller asked for the constraint.
    if (warning.measurement !== 'measurable') return true
    if (warning.constraint === 'contrast') return (warning.ratio ?? Infinity) < (warning.minimum ?? 4.5)
    if (warning.constraint === 'accent-area') return (warning.actual ?? 0) > (warning.maximum ?? 1)
    return warning.foreground !== undefined
  })
  return results
}
