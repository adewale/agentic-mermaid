// ============================================================================
// Page-safe style scoping for emitted SVG.
//
// An inline <svg> is part of its host document, so every rule in its <style>
// blocks applies to the whole page. Two diagrams of one family in different
// styles would otherwise repaint each other (the later rule wins). The final
// graphical pipeline therefore gives the root a class derived from the
// unscoped output and prefixes every selector with it, as upstream Mermaid
// does with the SVG id. Identical outputs share a scope because their rules
// are identical; any difference in output yields a different scope.
//
// Only descendant and class selectors are introduced: resvg (PNG) and every
// browser support them, which keeps raster and inline rendering in agreement.
// ============================================================================

import { hashId } from './scene/seed.ts'
import { replaceSvgRootStartTag, scanSvgStartTags, svgAttribute, svgRootStartTag } from './svg-structure.ts'

export const SVG_STYLE_SCOPE_PREFIX = 'am-'

/** Selector prefix for a scope: a root `svg` compound gains the class, and
 * every other selector becomes a descendant of the scoped root. */
export function scopeCssSelector(selector: string, scope: string): string {
  const leading = selector.match(/^\s*/)![0]
  const body = selector.slice(leading.length)
  if (body.length === 0) return selector
  const rootCompound = /^svg(?![\w-])/.exec(body)
  if (rootCompound) return `${leading}svg.${scope}${body.slice(3)}`
  return `${leading}.${scope} ${body}`
}

/** Split a selector list on top-level commas, ignoring commas inside strings,
 * attribute selectors, and functional pseudo-classes. */
function splitSelectorList(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i]!
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(' || char === '[') {
      depth++
    } else if (char === ')' || char === ']') {
      depth--
    } else if (char === ',' && depth === 0) {
      parts.push(prelude.slice(start, i))
      start = i + 1
    }
  }
  parts.push(prelude.slice(start))
  return parts
}

const GROUPING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document'])

/** Scope every style rule in a stylesheet. Declarations, comments, strings,
 * and non-grouping at-rules (`@import`, `@font-face`, `@keyframes`) are copied
 * byte-for-byte; grouping at-rules are scoped recursively. */
export function scopeCss(css: string, scope: string): string {
  let out = ''
  let cursor = 0
  let preludeStart = 0
  let quote: string | undefined
  let parenDepth = 0
  while (cursor < css.length) {
    const char = css[cursor]!
    if (quote) {
      if (char === '\\') cursor++
      else if (char === quote) quote = undefined
      cursor++
      continue
    }
    if (char === '/' && css[cursor + 1] === '*') {
      const end = css.indexOf('*/', cursor + 2)
      cursor = end < 0 ? css.length : end + 2
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      parenDepth++
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
    } else if (char === ';' && parenDepth === 0) {
      // A statement at-rule such as @import ends here; copy it unchanged.
      out += css.slice(preludeStart, cursor + 1)
      preludeStart = cursor + 1
    } else if (char === '{' && parenDepth === 0) {
      const blockEnd = matchingBrace(css, cursor)
      const prelude = css.slice(preludeStart, cursor)
      const block = css.slice(cursor + 1, blockEnd)
      out += scopedRule(prelude, block, scope)
      cursor = blockEnd + 1
      preludeStart = cursor
      continue
    }
    cursor++
  }
  return out + css.slice(preludeStart)
}

function scopedRule(prelude: string, block: string, scope: string): string {
  const comments = prelude.match(/^(?:\s*\/\*[\s\S]*?\*\/)*/)![0]
  const selectorText = prelude.slice(comments.length)
  const atRule = /^\s*@([\w-]+)/.exec(selectorText)
  if (atRule) {
    const name = atRule[1]!.toLowerCase()
    const inner = GROUPING_AT_RULES.has(name) ? scopeCss(block, scope) : block
    return `${prelude}{${inner}}`
  }
  const scoped = splitSelectorList(selectorText).map(selector => scopeCssSelector(selector, scope)).join(',')
  return `${comments}${scoped}{${block}}`
}

/** Index of the `}` closing the block opened at `open`, skipping strings and
 * comments; the end of input when the block is unterminated. */
function matchingBrace(css: string, open: number): number {
  let depth = 0
  let quote: string | undefined
  for (let i = open; i < css.length; i++) {
    const char = css[i]!
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = undefined
    } else if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) return css.length
      i = end + 1
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return css.length
}

/** The scope class carried by an emitted SVG root, if it has one. */
export function svgStyleScope(svg: string): string | undefined {
  const root = svgRootStartTag(svg)
  const classes = root ? svgAttribute(root, 'class')?.value.split(/\s+/) : undefined
  return classes?.find(token => token.startsWith(SVG_STYLE_SCOPE_PREFIX) && /^am-[0-9a-z]+$/.test(token))
}

/** Scope every `<style>` block of a complete SVG document to its own root. */
export function scopeSvgStyles(svg: string): string {
  const root = svgRootStartTag(svg)
  if (!root) return svg
  const styleRanges: Array<{ start: number; end: number }> = []
  for (const tag of scanSvgStartTags(svg)) {
    if (tag.name !== 'style' || tag.selfClosing) continue
    const close = svg.indexOf('</style', tag.end)
    if (close >= 0) styleRanges.push({ start: tag.end, end: close })
  }
  if (styleRanges.length === 0) return svg

  const scope = `${SVG_STYLE_SCOPE_PREFIX}${hashId(svg)}`
  let scoped = svg
  for (const range of [...styleRanges].sort((left, right) => right.start - left.start)) {
    scoped = `${scoped.slice(0, range.start)}${scopeCss(scoped.slice(range.start, range.end), scope)}${scoped.slice(range.end)}`
  }

  // The root precedes every <style>, so its offsets are unchanged above.
  const open = scoped.slice(root.start, root.end)
  const classAttribute = svgAttribute(root, 'class')
  const scopedOpen = classAttribute
    ? `${open.slice(0, classAttribute.valueEnd - root.start)}${classAttribute.value ? ' ' : ''}${scope}${open.slice(classAttribute.valueEnd - root.start)}`
    : `${open.slice(0, -1)} class="${scope}">`
  return replaceSvgRootStartTag(scoped, root, scopedOpen)
}
