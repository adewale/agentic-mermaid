/**
 * Flowchart typed runtime config: wire-or-warn (plan §Flowchart 6, P4).
 *
 * Config contract (verified against the upstream flowchart config schema
 * 2026-07-10, https://mermaid.js.org/config/schema-docs/…flowchart…):
 *   WIRED — nodeSpacing (→ RenderOptions.nodeSpacing → ELK nodeNode),
 *           rankSpacing (→ RenderOptions.layerSpacing → ELK betweenLayers),
 *           wrappingWidth (measured-pixel auto-wrap of node labels at layout
 *           sizing; upstream default 200 applies ONLY to markdown-string
 *           labels — regular labels wrap only when the key is explicit, so
 *           existing corpus geometry cannot drift).
 *   LINT  — every other documented key (curve, htmlLabels, padding,
 *           diagramPadding, titleTopMargin, subGraphTitleMargin,
 *           arrowMarkerAbsolute, defaultRenderer, inheritDir) emits the
 *           INEFFECTIVE_CONFIG Tier-3 lint (journey/class/er pattern).
 */
import { describe, it, expect } from 'bun:test'
import { decodeXML } from 'entities'

import { parseMermaid as parseGraph } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { resolveLabelContent, preparedDisplayTextValue } from '../shared/display-text.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { verifyMermaid } from '../agent/index.ts'
import {
  applyFlowchartLabelWrapping,
  resolveFlowchartRenderOptions,
} from '../flowchart-config.ts'
import { preprocessMermaidSource } from '../mermaid-source.ts'

const AB = 'flowchart TD\n  A --> B\n'

function frontmatterOf(source: string) {
  return preprocessMermaidSource(source).frontmatter
}

describe('flowchart INEFFECTIVE_CONFIG lint (fix stage, P4)', () => {
  it('names every documented-but-unwired flowchart config key present in frontmatter', () => {
    const source = [
      '---',
      'config:',
      '  flowchart:',
      '    curve: linear',
      '    htmlLabels: false',
      '    padding: 25',
      '---',
      AB,
    ].join('\n')
    const warnings = verifyMermaid(source).warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')
    const fields = warnings.map(w => (w as { field?: string }).field).sort()
    expect(fields).toEqual(['flowchart.curve', 'flowchart.htmlLabels', 'flowchart.padding'])
  })

  it('also lints init-directive flowchart config', () => {
    const source = `%%{init: {"flowchart": {"curve": "basis"}}}%%\n${AB}`
    const warnings = verifyMermaid(source).warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'flowchart.curve' }))
  })

  it('never lints the wired keys (nodeSpacing, rankSpacing, wrappingWidth)', () => {
    const source = [
      '---',
      'config:',
      '  flowchart:',
      '    nodeSpacing: 80',
      '    rankSpacing: 90',
      '    wrappingWidth: 150',
      '---',
      AB,
    ].join('\n')
    const warnings = verifyMermaid(source).warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')
    expect(warnings).toEqual([])
  })

  it('emits nothing without a flowchart config section', () => {
    expect(verifyMermaid(AB).warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })

})

describe('flowchart nodeSpacing/rankSpacing wiring (feature stage)', () => {
  const SIBLINGS = 'flowchart TD\n  A --> B\n  A --> C\n'

  const gapY = (source: string, options: ReturnType<typeof resolveFlowchartRenderOptions>) => {
    const positioned = layoutGraphSync(parseGraph(source), options)
    const a = positioned.nodes.find(n => n.id === 'A')!
    const b = positioned.nodes.find(n => n.id === 'B')!
    return b.y - (a.y + a.height)
  }

  it('rankSpacing widens the layer gap through resolveFlowchartRenderOptions', () => {
    const near = resolveFlowchartRenderOptions(frontmatterOf(`---\nconfig:\n  flowchart:\n    rankSpacing: 40\n---\n${AB}`), {})
    const far = resolveFlowchartRenderOptions(frontmatterOf(`---\nconfig:\n  flowchart:\n    rankSpacing: 220\n---\n${AB}`), {})
    expect(gapY(AB, far)).toBeGreaterThan(gapY(AB, near) + 150)
  })

  it('nodeSpacing widens the sibling gap', () => {
    // Two disconnected chains: small same-rank fan-outs are re-packed by the
    // symmetric-fanout passes (their gap is pass-owned), so the honest probe
    // of the ELK nodeNode threading is sibling components/lanes.
    const CHAINS = 'flowchart TD\n  A --> B\n  C --> D\n'
    const near = resolveFlowchartRenderOptions(frontmatterOf(`---\nconfig:\n  flowchart:\n    nodeSpacing: 24\n---\n${AB}`), {})
    const far = resolveFlowchartRenderOptions(frontmatterOf(`---\nconfig:\n  flowchart:\n    nodeSpacing: 200\n---\n${AB}`), {})
    const siblingGap = (options: ReturnType<typeof resolveFlowchartRenderOptions>) => {
      const positioned = layoutGraphSync(parseGraph(CHAINS), options)
      const [a, c] = ['A', 'C'].map(id => positioned.nodes.find(n => n.id === id)!)
      const [left, right] = a!.x < c!.x ? [a!, c!] : [c!, a!]
      return right.x - (left.x + left.width)
    }
    expect(siblingGap(far)).toBeGreaterThan(siblingGap(near) + 100)
  })

  it('explicit RenderOptions win over frontmatter config', () => {
    const resolved = resolveFlowchartRenderOptions(
      frontmatterOf(`---\nconfig:\n  flowchart:\n    nodeSpacing: 200\n    rankSpacing: 200\n---\n${AB}`),
      { nodeSpacing: 24, layerSpacing: 40 },
    )
    expect(resolved.nodeSpacing).toBe(24)
    expect(resolved.layerSpacing).toBe(40)
  })

  it('threads through the public render path (frontmatter changes geometry)', () => {
    const near = renderMermaidSVG(`---\nconfig:\n  flowchart:\n    rankSpacing: 40\n---\n${AB}`)
    const far = renderMermaidSVG(`---\nconfig:\n  flowchart:\n    rankSpacing: 220\n---\n${AB}`)
    const rectY = (svg: string, id: string) => {
      const group = svg.split(`data-id="${id}"`)[1] ?? ''
      const m = group.match(/<rect x="[\d.]+" y="([\d.]+)"/)
      return m ? parseFloat(m[1]!) : NaN
    }
    expect(rectY(far, 'B') - rectY(far, 'A')).toBeGreaterThan(rectY(near, 'B') - rectY(near, 'A') + 100)
  })
})

describe('flowchart wrappingWidth (feature stage)', () => {
  const LONG = 'flowchart TD\n  A{Does the incoming request carry a valid session token for this tenant?} --> B\n'

  it('fits literal entity runs and real formatting without rewriting their source or repeating casing', () => {
    const payload = '#lt;b#gt;x#lt;/b#gt; <b>y</b> ta\u001bil'
    const source = `flowchart LR\nA["${payload}"]`
    const options = { wrappingWidth: 40, style: { roles: { node: { textTransform: 'uppercase' as const, fontSize: 16, letterSpacing: 1 } } } }
    const graph = parseGraph(source)
    const original = graph.nodes.get('A')!.label
    const styleFace = resolveRenderRequest(source, options, 'svg').appearance.face
    applyFlowchartLabelWrapping(graph, options, styleFace)
    const positioned = layoutGraphSync(graph, { ...options, styleFace }).nodes[0]!
    const block = positioned.labelBlock!
    expect(graph.nodes.get('A')!.label).toBe(original)
    expect(block.prepared.source).toBe(payload)
    expect(block.prepared.transform).toBe('uppercase')
    expect(block.letterSpacing).toBe(1)
    expect(block.lineBlocks.length).toBeGreaterThan(1)
    expect(block.lineBlocks.every(line => line.width <= 40)).toBe(true)
    expect(block.lineBlocks.flatMap(line => line.runs).filter(run => run.bold).map(run => run.text).join('')).toBe('Y')
    expect(block.prepared.lines[0]![0]!.clusters![0]).toEqual({ text: '<', sourceStart: 0, sourceEnd: 4 })
    expect(block.breaks.some(point => point.kind === 'wrap')).toBe(true)
    expect(block.breaks.every(point => point.sourceOffset >= 0 && point.sourceOffset <= payload.length)).toBe(true)
    const svg = renderMermaidSVG(source, options)
    const visible = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, ''))).join('')
    expect(visible.replace(/[\s-]/g, '')).toBe('<B>X</B>YTA?IL')
    expect(svg).toMatch(/<tspan\b[^>]*\bfont-weight="bold"[^>]*>Y<\/tspan>/)
    const content = resolveLabelContent(graph.nodes.get('A')!.label, graph.nodes.get('A')!.labelContent)
    expect(typeof content).not.toBe('string')
    if (typeof content !== 'string') expect(preparedDisplayTextValue(content)).toBe('<b>x</b> y ta?il')
    expect(renderMermaidASCII(source)).toContain('<b>x</b> y ta?il')
  })

  it('an explicit wrappingWidth wraps a sentence-length diamond label under the width budget', () => {
    const options = resolveFlowchartRenderOptions(frontmatterOf(`---\nconfig:\n  flowchart:\n    wrappingWidth: 180\n---\n${LONG}`), {})
    const unwrapped = layoutGraphSync(parseGraph(LONG), {})
    const wrappedGraph = parseGraph(LONG)
    applyFlowchartLabelWrapping(wrappedGraph, options)
    const wrapped = layoutGraphSync(wrappedGraph, options)
    const before = unwrapped.nodes.find(n => n.id === 'A')!
    const after = wrapped.nodes.find(n => n.id === 'A')!
    expect(after.width).toBeLessThan(before.width)
    expect(after.labelBlock!.lines.length).toBeGreaterThan(1)
    // Every wrapped line fits the measured budget; the diamond may still pad.
    for (const line of after.labelBlock!.lines) expect(line.length).toBeLessThan(before.label.length)
  })

  it('the public render path wraps node labels into tspans when configured', () => {
    const svg = renderMermaidSVG(`---\nconfig:\n  flowchart:\n    wrappingWidth: 180\n---\n${LONG}`)
    const nodeText = svg.split('data-id="A"')[1]!.split('</g>')[0]!
    expect(nodeText).toContain('<tspan')
  })

  it('without config, output is byte-identical to the pre-config renderer (no drift)', () => {
    expect(renderMermaidSVG(LONG, { mermaidConfig: { flowchart: {} } })).toBe(renderMermaidSVG(LONG))
    expect(renderMermaidSVG(AB, { mermaidConfig: {} })).toBe(renderMermaidSVG(AB))
  })
})
