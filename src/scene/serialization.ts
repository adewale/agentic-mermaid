import type { SceneDoc, SceneNode } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { writeConnectorSvg, writeShapeSvg, writeTextSvg } from './svg-writer.ts'

// SVG serialization is backend-private state, not part of the public Scene IR.
// Shape, text and connector marks are written from their typed fields when
// first serialized (svg-writer.ts); a group is its opening tag, its children
// and its closing tag. Only document marks (the shell, definitions,
// stylesheets, titles, opaque family content) carry construction-time markup,
// normalized before admission: callers cannot use attribute order, quote
// style, or tag spacing as a second byte-level Scene authority.
const SERIALIZED_SCENE_NODES = new WeakMap<object, string>()
/** Marks the mark constructors built, and admitted copies of them: the only
 * shape, text, connector and group nodes the writer draws. A plain object
 * shaped like a mark has no serialization, as it had none before the writer. */
const WRITABLE_SCENE_NODES = new WeakSet<object>()
/** Writer output for frozen (admitted) leaf marks, which cannot change after. */
const WRITTEN_SCENE_NODES = new WeakMap<object, string>()
const POSSIBLE_FITTED_TEXT = /<\s*text/i

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
  // Only opening <svg> tags are canonicalized. Most document fragments are
  // styles, definitions or metadata and cannot contain one at all.
  if (!svg.includes('<svg')) return svg
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

/** Attach a document mark's markup. Every other mark's SVG is written from
 * its fields, so what paint certification reads is what the output shows. */
export function attachSceneNodeSerialization<T extends SceneNode>(node: T, svg: string): T {
  if (node.kind !== 'document') throw new TypeError(`Scene ${node.kind} "${node.id}" is written from its fields, not stored markup`)
  SERIALIZED_SCENE_NODES.set(node, canonicalizeSceneNodeSerialization(svg))
  return node
}

/** Record that a mark constructor built `node`, so the writer may draw it. */
export function admitWritableSceneNode<T extends SceneNode>(node: T): T {
  WRITABLE_SCENE_NODES.add(node)
  return node
}

export function sceneNodeSerialization(node: SceneNode): string {
  const stored = SERIALIZED_SCENE_NODES.get(node)
  if (stored !== undefined) return stored
  if (!WRITABLE_SCENE_NODES.has(node)) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  const written = WRITTEN_SCENE_NODES.get(node)
  if (written !== undefined) return written
  const svg = writeSceneNode(node)
  // A group is written from its children each time: its children array is
  // not part of what freezing it protects.
  if (node.kind !== 'group' && Object.isFrozen(node)) WRITTEN_SCENE_NODES.set(node, svg)
  return svg
}

function writeSceneNode(node: SceneNode): string {
  switch (node.kind) {
    case 'shape': return writeShapeSvg(node)
    case 'text': return writeTextSvg(node)
    case 'connector': return writeConnectorSvg(node)
    case 'group': return [
      node.open,
      ...node.children.map(child => indentLines(sceneNodeSerialization(child.node), child.indent)),
      node.close,
    ].join(node.join)
    case 'document': throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  }
}

/** Indent every line of a serialized chunk by `n` spaces. */
export function indentLines(s: string, n: number): string {
  if (n <= 0 || s === '') return s
  const pad = ' '.repeat(n)
  return pad + s.replace(/\n/g, `\n${pad}`)
}

export function transferSceneNodeSerialization(source: object, target: object): void {
  const svg = SERIALIZED_SCENE_NODES.get(source)
  if (svg !== undefined) SERIALIZED_SCENE_NODES.set(target, svg)
  if (WRITABLE_SCENE_NODES.has(source)) WRITABLE_SCENE_NODES.add(target)
}

export function hasSceneNodeSerialization(value: object): boolean {
  return SERIALIZED_SCENE_NODES.has(value) || WRITABLE_SCENE_NODES.has(value)
}

/** A conservative proof for the canonical default writer only. The font-fit
 * postpass ignores prepared text trees. Opaque fragments can still contain
 * unprepared text, so an unknown fragment or even a possible text token keeps
 * that postpass. Styled/custom backends cannot use this proof. */
export function sceneHasOnlyPreparedText(scene: SceneDoc): boolean {
  // The fitting pass accepts whitespace after '<' and compares names without
  // case. Opaque fragments must conservatively cover that same lexical model.
  const prepared = (node: SceneNode): boolean => {
    if (node.kind === 'document') {
      const svg = SERIALIZED_SCENE_NODES.get(node)
      return svg !== undefined && !POSSIBLE_FITTED_TEXT.test(svg)
    }
    if (!WRITABLE_SCENE_NODES.has(node)) return false
    switch (node.kind) {
      case 'text': return node.measurement === 'prepared' && node.block !== undefined
      case 'shape': return true
      // The connector writer sends every inline label through the prepared
      // shared text writer; companion labels are separate Text marks.
      case 'connector': return true
      case 'group': return !POSSIBLE_FITTED_TEXT.test(node.open) && !POSSIBLE_FITTED_TEXT.test(node.close) && node.children.every(child => prepared(child.node))
    }
  }
  return scene.parts.every(prepared)
}
