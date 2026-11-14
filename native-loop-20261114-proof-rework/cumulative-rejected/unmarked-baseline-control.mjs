// Untimed actual-product control, adapted from the existing product probes.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
const require = createRequire('/workspace/agentic-mermaid/package.json')
const { SaxesParser } = require('saxes')
const root = '/workspace/pr449-native-loop-20261113/path-order-implementation/build-candidate'
const work = '/workspace/pr449-native-loop-20261114-proof-rework'
const out = path.join(work, 'unmarked100-4cdd-baseline')
if (fs.existsSync(out)) throw Error('Refuse to overwrite retained control products')
const sha = value => createHash('sha256').update(value).digest('hex')
const inputBytes = fs.readFileSync(path.join(work, 'UNMARKED100-CASE.json'))
if (sha(inputBytes) !== '2046202deb5df91e2b39ce1827f71ebeaa0c20c13d43077b2138e3df81bc447c') throw Error('Input binding changed')
const input = JSON.parse(inputBytes)
if (sha(input.source) !== input.sourceSha256) throw Error('Source binding changed')
const entrySha256 = sha(fs.readFileSync(path.join(root, 'dist/index.js')))
const packageSha256 = sha(fs.readFileSync(path.join(root, 'package.json')))
if (entrySha256 !== '735d7a0dd72efadccc760e90dd20a484b1233778926613811de100108814c552' || packageSha256 !== '184f9523e4051f4eb5555f3b03ba6b93727e1adc1f5898092234376ccf029832') throw Error('Frozen 4cdd SDK changed')
const api = await import(pathToFileURL(path.join(root, 'dist/index.js')))
fs.mkdirSync(out)
const rows = []
for (const options of input.arms) {
  const backend = options.graphLayout.backend
  try {
    const product = api.renderMermaidSVGWithReceipt(input.source, options)
    const bytes = JSON.stringify(product)
    fs.writeFileSync(path.join(out, backend + '.product.json.gz'), gzipSync(bytes))
    const carriers = [], labels = []
    let markerReferences = 0, text
    const parser = new SaxesParser({ xmlns: true })
    parser.on('opentag', tag => {
      for (const name of ['marker-start', 'marker-mid', 'marker-end']) if (tag.attributes[name]) markerReferences++
      if (tag.local === 'text') text = ''
      if (tag.attributes['data-from'] && tag.attributes['data-to'] && ['line', 'polyline', 'path'].includes(tag.local)) carriers.push([tag.attributes['data-from'].value, tag.attributes['data-to'].value])
    })
    parser.on('text', value => { if (text !== undefined) text += value })
    parser.on('closetag', tag => { if (tag.local === 'text') { labels.push(text); text = undefined } })
    parser.write(product.svg).close()
    const authoredPairs = [...input.source.matchAll(/^(n\d+) --- (n\d+)$/gm)].map(match => [match[1], match[2]])
    rows.push({ backend, returned: true, options, sourceSha256: input.sourceSha256, svgSha256: sha(product.svg), productSha256: sha(bytes), actualEndpoints: carriers.length, endpointsExact: JSON.stringify(carriers) === JSON.stringify(authoredPairs), actualMarkerReferences: markerReferences, labelsComplete: Array.from({ length: 100 }, (_, index) => `Node ${index}`).every(label => labels.includes(label)), proof: product.receipt.layoutCertification })
  } catch (error) {
    rows.push({ backend, returned: false, options, error: { name: error.name, message: error.message, stack: error.stack } })
  }
}
const report = { sourceRevision: '4cddae30548df1adf0ea1908c88454fae3bcb36d', root, entrySha256, packageSha256, runtime: process.version, environment: { AGENTIC_MERMAID_ELK_CACHE: process.env.AGENTIC_MERMAID_ELK_CACHE, AGENTIC_MERMAID_SCENE_ASSERTIONS: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS }, boundary: 'Two untimed built public SVG+entire receipt calls. Existing SDK bytes reused; no performance sampling or timing.', rows }
fs.writeFileSync(path.join(out, 'RESULTS.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(rows.map(row => ({ backend: row.backend, returned: row.returned, endpointsExact: row.endpointsExact, actualEndpoints: row.actualEndpoints, labelsComplete: row.labelsComplete, actualMarkerReferences: row.actualMarkerReferences, proof: row.proof, error: row.error })), null, 2))
