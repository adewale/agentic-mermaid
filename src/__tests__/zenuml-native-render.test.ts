import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFamily, layoutMermaidWithReceipt, renderMermaidSVG } from '../agent/core.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import type { SceneNode } from '../scene/ir.ts'
import type { RenderOptions } from '../types.ts'
import { colorPixelCountInRaster, redPixel, renderSvgPixels } from './helpers/raster.ts'

const checkout = readFileSync(join(import.meta.dir, '../../eval/layout-compare/fixtures/zenuml-native-checkout.mmd'), 'utf8')

test('native Zen retains caller direction, lexical branches and created participants in public geometry and owned Scene ink', () => {
  const options = { embedFontImport: false }
  const layout = layoutMermaidWithReceipt(checkout, options).layout
  expect(layout.kind).toBe('zenuml')
  expect(layout.nodes.map(node => node.id)).toEqual(['Buyer', 'API', 'Stock', 'ticket:Ticket'])
  expect(layout.edges.map(edge => [edge.from, edge.to, edge.label?.text])).toEqual([
    ['Buyer', 'API', 'checkout()'],
    ['API', 'Stock', 'reserve()'],
    ['Stock', 'API', 'accepted'],
    ['Stock', 'API', 'rejected'],
    ['API', 'ticket:Ticket', '«order»'],
    ['ticket:Ticket', 'API', 'ticket'],
    ['API', 'Buyer', 'ready'],
  ])
  expect(layout.nodes.find(node => node.id === 'Buyer')?.label).toBe('Customer')
  const labelled = (text: string) => layout.edges.find(edge => edge.label?.text.includes(text))!
  expect([labelled('checkout').from, labelled('checkout').to]).toEqual(['Buyer', 'API'])
  expect([labelled('reserve').from, labelled('reserve').to]).toEqual(['API', 'Stock'])
  for (const label of ['accepted', 'rejected']) expect([labelled(label).from, labelled(label).to]).toEqual(['Stock', 'API'])
  expect([labelled('ready').from, labelled('ready').to]).toEqual(['API', 'Buyer'])
  const conditional = layout.groups.find(group => group.label?.includes('available'))!
  expect(conditional).toBeDefined()
  expect(labelled('accepted').parentId).toBe(conditional.id)
  expect(labelled('rejected').parentId).toBe(conditional.id)
  expect(labelled('accepted').path[0]![1]).toBeLessThan(labelled('rejected').path[0]![1])
  expect(labelled('rejected').path[0]![1]).toBeLessThan(labelled('ready').path[0]![1])
  const created = layout.nodes.find(node => node.id === 'ticket:Ticket')!
  expect(created).toBeDefined()
  expect(created.y).toBeGreaterThan(layout.nodes.find(node => node.id === 'API')!.y)

  const request = resolveRenderRequest(checkout, options, 'svg')
  const positioned = positionResolvedFamily('zenuml', request).positioned
  const scene = getFamily('zenuml')!.lowerScene!({ positioned, colors: request.appearance.colors, resolved: { renderOptions: request.renderOptions } })
  expect(scene.family).toBe('zenuml')
  expect(validateSceneDoc(scene).diagnostics).toEqual([])
  const nodes: SceneNode[] = []
  const visit = (parts: SceneNode[]) => { for (const part of parts) { nodes.push(part); if (part.kind === 'group') visit(part.children.map(child => child.node)) } }
  visit(scene.parts)
  for (const edge of layout.edges) {
    const owner = nodes.find(node => node.id === edge.id && node.role === 'message')!
    expect(owner).toBeDefined()
    if (edge.parentId && owner.kind === 'group') expect(owner.open).toContain(`data-parent-id="${edge.parentId}"`)
    expect(owner.kind === 'group' && owner.children.some(({ node }) => node.kind === 'connector' && node.endpoints?.from === edge.from && node.endpoints?.to === edge.to)).toBe(true)
  }
  const receipt = renderMermaidASCIIWithReceipt(checkout, { useAscii: true, colorMode: 'none' })
  const terminal = terminalDocumentOf(receipt)!
  expect(terminal).toBeDefined()
  for (const edge of layout.edges) {
    const region = terminal.regions().find(region => region.id === edge.id && region.kind === 'edge')!
    expect(region).toBeDefined()
    expect([region.from, region.to, region.parentId]).toEqual([edge.from, edge.to, edge.parentId])
    expect(region.ownedCellSpans.length).toBeGreaterThan(0)
  }
  for (const text of ['Customer', 'checkout', 'reserve', 'accepted', 'rejected', 'available', 'ready']) expect(receipt.text).toContain(text)
})

test('native Zen uses full shared Looks, palettes and measured role paints on actual marks', () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom')
  for (const [look, palette] of [['patent-drawing', 'github-light'], ['hand-drawn', 'dracula'], ['watercolor', 'solarized-light']]) {
    const options: RenderOptions = { embedFontImport: false, style: [look!, palette!, { roles: { node: { fillColor: '#103050', fontSize: 22, paddingX: 18 }, edge: { strokeColor: '#ff0000', textColor: '#ff0000', lineWidth: 3 } } }] }
    const layout = layoutMermaidWithReceipt(checkout, options).layout
    const svg = renderMermaidSVG(checkout, options)
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' })
    try {
      expect(dom.window.document.querySelector('[data-id="Buyer"]')).not.toBeNull()
      expect(svg).toContain('#103050')
      const raster = renderSvgPixels(svg)
      for (const edge of layout.edges) {
        const end = edge.path.at(-1)!
        expect(colorPixelCountInRaster(raster, redPixel, { left: Math.floor(end[0] - 10), right: Math.ceil(end[0] + 10), top: Math.floor(end[1] - 9), bottom: Math.ceil(end[1] + 9) })).toBeGreaterThan(5)
      }
      for (const node of layout.nodes.filter(node => node.labelBounds && node.labelVisibility !== 'semantic')) {
        expect(node.labelBounds!.x).toBeGreaterThanOrEqual(0)
        expect(node.labelBounds!.x + node.labelBounds!.w).toBeLessThanOrEqual(layout.bounds.w + 1)
      }
    } finally { dom.window.close() }
  }
})

test('an implicit outside caller stays an incoming endpoint without a fabricated participant header or self-call', () => {
  const source = 'zenuml\nAPI.request() {\n API->Worker: dispatch\n}'
  const layout = layoutMermaidWithReceipt(source).layout
  const incoming = layout.edges.find(edge => edge.label?.text.includes('request'))!
  expect(incoming.from).not.toBe('API')
  expect(incoming.to).toBe('API')
  expect(layout.nodes.find(node => node.id === incoming.from)?.shape).toBe('external-anchor')
  expect(renderMermaidSVG(source, { embedFontImport: false })).not.toContain(`data-id="${incoming.from}"`)
})

test('adjacent empty and note-only branch scopes keep their parents and chronology in pixels and cells', () => {
  const source = `zenuml
@Starter(User)
User
Service
Service.run() {
  if(first) {
    while(retry) {
      // inside retry
    }
  } else {
    // first fallback
  }
  if(second) {
  } else {
    Service->User: completed
  }
}`
  const layout = layoutMermaidWithReceipt(source).layout
  const first = layout.groups.find(group => group.label === 'first')!
  const second = layout.groups.find(group => group.label === 'second')!
  const retry = layout.groups.find(group => group.label?.includes('retry'))!
  expect(layout.groups).toHaveLength(3)
  expect(retry.parentId).toBe(first.id)
  expect(retry.y).toBeGreaterThan(first.y)
  expect(retry.y + retry.h).toBeLessThanOrEqual(first.y + first.h)
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.h)
  const innerNote = layout.nodes.find(node => node.label === 'inside retry')!
  const fallback = layout.nodes.find(node => node.label === 'first fallback')!
  expect(innerNote.parentId).toBe(retry.id)
  expect(fallback.parentId).toBe(first.id)
  expect(first.members).toContain(fallback.id)
  expect(retry.members).toContain(innerNote.id)
  const receipt = renderMermaidASCIIWithReceipt(source, { useAscii: false, colorMode: 'none' })
  const regions = terminalDocumentOf(receipt)!.regions()
  for (const expected of [retry, innerNote, fallback]) expect(regions.find(region => region.id === expected.id)?.parentId).toBe(expected.parentId)
  for (const text of ['first', 'second', 'retry', 'inside retry', 'first fallback', 'completed']) expect(receipt.text).toContain(text)
})
