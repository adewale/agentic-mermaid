import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { computedStyle, cssLength, cssRules, splitCss, svgTree, type SvgElement } from './resolved-css.ts'
import { IDENTITY, multiply, pathData, pathEndpoints, svgMatrix } from './resolved-geometry.ts'
import { RESOLVED_SCENE_VERSION, type Matrix, type ResolvedPaint, type ResolvedPart, type ResolvedPrimitive, type ResolvedScene, type ResolvedText } from './resolved-types.ts'
import type { SceneDoc } from './ir.ts'

/** Resolve the emitted SVG, not the Scene's idealized geometry. */
export function resolveSvgScene(svg: string, scene: SceneDoc, owners: readonly number[]): ResolvedScene {
  const root = svgTree(svg, owners)
  const rules = cssRules(root)
  const styles = new Map<SvgElement, Record<string, string>>()
  const ids = new Map<string, SvgElement>()
  const parts: ResolvedPart[] = []
  const partByIndex = new Map<number, ResolvedPart>()
  scene.parts.forEach((node, index) => {
    if (node.kind === 'document') return
    const part: ResolvedPart = { id: node.id, role: node.role, kind: node.kind, node, primitives: [] }
    parts.push(part)
    partByIndex.set(index, part)
  })
  const frame: ResolvedPrimitive[] = []
  let activeOwner = -1
  const fail = (feature: string): never => {
    throw new Error(`Resolved Scene part "${partByIndex.get(activeOwner)?.id ?? 'frame'}": ${feature}`)
  }
  const collectIds = (node: SvgElement): void => {
    if (node.attrs.id) ids.set(node.attrs.id, node)
    node.children.forEach(collectIds)
  }
  collectIds(root)
  const styleOf = (node: SvgElement): Record<string, string> => {
    const cached = styles.get(node)
    if (cached) return cached
    try {
      const style = computedStyle(node, node.parent ? styleOf(node.parent) : undefined, rules)
      styles.set(node, style)
      return style
    } catch (error) { return fail((error as Error).message) }
  }
  const color = (value: string, style: Record<string, string>): [string, number] => {
    if (value === 'none') return ['none', 1]
    if (/url\s*\(/i.test(value)) return fail(`paint server ${value}`)
    if (value.toLowerCase() === 'currentcolor') value = style.color!
    const mix = value.match(/^color-mix\(in srgb,\s*(.+)\)$/i)
    if (mix) {
      const components = splitCss(mix[1]!, ',')
      if (components.length !== 2) return fail(`Unsupported color ${value}`)
      const parse = (component: string): [string, number | undefined] => {
        const m = component.match(/^(.*?)\s+([\d.]+)%$/)
        return m ? [m[1]!, Number(m[2]) / 100] : [component, undefined]
      }
      const [a, aw] = parse(components[0]!), [b, bw] = parse(components[1]!)
      const w1 = aw ?? (bw === undefined ? 0.5 : 1 - bw), w2 = bw ?? 1 - w1
      const [ca, aa] = color(a, style), [cb, ab] = color(b, style)
      const A = tryParseCssColor(ca), B = tryParseCssColor(cb)
      if (!A || !B) return fail(`Unsupported color ${value}`)
      const sum = w1 + w2
      if (!(sum > 0) || !Number.isFinite(sum)) return fail(`Unsupported color ${value}`)
      const alpha = (aa * w1 + ab * w2) / sum
      const channel = (i: number) => alpha ? (A[i]! * aa * w1 + B[i]! * ab * w2) / (sum * alpha) : 0
      return [toHex(channel(0), channel(1), channel(2)).toLowerCase(), alpha * Math.min(1, sum)]
    }
    const rgba = tryParseCssColor(value)
    if (!rgba) return fail(`Unsupported color ${value}`)
    return [toHex(rgba[0], rgba[1], rgba[2]).toLowerCase(), rgba[3]]
  }
  const length = (value: string, style: Record<string, string>): number => cssLength(value, Number(style['font-size']))
  const paintOf = (style: Record<string, string>, opacity: number): ResolvedPaint => {
    const [fill, fa] = color(style.fill!, style), [stroke, sa] = color(style.stroke!, style)
    const dash = style['stroke-dasharray']!
    return {
      fill, fillOpacity: fa * Number(style['fill-opacity']), stroke, strokeOpacity: sa * Number(style['stroke-opacity']),
      strokeWidth: length(style['stroke-width']!, style), opacity,
      lineCap: style['stroke-linecap'] as ResolvedPaint['lineCap'], lineJoin: style['stroke-linejoin'] as ResolvedPaint['lineJoin'],
      miterLimit: Number(style['stroke-miterlimit']), fillRule: style['fill-rule'] as ResolvedPaint['fillRule'],
      paintOrder: style['paint-order']!,
      ...(dash === 'none' ? {} : {
        dashArray: dash.split(/[\s,]+/).map(value => length(value, style)),
        dashOffset: length(style['stroke-dashoffset']!, style),
      }),
    }
  }
  const push = (owner: number, primitive: ResolvedPrimitive) => (partByIndex.get(owner)?.primitives ?? frame).push(primitive)
  const markerStack = new Set<SvgElement>()
  const visit = (node: SvgElement, parentMatrix: Matrix, inheritedOpacity: number, givenOwner?: number, marker = false): void => {
    const tag = node.tag
    if (['defs', 'style', 'title', 'desc', 'metadata'].includes(tag)) return
    const owner = givenOwner ?? node.owner
    activeOwner = owner
    const style = styleOf(node)
    if (style.display === 'none') return
    for (const prop of ['filter', 'clip-path', 'mask', 'marker-mid']) if (style[prop] !== 'none') fail(`${prop}: ${style[prop]}`)
    const opacity = inheritedOpacity * Number(style.opacity)
    const matrix = multiply(parentMatrix, svgMatrix(node.attrs.transform))
    if (tag === 'g' || tag === 'a' || tag === 'svg') {
      if (tag === 'svg' && node !== root) fail('nested svg viewport')
      node.children.forEach(child => visit(child, matrix, opacity, givenOwner, marker))
      return
    }
    if (tag === 'text' && node.children.length) {
      for (const child of node.children) {
        const checkText = (run: SvgElement): void => {
          if (run.tag !== 'tspan') fail(`Unsupported text element <${run.tag}>`)
          run.children.forEach(checkText)
        }
        checkText(child)
        const run: SvgElement = { ...node, attrs: { ...node.attrs, ...child.attrs }, children: [], text: child.text }
        // Each independent run takes text attributes, overridden by its tspan.
        styles.set(run, styleOf(child))
        visit(run, parentMatrix, opacity, owner, marker)
      }
      return
    }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return
    const paint = paintOf(style, opacity)
    if (tag === 'text') {
      const len = (key: string) => node.attrs[key] === undefined ? 0 : length(node.attrs[key]!, style)
      const letterSpacing = style['letter-spacing'] === 'normal' ? 0 : length(style['letter-spacing']!, style)
      push(owner, {
        kind: 'text', text: node.text, x: len('x') + len('dx'), y: len('y') + len('dy'),
        fontSize: Number(style['font-size']),
        fontFamily: splitCss(style['font-family']!, ',').map(family => family.replace(/^["']|["']$/g, '')),
        fontWeight: Number(style['font-weight']), fontStyle: style['font-style'] as ResolvedText['fontStyle'],
        anchor: style['text-anchor'] as ResolvedText['anchor'],
        ...(style['dominant-baseline'] === 'auto' ? {} : { baseline: style['dominant-baseline'] }),
        ...(node.attrs.textLength === undefined ? {} : { textLength: len('textLength'), lengthAdjust: (node.attrs.lengthAdjust ?? 'spacing') as ResolvedText['lengthAdjust'] }),
        ...(letterSpacing ? { letterSpacing } : {}),
        matrix, paint,
      })
      return
    }
    let d: string
    try { d = pathData(node, Number(style['font-size'])) } catch (error) { return fail((error as Error).message) }
    push(owner, { kind: 'path', d, matrix, paint, ...(marker ? { marker: true as const } : {}) })
    for (const [prop, at] of [['marker-start', 0], ['marker-end', 1]] as const) {
      const ref = style[prop]!
      if (ref === 'none') continue
      const id = ref.match(/#([^)"']+)/)?.[1]
      const resource = (id ? ids.get(id) : undefined) ?? fail(`Unresolved marker ${ref}`)
      if (resource.tag !== 'marker') fail(`Unresolved marker ${ref}`)
      if (markerStack.has(resource)) fail(`Cyclic marker ${ref}`)
      markerStack.add(resource)
      const endpoint = pathEndpoints(d)[at]
      const orient = resource.attrs.orient ?? '0'
      const angle = orient.startsWith('auto') ? endpoint.angle + (orient === 'auto-start-reverse' && at === 0 ? 180 : 0) : Number(orient)
      const unit = resource.attrs.markerUnits === 'userSpaceOnUse' ? 1 : paint.strokeWidth
      const radians = angle * Math.PI / 180
      let mm = multiply(matrix, [Math.cos(radians) * unit, Math.sin(radians) * unit, -Math.sin(radians) * unit, Math.cos(radians) * unit, endpoint.point.x, endpoint.point.y])
      const vb = resource.attrs.viewBox?.trim().split(/[\s,]+/).map(Number)
      if (vb?.length === 4 && vb[2] && vb[3]) {
        const width = Number(resource.attrs.markerWidth ?? 3), height = Number(resource.attrs.markerHeight ?? 3)
        const sx = width / vb[2], sy = height / vb[3]
        mm = multiply(mm, [sx, 0, 0, sy, -vb[0]! * sx, -vb[1]! * sy])
      }
      mm = multiply(mm, [1, 0, 0, 1, -Number(resource.attrs.refX ?? 0), -Number(resource.attrs.refY ?? 0)])
      resource.children.forEach(child => visit(child, mm, opacity, owner, true))
      markerStack.delete(resource)
    }
  }
  try { visit(root, [...IDENTITY], 1) } catch (error) {
    if ((error as Error).message.startsWith('Resolved Scene part')) throw error
    fail((error as Error).message)
  }
  // Detach the public data from retained admission state and omit undefined
  // fields so the complete result survives a JSON round trip unchanged.
  return JSON.parse(JSON.stringify({
    version: RESOLVED_SCENE_VERSION, family: scene.family, width: scene.width, height: scene.height,
    svg, colors: scene.colors, parts, frame,
  })) as ResolvedScene
}
