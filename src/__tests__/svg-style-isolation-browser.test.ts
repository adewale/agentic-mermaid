/**
 * Page isolation for inline SVG. Two diagrams inlined in one HTML document must
 * each compute the same paint as when they are alone; before style scoping, a
 * later diagram's rules repainted earlier diagrams of the same family (the
 * production Examples page lost 8 of 15 renders once its style gallery loaded).
 *
 * Browser lane only (`bun run test:browser`, AM_BROWSER_TESTS=1). AM_CHROMIUM
 * overrides the pinned browser executable.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'

import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { createMermaidRenderer, knownStyles, renderMermaidSVG } from '../index.ts'
import type { ProfileTextMeasurementInput } from '../text-measurement-profile.ts'

const chromiumExecutable = (() => {
  const override = process.env.AM_CHROMIUM
  if (override) {
    if (!existsSync(override)) throw new Error(`AM_CHROMIUM is set but no executable exists at: ${override}`)
    return override
  }
  try { return existsSync(chromium.executablePath()) ? undefined : null } catch { return null }
})()
const describeBrowser = chromiumExecutable !== null && process.env.AM_BROWSER_TESTS === '1'
  ? describe
  : describe.skip

const STYLE_NAMES = knownStyles()

interface RenderCase { example: number; style: number }

const caseArb = fc.record({
  example: fc.integer({ min: 0, max: EDITOR_EXAMPLES.length - 1 }),
  style: fc.integer({ min: 0, max: STYLE_NAMES.length }),
})

// Same family in two styles is the case that collided; mix it with arbitrary pairs.
const pairArb: fc.Arbitrary<[RenderCase, RenderCase]> = fc.oneof(
  fc.tuple(caseArb, fc.integer({ min: 0, max: STYLE_NAMES.length })).map(([left, style]): [RenderCase, RenderCase] => [left, { example: left.example, style }]),
  fc.tuple(caseArb, caseArb),
)

function render(input: RenderCase, idPrefix: string): string {
  const example = EDITOR_EXAMPLES[input.example]!
  const style = input.style < STYLE_NAMES.length ? STYLE_NAMES[input.style] : undefined
  return renderMermaidSVG(example.source, {
    ...(example.options ?? {}),
    ...(style ? { style } : {}),
    idPrefix,
    embedFontImport: false,
    security: 'strict',
  })
}

const PAINT_PROPERTIES = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'visibility', 'display']

async function paints(page: Page, html: string, containerId: string): Promise<string[]> {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`)
  return page.evaluate(({ id, properties }) => {
    const root = document.getElementById(id)!.querySelector('svg')!
    return [root, ...root.querySelectorAll('*')].map(element => {
      const style = getComputedStyle(element)
      return `${element.tagName}|${properties.map(name => style.getPropertyValue(name)).join('|')}`
    })
  }, { id: containerId, properties: PAINT_PROPERTIES })
}

let browser: Browser

describeBrowser('inline SVG diagrams do not repaint each other', () => {
  beforeAll(async () => {
    browser = await chromium.launch(chromiumExecutable ? { executablePath: chromiumExecutable } : {})
  })
  afterAll(async () => {
    await browser?.close()
  })

  test('computed fonts agree with measured roles while root retheming preserves explicit and inherited fonts', async () => {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    try {
      for (const source of [
        'flowchart TD\nsubgraph S[Header]\nA[Normal]\nend',
        'C4Container\nSystem_Boundary(S,"Header") {\nContainer(A,"Normal","Go")\n}',
        'classDiagram\nnamespace Header {\nclass Normal {\n+run()\n}\n}',
      ]) {
        const inputs: ProfileTextMeasurementInput[] = []
        const renderer = createMermaidRenderer({ textMeasurement: {
          id: 'test:computed-fonts', version: '1.0.0',
          measure(input) {
            inputs.push(input)
            return input.text.length * (input.fontFamily === 'Georgia' ? 30 : 10)
          },
        } })
        const svg = renderer.renderMermaidSVG(`---\ntitle: Runtime\n---\n${source}`, {
          font: 'Inter', embedFontImport: false,
          style: { roles: { group: { fontFamily: 'Georgia' } } },
        })
        for (const label of ['Runtime', 'Header']) expect(inputs.some(input => input.text === label && input.fontFamily === 'Georgia')).toBe(true)
        await page.setContent(svg)
        const fonts = await page.evaluate(() => {
          const root = document.querySelector('svg')!
          const context = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          context.setAttribute('font-family', 'Georgia')
          context.innerHTML = '<text>Context<tspan>Child</tspan></text>'
          root.append(context)
          const family = (node: Element) => getComputedStyle(node).fontFamily.split(',')[0]!.trim().replace(/["']/g, '')
          const snapshot = () => {
            const texts = [...root.querySelectorAll('text')]
            const title = texts.find(node => node.textContent === 'Runtime')!
            const header = texts.find(node => node !== title && node.getAttribute('font-family') === 'Georgia')!
            const normal = texts.find(node => node.textContent?.startsWith('Normal'))!
            const mono = root.querySelector('.mono')
            return {
              title: family(title), header: family(header), normal: family(normal),
              descendants: [...header.querySelectorAll('tspan')].map(family),
              context: [...context.querySelectorAll('text, tspan')].map(family),
              mono: mono ? family(mono) : undefined,
            }
          }
          const before = snapshot()
          root.style.setProperty('--font', 'Roboto')
          return { before, after: snapshot() }
        })
        for (const [snapshot, normal] of [[fonts.before, 'Inter'], [fonts.after, 'Roboto']] as const) {
          expect(snapshot.title).toBe('Georgia')
          expect(snapshot.header).toBe('Georgia')
          expect(snapshot.normal).toBe(normal)
          expect(snapshot.descendants.every(font => font === 'Georgia')).toBe(true)
          expect(snapshot.context).toEqual(['Georgia', 'Georgia'])
          if (source.startsWith('classDiagram')) {
            expect(snapshot.mono).toBe('JetBrains Mono')
            expect(inputs.some(input => input.monospace && input.fontFamily === 'JetBrains Mono')).toBe(true)
          }
        }
      }
    } finally { await page.close() }
  })

  test('each diagram computes the same paint beside another diagram as it does alone', async () => {
    const page = await browser.newPage()
    await fc.assert(
      fc.asyncProperty(pairArb, async ([left, right]) => {
        const a = `<div id="a">${render(left, 'a-')}</div>`
        const b = `<div id="b">${render(right, 'b-')}</div>`
        expect(await paints(page, a + b, 'a')).toEqual(await paints(page, a, 'a'))
        expect(await paints(page, a + b, 'b')).toEqual(await paints(page, b, 'b'))
      }),
      fcParameters({ numRuns: 40 }),
    )
    await page.close()
  })
})
