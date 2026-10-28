// Temporary, opt-in delivery investigation. No candidate emitted here ships.
import { minify, type JsMinifyOptions } from '@swc/core'
import { gzipSync } from 'node:zlib'
import { browserRuntimeMinifyOptions } from './runtime-minify.ts'

type Compression = Exclude<JsMinifyOptions['compress'], boolean | undefined>

export function compressionBytes(code: string) {
  return { rawBytes: Buffer.byteLength(code), gzipBytes: gzipSync(code, { level: 9 }).byteLength }
}

export async function browserCompressionDiagnostics(source: string, baseline: string) {
  const options = browserRuntimeMinifyOptions()
  if (!options.compress || typeof options.compress !== 'object') throw new Error('Expected explicit safe compression settings')
  const compress = options.compress
  const candidates: Array<{ name: string; compress: Compression }> = [
    { name: 'inline-0', compress: { ...compress, inline: 0 } },
    { name: 'inline-1', compress: { ...compress, inline: 1 } },
    { name: 'inline-1-passes-5', compress: { ...compress, inline: 1, passes: 5 } },
    { name: 'no-function-reduction', compress: { ...compress, inline: 0, reduce_funcs: false } },
    { name: 'no-variable-collapse', compress: { ...compress, inline: 1, collapse_vars: false } },
    { name: 'hoist-declarations', compress: { ...compress, hoist_funs: true, hoist_vars: true, passes: 5 } },
  ]
  const results = [{ name: 'shipping-settings', ...compressionBytes(baseline) }]
  for (const candidate of candidates) {
    const result = await minify(source, { ...options, compress: candidate.compress })
    if (!result.code) throw new Error(`Compression diagnostic produced no module: ${candidate.name}`)
    results.push({ name: candidate.name, ...compressionBytes(result.code) })
  }
  return results
}
