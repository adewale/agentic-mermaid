// Offline attribution on the six saved public products; no extra render API calls.
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { Resvg } from '/tmp/pr449-main-integration-20261029-762/node_modules/@resvg/resvg-js/index.js'
import { HOSTED_FONT_RESOURCES } from '/tmp/pr449-main-integration-20261029-762/src/font-manifest.ts'
import { inlineFontVarForRaster } from '/tmp/pr449-main-integration-20261029-762/src/theme.ts'
import { prepareResvgMarkerOrientation } from '/tmp/pr449-main-integration-20261029-762/src/resvg-marker-orientation.ts'
const root = '/tmp/pr449-main-integration-20261029-762', out = '/workspace/pr449-native-loop-20261113/requirement-history-20261114/current-4cdd'
const fontFiles = HOSTED_FONT_RESOURCES.filter(font => font.family === 'Inter').map(font => {
  const path = root + '/' + font.path, bytes = readFileSync(path)
  if (bytes.length !== font.bytes || createHash('sha256').update(bytes).digest('hex') !== font.sha256) throw Error('Shipped font bytes differ from manifest')
  return path
})
const render = (svg: string) => new Resvg(prepareResvgMarkerOrientation(inlineFontVarForRaster(svg)), {
  background: '#fff', fitTo: { mode: 'zoom', value: 2 },
  font: { fontFiles, fontDirs: [], loadSystemFonts: false, defaultFontFamily: 'Inter' },
}).render()
const results = []
for (const direction of ['TB', 'BT', 'LR', 'RL']) for (const backend of ['agentic', 'elk']) {
  const directory = `${out}/${direction}/${backend}`, actual = gunzipSync(readFileSync(`${directory}/actual.svg.gz`)).toString()
  const original = render(actual), pixels = original.pixels
  writeFileSync(`${directory}/actual.png`, original.asPng())
  const textMatches = [...actual.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)]
  const markerMatches = [...actual.matchAll(/<polyline\b[^>]*\bdata-role="relationship"[^>]*\/>/g)]
  if (textMatches.length !== 15 || markerMatches.length !== 5) throw Error(`Unexpected roster ${direction}/${backend}`)
  const masks = [...textMatches.map((m, index) => ({ kind: 'text', index, start: m.index!, length: m[0].length, replacement: '', actualProgram: m[0] })),
    ...markerMatches.map((m, index) => ({ kind: 'marker-end', index, start: m.index!, length: m[0].length, replacement: m[0].replace(' marker-end="url(#requirement-arrow)"', ''), actualProgram: m[0] }))]
  const contributions = masks.map(mask => {
    const changed = actual.slice(0, mask.start) + mask.replacement + actual.slice(mask.start + mask.length)
    if (changed === actual) throw Error('No-op mask')
    const image = render(changed), other = image.pixels
    if (image.width !== original.width || image.height !== original.height) throw Error('Mask changed viewport')
    let changedPixels = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i]! - other[i]!) + Math.abs(pixels[i + 1]! - other[i + 1]!) + Math.abs(pixels[i + 2]! - other[i + 2]!) < 6) continue
      const pixel = i / 4, x = pixel % image.width, y = Math.floor(pixel / image.width)
      changedPixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    if (!changedPixels) throw Error(`No attributed ink ${direction}/${backend}/${mask.kind}/${mask.index}`)
    return { kind: mask.kind, index: mask.index, changedPixels, pixelBounds: { minX, minY, maxX, maxY }, actualProgram: mask.actualProgram }
  })
  const result = { direction, backend, svgSHA256: createHash('sha256').update(actual).digest('hex'), width: original.width, height: original.height,
    textPrograms: textMatches.length, markerOccurrences: markerMatches.length, contributions }
  writeFileSync(`${directory}/INK.json`, JSON.stringify(result, null, 2) + '\n'); results.push(result)
  console.log(JSON.stringify({ direction, backend, textsWithInk: 15, markersWithInk: 5, minimumTextPixels: Math.min(...contributions.filter(x => x.kind === 'text').map(x => x.changedPixels)), minimumMarkerPixels: Math.min(...contributions.filter(x => x.kind === 'marker-end').map(x => x.changedPixels)) }))
}
writeFileSync(`${out}/INK-SUMMARY.json`, JSON.stringify({ offlineRasters: 168, publicRenderCalls: 0, zoom: 2, fonts: 'Manifest-verified Inter weights, no system fonts',
  scope: 'Each actual text program and marker occurrence contributes final raster pixels. Not complete glyph attribution, font-independent readability, or a whole-diagram occlusion proof.', results }, null, 2) + '\n')
