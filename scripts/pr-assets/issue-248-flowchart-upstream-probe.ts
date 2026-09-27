#!/usr/bin/env bun
import { chromium } from 'playwright'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const root = join(import.meta.dir, '..', '..')
const mermaidDirectory = [join(root, 'node_modules', 'mermaid'), join(root, '..', 'node_modules', 'mermaid')].find(existsSync)
if (!mermaidDirectory) throw new Error('Pinned Mermaid dependency is missing')
const version = JSON.parse(readFileSync(join(mermaidDirectory, 'package.json'), 'utf8')).version
if (version !== '11.16.0') throw new Error(`Expected pinned Mermaid 11.16.0, got ${version}`)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
const page = await browser.newPage()
await page.setContent('<div id="host"></div>')
await page.addScriptTag({ path: join(mermaidDirectory, 'dist', 'mermaid.min.js') })
for (const [name, extra] of [
  ['class', ''],
  ['linkStyle', '  linkStyle 0 stroke:#00ff00,stroke-width:3px\n'],
] as const) {
  const source = `flowchart LR\n  A e1@--> B\n  classDef hot stroke:#ff0000,stroke-width:6px\n  class e1 hot\n${extra}`
  const result = await page.evaluate(async ({ source, name }) => {
    const mermaid = (globalThis as typeof globalThis & { mermaid: { initialize(config: object): void; render(id: string, source: string): Promise<{ svg: string }> } }).mermaid
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    const svg = (await mermaid.render(`flowchart-${name}`, source)).svg
    const host = document.getElementById('host')!
    host.innerHTML = svg
    const edge = host.querySelector<SVGElement>('path[id*="e1"], path[data-id="e1"], g[id*="e1"] path')
    return { edgeId: edge?.getAttribute('data-id') ?? null, computedStroke: edge ? getComputedStyle(edge).stroke : null, computedWidth: edge ? getComputedStyle(edge).strokeWidth : null }
  }, { source, name })
  const expected = name === 'class' ? { edgeId: 'e1', computedStroke: 'rgb(255, 0, 0)', computedWidth: '6px' } : { edgeId: 'e1', computedStroke: 'rgb(0, 255, 0)', computedWidth: '3px' }
  if (JSON.stringify(result) !== JSON.stringify(expected)) throw new Error(`${name}: pinned Mermaid style oracle changed: ${JSON.stringify(result)}`)
  console.log(`${name}: ${result.computedStroke}, ${result.computedWidth}`)
}
await browser.close()
