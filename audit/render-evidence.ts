import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const rendererRoot = process.env.RENDERER_ROOT ?? process.cwd()
const output = process.env.OUTPUT_DIR ?? '/tmp/arrowhead-evidence'
const phase = process.argv[2] ?? 'rendered'
const { renderMermaidSVG } = await import(join(rendererRoot, 'src/index.ts'))
const { prepareResvgMarkerOrientation } = await import(join(rendererRoot, 'src/resvg-marker-orientation.ts'))
const { Resvg } = await import(join(rendererRoot, 'node_modules/@resvg/resvg-js/index.js'))
const { SaxesParser } = await import(join(rendererRoot, 'node_modules/saxes/saxes.js'))
const rows = await Bun.file(new URL('./inputs.json', import.meta.url)).json()
mkdirSync(output, { recursive: true })
const placements = []
for (const row of rows) {
  const svg = renderMermaidSVG(row.source, row.options)
  await Bun.write(join(output, `${row.family}-${phase}.svg`), svg)
  const width = Number(svg.match(/\bwidth="([\d.]+)"/)![1])
  await Bun.write(join(output, `${row.family}-${phase}.png`), new Resvg(prepareResvgMarkerOrientation(svg), { fitTo: { mode: 'width', value: Math.ceil(width * 3) } }).render().asPng())
  const parser = new SaxesParser()
  let attrs: Record<string, string> | undefined
  parser.on('opentag', (tag: { attributes: Record<string, string> }) => {
    if (tag.attributes['data-id'] === (row.family === 'c4' ? row.connector.split(':')[1] : row.connector)) attrs = tag.attributes
  })
  parser.write(svg).close()
  if (!attrs) throw Error(`Missing connector ${row.connector}`)
  const coords = (attrs.points ?? attrs.d)!.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number)
  placements.push({ family: row.family, point: row.arrow_end === 'start' ? coords.slice(0, 2) : coords.slice(-2) })
}
await Bun.write(join(output, `placements-${phase}.json`), JSON.stringify(placements, null, 2))
