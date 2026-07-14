import type { SvgSemanticIdentity } from './identity.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { sceneRoleTraits } from './roles.ts'

export interface SvgRelationSemantics {
  from: string
  to: string
  label?: string
}

/** Typed per-element accessibility carried beside Scene identity. */
export interface SvgSemanticAccessibility {
  label: string
  role: 'graphics-symbol'
  roleDescription: 'relation'
  relation: SvgRelationSemantics
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Build relation accessibility from typed Scene fields only. */
export function relationAccessibility(
  identity: SvgSemanticIdentity,
  label?: string,
): SvgSemanticAccessibility | undefined {
  if (!sceneRoleTraits(identity.role).relation) return undefined
  if (identity.from === undefined || identity.to === undefined) return undefined
  const relation: SvgRelationSemantics = {
    from: identity.from,
    to: identity.to,
    ...(label ? { label } : {}),
  }
  return {
    label: `${relation.from} to ${relation.to}${relation.label ? `: ${relation.label}` : ''}`,
    role: 'graphics-symbol',
    roleDescription: 'relation',
    relation,
  }
}

export function relationAccessibilityForSvg(
  svg: string,
  identity: SvgSemanticIdentity,
): SvgSemanticAccessibility | undefined {
  const opening = svg.match(/^\s*<[A-Za-z][\w:-]*\b[^>]*>/)?.[0] ?? ''
  const sourceLabel = opening.match(/\sdata-label="([^"]*)"/)?.[1]
  return relationAccessibility({
    ...identity,
    ...(identity.from !== undefined ? { from: decodeAttr(identity.from) } : {}),
    ...(identity.to !== undefined ? { to: decodeAttr(identity.to) } : {}),
  }, sourceLabel ? decodeAttr(sourceLabel) : undefined)
}

export function ensureSvgAccessibility(svg: string, accessibility: SvgSemanticAccessibility | undefined): string {
  if (!accessibility) return svg
  const opening = svg.match(/^\s*<[A-Za-z][\w:-]*\b[^>]*>/)?.[0]
  if (!opening) return svg
  const attrs: string[] = []
  if (!/\srole=/.test(opening)) attrs.push(`role="${accessibility.role}"`)
  if (!/\saria-roledescription=/.test(opening)) attrs.push(`aria-roledescription="${accessibility.roleDescription}"`)
  if (!/\saria-label=/.test(opening)) attrs.push(`aria-label="${escapeAttr(accessibility.label)}"`)
  if (attrs.length === 0) return svg
  const close = opening.endsWith('/>') ? '/>' : '>'
  const body = opening.slice(0, -close.length).trimEnd()
  return svg.replace(opening, `${body} ${attrs.join(' ')}${close === '/>' ? ' /' : ''}>`)
}
