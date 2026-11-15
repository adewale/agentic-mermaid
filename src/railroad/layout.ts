import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { assertRailroadWork } from './parser.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle, type PositionedDiagramTitle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { Point, RenderOptions } from '../types.ts'
import type { RailroadBody, RailroadNode } from './types.ts'
import { railroadDisplayChildren, railroadDisplayNode, railroadRuleId } from './identity.ts'

interface Label { id: string; ruleId: string; kind: string; block: PixelTextBlock; x: number; y: number; width: number; height: number }
interface Track { id: string; ruleId: string; points: Point[] }
interface Plan { width: number; height: number; baseline: number; labels: Label[]; tracks: Track[]; children: Array<{ plan: Plan; x: number; y: number }> }
export interface PositionedRailroad {
  width: number; height: number; body: RailroadBody; labels: Label[]; tracks: Track[]
  rules: Array<{ id: string; name: PixelTextBlock; x: number; y: number; width: number; height: number }>
  title?: PositionedDiagramTitle
}

export function layoutRailroad(body: RailroadBody, options: RenderOptions = {}, styleFace?: InternalStyleFace, title?: string): PositionedRailroad {
  assertRailroadWork(body.rules)
  const style = resolveRenderStyle(options, undefined, styleFace)
  const measure = (value: string, role: 'node' | 'group' | 'edge' = 'node') => preparePixelText(value, {
    display: 'literal', maxWidth: 320, fontFamily: role === 'group' ? style.groupFont ?? options.font : options.font,
    fontSize: role === 'group' ? style.groupHeaderFontSize : role === 'edge' ? style.edgeLabelFontSize : style.nodeLabelFontSize,
    fontWeight: role === 'group' ? style.groupHeaderFontWeight : role === 'edge' ? style.edgeLabelFontWeight : style.nodeLabelFontWeight,
    letterSpacing: role === 'group' ? style.groupLetterSpacing : role === 'edge' ? style.edgeLetterSpacing : style.nodeLetterSpacing,
    transform: role === 'group' ? style.groupTextTransform : role === 'edge' ? style.edgeTextTransform : style.nodeTextTransform,
  })
  const build = (node: RailroadNode, id: string, ruleId: string): Plan => {
    node = railroadDisplayNode(node)
    const labels: Label[] = [], tracks: Track[] = [], placements: Plan['children'] = []
    const line = (points: Point[]) => tracks.push({ id: `track:${id}:${tracks.length}`, ruleId, points })
    const attach = (plan: Plan, x: number, y: number) => {
      placements.push({ plan, x, y })
    }
    if (node.type === 'terminal' || node.type === 'nonterminal' || node.type === 'special' || node.type === 'any') {
      const value = node.type === 'terminal' ? node.value : node.type === 'nonterminal' ? node.name : node.type === 'special' ? node.text : 'any character'
      const block = measure(value), width = block.width + 24 + 2 * style.nodePaddingX, height = Math.max(32, block.height + 2 * style.nodePaddingY), baseline = height / 2
      labels.push({ id, ruleId, kind: node.type, block, x: 12, y: 0, width: width - 24, height })
      line([{ x: 0, y: baseline }, { x: 12, y: baseline }]); line([{ x: width - 12, y: baseline }, { x: width, y: baseline }])
      return { width, height, baseline, labels, tracks, children: placements }
    }
    if (node.type === 'sequence' || node.type === 'predicate' || node.type === 'exception') {
      const elements = railroadDisplayChildren(node)
      const children = elements.map((element, index) => build(element, `${id}/${index}`, ruleId))
      const baseline = Math.max(16, ...children.map(child => child.baseline))
      let width = 0, height = 32
      for (const child of children) {
        attach(child, width, baseline - child.baseline)
        height = Math.max(height, baseline - child.baseline + child.height)
        width += child.width
        if (child !== children.at(-1)) { line([{ x: width, y: baseline }, { x: width + 24, y: baseline }]); width += 24 }
      }
      if (!children.length) { width = 32; line([{ x: 0, y: baseline }, { x: width, y: baseline }]) }
      return { width, height, baseline, labels, tracks, children: placements }
    }
    if (node.type === 'choice' || node.type === 'optional') {
      const choices = railroadDisplayChildren(node)
      const children = choices.map((element, index) => build(element, `${id}/${index}`, ruleId))
      const width = Math.max(32, ...children.map(child => child.width)) + 64, baseline = children[0]?.baseline ?? 16
      let y = 0
      for (const child of children) {
        attach(child, 32, y)
        const cy = y + child.baseline
        line([{ x: 0, y: baseline }, { x: 16, y: baseline }, { x: 16, y: cy }, { x: 32, y: cy }])
        line([{ x: 32 + child.width, y: cy }, { x: width - 16, y: cy }, { x: width - 16, y: baseline }, { x: width, y: baseline }])
        y += child.height + 24
      }
      if (node.type === 'choice' && node.ordered) {
        const block = measure('ordered choice', 'edge')
        labels.push({ id: `${id}/order`, ruleId, kind: 'annotation', block, x: 32, y: y - 16, width: block.width, height: block.height })
        y += block.height
      }
      return { width, height: Math.max(32, y - 24), baseline, labels, tracks, children: placements }
    }
    const child = build(node.element, `${id}/0`, ruleId), skip = node.min === 0 ? 32 : 0
    const block = measure(`repeat ${node.min}..${node.max ?? 'unbounded'}`, 'edge')
    const width = Math.max(child.width + 64, block.width + 64), baseline = skip ? 16 : child.baseline, cy = skip + child.baseline
    attach(child, 32, skip)
    line([{ x: 0, y: baseline }, { x: 16, y: baseline }, { x: 16, y: cy }, { x: 32, y: cy }])
    line([{ x: 32 + child.width, y: cy }, { x: width - 16, y: cy }, { x: width - 16, y: baseline }, { x: width, y: baseline }])
    if (skip) line([{ x: 0, y: baseline }, { x: width, y: baseline }])
    const loopY = skip + child.height + 24
    line([{ x: width - 16, y: cy }, { x: width - 16, y: loopY }, { x: 16, y: loopY }, { x: 16, y: cy }])
    labels.push({ id: `${id}/count`, ruleId, kind: 'annotation', block, x: 32, y: loopY + 5, width: block.width, height: block.height })
    return { width, height: loopY + block.height + 12, baseline, labels, tracks, children: placements }
  }
  const band = diagramTitleBand(body.title ?? title, style)
  const chart: PositionedRailroad = { width: 80, height: 40, body, labels: [], tracks: [], rules: [], ...(band ? { title: positionDiagramTitle(band, 80, 20) } : {}) }
  let y = 20 + (band?.height ?? 0)
  for (const [index, rule] of body.rules.entries()) {
    const id = railroadRuleId(index, rule.name), plan = build(rule.definition, `${id}/expression`, id), name = measure(rule.name, 'group')
    const contentY = y + name.height + 14
    // Keep local plans until placement is known. Every label and point is
    // translated once, rather than copied at each grammar ancestor.
    const pending = [{ plan, x: 40, y: contentY }]
    while (pending.length) {
      const placed = pending.pop()!
      for (const label of placed.plan.labels) chart.labels.push({ ...label, x: label.x + placed.x, y: label.y + placed.y })
      for (const track of placed.plan.tracks) chart.tracks.push({ ...track, points: track.points.map(point => ({ x: point.x + placed.x, y: point.y + placed.y })) })
      for (let i = placed.plan.children.length - 1; i >= 0; i--) {
        const child = placed.plan.children[i]!
        pending.push({ plan: child.plan, x: placed.x + child.x, y: placed.y + child.y })
      }
    }
    chart.tracks.push({ id: `entry:${id}`, ruleId: id, points: [{ x: 20, y: contentY + plan.baseline }, { x: 40, y: contentY + plan.baseline }] },
      { id: `exit:${id}`, ruleId: id, points: [{ x: 40 + plan.width, y: contentY + plan.baseline }, { x: 60 + plan.width, y: contentY + plan.baseline }] })
    const height = name.height + 14 + plan.height
    chart.rules.push({ id, name, x: 20, y, width: plan.width + 40, height })
    chart.width = Math.max(chart.width, plan.width + 80, name.width + 40)
    y += height + 32
  }
  chart.width = Math.max(chart.width, (band?.width ?? 0) + 40)
  chart.height = Math.max(40, y)
  if (band) chart.title = positionDiagramTitle(band, chart.width, 20)
  return chart
}
