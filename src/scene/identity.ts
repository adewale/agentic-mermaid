import type { SceneRole } from './ir.ts'
import { escapeAttr } from '../multiline-utils.ts'

/** Public semantic identity carried by every structured Scene mark. */
export interface SvgSemanticIdentity {
  /** Stable within one rendered SVG and derived from source semantics. */
  id: string
  /** Closed Scene role; consumers should not infer identity from CSS classes. */
  role: SceneRole
  /** Source endpoints when the mark is a relation. */
  from?: string
  to?: string
  /** Sanitized Mermaid class tokens preserved on the semantic element. */
  classNames?: readonly string[]
}

function readableIdentityAtom(value: string): boolean {
  return !value.includes('->') && !/[#:"\[\],\u0000-\u001f]/.test(value)
}

/** Keep established readable IDs for ordinary Mermaid identifiers while
 * switching delimiter-bearing source identities to an injective JSON tuple. */
export function semanticRelationId(from: string, to: string, prefix = ''): string {
  const body = readableIdentityAtom(from) && readableIdentityAtom(to)
    ? `${from}->${to}`
    : `relation:${JSON.stringify([from, to])}`
  return prefix ? `${prefix}:${body}` : body
}

export function semanticChildId(base: string, ...parts: Array<string | number>): string {
  const textParts = parts.map(String)
  return readableIdentityAtom(base) && textParts.every(readableIdentityAtom)
    ? [base, ...textParts].join(':')
    : `part:${JSON.stringify([base, ...textParts])}`
}

export function semanticNamespacedId(namespace: string, value: string, ...parts: Array<string | number>): string {
  const textParts = parts.map(String)
  return readableIdentityAtom(value) && textParts.every(readableIdentityAtom)
    ? [namespace, value, ...textParts].join(':')
    : `${namespace}:${JSON.stringify([value, ...textParts])}`
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function semanticIdentityForSvg(
  svg: string,
  fallback: Pick<SvgSemanticIdentity, 'id' | 'role'>,
): SvgSemanticIdentity {
  const opening = svg.match(/^\s*<([A-Za-z][\w:-]*)\b[^>]*>/)?.[0] ?? ''
  const attr = (name: string): string | undefined => {
    const value = opening.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
    return value === undefined ? undefined : decodeAttr(value)
  }
  const classNames = (attr('class') ?? '').split(/\s+/).filter(Boolean)
  const from = attr('data-from') ?? attr('data-entity1')
  const to = attr('data-to') ?? attr('data-entity2')
  return {
    id: attr('data-id') ?? fallback.id,
    role: fallback.role,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(classNames.length > 0 ? { classNames } : {}),
  }
}

const DOM_IDENTITY_ROLES = new Set<SceneRole>([
  'node', 'edge', 'group', 'actor', 'activation', 'message', 'block', 'note',
  'class-box', 'member', 'entity', 'attribute', 'relationship', 'cardinality',
  'pie-slice', 'bar', 'series', 'point', 'plate', 'section', 'task', 'milestone',
  'period', 'event', 'service', 'junction', 'title',
])

export function hasDomSvgIdentityRole(role: SceneRole): boolean {
  return DOM_IDENTITY_ROLES.has(role)
}

/**
 * Attach the all-family X4 identity attributes to the first source-semantic
 * SVG element in a crisp mark. Existing family-authored values win. Layout
 * furniture (grids, axes, halos, labels) keeps typed Scene identity but does
 * not bloat the DOM contract.
 */
export function ensureSvgIdentity(svg: string, identity: SvgSemanticIdentity): string {
  if (!hasDomSvgIdentityRole(identity.role)) return svg
  const opening = svg.match(/^\s*<([A-Za-z][\w:-]*)\b[^>]*>/)?.[0]
  if (!opening || opening.startsWith('<style') || opening.startsWith('<defs') || opening.startsWith('<svg')) return svg

  const attrs: string[] = []
  if (!/\sdata-id=/.test(opening)) attrs.push(`data-id="${escapeAttr(identity.id)}"`)
  if (!/\sdata-role=/.test(opening)) attrs.push(`data-role="${escapeAttr(identity.role)}"`)

  const legacyFrom = opening.match(/\sdata-entity1="([^"]*)"/)?.[1]
  const legacyTo = opening.match(/\sdata-entity2="([^"]*)"/)?.[1]
  const from = identity.from ?? legacyFrom
  const to = identity.to ?? legacyTo
  if (from !== undefined && !/\sdata-from=/.test(opening)) attrs.push(`data-from="${escapeAttr(from)}"`)
  if (to !== undefined && !/\sdata-to=/.test(opening)) attrs.push(`data-to="${escapeAttr(to)}"`)
  if (attrs.length === 0) return svg

  const close = opening.endsWith('/>') ? '/>' : '>'
  const body = opening.slice(0, -close.length).trimEnd()
  return svg.replace(opening, `${body} ${attrs.join(' ')}${close === '/>' ? ' /' : ''}>`)
}
