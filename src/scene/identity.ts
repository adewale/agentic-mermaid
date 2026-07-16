import type { SceneRole } from './roles.ts'
import { sceneRoleTraits } from './roles.ts'
import { escapeAttr } from '../multiline-utils.ts'

/** Public semantic identity carried by every structured Scene mark. */
export interface SvgSemanticIdentity {
  /** Stable within one rendered SVG and derived from source semantics. */
  id: string
  /** Core or namespaced Scene role; consumers never infer it from CSS classes. */
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
  const from = attr('data-from')
  const to = attr('data-to')
  return {
    id: attr('data-id') ?? fallback.id,
    role: fallback.role,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(classNames.length > 0 ? { classNames } : {}),
  }
}

export function hasDomSvgIdentityRole(role: SceneRole): boolean {
  return sceneRoleTraits(role).domIdentity
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

  const set = (source: string, name: string, value: string): string => {
    const encoded = escapeAttr(value)
    const pattern = new RegExp(`\\s${name}="[^"]*"`)
    if (pattern.test(source)) return source.replace(pattern, ` ${name}="${encoded}"`)
    const close = source.endsWith('/>') ? '/>' : '>'
    const body = source.slice(0, -close.length).trimEnd()
    return `${body} ${name}="${encoded}"${close === '/>' ? ' /' : ''}>`
  }
  let authoritativeOpening = set(set(opening, 'data-id', identity.id), 'data-role', identity.role)

  if (identity.from !== undefined) authoritativeOpening = set(authoritativeOpening, 'data-from', identity.from)
  if (identity.to !== undefined) authoritativeOpening = set(authoritativeOpening, 'data-to', identity.to)
  return authoritativeOpening === opening ? svg : svg.replace(opening, authoritativeOpening)
}
