import { resolveStyleStack, type StyleInput } from '../scene/style-registry.ts'
import { DEFAULTS, resolveColors } from '../theme.ts'
import { legibleInk } from '../shared/color-math.ts'
import { safeCssColor } from '../shared/css-color.ts'

/** The optional renderer can recolor owned vendor marks; its fixed text metrics
 * cannot realize native Look geometry, typography or sketch effects. */
export interface ZenUMLAppearance {
  background: string
  foreground: string
  muted: string
  nodeFill: string
  nodeBorder: string
  nodeText: string
  edge: string
  edgeText: string
  groupFill: string
  groupBorder: string
  groupText: string
}

export function resolveZenUMLAppearance(input: StyleInput | StyleInput[]): ZenUMLAppearance {
  const style = resolveStyleStack(input)
  const unsupported = Object.keys(style ?? {}).filter(key => !['formatVersion', '$schema', 'name', 'blurb', 'colors', 'roles'].includes(key))
  for (const [role, fields] of Object.entries(style?.roles ?? {})) {
    const allowed = role === 'node' || role === 'group' ? ['fillColor', 'borderColor', 'textColor']
      : role === 'edge' ? ['strokeColor', 'textColor'] : role === 'label' ? ['textColor'] : []
    for (const field of Object.keys(fields)) if (!allowed.includes(field)) unsupported.push(`roles.${role}.${field}`)
  }
  if (unsupported.length) throw Error(`ZenUML cannot realize ${unsupported.join(', ')}; use a palette or node/edge/group/label paint colors.`)
  const colors = resolveColors({ ...DEFAULTS, ...style?.colors })
  const roles = style?.roles
  const nodeFill = roles?.node?.fillColor ?? colors.nodeFill
  const groupFill = roles?.group?.fillColor ?? colors.groupHdr
  const appearance = {
    background: colors.bg,
    foreground: roles?.label?.textColor ?? colors.text,
    muted: colors.textMuted,
    nodeFill,
    nodeBorder: roles?.node?.borderColor ?? colors.nodeStroke,
    nodeText: roles?.node?.textColor ?? legibleInk(roles?.label?.textColor ?? colors.text, nodeFill),
    edge: roles?.edge?.strokeColor ?? colors.line,
    edgeText: roles?.edge?.textColor ?? roles?.label?.textColor ?? colors.text,
    groupFill,
    groupBorder: roles?.group?.borderColor ?? colors.nodeStroke,
    groupText: roles?.group?.textColor ?? legibleInk(roles?.label?.textColor ?? colors.text, groupFill),
  }
  for (const [field, value] of Object.entries(appearance)) {
    if (!safeCssColor(value)) throw Error(`ZenUML ${field} requires a concrete, non-fetching color; unresolved CSS variables are unavailable.`)
  }
  return appearance
}
