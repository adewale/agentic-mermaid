import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { byteDigest, portableDirectory } from './artifacts.ts'
import { assertPortableLocal } from './run.ts'

// Building runs nothing; the compiled kit refuses to measure without the Mermaid oracle.
assertPortableLocal(process.env, { mermaidOracle: false })
const argv = process.argv.slice(2)
if (argv.length && (argv.length !== 2 || argv[0] !== '--out')) throw Error('Use build.ts [--out FRESH_DIRECTORY]')
const out = resolve(argv[1] ?? join(portableDirectory, 'dist'))
if (existsSync(out) && readdirSync(out).length) throw Error('Compiled portable output must be fresh; existing artifacts are never overwritten')
mkdirSync(out, { recursive: true })
await build({
  entryPoints: { run: join(portableDirectory, 'run.ts'), worker: join(portableDirectory, 'worker.mjs'), execution: join(portableDirectory, 'execution.ts') },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'separate-measurement-producer',
      setup(build) {
        build.onResolve({ filter: /^\.\/execution\.ts$/ }, () => ({ path: './execution.mjs', external: true }))
      },
    },
  ],
})
// The oracle worker runs the installed reference Mermaid; it is copied, never bundled.
copyFileSync(join(portableDirectory, 'mermaid-oracle-worker.mjs'), join(out, 'mermaid-oracle-worker.mjs'))
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'trident-benchmark-kit', version: '0.1.0', private: true, type: 'module', engines: { node: '>=24' }, dependencies: {} }, null, 2) + '\n', { flag: 'wx' })
let sourceRevision: string | null = null
let sourceDirty: boolean | null = null
try {
  sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: join(portableDirectory, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
  if (!sourceDirty) sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: portableDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
} catch {}
const manifest = {
  protocol: 'compiled-portable-harness-v1',
  builtAt: new Date().toISOString(),
  sourceRevision,
  sourceDirty,
  files: ['run.mjs', 'worker.mjs', 'execution.mjs', 'mermaid-oracle-worker.mjs', 'package.json'].map(path => ({ path, sha256: byteDigest(join(out, path)) })),
  runtimeDependencies: 'Node24, the explicitly supplied target artifact and the pinned Mermaid oracle install; no product source, Git or harness node_modules required.',
}
writeFileSync(join(out, 'harness-artifact.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ out, sourceRevision, files: manifest.files }, null, 2))
