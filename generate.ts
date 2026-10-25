import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [root, phase, out] = process.argv.slice(2)
const api = await import(pathToFileURL(join(root!, 'src/agent/index.ts')).href)
mkdirSync(out!, { recursive: true })
const results = []
for (const [from, to] of [['X', 'B'], ['B', 'Outer'], ['Outer', 'B']]) {
  const name = `${from}-to-${to}`
  const source = `flowchart LR\nX\nY\nsubgraph Outer\ndirection TB\nA\nsubgraph Inner\ndirection TB\nB\nend\nend\n${from} --> ${to}`
  writeFileSync(join(out!, `${name}.mmd`), source + '\n')
  try {
    const rendered = api.renderMermaidSVGWithReceipt(source, { embedFontImport: false })
    const warnings: unknown[] = []
    const raster = api.renderMermaidPNGWithReceipt(source, { scale: 1, onWarning: (warning: unknown) => warnings.push(warning) })
    const layout = api.layoutMermaidWithReceipt(source, { debug: true }).layout
    writeFileSync(join(out!, `${name}-${phase}.svg`), rendered.svg)
    writeFileSync(join(out!, `${name}-${phase}.png`), raster.png)
    writeFileSync(join(out!, `${name}-${phase}-layout.json`), JSON.stringify(layout, null, 2))
    results.push({ name, source, ok: true, warnings, receipt: rendered.receipt, runtime: raster.runtime })
  } catch (error) {
    const message = String(error)
    writeFileSync(join(out!, `${name}-${phase}-error.txt`), message + '\n')
    results.push({ name, source, ok: false, error: message })
  }
}
writeFileSync(join(out!, `${phase}-results.json`), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results.map(({ name, ok, error }) => ({ name, ok, error }))))
