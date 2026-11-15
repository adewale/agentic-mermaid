import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { variants } from './configs.ts'
const args = process.argv.slice(2)
const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
const root = resolve(value('--root', '.')), reference = resolve(value('--reference', '../measurements/quality'))
const variant = args.includes('--variant') ? variants.find(v => v.id === value('--variant', '')) : undefined
if (!variant) {
  const out = resolve(value('--out', '../measurements/cache-replay.json'))
  if (existsSync(out)) throw Error('Refuse to overwrite cache replay')
  const rows = variants.map(v => {
    const result = spawnSync(process.execPath, [import.meta.path, '--root', root, '--reference', reference, '--variant', v.id], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1', AGENTIC_MERMAID_EXPERIMENTS: 'text-spans,indexed-layout,position-cache', AGENTIC_MERMAID_LAYOUT_FEATURES: v.features.filter(f => f !== 'fonts').join(',') },
    })
    return { variant: v.id, status: result.status, stderr: result.stderr, observations: result.status === 0 ? JSON.parse(result.stdout) : null }
  })
  const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    method: 'Built public receipt API, first and repeated calls with default caches. Exact SVG byte comparison to retained quality artifacts. Raster checks may be reused only for identical bytes.', rows }
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, failedProcesses: rows.filter(r => r.status !== 0).length, mismatches: rows.flatMap(r => r.observations ?? []).filter(r => !r.coldMatches || !r.warmMatches).length }))
} else {
  const api = await import(pathToFileURL(join(root, 'dist/index.js')).href)
  const corpus = JSON.parse(readFileSync(join(reference, variant.id, 'corpus.json'), 'utf8')) as Array<{ id: string; family: string; source: string }>
  const rows = []
  for (const item of corpus) for (const backend of ['elk', 'agentic'] as const) {
    const graphFamily = ['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'].includes(item.family)
    if (backend === 'agentic' && !graphFamily) continue
    // Identical request construction to the retained quality worker.
    const options = { security: 'strict', embedFontImport: false,
      ...(variant.features.includes('fonts') ? { fontMetrics: 'bundled-inter' } : {}),
      ...(graphFamily ? { graphLayout: { backend, fallback: backend === 'agentic' ? 'elk' : 'none',
        ...(variant.features.includes('elk-order') && backend === 'elk' || variant.features.includes('ports') && backend === 'agentic' ? { quality: 'balanced' } : {}),
        ...(variant.features.includes('wrap') && item.family === 'flowchart' ? { viewport: { width: 800, height: 600 } } : {}),
      } } : {}),
    }
    const expected = readFileSync(join(reference, variant.id, backend, 'artifacts', item.id.replace(/[^A-Za-z0-9_-]/g, '_') + '.svg'), 'utf8')
    let failure: string | undefined, coldMatches = false, warmMatches = false, consumedBytes = 0
    try {
      const first = api.renderMermaidSVGWithReceipt(item.source, options)
      consumedBytes += JSON.stringify(first).length
      coldMatches = first.svg === expected
      const second = api.renderMermaidSVGWithReceipt(item.source, options)
      consumedBytes += JSON.stringify(second).length
      warmMatches = second.svg === expected
    } catch (error) { failure = String(error) }
    rows.push({ id: item.id, backend, coldMatches, warmMatches, consumedBytes, failure })
  }
  console.log(JSON.stringify(rows))
}
