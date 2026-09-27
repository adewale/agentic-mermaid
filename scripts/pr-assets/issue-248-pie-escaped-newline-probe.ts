#!/usr/bin/env bun
import { chromium } from 'playwright'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { renderMermaidSVG, renderMermaidASCII } from '../../src/index.ts'
import { parsePieChart } from '../../src/pie/parser.ts'

const root = join(import.meta.dir, '..', '..')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
const page = await browser.newPage()
await page.setContent('<div id="host"></div>')
await page.addScriptTag({ path: join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js') })
const cases = [
  ['escaped-n-label', 'pie\n  "A\\nB" : 1'],
  ['escaped-tab-n-label', 'pie\n  "A\\t\\n\\tB" : 1'],
  ['literal-backslash-n-label', 'pie\n  "A\\\\nB" : 1'],
  ['escaped-n-title', 'pie\n  title A\\nB\n  "Slice" : 1'],
] as const
for (const [name, source] of cases) {
  const upstream = await page.evaluate(async ({ source, name }) => {
    const mermaid = (globalThis as typeof globalThis & { mermaid: { initialize(config: object): void; render(id: string, source: string): Promise<{ svg: string }> } }).mermaid
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'Arial' })
    const svg = (await mermaid.render(name, source)).svg
    const host = document.getElementById('host')!
    host.innerHTML = svg
    const svgText = [...host.querySelectorAll('text')].map(e => e.textContent)
    const legend = host.querySelector('g.legend text') as SVGTextElement | null
    const comparison = legend?.cloneNode(true) as SVGTextElement | undefined
    if (comparison && legend) {
      comparison.textContent = 'A B'
      legend.parentNode!.appendChild(comparison)
    }
    const result = {
      svgText,
      legendAdvance: legend?.getComputedTextLength() ?? null,
      spacedAdvance: comparison?.getComputedTextLength() ?? null,
    }
    comparison?.remove()
    return result
  }, { source, name })
  const localSvg = renderMermaidSVG(source, { embedFontImport: false })
  const localParsed = parsePieChart(source.split('\n'))
  const localTerminal = renderMermaidASCII(source, { colorMode: 'none' })
  if (name === 'escaped-n-label' || name === 'escaped-tab-n-label') {
    const upstreamText = name === 'escaped-tab-n-label' ? 'A\t\n\tB' : 'A\nB'
    if (!upstream.svgText.includes(upstreamText) || upstream.legendAdvance === null ||
        Math.abs(upstream.legendAdvance - (upstream.spacedAdvance ?? -1)) > 0.01 ||
        localParsed.entries[0]?.displayLabel !== 'A B' || !localSvg.includes('>A B (100.0%)</text>') ||
        !localTerminal.startsWith('A B  ')) {
      throw new Error('Escaped Pie LF did not paint as one space on both renderers')
    }
  } else if (name === 'literal-backslash-n-label') {
    if (!upstream.svgText.includes('A\\nB') || localParsed.entries[0]?.label !== 'A\\nB' ||
        !localSvg.includes('>A\\nB (100.0%)</text>')) {
      throw new Error('Doubly escaped Pie LF must remain a literal backslash-n')
    }
  } else if (!upstream.svgText.includes('A\\nB') || !localSvg.includes('>A\\nB</text>')) {
    throw new Error('Pie title backslash-n must remain literal')
  }
  console.log(JSON.stringify({ name, upstreamText: upstream.svgText, upstreamLegendAdvance: upstream.legendAdvance, upstreamSpacedAdvance: upstream.spacedAdvance, localLabel: localParsed.entries[0]?.displayLabel ?? localParsed.entries[0]?.label }))
}
await browser.close()
