import type { LayoutWarning } from '../agent/types.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { mixHex, wcagCssContrastRatio, tryParseCssColor } from '../shared/color-math.ts'
import { MIX } from '../theme.ts'
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
  const mixableHex = (color: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
  const canMix = mixableHex(colors.fg) && mixableHex(colors.bg)
  const derivedNodeFill = request.appearance.face?.node?.fillColor
    ?? colors.surface
    ?? (canMix ? mixHex(colors.fg, colors.bg, MIX.nodeFill) : undefined)
  const derivedNodeStroke = request.appearance.face?.node?.borderColor
    ?? colors.border
    ?? (canMix ? mixHex(colors.fg, colors.bg, MIX.nodeStroke) : undefined)
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
    'var(--_node-fill)': derivedNodeFill,
    'var(--_node-stroke)': derivedNodeStroke,
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

interface TextContrastCandidate {
  readonly node: Extract<SceneNode, { kind: 'text' }>
  readonly background?: string
}

function sameChannels(a: SceneNode, b: SceneNode): boolean {
  const left = a.channels ?? {}
  const right = b.channels ?? {}
  const entries = (value: typeof left) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right))
}

function collectTextContrastCandidates(
  nodes: readonly SceneNode[],
  inheritedBackground: string | undefined,
  candidates: TextContrastCandidate[],
  role?: string,
): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (!role || node.role === role) candidates.push({ node, background: inheritedBackground })
      continue
    }
    if (node.kind !== 'group') continue

    const children = node.children.map(child => child.node)
    const filledShapes = children.filter((child): child is Extract<SceneNode, { kind: 'shape' }> =>
      child.kind === 'shape' && child.paint.fill !== undefined && child.paint.fill !== 'none')
    for (const child of children) {
      let childBackground = inheritedBackground
      if (child.kind === 'text') {
        const semanticSurface = filledShapes.find(shape => shape.role === child.role && sameChannels(shape, child))
          ?? filledShapes.find(shape => shape.role === node.role && sameChannels(shape, node))
          ?? (filledShapes.length === 1 ? filledShapes[0] : undefined)
        childBackground = semanticSurface?.paint.fill ?? inheritedBackground
      }
      collectTextContrastCandidates([child], childBackground, candidates, role)
    }
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
  const pageBackground = resolvedPaint(request.appearance.colors.bg, request)
  const candidates: TextContrastCandidate[] = []
  collectTextContrastCandidates(scene.parts, pageBackground, candidates, constraint.role)
  if (candidates.length === 0) {
    return warning(constraint, {
      measurement: 'not-applicable', minimum,
      ...(constraint.role ? { role: constraint.role } : {}),
      message: `Contrast constraint has no applicable text mark${constraint.role ? ` for role ${constraint.role}` : ''}.`,
    })
  }

  const measured = candidates.map(candidate => {
    const foreground = resolvedPaint(candidate.node.paint.fill, request)
    const background = resolvedPaint(candidate.background, request)
    const ratio = foreground && background
      ? wcagCssContrastRatio(foreground, background, pageBackground)
      : null
    return { ...candidate, foreground, background, ratio }
  })
  const worst = measured
    .filter(candidate => candidate.ratio !== null)
    .sort((a, b) => a.ratio! - b.ratio!)[0]
  if (worst && worst.ratio! < minimum) {
    const rounded = Math.round(worst.ratio! * 100) / 100
    return warning(constraint, {
      measurement: 'measurable', minimum, ratio: rounded,
      role: worst.node.role, mark: worst.node.id,
      foreground: worst.foreground, background: worst.background,
      message: `Final ${worst.node.role} contrast is ${rounded}:1; expected at least ${minimum}:1. Paint remains unchanged.`,
    })
  }
  const unresolved = measured.find(candidate => candidate.ratio === null)
  if (unresolved) {
    return warning(constraint, {
      measurement: 'unmeasurable', minimum,
      role: unresolved.node.role, mark: unresolved.node.id,
      ...(unresolved.foreground ? { foreground: unresolved.foreground } : {}),
      ...(unresolved.background ? { background: unresolved.background } : {}),
      message: 'Final contrast is unmeasurable because an effective paint pair is unresolved; no ratio was fabricated.',
    })
  }
  const rounded = Math.round(worst!.ratio! * 100) / 100
  return warning(constraint, {
    measurement: 'measurable', minimum, ratio: rounded,
    role: worst!.node.role, mark: worst!.node.id,
    foreground: worst!.foreground, background: worst!.background,
    message: `Final ${worst!.node.role} contrast is ${rounded}:1 and meets ${minimum}:1.`,
  })
}

function accentAreaConstraint(
  constraint: Extract<BrandConstraint, { kind: 'accent-area' }>,
  scene: SceneDoc,
  request: ResolvedRenderRequest,
): BrandWarning {
  const accent = resolvedPaint(request.appearance.colors.accent, request)
  if (!accent) return warning(constraint, {
    measurement: 'unmeasurable', maximum: constraint.maxFraction,
    message: 'Accent-area constraint is unmeasurable because no concrete accent paint is resolved.',
  })
  let total = 0
  let accented = 0
  visit(scene.parts, node => {
    if (node.kind !== 'shape' || node.role === 'chrome') return
    const fill = resolvedPaint(node.paint.fill, request)
    if (!fill || fill === 'none' || fill === 'transparent') return
    const bounds = geometryBounds(node.geometry)
    if (!bounds) return
    const area = Math.max(0, bounds.x1 - bounds.x0) * Math.max(0, bounds.y1 - bounds.y0)
    total += area
    if (fill === accent) accented += area
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
