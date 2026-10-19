/** Shared semantic decoration of private typed recipes. No SVG is inspected. */
import type { SceneNode, SceneRole } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { hasMarkerCss } from '../output-security.ts'
import { snapshotSvgEmissionRecipe, svgEmissionValue, svgValue as v, type SvgAttribute, type SvgEmissionRecipe } from './svg-emission.ts'

export function firstEmission(recipe: SvgEmissionRecipe): SvgEmissionRecipe {
  return recipe.kind === 'sequence' && recipe.children[0] ? firstEmission(recipe.children[0]) : recipe
}

export function emissionAttribute(recipe: SvgEmissionRecipe, name: string, node: SceneNode): string | undefined {
  const first = firstEmission(recipe)
  if (!('attributes' in first)) return undefined
  const attribute = first.attributes?.find(attribute => attribute.name === name)
  const value = attribute && svgEmissionValue(node, attribute.value)
  return value === undefined ? undefined : String(value)
}

export function emissionIdentity(recipe: SvgEmissionRecipe, fallback: { id: string; role: SceneRole }): SvgSemanticIdentity {
  // Metadata is captured before this function, so these reads cannot invoke
  // extension getters. Semantic refs resolve only once a mark exists.
  const node = { kind: 'document', element: 'content', ...fallback } as SceneNode
  const attr = (name: string) => emissionAttribute(recipe, name, node)
  const classNames = (attr('class') ?? '').split(/\s+/).filter(Boolean)
  const from = attr('data-from'), to = attr('data-to')
  return { id: attr('data-id') ?? fallback.id, role: fallback.role,
    ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}),
    ...(classNames.length ? { classNames } : {}) }
}

const DECORATED = new WeakMap<object, Map<number, SvgEmissionRecipe>>()

/** The same immutable decoration is shared by all marks with the same lexical
 * recipe and semantic capabilities; IDs and labels remain on the typed mark. */
export function decorateEmission(recipe: SvgEmissionRecipe, node: SceneNode, connector = false): SvgEmissionRecipe {
  const key = Number(hasDomSvgIdentityRole(node.role)) | (node.accessibility ? 2 : 0)
    | (connector ? 4 : 0) | (node.transform && connector ? 8 : 0)
    | (node.kind === 'connector' && node.markers.start ? 16 : 0)
    | (node.kind === 'connector' && node.markers.mid.length ? 32 : 0)
    | (node.kind === 'connector' && node.markers.end ? 64 : 0)
    | (node.identity?.from !== undefined ? 128 : 0) | (node.identity?.to !== undefined ? 256 : 0)
  let cache = DECORATED.get(recipe)
  const prior = cache?.get(key)
  if (prior) return prior
  if (connector) {
    const carrier = firstEmission(recipe)
    const check = (part: SvgEmissionRecipe): void => {
      if (part.kind === 'sequence') { for (const child of part.children) check(child); return }
      if (!('attributes' in part)) return
      const seen = new Set<string>()
      for (const attribute of part.attributes ?? []) {
        if (attribute.name === 'style' && (attribute.value.source !== 'style' || hasMarkerCss(String(svgEmissionValue(node, attribute.value) ?? '')))) throw new TypeError(`Connector "${node.id}" SVG shorthand/CSS bypasses typed markers`)
        if (!/^marker-(?:start|mid|end)$/.test(attribute.name)) continue
        const position = attribute.name.slice(7) as 'start' | 'mid' | 'end'
        if (part !== carrier || seen.has(attribute.name)) throw new TypeError(`Connector "${node.id}" has duplicate or non-carrier ${attribute.name}`)
        seen.add(attribute.name)
        if (attribute.value.source !== 'marker' || attribute.value.position !== position
          || node.kind !== 'connector' || !(position === 'mid' ? node.markers.mid.length : node.markers[position])) {
          throw new TypeError(`Connector "${node.id}" ${attribute.name} disagrees with typed markers`)
        }
      }
    }
    check(recipe)
  }
  const decorate = (first: SvgEmissionRecipe): SvgEmissionRecipe => {
    if (first.kind === 'sequence') {
      const child = first.children[0]
      if (!child) return first
      const decorated = decorate(child)
      return decorated === child ? first : { ...first, children: [decorated, ...first.children.slice(1)] }
    }
    if (first.kind !== 'primitive' && first.kind !== 'text' && first.kind !== 'group') return first
    const attributes = [...first.attributes]
    const tail: SvgAttribute[] = first.kind === 'text' ? [...first.tailAttributes ?? []] : attributes
    let changed = false
    const replaceAt = (list: SvgAttribute[], index: number, value: SvgAttribute['value']): void => {
      const current = list[index]!
      if (current.value.source === 'identity' && value.source === 'identity' && current.value.field === value.field) return
      list[index] = { ...current, value }
      changed = true
    }
    const set = (name: SvgAttribute['name'], value: SvgAttribute['value'], replace: boolean): void => {
      const index = attributes.findIndex(attribute => attribute.name === name)
      if (index >= 0) { if (replace) replaceAt(attributes, index, value); return }
      if (tail !== attributes) {
        const index = tail.findIndex(attribute => attribute.name === name)
        if (index >= 0) { if (replace) replaceAt(tail, index, value); return }
      }
      tail.push({ name, value })
      changed = true
    }
    if (connector) {
      for (const position of ['start', 'mid', 'end'] as const) {
        const present = node.kind === 'connector' && (position === 'mid' ? node.markers.mid.length : node.markers[position])
        if (present) set(`marker-${position}`, { source: 'marker', position }, false)
      }
      set('data-relationship', v.connector('relationshipKind'), false)
      set('data-direction', v.connector('direction'), false)
      if (node.transform) set('transform', v.transform(), false)
    }
    if (hasDomSvgIdentityRole(node.role)) {
      set('data-id', v.identity('id'), true); set('data-role', v.identity('role'), true)
      // Undefined projections produce no attribute, preserving the old presence
      // rules without specializing a recipe for each endpoint value.
      if (node.identity?.from !== undefined) set('data-from', v.identity('from'), true)
      if (node.identity?.to !== undefined) set('data-to', v.identity('to'), true)
    }
    if (node.accessibility) {
      set('role', v.accessibility('role'), false)
      set('aria-roledescription', v.accessibility('roleDescription'), false)
      set('aria-label', v.accessibility('label'), false)
    }
    const normalizeClose = first.kind === 'primitive' && first.close === '/>' && (hasDomSvgIdentityRole(node.role) || node.accessibility)
    if (!changed && !normalizeClose) return first
    return first.kind === 'text' ? { ...first, attributes, tailAttributes: tail }
      : normalizeClose
        ? { ...first, attributes, close: ' />' } : { ...first, attributes }
  }
  const decorated = snapshotSvgEmissionRecipe(decorate(recipe))
  if (!cache) DECORATED.set(recipe, cache = new Map())
  cache.set(key, decorated)
  return decorated
}
