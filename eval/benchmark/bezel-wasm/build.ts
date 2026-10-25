import '../ci-policy-enforce.ts'
// Optional benchmark adapter; requires Rust's wasm32-unknown-unknown target and
// wasm-bindgen-cli 0.2.104. The Bezel checkout remains unmodified.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1]
  if (!['--checkout', '--out', '--wasm-bindgen'].includes(key) || !value || options.has(key)) throw new Error(`Invalid option ${key}`)
  options.set(key, value)
}
if (!options.has('--checkout') || !options.has('--out')) throw new Error('Provide --checkout BEZEL_CHECKOUT --out DIRECTORY')
const checkout = resolve(options.get('--checkout')!), out = resolve(options.get('--out')!)
function run(command: string, args: string[], cwd = out): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}
const revision = run('git', ['rev-parse', 'HEAD'], checkout)
if (run('git', ['status', '--porcelain', '--untracked-files=no'], checkout)) throw new Error('Bezel checkout must have no tracked changes')
mkdirSync(join(out, 'src'), { recursive: true })
const packageInfo = readFileSync(join(checkout, 'Cargo.toml'), 'utf8')
const version = packageInfo.match(/\[workspace.package\][\s\S]*?version = "([^"]+)"/)?.[1]
if (!version) throw new Error('Cannot read Bezel workspace version')
writeFileSync(join(out, 'Cargo.toml'), `[package]\nname = "bezel-bench"\nversion = "0.1.0"\nedition = "2024"\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nmermaid = { package = "bezel-mermaid", path = ${JSON.stringify(join(checkout, 'crates/mermaid'))} }\nwasm-bindgen = "=0.2.104"\n[profile.release]\nopt-level = 3\nlto = true\ncodegen-units = 1\n`)
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib.rs'), join(out, 'src/lib.rs'))
run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'])
run(options.get('--wasm-bindgen') ?? 'wasm-bindgen', ['--target', 'web', '--out-dir', join(out, 'pkg'), join(out, 'target/wasm32-unknown-unknown/release/bezel_bench.wasm')])
const wasm = readFileSync(join(out, 'pkg/bezel_bench_bg.wasm'))
writeFileSync(join(out, 'entry.js'), `import { initSync, render } from './pkg/bezel_bench.js';\ninitSync({ module: Uint8Array.from(atob(${JSON.stringify(wasm.toString('base64'))}), c => c.charCodeAt(0)) });\nglobalThis.bezelRender = render;\n`)
const build = await Bun.build({ entrypoints: [join(out, 'entry.js')], target: 'browser', format: 'iife', minify: true,
  define: { 'import.meta.url': JSON.stringify('bezel-benchmark:embedded-wasm') } })
if (!build.success || build.outputs.length !== 1) throw new Error(`Bezel wrapper bundle failed: ${build.logs}`)
const bundle = Buffer.from(await build.outputs[0]!.arrayBuffer())
writeFileSync(join(out, 'bezel.js'), bundle)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ revision, version, rustc: run('rustc', ['--version']), wasmBindgen: run(options.get('--wasm-bindgen') ?? 'wasm-bindgen', ['--version']), profile: 'opt-level=3,lto=true,codegen-units=1', bundleSha256: sha256(bundle), wasmSha256: sha256(wasm), wasmBytes: wasm.length, cargoLockSha256: sha256(readFileSync(join(out, 'Cargo.lock'))), api: 'mermaid::render(source, &Options::default(), &Metrics).svg' }, null, 2) + '\n')
console.log(join(out, 'manifest.json'))
