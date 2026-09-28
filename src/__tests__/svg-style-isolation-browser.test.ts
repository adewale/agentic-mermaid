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
import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'

import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { knownStyles, renderMermaidSVG } from '../index.ts'

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

  test('each diagram computes the same paint beside another diagram as it does alone', async () => {
    const page = await browser.newPage()
    await fc.assert(
      fc.asyncProperty(pairArb, async ([left, right]) => {
        const a = `<div id="a">${render(left, 'a-')}</div>`
        const b = `<div id="b">${render(right, 'b-')}</div>`
        expect(await paints(page, a + b, 'a')).toEqual(await paints(page, a, 'a'))
        expect(await paints(page, a + b, 'b')).toEqual(await paints(page, b, 'b'))
      }),
      { numRuns: 40 },
    )
    await page.close()
  })
})
