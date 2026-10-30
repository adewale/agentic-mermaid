import type { StyleBackendContext } from './backend.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

/** Private, per-request ownership channel. No wrappers reach the public SVG. */
export interface ScenePartCapture {
  scene?: SceneDoc
  owners?: number[]
  begin(context: StyleBackendContext, scene: SceneDoc): void
  finish(svg: string): string
}

const capturePart = Symbol()
const partHasOwn = Object.hasOwn
const partOwn = Object.getOwnPropertyDescriptor, partPrototype = Object.getPrototypeOf, partApply = Reflect.apply
const partObjectPrototype = Object.prototype
type CapturingContext = StyleBackendContext & { [capturePart]?: (node: SceneNode, svg: string) => string }

export function createScenePartCapture(): ScenePartCapture {
  const capture: ScenePartCapture = {
    begin(context, scene) {
      capture.scene = scene
      const owners = new Map(scene.parts.map((node, index) => [node, index]))
      ;(context as CapturingContext)[capturePart] = (node, svg) => {
        if (node.kind === 'document') return svg
        const index = owners.get(node)
        if (index === undefined) throw new Error('Resolved Scene part is not in the rendered document')
        return `<!--am-part-start:${index}-->${svg}<!--am-part-end:${index}-->`
      }
    },
    finish(svg) { return consumePartBoundaries(svg, capture) },
  }
  return capture
}

export function capturedPart(context: StyleBackendContext, node: SceneNode, svg: string, observe?: (unchanged: boolean) => void): string {
  if (!observe) return (context as CapturingContext)[capturePart]?.(node, svg) ?? svg
  const own = partOwn(context, capturePart), inherited = partPrototype(context) === partObjectPrototype ? partOwn(partObjectPrototype, capturePart) : undefined
  const closed = (!own || partHasOwn(own, 'value') && own.value === undefined) && partPrototype(context) === partObjectPrototype && (!inherited || partHasOwn(inherited, 'value') && inherited.value === undefined)
  const callback = (context as CapturingContext)[capturePart]
  const result = callback === undefined || callback === null ? svg : partApply(callback, context, [node, svg]) ?? svg
  observe(closed && callback === undefined)
  return result
}

/** Strip the private boundaries before hashing/scoping the SVG. Record owner
 * by opening-tag ordinal, which the remaining attribute-only passes preserve. */
export function consumePartBoundaries(svg: string, capture: ScenePartCapture): string {
  const ranges: { start: number; end: number; owner: number }[] = []
  const clean = svg.replace(/<!--am-part-(start|end):(\d+)-->/g, (token: string, edge: string, index: string, offset: number) => {
    ranges.push({ start: offset, end: offset + token.length, owner: edge === 'start' ? Number(index) : -1 })
    return ''
  })
  const reported = new Set(ranges.filter(range => range.owner >= 0).map(range => range.owner))
  capture.scene?.parts.forEach((node, index) => {
    if (node.kind !== 'document' && !reported.has(index)) throw new Error(`Resolved Scene part "${node.id}": backend did not report ownership`)
  })
  let cursor = 0, owner = -1
  capture.owners = scanSvgStartTags(svg).map(tag => {
    while (cursor < ranges.length && ranges[cursor]!.end <= tag.start) owner = ranges[cursor++]!.owner
    return owner
  })
  return clean
}
