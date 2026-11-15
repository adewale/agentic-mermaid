import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { renderSvgPixels } from './helpers/raster.ts'
import { prepareSvgForPngRasterization } from '../png-contract.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { colorPixelBoxInRaster } from './helpers/raster.ts'
import { resolveRenderRequest, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import type { SceneNode } from '../scene/ir.ts'
import type { RenderOptions } from '../types.ts'

const executablePath = process.env.AM_CHROMIUM
const available = executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath())
const describeBrowser = available && process.env.AM_BROWSER_TESTS === '1' ? describe : describe.skip
let browser: Browser

describeBrowser('native PNG and browser marker contact', () => {
  beforeAll(async () => { browser = await chromium.launch(executablePath ? { executablePath } : {}) })
  afterAll(async () => { await browser?.close() })

  test('family-owned endpoint glyphs agree across faces, styles and native/browser rasterizers', async () => {
    const cases: Array<{ source: string; options?: RenderOptions }> = []
    for (const direction of ['LR', 'RL', 'TB', 'BT']) {
      for (const relation of ['<|--', '--|>', '*--', '--*', 'o--', '--o', '<--', '-->', '()--', '--()']) {
        cases.push({ source: `classDiagram\ndirection ${direction}\nA ${relation} B` })
      }
      cases.push({ source: `flowchart ${direction}\nA <--> B` })
      cases.push({ source: `stateDiagram-v2\ndirection ${direction}\nA --> B` })
    }
    for (const [from, to] of [['L', 'R'], ['R', 'L'], ['T', 'B'], ['B', 'T']]) {
      cases.push({ source: `architecture-beta\nservice a(server)[A]\nservice b(database)[B]\na:${from} <--> ${to}:b`, options: { architecture: { visual: { edgeStroke: '#ff0000' } } } })
      cases.push({ source: `architecture-beta\njunction j\nservice b(database)[B]\nj:${from}<-->${to}:b` })
      for (const junctionFirst of [true, false]) cases.push({
        source: `---\ntitle: Junction connections\n---\narchitecture-beta\ngroup outer(cloud)[Outer]\ngroup g(cloud)[Group] in outer\njunction j in g\nservice b(database)[B] in g\n${junctionFirst ? `j:${from}<-->${to}:b` : `b:${from}<-->${to}:j`}\nalign ${from === 'L' || from === 'R' ? 'row' : 'column'} j b`,
        options: { architecture: { visual: { junctionOuterRadius: 20, edgeLineWidth: 3 } } },
      })
    }
    cases.push({ source: 'sequenceDiagram\nA<<->>B: filled\nB<<-->>A: reverse\nA<<->>A: self\nA-)B: open\nA-xB: cross\nA-|\\B: half top\nA-|/B: half bottom\nA\\|-B: start half top\nA/|-B: start half bottom\nA-\\\\B: stick top\nA-//B: stick bottom\nA\\\\-B: start stick top\nA//-B: start stick bottom' })
    cases.push({ source: 'journey\ntitle Work\nsection Today\nDone: 5: Me' })
    cases.push({ source: 'gantt\ndateFormat YYYY-MM-DD\nsection Work\nFirst :a, 2026-01-01, 1d\nNext :after a, 1d', options: { gantt: { dependencyArrows: true } } })
    const page = await browser.newPage()
    try {
      for (const input of cases) {
        for (const stroke of ['crisp', 'jittered', 'freehand'] as const) {
          const options: RenderOptions = { ...input.options, embedFontImport: false, seed: 7,
            style: { stroke, roles: { edge: { strokeColor: '#ff0000', lineWidth: 2 } } } }
          const native = decodePng(renderMermaidPNG(input.source, { ...options, scale: 1 }))
          const svg = prepareSvgForPngRasterization(renderMermaidSVG(input.source, options), {
            width: native.width, height: native.height, pixels: native.width * native.height,
          })
          const request = resolveRenderRequest(input.source, options)
          const scene = lowerPositionedFamilyScene(request, positionResolvedFamily(resolvedRenderExecutionPlanOf(request).family.id, request))
          const endpoints: Array<{ id: string; x: number; y: number }> = []
          const visit = (node: SceneNode): void => {
            if (node.kind === 'group') node.children.forEach(child => visit(child.node))
            if (node.kind !== 'connector') return
            for (const endpoint of ['start', 'end'] as const) {
              const point = node.endpoints[endpoint]?.point
              if (node.markers[endpoint] && point) endpoints.push({ id: `${node.id}/${endpoint}`, ...point })
            }
          }
          scene.parts.forEach(visit)
          expect(endpoints.length, `${scene.family}/${stroke}`).toBeGreaterThan(0)
          const regions = endpoints.map(point => ({ left: Math.max(0, Math.floor(point.x - 24)), right: Math.min(native.width, Math.ceil(point.x + 24)), top: Math.max(0, Math.floor(point.y - 24)), bottom: Math.min(native.height, Math.ceil(point.y + 24)) }))
          const web = await page.evaluate(async ({ source, regions }) => {
            const img = new Image()
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)))
            await img.decode()
            const canvas = document.createElement('canvas')
            canvas.width = img.width; canvas.height = img.height
            const context = canvas.getContext('2d')!
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, img.width, img.height)
            context.drawImage(img, 0, 0)
            const pixels = context.getImageData(0, 0, img.width, img.height).data
            return regions.map(region => {
              let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
              for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
                const i = (y * img.width + x) * 4
                const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!
                // Include family-authored translucency (Gantt dependencies).
                if (!(pixels[i + 3]! > 0 && r > 170 && r - g > 45 && r - b > 45)) continue
                left = Math.min(left, x); right = Math.max(right, x)
                top = Math.min(top, y); bottom = Math.max(bottom, y)
              }
              return { left, right, top, bottom }
            })
          }, { source: svg, regions })
          for (const [index, endpoint] of endpoints.entries()) {
            const a = colorPixelBoxInRaster({ width: native.width, height: native.height, pixels: native.rgba },
              (r, g, b, alpha) => alpha > 0 && r > 170 && r - g > 45 && r - b > 45, regions[index])
            const b = web[index]!
            for (const side of ['left', 'right', 'top', 'bottom'] as const) {
              // Styled rasterizers differ at faint/jittered edge pixels. This
              // is a bounded contact check, not a pixel-equality promise.
              expect(Math.abs(a[side] - b[side]), `${scene.family}/${stroke}/${endpoint.id}/${side}`).toBeLessThanOrEqual(3)
            }
          }
        }
      }
    } finally { await page.close() }
  }, 120_000)

  test('marker viewports clip wide tip strokes at the attachment plane', async () => {
    const page = await browser.newPage()
    try {
      for (const source of ['architecture-beta\njunction j\nservice b(database)[B]\nj:R<-->L:b', 'flowchart LR\nA ==> B', 'stateDiagram-v2\nstate fork_state <<fork>>\n[*] --> fork_state']) {
        await page.setContent(renderMermaidSVG(source, { embedFontImport: false, architecture: { visual: { junctionOuterRadius: 20, edgeLineWidth: 3 } } }))
        const overflow = await page.locator('marker').evaluateAll(markers => markers.map(marker => getComputedStyle(marker).overflow))
        expect(overflow.length).toBeGreaterThan(0)
        expect(overflow.every(value => value === 'hidden')).toBe(true)
      }
    } finally { await page.close() }
  })

  test('start reversal survives nonzero viewBoxes, marker units, clipping and carrier rotation', async () => {
    const { prepareResvgMarkerOrientation } = await import('../resvg-marker-orientation.ts')
    const page = await browser.newPage()
    try {
      for (const units of ['userSpaceOnUse', 'strokeWidth']) for (const angle of [0, 90, 180, 270]) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><defs><marker id="head" markerWidth="12" markerHeight="8" viewBox="10 20 12 8" refX="22" refY="24" markerUnits="${units}" orient="auto-start-reverse" overflow="hidden"><path d="M10 20 L22 24 L10 28Z" fill="#ff0000"/></marker></defs><line x1="60" y1="90" x2="120" y2="90" stroke="#111111" stroke-width="2" transform="rotate(${angle} 90 90)" marker-start="url(#head)" marker-end="url(#head)"/></svg>`
        const native = colorPixelBoxInRaster(renderSvgPixels(prepareResvgMarkerOrientation(svg)), (r, g, b, a) => a > 0 && r > 180 && g < 90 && b < 90)
        const web = await page.evaluate(async source => {
          const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(source); await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 180
          const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
          const pixels = ctx.getImageData(0, 0, 180, 180).data
          let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
          for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) {
            const i = (y * 180 + x) * 4
            if (!(pixels[i + 3]! > 0 && pixels[i]! > 180 && pixels[i + 1]! < 90 && pixels[i + 2]! < 90)) continue
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
          }
          return { left, right, top, bottom }
        }, svg)
        for (const side of ['left', 'right', 'top', 'bottom'] as const) expect(Math.abs(native[side] - web[side]), `${units}/${angle}/${side}`).toBeLessThanOrEqual(1)
      }
    } finally { await page.close() }
  })
})
