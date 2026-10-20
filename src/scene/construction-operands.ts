/** Original typed construction operands for the selected public lowering.
 * These records never contain SVG and never replace public semantic validation. */
import type { SceneNode, SceneNodeBase, Geometry, MarkPaint, ConnectorMark, DocumentMark } from './ir.ts'
import type { SvgEmissionMetadataCounts, SvgGroupEmission, SvgEmissionNode, SvgTextNode, SvgTextBlock, SvgTextRun } from './svg-emission.ts'
import { snapshotBoundedExternalData, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, type ExternalDataSnapshotLimits } from './external-data-snapshot.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { sceneNodeEmission } from './serialization.ts'
import { svgEmissionMetadataCounts } from './svg-emission.ts'
import { publicConstructionOperandsRequired } from './lowering-invocation.ts'

type GroupProgram = 'namespace' | 'box' | 'note'
const groupPrograms = new WeakMap<object, GroupProgram>()
type Identity = true | readonly [string, SceneNode['role'], string | undefined, string | undefined] | undefined
type Extra = Pick<SceneNodeBase, 'accessibility' | 'transform' | 'channels'>
/** Temporary assembly only; no Base array is retained by an operand root. */
type Base = readonly [id: string, role: SceneNode['role'], identity: Identity, extra?: Extra]
type Paint = readonly [MarkPaint['fill']?, MarkPaint['stroke']?, MarkPaint['strokeWidth']?, MarkPaint['strokeDasharray']?, MarkPaint['strokeDashoffset']?, MarkPaint['strokeLinecap']?, MarkPaint['strokeLinejoin']?, MarkPaint['strokeMiterlimit']?, MarkPaint['vectorEffect']?, MarkPaint['paintOrder']?, MarkPaint['opacity']?]
type Geo = readonly ['rect', number, number, number, number, number?, number?] | readonly ['circle', number, number, number] |
  readonly ['ellipse', number, number, number, number] | readonly ['line', number, number, number, number] |
  readonly ['path', string] | readonly ['polygon' | 'polyline', readonly (readonly [number, number])[]] | readonly ['compound', readonly Geo[]]
type Run = readonly [string, boolean?, boolean?, boolean?, boolean?]
type Fragment = readonly [number, string, number, number]
type Line = readonly [readonly Run[], number, number, (readonly Fragment[])?]
type Block = readonly [string, NonNullable<SvgTextNode['display']>, number, number, number, number, number, readonly Line[]]
export type ConstructionOperands = readonly ['shape', string, SceneNode['role'], Identity, Geo, Paint, Extra?] |
  readonly ['text', string, SceneNode['role'], Identity, string, number, number, number, SvgTextNode['anchor'], Paint, Block | undefined,
    SvgTextNode['measurement'], number | undefined, number | undefined, SvgTextNode['display'], Extra?] |
  readonly ['group', string, SceneNode['role'], Identity, string, readonly (readonly [ConstructionOperands, number])[], Extra?] |
  readonly ['connector', string, SceneNode['role'], Identity, Omit<ConnectorMark, keyof SceneNodeBase | 'kind'>, Extra?] |
  readonly ['document', string, SceneNode['role'], Identity, Omit<DocumentMark, keyof SceneNodeBase | 'kind'>, Extra?]
const original = new WeakMap<object, ConstructionOperands>()
const heights = new WeakMap<object, number>()

/** Called only at the three actual Class Group producers. It reads no input. */
export function classConstructionGroup<T extends SvgGroupEmission>(program: GroupProgram, recipe: T): T {
  if (publicConstructionOperandsRequired()) groupPrograms.set(recipe, program)
  return recipe
}

/** A bounded raw opening phase, distinct from admitted node serialization. */
export function classConstructionOpeningLimit(input: object, recipe: SvgGroupEmission, id: string): number {
  const program = groupPrograms.get(input)
  if (!program || recipe.prefix !== undefined || recipe.leadingWhitespace !== undefined) throw new TypeError('Public Class Group requires its closed construction program')
  const names = recipe.attributes.map(attribute => attribute.name)
  const allowed = program === 'namespace'
    ? ['class', 'data-id', 'data-label', 'data-parent-id']
    : program === 'box'
      ? ['class', 'data-id', 'data-label', 'data-annotation', 'data-class', 'data-href', 'role', 'tabindex']
      : ['class', 'data-note-index', 'data-for']
  const seen = new Set<object>()
  let previous = -1
  for (const attribute of recipe.attributes) {
    const index = allowed.indexOf(attribute.name)
    if (index <= previous || attribute.value.source !== 'metadata' || seen.has(attribute.value)
      || attribute.fallback !== undefined || attribute.format !== undefined || attribute.before !== undefined || attribute.escape !== undefined || attribute.omit !== undefined
      || attribute.display !== undefined && !(attribute.name === 'data-label' && attribute.display === true)) throw new TypeError('Unsupported Class construction opening profile')
    previous = index
    seen.add(attribute.value)
    if (attribute.name === 'data-note-index') {
      const value = attribute.value.value
      if (typeof value !== 'number' || !Number.isFinite(value) || String(value).length > 24 || id !== `class-note:${value}`) throw new TypeError('Invalid Class note construction index')
    } else if (typeof attribute.value.value !== 'string') throw new TypeError('Class construction opening values must be strings')
  }
  const expected = program === 'namespace' ? 'namespace' : program === 'box' ? 'class-node' : 'class-note'
  const first = recipe.attributes[0]?.value
  if (first?.source !== 'metadata' || typeof first.value !== 'string' || (program === 'box' ? !first.value.startsWith(expected) : first.value !== expected)
    || names[0] !== 'class' || program === 'note' && names[1] !== 'data-note-index'
    || program !== 'note' && (names[1] !== 'data-id' || names[2] !== 'data-label')) throw new TypeError('Incomplete Class construction opening profile')
  // Every distinct metadata projection was charged by the initial recipe
  // capture's 5M text bound. Identity reuses captured data-id; note's native
  // numeric fallback is <=35 ASCII chars. <=9 final attrs + syntax fit200B.
  return 6 * 5_000_000 + 200
}

/** Exact retained data identity, used for transfer/accounting, never a public mark. */
export function constructionOperands(node: object): ConstructionOperands | undefined { return original.get(node) }

/** Materialize only the narrow operands required by the common typed writer.
 * Views are transient and are never passed through public map/species callbacks. */
export function originalConstructionNode(node: SceneNode | SvgEmissionNode): SvgEmissionNode {
  const operands = original.get(node)
  return operands ? emissionView(operands) : node
}

export function hasConstructionOperands(node: object): boolean { return original.has(node) }

export function transferConstructionOperands(source: object, target: object): void {
  const operands = original.get(source)
  if (operands) original.set(target, operands)
}

/** Private dense arrays do not dispatch caller-replaced map/species/iterators. */
function dense<T, U>(values: readonly T[], convert: (value: T) => U): U[] {
  const result: U[] = []
  const length = values.length
  for (let index = 0; index < length; index++) Object.defineProperty(result, index, {
    value: convert(values[index]!), enumerable: true, writable: true, configurable: true,
  })
  return result
}
function tail<const T extends unknown[]>(value: T): T {
  while (value.length && value[value.length - 1] === undefined) value.length--
  return value
}
function paintTuple(p: MarkPaint): Paint {
  return tail([p.fill, p.stroke, p.strokeWidth, p.strokeDasharray, p.strokeDashoffset, p.strokeLinecap,
    p.strokeLinejoin, p.strokeMiterlimit, p.vectorEffect, p.paintOrder, p.opacity])
}
function record<T extends object>(value: T): T { return Object.setPrototypeOf(value, null) }
function paintView(p: Paint): MarkPaint {
  return record({ fill: p[0], stroke: p[1], strokeWidth: p[2], strokeDasharray: p[3], strokeDashoffset: p[4],
    strokeLinecap: p[5], strokeLinejoin: p[6], strokeMiterlimit: p[7], vectorEffect: p[8], paintOrder: p[9], opacity: p[10] })
}
function geometryTuple(g: Geometry): Geo {
  switch (g.kind) {
    case 'rect': return tail(['rect', g.x, g.y, g.width, g.height, g.rx, g.ry])
    case 'line': return ['line', g.x1, g.y1, g.x2, g.y2]
    case 'circle': return ['circle', g.cx, g.cy, g.r]
    case 'ellipse': return ['ellipse', g.cx, g.cy, g.rx, g.ry]
    case 'path': return ['path', g.d]
    case 'polygon': case 'polyline': return [g.kind, dense(g.points, p => [p.x, p.y] as const)]
    case 'compound': return ['compound', dense(g.children, geometryTuple)]
  }
}
function geometryView(g: Geo): Geometry {
  switch (g[0]) {
    case 'rect': return record({ kind: 'rect', x: g[1], y: g[2], width: g[3], height: g[4], ...(g[5] !== undefined ? { rx: g[5] } : {}), ...(g[6] !== undefined ? { ry: g[6] } : {}) })
    case 'line': return record({ kind: 'line', x1: g[1], y1: g[2], x2: g[3], y2: g[4] })
    case 'circle': return record({ kind: 'circle', cx: g[1], cy: g[2], r: g[3] })
    case 'ellipse': return record({ kind: 'ellipse', cx: g[1], cy: g[2], rx: g[3], ry: g[4] })
    case 'path': return record({ kind: 'path', d: g[1] })
    case 'polygon': case 'polyline': return record({ kind: g[0], points: dense(g[1], p => record({ x: p[0], y: p[1] })) })
    case 'compound': return record({ kind: 'compound', children: dense(g[1], geometryView) })
  }
}
function baseTuple(node: SceneNode): Base {
  const identity = node.identity
  const value: Base[2] = !identity ? undefined : identity.id === node.id && identity.role === node.role && identity.from === undefined && identity.to === undefined
    ? true : [identity.id, identity.role, identity.from, identity.to]
  const extra = node.accessibility || node.transform || node.channels
    ? { ...(node.accessibility ? { accessibility: node.accessibility } : {}), ...(node.transform ? { transform: node.transform } : {}), ...(node.channels ? { channels: node.channels } : {}) } : undefined
  return extra ? [node.id, node.role, value, extra] : [node.id, node.role, value]
}
function baseView(id: string, role: SceneNode['role'], identity: Identity, extra: Extra | undefined): SceneNodeBase {
  return record({ id, role, ...(identity ? { identity: identity === true ? record({ id, role })
    : record({ id: identity[0], role: identity[1], ...(identity[2] !== undefined ? { from: identity[2] } : {}), ...(identity[3] !== undefined ? { to: identity[3] } : {}) }) } : {}), ...extra })
}
/** Add only an existing optional extra record. Required undefined scalar slots
 * remain actual entries; private assembly does not invoke an array iterator. */
function withExtra<const T extends unknown[]>(tuple: T, extra: Extra | undefined): readonly [...T, Extra?]
function withExtra(tuple: unknown[], extra: Extra | undefined): readonly unknown[] {
  if (extra !== undefined) Object.defineProperty(tuple, tuple.length, { value: extra, enumerable: true, writable: true, configurable: true })
  return tuple
}
function blockTuple(b: SvgTextBlock): Block {
  return [b.prepared.source, b.prepared.display, b.width, b.height, b.lineHeight, b.fontWeight, b.letterSpacing,
    dense(b.lineBlocks, line => tail([dense(line.runs, run => tail([run.text, run.bold, run.italic, run.underline, run.strikethrough]) as Run),
      line.width, line.originX, line.fragments ? dense(line.fragments, f => [f.runIndex, f.text, f.x, f.width] as const) : undefined]) as Line)]
}
function blockView(b: Block): SvgTextBlock {
  const lineBlocks = dense(b[7], line => record({ runs: dense(line[0], run => record({ text: run[0], bold: run[1], italic: run[2], underline: run[3], strikethrough: run[4] } satisfies SvgTextRun)),
    width: line[1], originX: line[2], ...(line[3] ? { fragments: dense(line[3], f => record({ runIndex: f[0], text: f[1], x: f[2], width: f[3] })) } : {}) }))
  return record({ prepared: record({ source: b[0], display: b[1] }), width: b[2], height: b[3], lineHeight: b[4], fontWeight: b[5], letterSpacing: b[6],
    lines: dense(lineBlocks, line => { let text = ''; for (let index = 0; index < line.runs.length; index++) text += line.runs[index]!.text; return text }), lineBlocks })
}
function emissionView(o: ConstructionOperands): SvgEmissionNode {
  const extra = o[0] === 'text' ? o.length > 15 ? o[15] : undefined
    : o[0] === 'shape' || o[0] === 'group' ? o.length > 6 ? o[6] : undefined
      : o.length > 5 ? o[5] : undefined
  const base = baseView(o[1], o[2], o[3], extra)
  let view: SvgEmissionNode
  switch (o[0]) {
    case 'shape': view = { ...base, kind: 'shape', geometry: geometryView(o[4]), paint: paintView(o[5]) }; break
    case 'text': {
      view = { ...base, kind: 'text', text: o[4], x: o[5], y: o[6], fontSize: o[7], anchor: o[8], paint: paintView(o[9]),
        ...(o[10] ? { block: blockView(o[10]) } : {}), measurement: o[11], fontWeight: o[12], letterSpacing: o[13], display: o[14] }
      break
    }
    case 'group': view = { ...base, kind: 'group', open: '', close: '</g>', join: o[4], children: dense(o[5], child => record({ node: emissionView(child[0]), indent: child[1] })) }; break
    case 'connector': view = { ...base, kind: 'connector', ...o[4] }; break
    case 'document': view = { ...base, kind: 'document', ...o[4] }; break
  }
  record(view)
  original.set(view, o)
  return view
}

function common(node: SceneNode): Pick<SceneNodeBase, 'id' | 'role' | 'identity' | 'accessibility' | 'transform' | 'channels'> {
  return {
    id: node.id, role: node.role,
    ...(node.identity ? { identity: { id: node.identity.id, role: node.identity.role,
      ...(node.identity.from !== undefined ? { from: node.identity.from } : {}), ...(node.identity.to !== undefined ? { to: node.identity.to } : {}) } } : {}),
    ...(node.accessibility ? { accessibility: node.accessibility } : {}),
    ...(node.transform ? { transform: node.transform } : {}),
    ...(node.channels ? { channels: node.channels } : {}),
  }
}

/** Copy only closed mark operands. The existing descriptor-copy owner handles
 * getter/prototype isolation, aliases, cycles and its real graph budgets. */
export function captureConstructionOperands(node: SceneNode): ConstructionOperands {
  let input: SceneNode
  switch (node.kind) {
    case 'shape': input = { ...common(node), kind: 'shape', geometry: node.geometry, paint: node.paint }; break
    case 'text': input = { ...common(node), kind: 'text', text: node.text, x: node.x, y: node.y, fontSize: node.fontSize, anchor: node.anchor, paint: node.paint,
      ...(node.block ? { block: node.block } : {}), ...(node.measurement ? { measurement: node.measurement } : {}),
      ...(node.fontWeight !== undefined ? { fontWeight: node.fontWeight } : {}), ...(node.letterSpacing !== undefined ? { letterSpacing: node.letterSpacing } : {}),
      ...(node.display !== undefined ? { display: node.display } : {}) }; break
    case 'group': {
      const head = common(node)
      const joinInput = node.join
      const selected = dense(node.children, child => {
        const operands = original.get(child.node)
        if (!operands) throw new TypeError('Class construction composition requires captured child operands')
        return [operands, child.indent] as const
      })
      const capturedHead = snapshotBoundedExternalData(head, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction') as SceneNodeBase
      const join = snapshotBoundedExternalData(joinInput, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction.join') as string
      const occurrences = dense(selected, child => Object.freeze([child[0], snapshotBoundedExternalData(child[1],
        EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction.indent') as number] as const))
      const base = snapshotBoundedExternalData(baseTuple({ ...capturedHead, kind: 'group', open: '', close: '', children: [], join }), EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction.base') as Base
      const tuple: ConstructionOperands = Object.freeze(withExtra(['group', base[0], base[1], base[2], join, Object.freeze(occurrences)], base.length > 3 ? base[3] : undefined))
      finishCapture(node, tuple)
      return tuple
    }
    case 'connector': input = { ...common(node), kind: 'connector', lineStyle: node.lineStyle, endpoints: node.endpoints, relationship: node.relationship,
      route: node.route, stroke: node.stroke, markers: node.markers, labels: node.labels, hit: node.hit, terminalProjection: node.terminalProjection }; break
    case 'document': input = { ...common(node), kind: 'document', element: node.element,
      ...(node.text !== undefined ? { text: node.text } : {}), ...(node.domId !== undefined ? { domId: node.domId } : {}),
      ...(node.markerResources !== undefined ? { markerResources: node.markerResources } : {}),
      ...(node.gradientResources !== undefined ? { gradientResources: node.gradientResources } : {}) }; break
  }
  // Preserve the original complete descriptor-capture boundary before reducing
  // the retained representation. This temporary full copy is not published.
  const copied = snapshotBoundedExternalData(input, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction') as Exclude<SceneNode, { kind: 'group' }>
  const base = baseTuple(copied)
  let tuple: ConstructionOperands
  switch (copied.kind) {
    case 'shape': tuple = withExtra(['shape', base[0], base[1], base[2], geometryTuple(copied.geometry), paintTuple(copied.paint)], base.length > 3 ? base[3] : undefined); break
    case 'text': tuple = withExtra(['text', base[0], base[1], base[2], copied.text, copied.x, copied.y, copied.fontSize, copied.anchor, paintTuple(copied.paint),
      copied.block ? blockTuple(copied.block) : undefined, copied.measurement, copied.fontWeight, copied.letterSpacing, copied.display], base.length > 3 ? base[3] : undefined); break
    case 'connector': tuple = withExtra(['connector', base[0], base[1], base[2], { lineStyle: copied.lineStyle, endpoints: copied.endpoints, relationship: copied.relationship,
      route: copied.route, stroke: copied.stroke, markers: copied.markers, labels: copied.labels, hit: copied.hit, terminalProjection: copied.terminalProjection }], base.length > 3 ? base[3] : undefined); break
    case 'document': tuple = withExtra(['document', base[0], base[1], base[2], { element: copied.element, ...(copied.text !== undefined ? { text: copied.text } : {}),
      ...(copied.domId !== undefined ? { domId: copied.domId } : {}), ...(copied.markerResources !== undefined ? { markerResources: copied.markerResources } : {}),
      ...(copied.gradientResources !== undefined ? { gradientResources: copied.gradientResources } : {}) }], base.length > 3 ? base[3] : undefined); break
  }
  const captured = snapshotBoundedExternalData(tuple, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'construction.operands') as ConstructionOperands
  finishCapture(node, captured)
  return captured
}

function finishCapture(node: SceneNode, tuple: ConstructionOperands): void {
  const active = new WeakSet<object>()
  const height = (value: unknown): number => {
    if (value === null || typeof value !== 'object') return -1
    if (active.has(value)) throw new TypeError('Construction operands must be acyclic')
    const prior = heights.get(value)
    if (prior !== undefined) return prior
    active.add(value)
    let result = 0
    for (const key of Object.keys(value)) result = Math.max(result, 1 + height((value as Record<string, unknown>)[key]))
    active.delete(value)
    if (result > EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS.maxDepth) throw new RangeError('Construction operand graph is too deeply nested')
    heights.set(value, result)
    return result
  }
  height(tuple)
  // Account the assembled shared graph before publication too. Reuse never
  // waives the ordinary per-object, aggregate, text, or per-reference height limits.
  const limits = EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS
  const total = { objects: 0, properties: 0, arrayEntries: 0, textBytes: 0, propertyKeyBytes: 0 }
  const consume = (counts: SvgEmissionMetadataCounts): void => {
    for (const key of ['objects', 'properties', 'arrayEntries', 'textBytes', 'propertyKeyBytes'] as const) total[key] += counts[key]
    if (total.objects > limits.maxObjects || total.properties > limits.maxAggregateProperties || total.arrayEntries > limits.maxAggregateArrayEntries
      || total.textBytes > limits.maxTextBytes || total.propertyKeyBytes > limits.maxAggregatePropertyKeyBytes) throw new RangeError('Construction operands exceed the aggregate Scene data limits')
  }
  const recipes = new WeakSet<object>()
  accountGraph(tuple, 0, new WeakSet(), limits, consume, value => {
    const recipe = sceneNodeEmission(value)
    if (recipe && !recipes.has(recipe)) { recipes.add(recipe); consume(svgEmissionMetadataCounts(recipe)) }
  })
  original.set(node, tuple)
}

/** The caller supplies only the existing private recipe/resource accounting
 * callback. No callback enters retained data or an SVG program. */
export function accountConstructionOperands(
  node: object, depth: number, seen: WeakSet<object>, limits: ExternalDataSnapshotLimits,
  consume: (counts: SvgEmissionMetadataCounts) => void, privateData: (value: object, depth: number) => void,
): void {
  const view = original.get(node)
  if (view) accountGraph(view, depth + 1, seen, limits, consume, privateData)
}

function accountGraph(view: ConstructionOperands, depth: number, seen: WeakSet<object>, limits: ExternalDataSnapshotLimits,
  consume: (counts: SvgEmissionMetadataCounts) => void, privateData: (value: object, depth: number) => void): void {
  const visit = (value: unknown, at: number): void => {
    if (value === null || typeof value !== 'object') return
    if (at + (heights.get(value) ?? 0) > limits.maxDepth) throw new RangeError('Construction operands exceed the enclosing Scene depth limit')
    if (seen.has(value)) return
    seen.add(value)
    privateData(value, at)
    const keys = Object.keys(value)
    const array = Array.isArray(value)
    if (array && value.length > limits.maxArrayEntries) throw new RangeError('Construction operands exceed the Scene array limit')
    if (!array && keys.length > limits.maxPropertiesPerObject) throw new RangeError('Construction operands exceed the Scene property limit')
    const counts: SvgEmissionMetadataCounts = { objects: 1, properties: array ? 0 : keys.length, arrayEntries: array ? value.length : 0,
      textBytes: 0, propertyKeyBytes: 0 }
    let textBytes = 0, propertyKeyBytes = 0
    for (const key of keys) {
      if (!array) {
        const bytes = boundedUtf8ByteLength(key, limits.maxPropertyKeyBytes)
        if (bytes > limits.maxPropertyKeyBytes) throw new RangeError('Construction operands exceed the Scene key limit')
        propertyKeyBytes += bytes
      }
      const child: unknown = (value as Record<string, unknown>)[key]
      if (typeof child === 'string') textBytes += boundedUtf8ByteLength(child, limits.maxTextBytes)
    }
    consume({ ...counts, textBytes, propertyKeyBytes })
    for (const key of keys) visit((value as Record<string, unknown>)[key], at + 1)
  }
  visit(view, depth)
}
