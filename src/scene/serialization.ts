import type { SceneNode } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

// SVG serialization is backend-private state, not part of the public Scene IR.
// Construction-time markup is normalized before admission: callers cannot use
// attribute order, quote style, or tag spacing as a second byte-level Scene
// authority, and the default backend no longer replays historical emitter
// bytes. The semantic Scene fields remain the public contract.
const SERIALIZED_SCENE_NODES = new WeakMap<object, string>()

interface SerializedAttribute {
  readonly name: string
  readonly value: string
  readonly index: number
}

function canonicalOpeningTag(tag: string): string {
  const head = tag.match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)/)
  if (!head || tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) return tag
  const name = head[1]!
  // The v2 Scene contract owns the document shell. Family mark serialization
  // remains an internal projection of its typed geometry/presentation fields;
  // reordering those attributes would add no contract value and would make
  // family-level semantic probes needlessly depend on the shell migration.
  if (name !== 'svg') return tag
  const selfClosing = /\/\s*>$/.test(tag)
  const boundary = selfClosing ? tag.lastIndexOf('/') : tag.length - 1
  const attributes: SerializedAttribute[] = []
  let cursor = head[0].length
  while (cursor < boundary) {
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    if (cursor >= boundary) break
    const attribute = tag.slice(cursor).match(/^([^\s=<>/]+)/)
    if (!attribute) return tag
    const attributeName = attribute[1]!
    cursor += attribute[0].length
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    if (tag[cursor] !== '=') return tag
    cursor++
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    const quote = tag[cursor]
    if (quote !== '"' && quote !== "'") return tag
    cursor++
    const valueStart = cursor
    while (cursor < boundary && tag[cursor] !== quote) cursor++
    if (tag[cursor] !== quote) return tag
    const rawValue = tag.slice(valueStart, cursor)
    cursor++
    attributes.push({
      name: attributeName,
      value: quote === '"' ? rawValue : rawValue.replaceAll('"', '&quot;'),
      index: attributes.length,
    })
  }
  const shellOrder = new Map([
    ['xmlns', 0], ['width', 1], ['height', 2], ['viewBox', 3], ['style', 4],
  ])
  attributes.sort((a, b) => {
    const aOrder = shellOrder.get(a.name) ?? 100
    const bOrder = shellOrder.get(b.name) ?? 100
    return aOrder - bOrder || compareCodePointStrings(a.name, b.name) || a.index - b.index
  })
  const serialized = attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ')
  return `<${name}${serialized ? ` ${serialized}` : ''}${selfClosing ? ' /' : ''}>`
}

/** Canonicalize the owned SVG document shell without reparsing or rewriting
 * family elements, text, CSS, comments, or closing tags. This is deliberately
 * one-way: historical root ordering cannot survive as backend output. */
export function canonicalizeSceneNodeSerialization(svg: string): string {
  let output = ''
  let cursor = 0
  while (cursor < svg.length) {
    const start = svg.indexOf('<', cursor)
    if (start < 0) return output + svg.slice(cursor)
    output += svg.slice(cursor, start)
    if (svg.startsWith('<!--', start)) {
      const end = svg.indexOf('-->', start + 4)
      if (end < 0) return output + svg.slice(start)
      output += svg.slice(start, end + 3)
      cursor = end + 3
      continue
    }
    let quote: '"' | "'" | undefined
    let end = start + 1
    for (; end < svg.length; end++) {
      const char = svg[end]
      if (quote) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (end >= svg.length) return output + svg.slice(start)
    output += canonicalOpeningTag(svg.slice(start, end + 1))
    cursor = end + 1
  }
  return output
}

export function attachSceneNodeSerialization<T extends SceneNode>(node: T, svg: string): T {
  SERIALIZED_SCENE_NODES.set(node, canonicalizeSceneNodeSerialization(svg))
  return node
}

export function sceneNodeSerialization(node: SceneNode): string {
  const svg = SERIALIZED_SCENE_NODES.get(node)
  if (svg === undefined) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  return svg
}

export function transferSceneNodeSerialization(source: object, target: object): void {
  const svg = SERIALIZED_SCENE_NODES.get(source)
  if (svg !== undefined) SERIALIZED_SCENE_NODES.set(target, svg)
}

export function hasSceneNodeSerialization(value: object): boolean {
  return SERIALIZED_SCENE_NODES.has(value)
}
