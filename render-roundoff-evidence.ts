import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const [rootArg, outArg, prefix] = process.argv.slice(2)
if (!rootArg || !outArg || !prefix) throw new Error('Usage: bun render-roundoff-evidence.ts CHECKOUT OUT_DIR before|after')
const root = resolve(rootArg), out = resolve(outArg)
mkdirSync(out, { recursive: true })
const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
const { renderMermaidSVG } = await load('src/index.ts')
const { graphStressSamples } = await load('eval/layout-compare/generated.ts')
const { Resvg } = await load('node_modules/@resvg/resvg-js/index.js')
const fixtures = [
  { id: 'class-80', source: graphStressSamples().find((sample: { id: string }) => sample.id === 'fixture/stress/class-80-classes.mmd').source, options: { style: 'publication-figure' } },
  { id: 'cyclic-labelled-15-chains', source: readFileSync(resolve(root, 'eval/layout-compare/fixtures/cyclic-labelled-15-chains.mmd'), 'utf8'), options: {} },
]
const results = []
for (const fixture of fixtures) {
  writeFileSync(resolve(out, `${fixture.id}.mmd`), fixture.source)
  writeFileSync(resolve(out, `${fixture.id}.options.json`), JSON.stringify(fixture.options, null, 2) + '\n')
  try {
    const svg = renderMermaidSVG(fixture.source, fixture.options)
    writeFileSync(resolve(out, `${prefix}-${fixture.id}.svg`), svg)
    const raster = new Resvg(svg, { background: '#ffffff', fitTo: { mode: 'width', value: 2400 } }).render()
    writeFileSync(resolve(out, `${prefix}-${fixture.id}.png`), raster.asPng())
    results.push({ fixture: fixture.id, status: 'rendered', width: raster.width, height: raster.height })
  } catch (error) {
    writeFileSync(resolve(out, `${prefix}-${fixture.id}.error.txt`), String(error) + '\n')
    results.push({ fixture: fixture.id, status: 'error', error: String(error) })
  }
}
const record = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), bun: Bun.version, resvg: JSON.parse(readFileSync(resolve(root, 'node_modules/@resvg/resvg-js/package.json'), 'utf8')).version, results }
writeFileSync(resolve(out, `${prefix}.json`), JSON.stringify(record, null, 2) + '\n')
console.log(JSON.stringify(record, null, 2))
