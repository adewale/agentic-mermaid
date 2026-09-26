// An inline SVG's <style> rules apply to its whole host page. These properties
// state the scoping contract that keeps one diagram from repainting another:
//   1. the CSS rewrite prefixes exactly the selectors of style rules and copies
//      every declaration, comment, string, and non-grouping at-rule unchanged
//      (checked against a stylesheet model, not by re-parsing the output);
//   2. every real render, in every family and style, carries one root scope and
//      no unscoped selector, and the scope is a pure function of the output;
//   3. resvg rasterizes the scoped output to the same pixels as the unscoped
//      output, so PNG and inline rendering keep agreeing.
// The cross-diagram page property itself runs in a browser:
// svg-style-isolation-browser.test.ts.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'

import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { knownStyles, renderMermaidSVG } from '../index.ts'
import { scopeCss, svgStyleScope } from '../svg-style-scope.ts'

const SCOPE = 'am-test0'

type Selector = { kind: 'root' | 'other'; text: string }
type Rule =
  | { kind: 'style'; selectors: Selector[]; separators: string[]; body: string }
  | { kind: 'media'; query: string; rules: Rule[] }
  | { kind: 'verbatim'; text: string }

const identArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/)
const trickyStringArb = fc.constantFrom('"}{;,"', "'a,b{c}'", '"\\"}"', '"/* not a comment */"')

const compoundArb: fc.Arbitrary<string> = fc.oneof(
  identArb.map(name => `.${name}`),
  fc.tuple(fc.constantFrom('text', 'line', 'rect', 'path', 'g'), identArb).map(([tag, name]) => `${tag}.${name}`),
  fc.tuple(identArb, identArb).map(([a, b]) => `.${a}.${b}`),
  identArb.map(name => `.${name}:hover`),
  fc.tuple(identArb, trickyStringArb).map(([name, value]) => `[data-${name}=${value}]`),
  fc.tuple(identArb, identArb).map(([a, b]) => `:is(.${a}, .${b})`),
  fc.constant('text'),
)

const complexArb: fc.Arbitrary<string> = fc.tuple(
  compoundArb,
  fc.array(fc.tuple(fc.constantFrom(' ', ' > ', ' + ', ' ~ '), compoundArb), { maxLength: 2 }),
).map(([first, rest]) => first + rest.map(([combinator, compound]) => combinator + compound).join(''))

const selectorArb: fc.Arbitrary<Selector> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom('', '.xychart', ' text', ' > g').map(tail => ({ kind: 'root' as const, text: `svg${tail}` })) },
  { weight: 4, arbitrary: complexArb.map(text => ({ kind: 'other' as const, text })) },
)

const declarationArb = fc.oneof(
  fc.tuple(identArb, identArb).map(([property, value]) => `${property}: ${value};`),
  trickyStringArb.map(value => `content: ${value};`),
  fc.constant('background: url("data:image/svg+xml,%3Csvg%3E{}%3C/svg%3E");'),
  fc.constant('/* a { b } c */'),
  fc.constant('--_text: var(--fg);'),
)

const styleRuleArb: fc.Arbitrary<Rule> = fc.tuple(
  fc.array(selectorArb, { minLength: 1, maxLength: 3 }),
  fc.array(fc.constantFrom(',', ', ', ',\n  '), { minLength: 2, maxLength: 2 }),
  fc.array(declarationArb, { maxLength: 4 }),
).map(([selectors, separators, declarations]) => ({ kind: 'style', selectors, separators, body: ` ${declarations.join(' ')} ` }))

const verbatimArb: fc.Arbitrary<Rule> = fc.constantFrom(
  '@import url("https://example.test/a{b}.css");',
  '@font-face { font-family: "X{"; src: url(a.woff2); }',
  '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }',
  '/* .not-a-rule { color: red } */',
).map(text => ({ kind: 'verbatim', text }))

const ruleArb: fc.Arbitrary<Rule> = fc.oneof(
  { weight: 5, arbitrary: styleRuleArb },
  { weight: 1, arbitrary: verbatimArb },
  { weight: 1, arbitrary: fc.array(styleRuleArb, { minLength: 1, maxLength: 3 }).map(rules => ({ kind: 'media' as const, query: '@media (min-width: 10px) ', rules })) },
)

function renderRule(rule: Rule, scoped: boolean): string {
  if (rule.kind === 'verbatim') return rule.text
  if (rule.kind === 'media') return `${rule.query}{\n${rule.rules.map(inner => renderRule(inner, scoped)).join('\n')}\n}`
  const selectors = rule.selectors.map(selector => {
    if (!scoped) return selector.text
    return selector.kind === 'root' ? `svg.${SCOPE}${selector.text.slice(3)}` : `.${SCOPE} ${selector.text}`
  })
  return `${selectors.map((text, index) => index === 0 ? text : `${rule.separators[(index - 1) % 2]}${text}`).join('')} {${rule.body}}`
}

const stylesheetArb = fc.array(ruleArb, { minLength: 1, maxLength: 6 })

describe('style scoping rewrites selectors and nothing else', () => {
  it('matches the stylesheet model exactly', () => {
    fc.assert(
      fc.property(stylesheetArb, rules => {
        const css = `\n  ${rules.map(rule => renderRule(rule, false)).join('\n  ')}\n`
        const expected = `\n  ${rules.map(rule => renderRule(rule, true)).join('\n  ')}\n`
        expect(scopeCss(css, SCOPE)).toBe(expected)
      }),
      { numRuns: 300 },
    )
  })
})

const STYLE_NAMES = knownStyles()
const EXAMPLES = EDITOR_EXAMPLES

/** Top-level selectors of every style rule, with comments and strings removed.
 * Real renders carry only plain rules, so a flat scan is exact here. */
function ruleSelectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
  const selectors: string[] = []
  for (const match of stripped.matchAll(/(?:^|[;}])\s*([^{};]+?)\s*\{/g)) {
    const prelude = match[1]!.trim()
    if (prelude.startsWith('@')) continue
    selectors.push(...prelude.split(',').map(part => part.trim()))
  }
  return selectors
}

function styleText(svg: string): string {
  return [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]!).join('\n')
}

function unscoped(svg: string, scope: string): string {
  return svg
    .replace(` class="${scope}"`, '')
    .replace(` ${scope}"`, '"')
    .replaceAll(`svg.${scope}`, 'svg')
    .replaceAll(`.${scope} `, '')
}

const renderCaseArb = fc.record({
  example: fc.integer({ min: 0, max: EXAMPLES.length - 1 }),
  style: fc.integer({ min: 0, max: STYLE_NAMES.length }),
  idPrefix: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/), { nil: undefined }),
})

function renderCase(input: { example: number; style: number; idPrefix?: string }): string {
  const example = EXAMPLES[input.example]!
  const style = input.style < STYLE_NAMES.length ? STYLE_NAMES[input.style] : undefined
  return renderMermaidSVG(example.source, {
    ...(example.options ?? {}),
    ...(style ? { style } : {}),
    ...(input.idPrefix ? { idPrefix: `${input.idPrefix}-` } : {}),
  })
}

describe('every render scopes its styles to its own root', () => {
  it('carries one root scope, leaves no selector unscoped, and derives the scope from the output alone', () => {
    fc.assert(
      fc.property(renderCaseArb, input => {
        const svg = renderCase(input)
        const scope = svgStyleScope(svg)
        expect(scope).toBeDefined()
        const selectors = ruleSelectors(styleText(svg))
        expect(selectors.length).toBeGreaterThan(0)
        for (const selector of selectors) {
          expect(selector.startsWith(`.${scope} `) || selector === `svg.${scope}` || selector.startsWith(`svg.${scope}`)).toBe(true)
        }
        expect(renderCase(input)).toBe(svg)
      }),
      { numRuns: 60 },
    )
  })

  it('gives different outputs different scopes', () => {
    fc.assert(
      fc.property(renderCaseArb, renderCaseArb, (left, right) => {
        const a = renderCase(left)
        const b = renderCase(right)
        const scopeA = svgStyleScope(a)!
        const scopeB = svgStyleScope(b)!
        if (unscoped(a, scopeA) === unscoped(b, scopeB)) expect(scopeA).toBe(scopeB)
        else expect(scopeA).not.toBe(scopeB)
      }),
      { numRuns: 40 },
    )
  })
})

const FONT_DIR = join(import.meta.dir, '..', '..', 'assets', 'fonts')

function pixels(svg: string): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'zoom', value: 1 }, font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' } }).render().pixels
}

describe('scoping preserves raster output', () => {
  it('rasterizes the scoped and unscoped SVG to identical pixels', () => {
    fc.assert(
      fc.property(renderCaseArb, input => {
        const svg = renderCase(input)
        const plain = unscoped(svg, svgStyleScope(svg)!)
        expect(Buffer.from(pixels(svg)).equals(Buffer.from(pixels(plain)))).toBe(true)
      }),
      { numRuns: 24 },
    )
  })
})
