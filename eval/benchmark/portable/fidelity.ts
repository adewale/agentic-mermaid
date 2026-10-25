import { SaxesParser } from 'saxes'
import type { PortableCase, PortableEdge } from './cohorts.ts'

export interface FidelityCheck {
  name: string
  status: 'passed' | 'failed' | 'unmeasured'
  expected: unknown
  actual: unknown
  scope: string
}
export interface PortableOutput {
  svg?: unknown
  model?: unknown
  error?: unknown
  adapter?: string
}
export interface PortableQualification {
  accepted: boolean
  passed: boolean
  semanticComplete: boolean
  checks: FidelityCheck[]
  unmeasuredScopes: string[]
  scope: string
}
interface Element {
  tag: string
  uri: string
  attributes: Record<string, string>
  children: Element[]
  text: string
  parent?: Element
}
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
interface Point {
  x: number
  y: number
}
interface NativeTopology {
  nodes: string[]
  edges: (PortableEdge & { svgId?: string })[]
  groups?: { id: string; members: string[] }[]
  labels?: Record<string, string>
}
const namespace = 'http://www.w3.org/2000/svg'
const normalizedText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim()
const ordered = (values: readonly unknown[]) => [...values].map(value => JSON.stringify(value)).sort()
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const multiset = (values: readonly unknown[]) => ordered(values)
const pair = (value: PortableEdge) => [value.source, value.target]
const object = (value: unknown): Record<string, any> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined)
const entries = (value: unknown): [string, any][] => {
  const record = object(value)
  return value instanceof Map ? [...value.entries()] : record ? Object.entries(record) : []
}
const array = (value: unknown): any[] => (Array.isArray(value) ? value : [])

function parseSvg(svg: string): Element {
  let root: Element | undefined, current: Element | undefined, problem: Error | undefined
  const parser = new SaxesParser({ xmlns: true })
  parser.on('error', error => {
    problem ??= error
  })
  parser.on('opentag', tag => {
    const element: Element = { tag: tag.local, uri: tag.uri, attributes: Object.fromEntries(Object.values(tag.attributes).map(attribute => [attribute.name, attribute.value])), children: [], text: '', ...(current ? { parent: current } : {}) }
    if (!root) root = element
    current?.children.push(element)
    current = element
  })
  parser.on('text', text => {
    if (current) current.text += text
  })
  parser.on('cdata', text => {
    if (current) current.text += text
  })
  parser.on('closetag', () => {
    current = current?.parent
  })
  parser.write(svg).close()
  if (problem) throw problem
  if (!root || root.tag !== 'svg' || root.uri !== namespace) throw Error('Output is not a namespaced SVG root')
  return root
}
const all = (element: Element): Element[] => [element, ...element.children.flatMap(all)]
const hasClass = (element: Element, value: string) => element.attributes.class?.split(/\s+/).includes(value) ?? false
function visible(element: Element): boolean {
  for (let current: Element | undefined = element; current; current = current.parent) {
    const attributes = current.attributes,
      style = attributes.style ?? ''
    if (
      ['defs', 'metadata', 'style', 'script', 'title', 'desc'].includes(current.tag) ||
      attributes.display === 'none' ||
      ['hidden', 'collapse'].includes(attributes.visibility ?? '') ||
      attributes.opacity === '0' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:[;\s]|$)|font-size\s*:\s*0(?:px)?(?:[;\s]|$))/i.test(style)
    )
      return false
  }
  return true
}
function renderedText(element: Element): boolean {
  for (let current: Element | undefined = element; current; current = current.parent) {
    if (current.uri === namespace && ['text', 'tspan', 'textPath'].includes(current.tag)) return true
    if (element.uri === 'http://www.w3.org/1999/xhtml' && current.uri === namespace && current.tag === 'foreignObject') return true
  }
  return false
}
const textIn = (element: Element) =>
  normalizedText(
    all(element)
      .filter(item => visible(item) && renderedText(item))
      .map(item => item.text)
      .join(' '),
  )
const finiteLength = (value: string | undefined): number | undefined => (value !== undefined && /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?$/i.test(value.trim()) && Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : undefined)
function canvas(root: Element): boolean {
  const box = root.attributes.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box?.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return true
  return (finiteLength(root.attributes.width) ?? 0) > 0 && (finiteLength(root.attributes.height) ?? 0) > 0
}
function translation(element: Element): Point | undefined {
  const point = { x: 0, y: 0 }
  for (let current: Element | undefined = element; current; current = current.parent) {
    const transform = current.attributes.transform
    if (!transform) continue
    const match = /^translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)$/.exec(transform)
    if (!match) return undefined
    const x = Number(match[1]),
      y = Number(match[2] ?? 0)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    point.x += x
    point.y += y
  }
  return point
}
function shapeBounds(owner: Element): Bounds | undefined {
  const shape = owner.children.find(child => child.uri === namespace && visible(child) && ['rect', 'circle', 'ellipse', 'polygon'].includes(child.tag))
  if (!shape) return undefined
  const position = translation(shape)
  if (!position) return undefined
  const a = shape.attributes,
    n = (key: string, fallback = 0) => finiteLength(a[key]) ?? fallback
  let box: Bounds
  if (shape.tag === 'rect') box = { x: n('x'), y: n('y'), width: n('width'), height: n('height') }
  else if (shape.tag === 'circle' || shape.tag === 'ellipse') {
    const rx = n(shape.tag === 'circle' ? 'r' : 'rx'),
      ry = n(shape.tag === 'circle' ? 'r' : 'ry')
    box = { x: n('cx') - rx, y: n('cy') - ry, width: 2 * rx, height: 2 * ry }
  } else {
    const values = (a.points ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (values.length < 6 || values.length % 2 || !values.every(Number.isFinite)) return undefined
    const xs = values.filter((_value, index) => index % 2 === 0),
      ys = values.filter((_value, index) => index % 2 === 1)
    box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  return box.width > 0 && box.height > 0 ? { ...box, x: box.x + position.x, y: box.y + position.y } : undefined
}
/** Endpoint projection only. Curve interiors and crossings need a separate oracle. */
function pathEndpoints(path: Element): { start: Point; end: Point } | undefined {
  const tokens = path.attributes.d?.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)
  const shift = translation(path)
  if (!tokens?.length || !shift) return undefined
  let cursor = 0,
    command = '',
    current = { x: 0, y: 0 },
    start: Point | undefined,
    subpath = { x: 0, y: 0 },
    hasSegment = false
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }
  while (cursor < tokens.length) {
    if (/^[a-z]$/i.test(tokens[cursor]!)) command = tokens[cursor++]!
    const upper = command.toUpperCase(),
      relative = command !== upper
    if (upper === 'Z') {
      current = { ...subpath }
      command = ''
      continue
    }
    const count = arity[upper]
    if (!count || cursor + count > tokens.length) return undefined
    const values = tokens.slice(cursor, cursor + count).map(Number)
    if (!values.every(Number.isFinite)) return undefined
    cursor += count
    const previous = { ...current },
      origin = relative ? current : { x: 0, y: 0 }
    if (upper === 'H') current = { x: origin.x + values[0]!, y: current.y }
    else if (upper === 'V') current = { x: current.x, y: origin.y + values[0]! }
    else current = { x: origin.x + values[count - 2]!, y: origin.y + values[count - 1]! }
    if (upper === 'M') {
      start ??= { ...current }
      subpath = { ...current }
      command = relative ? 'l' : 'L'
    } else hasSegment ||= current.x !== previous.x || current.y !== previous.y || (['C', 'S', 'Q'].includes(upper) && values.slice(0, -2).some((value, index) => value + (index % 2 ? origin.y : origin.x) !== (index % 2 ? previous.y : previous.x)))
  }
  return start && hasSegment ? { start: { x: start.x + shift.x, y: start.y + shift.y }, end: { x: current.x + shift.x, y: current.y + shift.y } } : undefined
}
/** The reviewed Pele arrow head is a filled three-point path, with its tip first. */
function markerTriangle(path: Element): { tip: Point; base: Point } | undefined {
  const values = path.attributes.d?.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g),
    shift = translation(path)
  if (!values || !shift || values.length !== 10 || values[0] !== 'M' || values[3] !== 'L' || values[6] !== 'L' || values[9] !== 'Z') return undefined
  const [x, y, ax, ay, bx, by] = [values[1], values[2], values[4], values[5], values[7], values[8]].map(Number)
  if (![x, y, ax, ay, bx, by].every(Number.isFinite) || Math.abs((ax! - x!) * (by! - y!) - (ay! - y!) * (bx! - x!)) < 1e-6) return undefined
  return { tip: { x: x! + shift.x, y: y! + shift.y }, base: { x: (ax! + bx!) / 2 + shift.x, y: (ay! + by!) / 2 + shift.y } }
}
function arrowPointsInto(marker: { tip: Point; base: Point }, box: Bounds): boolean {
  const toward = { x: box.x + box.width / 2 - marker.tip.x, y: box.y + box.height / 2 - marker.tip.y }
  return distance(marker.tip, box) <= 12 && (marker.tip.x - marker.base.x) * toward.x + (marker.tip.y - marker.base.y) * toward.y > 0
}
function distance(point: Point, box: Bounds): number {
  const dx = Math.max(box.x - point.x, 0, point.x - box.x - box.width),
    dy = Math.max(box.y - point.y, 0, point.y - box.y - box.height)
  return dx || dy ? Math.hypot(dx, dy) : Math.min(point.x - box.x, box.x + box.width - point.x, point.y - box.y, box.y + box.height - point.y)
}
function contained(inner: Bounds, outer: Bounds) {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1
}
function nativeTopology(model: Record<string, any>): NativeTopology | undefined {
  const links = (items: any[], from: string, to: string) => items.map(item => ({ source: String(item[from]), target: String(item[to]), ...(typeof item.id === 'string' ? { svgId: item.id } : {}) }))
  switch (model.type) {
    case 'flowchart':
      return { nodes: entries(model.nodes).map(([key]) => key), edges: links(array(model.edges), 'start', 'end'), labels: Object.fromEntries(entries(model.nodes).map(([key, node]) => [key, node.text])), groups: array(model.subgraphs).map(group => ({ id: group.id, members: group.nodes })) }
    case 'sequence':
      return {
        nodes: entries(model.actors).map(([key]) => key),
        labels: Object.fromEntries(entries(model.actors).map(([key, actor]) => [key, actor.description ?? actor.name ?? key])),
        edges: links(
          array(model.messages).filter(item => item.from !== undefined && item.to !== undefined),
          'from',
          'to',
        ),
      }
    case 'class':
      return { nodes: entries(model.classes).map(([key]) => key), edges: links(array(model.relations), 'id1', 'id2'), labels: Object.fromEntries(entries(model.classes).map(([key, item]) => [key, item.label ?? key])) }
    case 'state':
      return { nodes: entries(model.states).map(([key]) => key), edges: links(array(model.relations), 'id1', 'id2'), labels: Object.fromEntries(entries(model.states).map(([key, item]) => [key, array(item.descriptions).join('\n') || key])) }
    case 'er': {
      const names = new Map(entries(model.entities).map(([key, entity]) => [entity.id, key]))
      return {
        nodes: entries(model.entities).map(([key]) => key),
        edges: array(model.relationships).map(item => ({ source: names.get(item.entityA) ?? String(item.entityA), target: names.get(item.entityB) ?? String(item.entityB) })),
        labels: Object.fromEntries(entries(model.entities).map(([key, item]) => [key, item.alias || item.label || key])),
      }
    }
    case 'architecture':
      return {
        nodes: entries(model.nodes).map(([key]) => key),
        edges: links(array(model.edges), 'lhsId', 'rhsId'),
        groups: entries(model.groups).map(([id]) => ({
          id,
          members: entries(model.nodes)
            .filter(([_key, node]) => node.in === id)
            .map(([key]) => key),
        })),
      }
    case 'requirement':
      return { nodes: [...entries(model.requirements), ...entries(model.elements)].map(([key]) => key), edges: links(array(model.relations), 'src', 'dst') }
    case 'sankey':
      return { nodes: array(model.nodes).map(node => node.id), edges: array(model.links).map(item => ({ source: item.source.id, target: item.target.id })) }
    case 'c4':
      return { nodes: array(model.shapes).map(item => item.alias), edges: links(array(model.rels), 'from', 'to') }
    default:
      return undefined
  }
}
function modelPath(model: unknown, path: (string | number | { map: string })[]): unknown {
  let current: any = model
  for (const key of path) {
    if (typeof key === 'object') {
      if (!(current instanceof Map)) return undefined
      current = current.get(key.map)
    } else {
      if (current === null || current === undefined) return undefined
      current = current[key]
    }
  }
  return current
}
const displayValue = (value: unknown): unknown => (typeof value === 'string' ? normalizedText(value) : Array.isArray(value) ? value.map(displayValue) : value)
function leafMembers(group: { id: string; members: string[] }, groups: { id: string; members: string[] }[], seen = new Set<string>()): string[] {
  if (seen.has(group.id)) return []
  seen.add(group.id)
  return [
    ...new Set(
      group.members.flatMap(member => {
        const child = groups.find(item => item.id === member)
        return child ? leafMembers(child, groups, new Set(seen)) : [member]
      }),
    ),
  ].sort()
}

function qualifyPortableUnchecked(testCase: PortableCase, output: PortableOutput): PortableQualification {
  const checks: FidelityCheck[] = [],
    unmeasuredScopes = ['Perceptual legibility, font metrics, text clipping and complete shape/path paint correspondence are not measured.']
  const accepted = output.error === undefined
  const check = (name: string, expected: unknown, actual: unknown, scope: string, available = true) => checks.push({ name, status: !available ? 'unmeasured' : same(expected, actual) ? 'passed' : 'failed', expected, actual: actual === undefined ? null : actual, scope })
  check('acceptance', testCase.expected.accept, accepted, 'Actual public renderer return versus exception; a non-SVG return is still acceptance and fails format separately.')
  if (!testCase.expected.accept || !accepted) return { accepted, passed: checks.every(item => item.status === 'passed'), semanticComplete: false, checks, unmeasuredScopes, scope: 'Public acceptance/rejection only; no positive rendered semantic witness.' }
  let root: Element | undefined
  try {
    if (typeof output.svg !== 'string') throw Error('Public renderer returned no SVG string')
    root = parseSvg(output.svg)
    check('svg-format', true, true, 'Strict XML and SVG root namespace.')
  } catch (error) {
    check('svg-format', 'valid namespaced SVG', String(error), 'Strict XML and SVG root namespace.')
  }
  check('positive-canvas', true, root ? canvas(root) : false, 'Positive finite viewBox or explicit width/height.')
  if (typeof testCase.renderOptions?.fontSize === 'number') {
    const style = root?.attributes.style ?? ''
    const size = /(?:^|;)\s*font-size\s*:\s*([\d.]+)px/.exec(style)?.[1] ?? /(?:^|;)\s*font\s*:\s*([\d.]+)px/.exec(style)?.[1]
    check('svg-root-font-size', testCase.renderOptions.fontSize, size === undefined ? null : Number(size), 'Authored fontSize is emitted as an SVG root font declaration. Computed CSS, glyph metrics and clipping remain unmeasured.')
  }
  const nodes = root ? all(root) : [],
    visibleText = root ? textIn(root) : ''
  for (const label of testCase.expected.labels) check('label:' + label, true, visibleText.includes(normalizedText(label)), 'Authored rendered text, excluding hidden/metadata/defs text; computed CSS and clipping remain unmeasured.')
  const ids = nodes.map(element => element.attributes.id).filter((id): id is string => !!id)
  check('svg-unique-ids', ids.length, new Set(ids).size, 'Document IDs must be unique; repeated data-id values are renderer-specific.')
  const model = object(output.model),
    topology = model ? nativeTopology(model) : undefined,
    expected = testCase.expected.topology
  const modelChecks = checks.length
  for (const assertion of testCase.expected.model ?? []) {
    const value = modelPath(output.model, assertion.path),
      display = assertion.comparison === 'display-text'
    check(
      'model:' + JSON.stringify(assertion.path),
      display ? displayValue(assertion.value) : assertion.value,
      display ? displayValue(value) : value,
      'Authored expected value against separately invoked public parse model; not a claim about painted output.' + (display ? ' Declared display-text comparison normalizes whitespace/NFC.' : ''),
      model !== undefined,
    )
  }
  if (expected) {
    check('model-node-identities', multiset(expected.nodes), multiset(topology?.nodes ?? []), 'Exact authored node identity multiset in public parse model.', topology !== undefined)
    check('model-edge-endpoints-and-multiplicity', multiset(expected.edges.map(pair)), multiset((topology?.edges ?? []).map(pair)), 'Directed endpoint pair multiset; parallel and reciprocal edges stay distinct.', topology !== undefined)
    if (model?.type === 'sequence') check('model-message-order', expected.edges.map(pair), (topology?.edges ?? []).map(pair), 'Authored message endpoint order is significant in a sequence diagram.', topology !== undefined)
    for (const [id, label] of Object.entries(expected.nodeLabels ?? {})) check('model-node-label:' + id, label, topology?.labels?.[id], 'Authored label belongs to its authored public-model node identity.', topology?.labels !== undefined)
    for (const group of expected.groups ?? []) {
      const actual = topology?.groups?.find(item => item.id === group.id)
      check('model-group-membership:' + group.id, leafMembers(group, expected.groups ?? []), actual ? leafMembers(actual, topology!.groups!) : null, 'Descendant leaf membership, normalizing nested group representation.', topology?.groups !== undefined)
    }
  }
  const nativeChecks = checks.slice(modelChecks)
  const nativeComplete = nativeChecks.length > 0 && nativeChecks.every(item => item.status === 'passed')
  let paintComplete = false
  if (expected && root && hasClass(root, 'pele') && ['flowchart', 'class', 'state', 'er'].includes(model?.type)) {
    const drawnNodes = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-node'))
    const drawnEdges = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-edge'))
    const drawnGroups = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-cluster'))
    const paintChecks = checks.length
    const flowchart = model!.type === 'flowchart'
    check('svg-family-owner', true, model!.type === testCase.family && hasClass(root, 'pele-' + testCase.family), 'The public model and owned SVG root identify the authored diagram family.')
    check('svg-owned-node-identities', multiset(expected.nodes), multiset(drawnNodes.map(element => element.attributes['data-id'])), 'Pele owned node groups; each authored node appears exactly once.')
    for (const [id, label] of Object.entries(expected.nodeLabels ?? {})) {
      const owners = drawnNodes.filter(element => element.attributes['data-id'] === id)
      check('svg-owned-node-label:' + id, true, owners.length === 1 && textIn(owners[0]!).includes(normalizedText(label)), 'Authored label is painted under its authored node owner.')
    }
    const bounds = new Map(drawnNodes.map(element => [element.attributes['data-id']!, shapeBounds(element)]))
    const geometryAvailable = drawnNodes.length === expected.nodes.length && [...bounds.values()].every(Boolean)
    const endpointOwner = (point: Point): string | undefined => {
      const candidates = [...bounds].filter(([_id, box]) => box && distance(point, box) <= 12)
      return candidates.length === 1 ? candidates[0]![0] : undefined
    }
    const observedEdges: PortableEdge[] = []
    let bindingsMeasured = true
    check(
      'svg-owned-edge-identities',
      true,
      drawnEdges.every(owner => !!owner.attributes['data-id']) && new Set(drawnEdges.map(owner => owner.attributes['data-id'])).size === drawnEdges.length,
      'Every drawn relation has a nonempty unique owner identity; duplicate data-id values cannot impersonate distinct parallel relations.',
    )
    for (const [index, owner] of drawnEdges.entries()) {
      const id = owner.attributes['data-id']
      const matches = (topology?.edges ?? []).filter(item => item.svgId === id)
      const ink = owner.children.filter(element => element.uri === namespace && element.tag === 'path' && !hasClass(element, 'pele-marker') && visible(element) && !!element.attributes.d)
      check(`svg-edge-owned-ink:${index}`, true, ink.length > 0, 'An owned edge needs rendered path data; IDs or text sidecars alone do not qualify.')
      const endpoints = ink[0] ? pathEndpoints(ink[0]) : undefined
      const geometricSource = endpoints ? endpointOwner(endpoints.start) : undefined,
        geometricTarget = endpoints ? endpointOwner(endpoints.end) : undefined
      const binding = flowchart ? (matches.length === 1 ? matches[0] : undefined) : geometricSource && geometricTarget ? { source: geometricSource, target: geometricTarget } : undefined
      if (!binding) bindingsMeasured = false
      else observedEdges.push(binding)
      const source = binding ? bounds.get(binding.source) : undefined,
        target = binding ? bounds.get(binding.target) : undefined
      const attachment = endpoints && source && target ? distance(endpoints.start, source) <= 12 && distance(endpoints.end, target) <= 12 : !flowchart && geometryAvailable && endpoints ? false : null
      check(
        `svg-edge-attachment:${index}`,
        true,
        attachment,
        'Connecting path endpoints touch their owned node bounding boxes within12px, allowing marker inset. Class/state/ER endpoints must each identify a unique visible owner. Curve interiors and exact shape boundaries remain unmeasured.',
        !!endpoints && (flowchart ? !!source && !!target : geometryAvailable),
      )
      const markers = owner.children.filter(element => element.uri === namespace && hasClass(element, 'pele-marker') && visible(element))
      if (model!.type === 'er') {
        const ends = markers
          .filter(marker => marker.tag === 'path')
          .map(pathEndpoints)
          .filter((points): points is { start: Point; end: Point } => !!points)
        check(
          `svg-edge-end-markers:${index}`,
          true,
          source && target ? ends.some(points => Math.min(distance(points.start, source), distance(points.end, source)) <= 12) && ends.some(points => Math.min(distance(points.start, target), distance(points.end, target)) <= 12) : null,
          'Visible cardinality path ink is attached to both entity ends. Exact cardinality glyph meaning is not independently asserted by this topology projection.',
          !!source && !!target,
        )
      } else {
        const triangles = markers
          .filter(marker => marker.tag === 'path')
          .map(markerTriangle)
          .filter((triangle): triangle is { tip: Point; base: Point } => !!triangle)
        const classProfile = model!.type !== 'class' || array(model!.relations).every(relation => relation.relation?.type1 === 'none' && relation.relation?.type2 === 3)
        check(
          `svg-edge-target-marker:${index}`,
          true,
          target ? triangles.some(triangle => arrowPointsInto(triangle, target)) : null,
          'The reviewed ordinary directed relation has a nondegenerate triangular arrowhead pointing into its logical target within12px. Other class relation marker profiles are unmeasured.',
          !!target && classProfile,
        )
      }
    }
    check(
      'svg-owned-edge-endpoints-and-multiplicity',
      multiset(expected.edges.map(pair)),
      multiset(observedEdges.map(pair)),
      flowchart ? 'Pele flowchart SVG edge ownership bound to public parse IDs and actual path ink.' : 'Class/state/ER actual path endpoints bind independently to unique owned node bounds; directed pair multiplicity is compared with authored expectations without guessing generated relation IDs.',
      bindingsMeasured,
    )
    check('svg-owned-edge-count', expected.edges.length, drawnEdges.length, 'Exact number of drawn edge owners, independently of model and labels.')
    for (const group of expected.groups ?? []) {
      const owner = drawnGroups.find(element => element.attributes['data-id'] === group.id),
        groupBox = owner ? shapeBounds(owner) : undefined
      const children = group.members.map(id => bounds.get(id) ?? (drawnGroups.find(element => element.attributes['data-id'] === id) ? shapeBounds(drawnGroups.find(element => element.attributes['data-id'] === id)!) : undefined))
      check('svg-group-containment:' + group.id, true, groupBox && children.every(Boolean) ? children.every(child => contained(child!, groupBox)) : null, 'Authored direct members are painted inside their owner cluster bounding box.', !!groupBox && children.every(Boolean))
    }
    paintComplete = checks.slice(paintChecks).every(item => item.status === 'passed')
    unmeasuredScopes.push(
      'Graph checks cover owner identity, declared label ownership, edge count/endpoints, approximate attachment, ordinary directed markers or ER endpoint marker ink, and optional group containment. Crossings, full curve geometry, arbitrary transforms, unasserted class member/ER cardinality meaning and undeclared label-owner assignments remain unmeasured.',
    )
  } else if (expected && root && hasClass(root, 'pele') && model?.type === 'sequence') {
    const paintChecks = checks.length
    const messages = array(model.messages),
      connections = messages.filter(message => message.from !== undefined && message.to !== undefined)
    const profile =
      connections.length === messages.length &&
      connections.every(message => [0, 1].includes(message.type) && message.from !== message.to && !message.activate && !message.centralConnection) &&
      !array(model.notes).length &&
      !array(model.boxes).length &&
      !entries(model.createdActors).length &&
      !entries(model.destroyedActors).length &&
      !entries(model.active).length &&
      entries(model.actors).every(([_id, actor]) => actor.type === 'participant')
    check('svg-sequence-message-profile', true, profile, 'Reviewed simple directed participant messages only; self, bidirectional, lifecycle, notes, boxes and control-block paint remain unmeasured.', profile)
    check('svg-family-owner', true, testCase.family === 'sequence' && hasClass(root, 'pele-sequence'), 'Public sequence model and owned SVG root identify the authored family.')
    const headers = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-actor') && !hasClass(element, 'pele-actor-footer'))
    const lifelines = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-lifeline'))
    check('svg-owned-node-identities', multiset(expected.nodes), multiset(headers.map(owner => owner.attributes['data-id'])), 'Exactly one actor header owns each identity; legitimate repeated footer actors are excluded from header counting.')
    check('svg-sequence-lifeline-identities', multiset(expected.nodes), multiset(lifelines.map(owner => owner.attributes['data-id'])), 'Each actor has exactly one visible owned lifeline.')
    const lines = new Map<string, { x: number; top: number; bottom: number }>()
    for (const owner of lifelines) {
      const points = owner.tag === 'path' ? pathEndpoints(owner) : undefined
      if (points && Math.abs(points.start.x - points.end.x) < 1e-6 && points.end.y > points.start.y) lines.set(owner.attributes['data-id']!, { x: points.start.x, top: points.start.y, bottom: points.end.y })
    }
    for (const [id, actor] of entries(model.actors)) {
      const owners = headers.filter(owner => owner.attributes['data-id'] === id),
        header = owners.length === 1 ? owners[0] : undefined
      const box = header ? shapeBounds(header) : undefined,
        line = lines.get(id)
      check('svg-sequence-actor-label:' + id, normalizedText(String(actor.description ?? actor.name ?? id)), header ? textIn(header) : null, 'Header text is owned by the corresponding public actor identity; independent authored label-owner fields remain separate.')
      check('svg-sequence-lifeline-header:' + id, true, box && line ? Math.abs(box.x + box.width / 2 - line.x) <= 1 && Math.abs(box.y + box.height - line.top) <= 1 : null, 'The owned vertical lifeline begins at the bottom center of its corresponding actor header.', !!box && !!line)
    }
    const ownerAt = (point: Point): string | undefined => {
      const candidates = [...lines].filter(([_id, line]) => Math.abs(point.x - line.x) <= 12 && point.y >= line.top - 1 && point.y <= line.bottom + 1)
      return candidates.length === 1 ? candidates[0]![0] : undefined
    }
    const drawn = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-edge') && hasClass(element, 'pele-message'))
    const projected = drawn
      .map(owner => {
        const ink = owner.children.filter(element => element.uri === namespace && visible(element) && element.tag === 'path' && !hasClass(element, 'pele-marker') && !!element.attributes.d)
        return { owner, ink, points: ink.length === 1 ? pathEndpoints(ink[0]!) : undefined }
      })
      .sort((left, right) => (left.points?.start.y ?? Infinity) - (right.points?.start.y ?? Infinity))
    check('svg-owned-edge-count', expected.edges.length, drawn.length, 'Exact painted message count, independent of public model and global labels.')
    check('svg-owned-edge-identities', true, drawn.every(owner => !!owner.attributes['data-id']) && new Set(drawn.map(owner => owner.attributes['data-id'])).size === drawn.length, 'Every painted message has a nonempty unique owner ID.')
    const observed: PortableEdge[] = [],
      order: number[] = []
    let endpointsMeasured = true
    for (const [index, item] of projected.entries()) {
      const points = item.points,
        from = points ? ownerAt(points.start) : undefined,
        to = points ? ownerAt(points.end) : undefined
      const horizontal = points ? Math.abs(points.start.y - points.end.y) <= 1 : false
      check('svg-sequence-message-attachment:' + index, true, !!from && !!to && horizontal, 'A simple message path connects two unique owned lifelines within12px. Self/control/lifecycle geometry is outside this projection.', !!points && lines.size === expected.nodes.length)
      if (from && to && horizontal) {
        observed.push({ source: from, target: to })
        order.push(points!.start.y)
      } else endpointsMeasured = false
      const sourceLine = from ? lines.get(from) : undefined,
        targetLine = to ? lines.get(to) : undefined
      const triangles = item.owner.children
        .filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-marker') && element.tag === 'path')
        .map(markerTriangle)
        .filter((triangle): triangle is { tip: Point; base: Point } => !!triangle)
      check(
        'svg-sequence-target-marker:' + index,
        true,
        sourceLine && targetLine && points ? triangles.some(marker => Math.abs(marker.tip.x - targetLine.x) <= 12 && Math.abs(marker.tip.y - points.end.y) <= 1 && (marker.tip.x - marker.base.x) * (targetLine.x - sourceLine.x) > 0) : null,
        'The nondegenerate message arrowhead points from its observed source toward the target lifeline.',
        !!sourceLine && !!targetLine && !!points && profile,
      )
      const labels = nodes.filter(element => element.uri === namespace && visible(element) && hasClass(element, 'pele-edge-label') && element.attributes['data-id'] === item.owner.attributes['data-id'])
      check(
        'svg-sequence-owned-message-label:' + index,
        normalizedText(String(connections[index]?.message ?? '')),
        labels.length === 1 ? textIn(labels[0]!) : null,
        'Message text belongs to the same SVG owner as the geometrically ordered public message; an unowned global text copy cannot substitute.',
        connections[index] !== undefined,
      )
    }
    check('svg-owned-edge-endpoints-and-multiplicity', expected.edges.map(pair), observed.map(pair), 'Authored directed message order and multiplicity are checked against actual path-to-lifeline bindings, without guessing renderer-generated message IDs.', endpointsMeasured)
    check(
      'svg-sequence-row-order',
      true,
      order.every((value, index) => index === 0 || value > order[index - 1]! + 1),
      'Simple messages occupy distinct successive rows in authored order; simultaneous/control-block layouts are outside this projection.',
      endpointsMeasured,
    )
    paintComplete = checks.slice(paintChecks).every(item => item.status === 'passed')
    unmeasuredScopes.push(
      'Sequence checks cover simple participant headers/lifelines and directed message geometry, order, multiplicity and public-model label ownership. Lifecycle/self/bidirectional/control-block/activation/box/note geometry, unasserted native label assignments and complete path/text paint remain unmeasured.',
    )
  } else {
    check('painted-semantic-correspondence', 'native semantic facts correspond to owned visible geometry', null, 'No reviewed renderer/family paint projection is available; label retention alone does not establish it.', false)
  }
  const complete = nativeComplete && paintComplete && checks.every(item => item.status === 'passed')
  return {
    accepted,
    passed: checks.every(item => item.status === 'passed'),
    semanticComplete: complete,
    checks,
    unmeasuredScopes,
    scope: complete
      ? model?.type === 'sequence'
        ? 'Declared simple sequence actor identities, ordered message endpoints and multiplicity plus owned lifelines, connecting path geometry, target arrows and public-model message label correspondence; not complete Mermaid or visual fidelity.'
        : `Declared ${testCase.family} native identities/endpoints plus owned SVG identities/ink/bounding-box attachment, scoped endpoint markers and optional group criteria; not complete Mermaid or visual fidelity.`
      : 'Public model facts and SVG admission, with painted semantic correspondence explicitly unmeasured where no reviewed projection exists.',
  }
}

/** An unreviewed result shape must fail its own record, not abort other projects. */
export function qualifyPortable(testCase: PortableCase, output: PortableOutput): PortableQualification {
  try {
    return qualifyPortableUnchecked(testCase, output)
  } catch (error) {
    return {
      accepted: output.error === undefined,
      passed: false,
      semanticComplete: false,
      checks: [{ name: 'qualification-protocol', status: 'failed', expected: 'Inspectable public result', actual: (error instanceof Error ? error.message : String(error)).slice(0, 1000), scope: 'The qualifier could not inspect the actual result; no semantic or timing qualification is inferred.' }],
      unmeasuredScopes: ['Qualification failed before all declared criteria could be checked.'],
      scope: 'Qualifier failure; partial observations are not a fidelity certificate.',
    }
  }
}
