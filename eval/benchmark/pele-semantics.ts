/** The published 1.9.0 renderer encodes endpoints on owned edge wrappers.
 * This adapter observes those wrappers, never Pele's separate input parser. */
import { decodeXML } from 'entities'
import type { PeerSemantic, TrackInput } from './peer-tracks.ts'
import { visitTypedPathSegments } from '../../src/scene/bounds.ts'
import { tryParseCssColor } from '../../src/shared/color-math.ts'

export const PELE_SEMANTIC_ADAPTER = Object.freeze({
  id: 'pele-1.9.0-rendered-ids-v1', peer: 'pele', version: '1.9.0',
  integrity: 'sha512-KUmBt7P5JduVKQaP6FKfXiRgH3LBVIKsmdgPJZU7jD3ye6F+Z8fbms+OjivE7rWY09Qx+5X65VKe/9ywKFJ9Sw==',
  archiveSha256: 'd9dd5bc81e8d4d5747a2af07d54e2b8b9e897bff49cc4af7612d219c3d70ba33',
  archiveUrl: 'https://registry.npmjs.org/pele/-/pele-1.9.0.tgz',
  sourceTagCommit: 'e7f092a4de147cc32210913c20e36eaa5fcd0ef1',
  families: ['flowchart', 'class', 'er'], unsupportedFamilies: ['sequence', 'state'],
  relationContract: 'rendered directed endpoint multiset; endpoint attachment geometry not asserted',
})

type Family = 'flowchart' | 'class' | 'er'
const attr = (tag: string, name: string) => decodeXML(tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1] ?? '')

/** Reject syntax which can override generated IDs, collapse endpoints, or make
 * authored entity names differ from labels. This is the enrolled fixture
 * grammar, not an alternative Mermaid parser or a successful-case selection. */
function fixtureFamily(input: TrackInput): Family | undefined {
  const lines = input.source.split('\n').map(line => line.trim()).filter(Boolean)
  const header = lines.shift()
  const id = '[A-Za-z_]\\w*'
  if (/^(?:flow5|tree\d+|mesh\d+)$/.test(input.id) && /^flowchart (?:TD|LR)$/.test(header ?? '')) {
    const node = `${id}(?:\\[[^\\[\\]{}<>|]*\\]|\\{[^\\[\\]{}<>|]*\\})?`
    const edge = new RegExp(`^${node}\\s*-->\\s*(?:\\|[^|<>]*\\|\\s*)?${node}$`)
    return lines.length && lines.every(line => edge.test(line)) ? 'flowchart' : undefined
  }
  const family = input.id === 'class80' && header === 'classDiagram' ? 'class'
    : input.id === 'er40' && header === 'erDiagram' ? 'er' : undefined
  if (!family) return undefined
  const declaration = new RegExp(`^${family === 'class' ? 'class\\s+' : ''}${id}\\s*\\{$`)
  const relation = new RegExp(family === 'class' ? `^${id}\\s*<\\|--\\s*${id}(?:\\s*:\\s*[^<>]*)?$` : `^${id}\\s*\\|\\|--o\\{\\s*${id}\\s*:\\s*[^<>]*$`)
  let body = false
  for (const line of lines) {
    if (body) {
      if (line === '}') body = false
      else if (!(family === 'class' ? /^[+~-][^{}<>]*$/ : /^(?:int|string)\s+\w+(?:\s+PK)?$/).test(line)) return undefined
    } else if (declaration.test(line)) body = true
    else if (!relation.test(line)) return undefined
  }
  return body ? undefined : family
}

interface Wrapper { id: string; ink: boolean; blocked: boolean }
function renderedWrappers(svg: string) {
  const nodes: Wrapper[] = [], edges: Wrapper[] = []
  const stack: Array<{ edge?: Wrapper; blocked: boolean; child: boolean; transformed: boolean; stroke: string; context: boolean; lineColor?: string }> = []
  let stylesheet = false
  for (const [tag, kind] of svg.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
    if (!kind) continue
    if (tag.startsWith('</')) { stack.pop(); continue }
    const parent = stack.at(-1)
    const firstChild = !parent?.child
    if (parent) parent.child = true
    if (kind === 'style') stylesheet = true
    const classes = attr(tag, 'class').split(/\s+/)
    const context = (!parent || parent.context) && (kind === 'svg' || kind === 'g')
    const style = attr(tag, 'style')
    const lineDeclarations = [...style.matchAll(/(?:^|;)\s*--_l\s*:([^;]+)/g)]
    const declaredLine = lineDeclarations[0]?.[1]?.trim()
    // Default Node render options emit this fallback; external CSS is outside
    // this standalone benchmark. Do not guess at other variable programs.
    const lineColor = declaredLine === undefined ? parent?.lineColor : lineDeclarations.length === 1 && kind === 'svg' && !parent && declaredLine === 'var(--pele-line,#1f1f1f)' ? '#1f1f1f' : undefined
    const blocked = !!parent?.blocked || /^(?:defs|clipPath|mask|symbol|marker|pattern|metadata|title|desc|style)$/.test(kind)
      || /\s(?:visibility|display|opacity|stroke-opacity|stroke-dasharray|stroke-dashoffset|clip-path|mask|filter)=/.test(tag)
      || /(?:^|;)\s*(?:display|visibility|opacity|stroke|stroke-width|stroke-opacity|stroke-dasharray|stroke-dashoffset|transform|clip-path|mask|filter|--pele-line)\s*:/.test(style)
      || (!!attr(tag, 'stroke-width') && !(Number(attr(tag, 'stroke-width')) > 0))
    const transformed = !!parent?.transformed || !!attr(tag, 'transform')
    const stroke = attr(tag, 'stroke') || parent?.stroke || 'none'
    const paint = tryParseCssColor(stroke === 'var(--_l)' ? lineColor ?? '' : stroke)
    if (kind === 'path' && parent?.edge && parent.context && firstChild && !classes.includes('pele-marker') && !blocked && !transformed && paint && paint[3] > 0) {
      let extent = false
      const valid = visitTypedPathSegments(attr(tag, 'd'), segment => {
        const box = segment.bounds
        if (box.x1 > box.x0 || box.y1 > box.y0) extent = true
        return true
      })
      if (valid && extent) parent.edge.ink = true
    }
    const node = kind === 'g' && classes.includes('pele-node'), edge = kind === 'g' && classes.includes('pele-edge')
    const wrapper = node || edge ? { id: attr(tag, 'data-id'), ink: false, blocked: blocked || !context } : undefined
    if (wrapper) (node ? nodes : edges).push(wrapper)
    if (!tag.endsWith('/>')) stack.push({ ...(edge ? { edge: wrapper } : {}), blocked, transformed, stroke, context, lineColor, child: false })
  }
  return { nodes, edges, stylesheet }
}

/** Decode against all rendered node identities, so A_B/C versus A/B_C is
 * rejected as ambiguous instead of guessing a split from the expected pairs. */
function endpoints(encoded: string, family: Family, nodes: Set<string>): Array<[string, string]> {
  const decode = (value: string) => {
    const name = family === 'er' ? value.match(/^entity-(.+)-(?:0|[1-9]\d*)$/)?.[1] : value
    return name && nodes.has(name) ? name : undefined
  }
  const candidates: Array<[string, string]> = []
  for (let index = 0; index < encoded.length; index++) if (encoded[index] === '_') {
    const from = decode(encoded.slice(0, index)), to = decode(encoded.slice(index + 1))
    if (from && to) candidates.push([from, to])
  }
  return candidates
}

export function inspectPeleSemantics(svg: string, input: TrackInput, expected: Array<[string, string]> | undefined): PeerSemantic {
  const result: PeerSemantic = { ok: false, checks: [], unsupported: [], failures: [] }
  const family = fixtureFamily(input)
  if (!family || !expected?.length) {
    result.unsupported.push(`${PELE_SEMANTIC_ADAPTER.id}: rendered endpoints unobservable for this family or source grammar`)
    return result
  }
  const { nodes, edges, stylesheet } = renderedWrappers(svg)
  if (stylesheet) result.unsupported.push('Pele stylesheet visibility is outside the pinned fixture contract')
  const ids = new Set(nodes.map(node => node.id))
  const declared = family === 'flowchart' ? [] : [...input.source.matchAll(new RegExp(`^\\s*${family === 'class' ? 'class\\s+' : ''}([A-Za-z_]\\w*)\\s*\\{`, 'gm'))].map(match => match[1]!)
  const wantedNodes = new Set([...expected.flat(), ...declared])
  if (nodes.some(node => node.blocked)) result.failures.push('Pele node wrapper is hidden or outside rendered content')
  if (ids.has('') || ids.size !== nodes.length) result.failures.push('missing or duplicate Pele node wrapper identities')
  if (ids.size !== wantedNodes.size || [...wantedNodes].some(id => !ids.has(id))) result.failures.push('Pele rendered node identities differ from authored endpoints')
  else result.checks.push(`${ids.size} authored node identities on Pele node wrappers`)
  const seen = new Set<string>(), actual = new Map<string, number>(), ordinals = new Map<string, number[]>()
  for (const edge of edges) {
    if (!edge.id || seen.has(edge.id)) result.failures.push('missing or duplicate Pele edge wrapper identities')
    seen.add(edge.id)
    if (!edge.ink) result.failures.push('Pele edge wrapper has no nonempty owned path')
    const match = edge.id.match(family === 'flowchart' ? /^L_(.+)_(0|[1-9]\d*)$/ : /^id_(.+)_(0|[1-9]\d*)$/)
    const ordinal = Number(match?.[2])
    if (!match || !Number.isSafeInteger(ordinal)) { result.failures.push('Pele edge identity does not match the pinned endpoint schema'); continue }
    const candidates = endpoints(match[1]!, family, ids)
    if (candidates.length > 1) { result.unsupported.push('ambiguous Pele rendered endpoint identity encoding'); continue }
    if (!candidates.length) { result.failures.push('Pele edge identity names absent rendered endpoints'); continue }
    const key = JSON.stringify(candidates[0])
    actual.set(key, (actual.get(key) ?? 0) + 1)
    const ordinalKey = family === 'flowchart' ? key : 'all'
    const values = ordinals.get(ordinalKey) ?? []
    values.push(ordinal)
    ordinals.set(ordinalKey, values)
  }
  const wanted = new Map<string, number>()
  for (const pair of expected) { const key = JSON.stringify(pair); wanted.set(key, (wanted.get(key) ?? 0) + 1) }
  if (!result.unsupported.length) {
    if (edges.length !== expected.length || actual.size !== wanted.size || [...wanted].some(([key, count]) => actual.get(key) !== count)) result.failures.push('Pele rendered directed endpoint multiset differs from authored relations')
    else result.checks.push(`${expected.length} authored directed endpoint occurrences on Pele edge wrappers`)
  }
  for (const values of ordinals.values()) {
    values.sort((a, b) => a - b)
    if (values.some((value, index) => value !== (family === 'flowchart' ? index === 0 ? 0 : index + 1 : index + (family === 'class' ? 1 : 0)))) result.failures.push('Pele edge occurrence ordinals differ from the pinned schema')
  }
  const supported = result.unsupported.length === 0
  result.unsupported.push('endpoint attachment geometry and full visual equivalence not asserted')
  result.checks.push(PELE_SEMANTIC_ADAPTER.id)
  result.ok = result.failures.length === 0 && supported
  return result
}
