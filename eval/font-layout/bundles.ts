import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
const root = resolve(process.argv[2]!), output = resolve(process.argv[3]!)
const size = (file: string) => {
  const bytes = readFileSync(join(root, file))
  return { raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length }
}
const closure = (entry: string) => {
  const files = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file) || !existsSync(join(root, file))) return
    files.add(file)
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)) {
      if (match[1]!.startsWith('.')) visit(join(dirname(file), match[1]!))
    }
  }
  visit(entry)
  return { files: [...files].sort(), totals: [...files].reduce((total, file) => {
    const bytes = size(file)
    return { raw: total.raw + bytes.raw, gzip: total.gzip + bytes.gzip, brotli: total.brotli + bytes.brotli }
  }, { raw: 0, gzip: 0, brotli: 0 }) }
}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  method: 'Built artifacts; gzip/Brotli per file summed for static internal ESM closure. External packages, dynamic imports and fonts excluded; actual lazy browser transfers are measured separately.',
  nodeSvg: closure('dist/index.js'), nodeAgent: closure('dist/agent.js'),
  browserIife: size('dist/browser.global.js'),
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(output)
