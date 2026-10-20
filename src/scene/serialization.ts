import type { GroupMark, SceneDoc, SceneNode } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import {
  serializeSvgEmission, snapshotSvgEmissionRecipe, writeSvgEmission, writeSvgGroupOpen,
  measureSvgEmission,
  transferSvgGroupMetadata,
  type SvgEmissionNode, type SvgEmissionRecipe, type SvgEmissionContext, type SvgGroupEmission,
} from './svg-emission.ts'
import { writeConnectorSvg, writeShapeSvg, writeTextSvg, SvgWriter } from './svg-writer.ts'
import { writeSceneText, writeConnectorLabels } from './svg-text-emission.ts'
import { writeScenePrelude, writeSceneShadow } from './svg-document-emission.ts'
import { captureConstructionOperands, originalConstructionNode, transferConstructionOperands, constructionOperands } from './construction-operands.ts'
import { publicConstructionOperandsRequired } from './lowering-invocation.ts'

// SVG serialization is backend-private state, not part of the public Scene IR.
// Construction-time markup is normalized before admission: callers cannot use
// attribute order, quote style, or tag spacing as a second byte-level Scene
// authority, and the default backend no longer replays historical emitter
// bytes. The semantic Scene fields remain the public contract.
const SERIALIZED_SCENE_NODES = new WeakMap<object, string>()
const TYPED_SCENE_EMISSIONS = new WeakMap<object, SvgEmissionRecipe>()
const WRITABLE_SCENE_NODES = new WeakSet<object>()
const POSSIBLE_FITTED_TEXT = /<\s*text/i
const GROUP_VIEWS = new WeakMap<object, { open: () => string; close: () => string }>()

const emissionContext: SvgEmissionContext = {
  writeText: writeSceneText,
  writeConnectorLabels,
  writePrelude: writeScenePrelude,
  writeShadow: writeSceneShadow,
  writeChild: writeSceneNode,
}

/** Private, copied and bounded emission data. No caller flag or family name
 * can manufacture membership in this ownership table. */
export function attachSceneNodeEmission<T extends SceneNode>(node: T, recipe: SvgEmissionRecipe): T {
  const captured = snapshotSvgEmissionRecipe(recipe)
  if (publicConstructionOperandsRequired()) {
    const view = captureConstructionOperands(node)
    TYPED_SCENE_EMISSIONS.set(view, captured)
  }
  TYPED_SCENE_EMISSIONS.set(node, captured)
  return node
}

/** Crisp source operands only; styled redraw still uses current semantics. */
export function sceneNodeCrispOperands(node: SceneNode): SvgEmissionNode { return originalConstructionNode(node) }

export function sceneNodeEmission(node: object): SvgEmissionRecipe | undefined {
  return TYPED_SCENE_EMISSIONS.get(node) ?? TYPED_SCENE_EMISSIONS.get(constructionOperands(node) ?? node)
}

/** The compatibility strings are derived views, never retained SVG authority.
 * External admission recognizes only these exact privately registered views. */
export function attachGroupEmissionViews(node: GroupMark, recipe: SvgGroupEmission, fields: 'open' | 'close' | 'both' = 'both'): GroupMark {
  const open = (): string => {
    const writer = new SvgWriter()
    writeSvgGroupOpen(node, recipe, writer)
    return writer.finish()
  }
  const close = (): string => '</g>'
  GROUP_VIEWS.set(node, { open, close })
  const descriptors: PropertyDescriptorMap = {
    open: { enumerable: true, configurable: true, get: open },
    close: { enumerable: true, configurable: true, get: close },
  }
  if (fields === 'close') delete descriptors.open
  if (fields === 'open') delete descriptors.close
  Object.defineProperties(node, descriptors)
  return node
}

export function ownedSceneEmissionView(source: object, key: PropertyKey, descriptor?: PropertyDescriptor): string | undefined {
  const views = GROUP_VIEWS.get(source)
  if (!views || (key !== 'open' && key !== 'close')) return undefined
  const expected = views[key]
  if (descriptor?.get !== expected || descriptor.set !== undefined || !descriptor.enumerable) return undefined
  return expected()
}

export function hasOwnedSceneEmissionView(source: object, key: string): boolean {
  const views = GROUP_VIEWS.get(source)
  if (!views || key !== 'open' && key !== 'close') return false
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  return descriptor?.get === views[key] && descriptor.set === undefined && descriptor.enumerable === true
}

export function sceneNodeSerializationBytes(node: SceneNode, maxBytes: number): number {
  const recipe = sceneNodeEmission(node)
  if (recipe) return measureSvgEmission(originalConstructionNode(node), recipe, emissionContext, maxBytes)
  const writer = new SvgWriter({ maxBytes, mode: 'count' })
  writeSceneNode(node, writer)
  return writer.bytes
}

export function writeSceneNode(node: SvgEmissionNode, writer: SvgWriter, context: SvgEmissionContext = emissionContext): void {
  const recipe = sceneNodeEmission(node)
  if (recipe) { writeSvgEmission(originalConstructionNode(node), recipe, writer, context); return }
  const stored = SERIALIZED_SCENE_NODES.get(node)
  if (stored !== undefined) { writer.write(stored); return }
  if (!isNativeSceneNode(node)) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  switch (node.kind) {
    case 'shape': writer.write(writeShapeSvg(node)); return
    case 'text': writer.write(writeTextSvg(node)); return
    case 'connector': writer.write(writeConnectorSvg(node)); return
    case 'group':
      writer.write(node.open)
      for (const child of node.children) {
        writer.write(node.join)
        const destination = writer.indented(child.indent).scoped(5_000_000)
        if (context.writeChild) context.writeChild(child.node, destination)
        else writeSceneNode(child.node, destination, context)
      }
      writer.write(node.join)
      writer.write(node.close)
      return
    case 'document': throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  }
}

/** Observe the actual closed emission path. Only multiline prepared text is
 * already fitted; direct/fallback text still requires the compatibility pass.
 * Connector-owned inline labels use retained prepared blocks too. */
export function sceneDocumentEmission(writer: SvgWriter): {
  writeNode(node: SceneNode, destination?: SvgWriter): void
  readonly textAlreadyFitted: boolean
} {
  let textAlreadyFitted = true
  const context: SvgEmissionContext = {
    ...emissionContext,
    writeText(node, recipe, destination) {
      if (node.measurement !== 'prepared' || recipe.layout !== 'multiline') textAlreadyFitted = false
      writeSceneText(node, recipe, destination)
    },
    writeChild(node, destination) { writeNode(node, destination) },
  }
  const writeNode = (node: SvgEmissionNode, destination = writer): void => {
    if (!sceneNodeEmission(node) && !nativePreparedText(node)) textAlreadyFitted = false
    writeSceneNode(node, destination, context)
  }
  return {
    writeNode,
    get textAlreadyFitted() { return textAlreadyFitted },
  }
}

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
  const recipe = sceneNodeEmission(node)
  if (recipe) return serializeSvgEmission(originalConstructionNode(node), recipe, emissionContext)
  const svg = SERIALIZED_SCENE_NODES.get(node)
  if (svg !== undefined) return svg
  const writer = new SvgWriter()
  writeSceneNode(node, writer)
  return writer.finish()
}

export function transferSceneNodeSerialization(source: object, target: object): void {
  if (WRITABLE_SCENE_NODES.has(source)) WRITABLE_SCENE_NODES.add(target)
  transferConstructionOperands(source, target)
  transferSvgGroupMetadata(source, target)
  const recipe = TYPED_SCENE_EMISSIONS.get(source)
  if (recipe) TYPED_SCENE_EMISSIONS.set(target, recipe)
  const svg = SERIALIZED_SCENE_NODES.get(source)
  if (svg !== undefined) SERIALIZED_SCENE_NODES.set(target, svg)
}

export function hasSceneNodeSerialization(value: object): boolean {
  return TYPED_SCENE_EMISSIONS.has(value) || SERIALIZED_SCENE_NODES.has(value) || WRITABLE_SCENE_NODES.has(value)
}

/** Controlled constructor provenance survives bounded admission copies. Native
 * typed marks share the request-local sink; serialized leaf strings are never cached. */
export function admitWritableSceneNode<T extends SceneNode>(node: T): T {
  WRITABLE_SCENE_NODES.add(node)
  return node
}

function nativePreparedText(node: SvgEmissionNode): boolean {
  if (node.kind === 'document') {
    const svg = SERIALIZED_SCENE_NODES.get(node)
    return svg !== undefined && !POSSIBLE_FITTED_TEXT.test(svg)
  }
  if (!WRITABLE_SCENE_NODES.has(node)) return false
  switch (node.kind) {
    case 'text': return node.measurement === 'prepared' && node.block !== undefined
    case 'shape': case 'connector': return true
    case 'group': return !POSSIBLE_FITTED_TEXT.test(node.open) && !POSSIBLE_FITTED_TEXT.test(node.close)
      && node.children.every(child => nativePreparedText(child.node))
  }
}

/** Conservative proof for the native typed compatibility path. */
export function sceneHasOnlyPreparedText(scene: SceneDoc): boolean {
  return scene.parts.every(nativePreparedText)
}

/** Preserve the group adapter's exact historical whitespace. */
export function indentLines(value: string, spaces: number): string {
  if (spaces <= 0 || value === '') return value
  const prefix = ' '.repeat(spaces)
  return prefix + value.replace(/\n/g, `\n${prefix}`)
}

/** A construction view never acquires native writer provenance implicitly. */
function isNativeSceneNode(node: SvgEmissionNode): node is SceneNode {
  return WRITABLE_SCENE_NODES.has(node)
}
