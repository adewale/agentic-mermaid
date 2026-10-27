import { decodeXML } from 'entities'
import { scanSvgStartTags } from '../svg-structure.ts'

/** A small SVG tree, independent of browser globals and XML/HTML DOMs. */
export interface SvgElement {
  tag: string
  attrs: Record<string, string>
  children: SvgElement[]
  parent?: SvgElement
  text: string
  owner: number
}

export function svgTree(svg: string, owners: readonly number[] = []): SvgElement {
  const starts = scanSvgStartTags(svg)
  const closes = [...svg.matchAll(/<\/([A-Za-z][\w:-]*)\s*>/g)]
  const stack: { node: SvgElement; start: number }[] = []
  let closeIndex = 0
  let root: SvgElement | undefined
  const closeBefore = (offset: number) => {
    while (closeIndex < closes.length && closes[closeIndex]!.index! < offset) {
      const close = closes[closeIndex++]!
      const entry = stack.pop()
      if (!entry || entry.node.tag !== close[1]) throw new Error('Malformed resolved SVG tree')
      entry.node.text = decodeXML(svg.slice(entry.start, close.index).replace(/<[^>]*>/g, ''))
    }
  }
  starts.forEach((token, index) => {
    closeBefore(token.start)
    const parent = stack.at(-1)?.node
    const node: SvgElement = {
      tag: token.name,
      attrs: Object.fromEntries(token.attributes.map(attr => [attr.name, decodeXML(attr.value)])),
      children: [], text: '', owner: owners[index] ?? -1,
      ...(parent ? { parent } : {}),
    }
    if (parent) parent.children.push(node)
    else if (!root) root = node
    else throw new Error('Resolved SVG has multiple roots')
    if (!token.selfClosing) stack.push({ node, start: token.end })
  })
  closeBefore(svg.length)
  if (!root || stack.length) throw new Error('Resolved SVG has no complete root')
  return root
}

export const CSS_DEFAULTS: Readonly<Record<string, string>> = {
  fill: '#000000', 'fill-opacity': '1', stroke: 'none', 'stroke-opacity': '1', 'stroke-width': '1',
  opacity: '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4',
  'fill-rule': 'nonzero', 'paint-order': 'normal', 'stroke-dasharray': 'none', 'stroke-dashoffset': '0',
  color: '#000000', 'font-size': '16', 'font-family': 'serif', 'font-weight': '400', 'font-style': 'normal',
  'text-anchor': 'start', 'dominant-baseline': 'auto', 'letter-spacing': 'normal',
  display: 'inline', visibility: 'visible', filter: 'none', 'clip-path': 'none', mask: 'none',
  'marker-start': 'none', 'marker-end': 'none', 'marker-mid': 'none',
}
const NON_INHERITED = new Set(['opacity', 'display', 'filter', 'clip-path', 'mask'])
type Declaration = { key: string; value: string; important: boolean }
interface Rule { selector: string; specificity: number; declarations: Declaration[] }

/** Split only outside CSS strings and functions (font stacks, var fallbacks). */
export function splitCss(value: string, separator: string): string[] {
  const out: string[] = []
  let quote = '', depth = 0, start = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === separator && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1 }
  }
  out.push(value.slice(start).trim())
  return out
}

function declarations(css: string): Declaration[] {
  return splitCss(css, ';').flatMap(decl => {
    const at = decl.indexOf(':')
    if (at < 0) return []
    const key = decl.slice(0, at).trim()
    const raw = decl.slice(at + 1).trim()
    return [{ key, value: raw.replace(/\s*!important\s*$/i, '').trim(), important: /!important\s*$/i.test(raw) }]
  })
}

function compoundMatches(node: SvgElement, selector: string): boolean {
  // Interactive pseudo-classes never apply to the static scene.
  if (selector.includes(':') && !selector.endsWith(':root')) return false
  if (selector.endsWith(':root')) {
    if (node.parent) return false
    selector = selector.slice(0, -5)
  }
  let valid = true
  const rest = selector.replace(/\[([\w:-]+)(?:\s*([~|^$*]?=)\s*["']?([^\]"']*?)["']?)?\]/g, (_, key: string, op: string, value: string) => {
    const attr = node.attrs[key]
    valid &&= op === undefined ? attr !== undefined : op === '=' ? attr === value
      : op === '~=' ? (attr ?? '').split(/\s+/).includes(value) : false
    return ''
  }).replace(/([.#])([\w-]+)/g, (_, kind: string, value: string) => {
    valid &&= kind === '#' ? node.attrs.id === value : (node.attrs.class ?? '').split(/\s+/).includes(value)
    return ''
  })
  return valid && (rest === '' || rest === '*' || rest === node.tag)
}

function matches(node: SvgElement, selector: string): boolean {
  const parts = selector.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/)
  let current: SvgElement | undefined = node
  let index = parts.length - 1
  if (!compoundMatches(node, parts[index--]!)) return false
  while (index >= 0) {
    const direct = parts[index] === '>'
    if (direct) index--
    const part = parts[index--]!
    current = current?.parent
    while (current && !compoundMatches(current, part) && !direct) current = current.parent
    if (!current || !compoundMatches(current, part)) return false
  }
  return true
}

export function cssRules(root: SvgElement): Rule[] {
  const rules: Rule[] = []
  const visit = (node: SvgElement) => {
    if (node.tag === 'style') {
      const css = node.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '')
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[1]!.trim().startsWith('@')) continue
        for (const selector of splitCss(match[1]!, ',')) {
          const specificity = (selector.match(/#[\w-]+/g)?.length ?? 0) * 100
            + (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)?.length ?? 0) * 10
            + (selector.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g)?.length ?? 0)
          rules.push({ selector, specificity, declarations: declarations(match[2]!) })
        }
      }
    }
    node.children.forEach(visit)
  }
  visit(root)
  return rules
}

export function resolveVars(value: string, style: Record<string, string>, depth = 0): string {
  if (depth > 32) throw new Error('Unresolved or cyclic CSS var()')
  let result = '', cursor = 0
  while (true) {
    const start = value.indexOf('var(', cursor)
    if (start < 0) return result + value.slice(cursor)
    let end = start + 4, nesting = 1
    while (end < value.length && nesting) {
      if (value[end] === '(') nesting++
      else if (value[end] === ')') nesting--
      end++
    }
    if (nesting) throw new Error('Malformed CSS var()')
    const [name, ...fallback] = splitCss(value.slice(start + 4, end - 1), ',')
    const replacement = style[name!] ?? (fallback.length ? fallback.join(',') : undefined)
    if (replacement === undefined) throw new Error(`Unresolved CSS variable ${name}`)
    result += value.slice(cursor, start) + resolveVars(replacement, style, depth + 1)
    cursor = end
  }
}

export function computedStyle(node: SvgElement, parent: Record<string, string> | undefined, rules: Rule[]): Record<string, string> {
  const style: Record<string, string> = { ...CSS_DEFAULTS }
  if (parent) for (const [key, value] of Object.entries(parent)) if (!NON_INHERITED.has(key)) style[key] = value
  const ranks = new Map<string, number>()
  const apply = (decl: Declaration, specificity: number) => {
    const rank = (decl.important ? 1e6 : 0) + specificity
    if (rank < (ranks.get(decl.key) ?? -1)) return
    ranks.set(decl.key, rank)
    style[decl.key] = decl.value === 'inherit' || (decl.value === 'unset' && !NON_INHERITED.has(decl.key))
      ? parent?.[decl.key] ?? CSS_DEFAULTS[decl.key] ?? ''
      : decl.value === 'initial' || decl.value === 'unset' ? CSS_DEFAULTS[decl.key] ?? '' : decl.value
  }
  for (const [key, value] of Object.entries(node.attrs)) if (key in CSS_DEFAULTS) apply({ key, value, important: false }, 0)
  for (const rule of rules) if (matches(node, rule.selector)) for (const decl of rule.declarations) apply(decl, rule.specificity + 1)
  for (const decl of declarations(node.attrs.style ?? '')) apply(decl, 10000)
  // Custom properties inherit their computed value, so a child's override
  // cannot change an alias that was already resolved on an ancestor.
  const custom = { ...style }
  for (const [key, value] of Object.entries(custom)) if (key.startsWith('--')) {
    try { style[key] = resolveVars(value, custom) } catch { delete style[key] }
  }
  for (const [key, value] of Object.entries(style)) if (!key.startsWith('--')) style[key] = resolveVars(value, style)
  // Resolve font-relative values here, before descendants inherit them.
  const size = style['font-size']!
  style['font-size'] = computedNumber(cssLength(size, Number(parent?.['font-size'] ?? 16), 16))
  if (style['font-weight'] === 'normal') style['font-weight'] = '400'
  if (style['font-weight'] === 'bold') style['font-weight'] = '700'
  if (style['font-weight'] === 'bolder') style['font-weight'] = Number(parent?.['font-weight'] ?? 400) < 400 ? '400' : Number(parent?.['font-weight'] ?? 400) < 600 ? '700' : '900'
  if (style['font-weight'] === 'lighter') style['font-weight'] = Number(parent?.['font-weight'] ?? 400) < 600 ? '100' : Number(parent?.['font-weight'] ?? 400) < 800 ? '400' : '700'
  for (const key of ['stroke-width', 'stroke-dashoffset', 'letter-spacing']) {
    if (style[key] !== 'normal') style[key] = computedNumber(cssLength(style[key]!, Number(style['font-size'])))
  }
  if (style['stroke-dasharray'] !== 'none') {
    style['stroke-dasharray'] = style['stroke-dasharray']!.split(/[\s,]+/).map(value => computedNumber(cssLength(value, Number(style['font-size'])))).join(' ')
  }
  for (const key of ['opacity', 'fill-opacity', 'stroke-opacity']) {
    const value = style[key]!
    const number = Number(value.endsWith('%') ? value.slice(0, -1) : value) / (value.endsWith('%') ? 100 : 1)
    if (!Number.isFinite(number)) throw new Error(`Unsupported ${key}: ${value}`)
    style[key] = computedNumber(Math.max(0, Math.min(1, number)))
  }
  style['stroke-miterlimit'] = computedNumber(Number(style['stroke-miterlimit']))
  const normalOrder = ['fill', 'stroke', 'markers']
  const authoredOrder = style['paint-order'] === 'normal' ? [] : style['paint-order']!.split(/\s+/)
  const fullOrder = [...authoredOrder, ...normalOrder.filter(phase => !authoredOrder.includes(phase))]
  // CSSOM omits a suffix whose order is already implied by the defaults:
  // "stroke fill" and "stroke fill markers" both compute to "stroke".
  for (let size = 0; size <= fullOrder.length; size++) {
    const prefix = fullOrder.slice(0, size)
    const expanded = [...prefix, ...normalOrder.filter(phase => !prefix.includes(phase))]
    if (expanded.join(' ') === fullOrder.join(' ')) {
      style['paint-order'] = prefix.join(' ') || 'normal'
      break
    }
  }
  return style
}

/** CSSOM serializes computed SVG numeric values from float storage to six
 * significant digits. Geometry attributes themselves retain their doubles. */
function computedNumber(value: number): string {
  const rounded = Math.fround(value)
  if (!Number.isFinite(rounded)) throw new Error('Non-finite computed CSS value')
  return String(Number(rounded.toPrecision(6)))
}

export function cssLength(value: string, fontSize: number, rootSize = 16): number {
  const match = value.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?)(px|em|rem|pt|pc|in|cm|mm|q)?$/i)
  if (!match) throw new Error(`Unsupported length "${value}"`)
  const scale: Record<string, number> = { px: 1, em: fontSize, rem: rootSize, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 }
  const result = Number(match[1]) * (scale[match[2]?.toLowerCase() ?? 'px'] ?? 1)
  if (!Number.isFinite(result)) throw new Error(`Non-finite length "${value}"`)
  return result
}
