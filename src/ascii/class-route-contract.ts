import type { TerminalBounds } from './terminal-document.ts'
import { TERMINAL_CERTIFICATION_LIMITS as LIMITS } from './terminal-limits.ts'
import { visualWidth } from './width.ts'
import type { TerminalBox, BoxRoute, BoxText } from './class-like-layout.ts'
interface Frame extends TerminalBox {
  labelLines: string[]
  parentId?: string
}
export const classLinkFooterText = (id: string, href: string): string => `link ${id}: ${href}`
/** The cells of a namespace's header text, each line centred on its top rows
 * as ` line `, exactly as the class renderer paints it. */
export function namespaceHeaderLabel(frame: Frame): TerminalBounds {
  const spans = frame.labelLines.map(line => {
    const x = frame.x + Math.max(1, Math.floor((frame.width - visualWidth(line) - 2) / 2))
    return { x, end: x + visualWidth(line) + 2 }
  })
  const x = Math.min(...spans.map(span => span.x))
  return { x, y: frame.y, width: Math.max(...spans.map(span => span.end)) - x, height: frame.labelLines.length }
}
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
/** Validate actual class route geometry before any paint. Only strict
 * perpendicular interior crossings are legal between unrelated authored
 * paths; a namespace's header band (outside its text) and borders are crossed
 * straight through, and only by routes with an endpoint inside it. */
const proofLimit = Symbol('class route contact proof limit')
function inspectClassRoutes(routes: readonly BoxRoute[], boxes: readonly TerminalBox[], frames: readonly Frame[], parents: ReadonlyMap<string, string>): { reason: string; relation: string } | undefined {
  const frameById = new Map(frames.map(frame => [frame.id, frame])),
    headers = new Map(frames.map(frame => [frame.id, namespaceHeaderLabel(frame)])),
    ink = new Map<string, { edge: string; mask: number; terminal: boolean }>()
  let work = 0
  const visit = () => {
    if (work >= LIMITS.maxOperations) throw proofLimit
    work++
  }
  const ancestors = (id: string) => {
    const result = new Set<string>()
    let at = parents.get(id)
    while (at) {
      visit()
      if (result.has(at)) throw new Error('Cyclic namespace parent')
      result.add(at)
      at = frameById.get(at)?.parentId
    }
    return result
  }
  for (const route of routes) {
    const relation = route.relation.id,
      permitted = new Set([...ancestors(route.relation.from), ...ancestors(route.relation.to)]),
      seen = new Set<string>()
    for (let index = 0; index < route.points.length; index++) {
      visit()
      const p = route.points[index]!,
        a = route.points[index - 1],
        b = route.points[index + 1],
        key = p.x + ',' + p.y
      if (seen.has(key)) return { reason: 'self-retracing route ' + relation, relation }
      seen.add(key)
      let mask = 0
      for (const q of [a, b]) if (q) mask |= q.x > p.x ? 2 : q.x < p.x ? 8 : q.y > p.y ? 4 : 1
      const terminal = index === 0 || index === route.points.length - 1,
        previous = ink.get(key)
      if (previous && previous.edge !== relation && !(!terminal && !previous.terminal && ((mask === 10 && previous.mask === 5) || (mask === 5 && previous.mask === 10)))) return { reason: 'illegal route contact ' + previous.edge + ' / ' + relation, relation }
      ink.set(key, { edge: relation, mask: previous ? 15 : mask, terminal })
      for (const box of boxes) {
        visit()
        if (p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height) return { reason: 'card body contact ' + relation, relation }
      }
      for (const frame of frames) {
        visit()
        if (p.x < frame.x || p.x >= frame.x + frame.width || p.y < frame.y || p.y >= frame.y + frame.height) continue
        if (overlap(headers.get(frame.id)!, { x: p.x, y: p.y, width: 1, height: 1 })) return { reason: 'namespace header contact ' + relation, relation }
        const vertical = p.x === frame.x || p.x === frame.x + frame.width - 1,
          horizontal = p.y < frame.y + Math.max(1, frame.labelLines.length) || p.y === frame.y + frame.height - 1
        if (vertical || horizontal) {
          if (!permitted.has(frame.id) || !a || !b || (vertical && horizontal) || (vertical && (a.y !== p.y || b.y !== p.y)) || (horizontal && (a.x !== p.x || b.x !== p.x))) return { reason: 'namespace boundary contact ' + relation, relation }
        }
      }
    }
  }
  const labels = routes.flatMap(route => [route.label, route.fromLabel, route.toLabel].filter((text): text is BoxText => !!text).map(text => ({ text, relation: route.relation.id })))
  for (let i = 0; i < labels.length; i++) {
    const { text: label, relation } = labels[i]!
    for (const box of [...boxes, ...frames.map(frame => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.labelLines.length }))]) {
      visit()
      if (overlap(label, box)) return { reason: 'label geometry contact', relation }
    }
    for (let j = 0; j < i; j++) {
      visit()
      if (overlap(label, labels[j]!.text)) return { reason: 'label overlap', relation }
    }
    for (let y = label.y; y < label.y + label.height; y++)
      for (let x = label.x; x < label.x + label.width; x++) {
        visit()
        if (ink.has(x + ',' + y)) return { reason: 'label shaft contact', relation }
      }
  }
  return undefined
}
export function classRoutesDecision(routes: readonly BoxRoute[], boxes: readonly TerminalBox[], frames: readonly Frame[], parents: ReadonlyMap<string, string>): { status: 'clear' | 'unknown' } | { status: 'invalid'; reason: string; relation: string } {
  try {
    const issue = inspectClassRoutes(routes, boxes, frames, parents)
    return issue ? { status: 'invalid', ...issue } : { status: 'clear' }
  } catch (error) {
    if (error === proofLimit) return { status: 'unknown' }
    throw error
  }
}
