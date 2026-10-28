import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Metafile } from 'esbuild'
import type * as Rollup from 'rollup'
import { compressBrowserModule } from './browser-compression.ts'

// Rollup is already tsup's chunk-processing dependency. Resolve from its owner
// rather than depending on a particular package manager's hoisting layout.
const require = createRequire(import.meta.url)
const { rollup } = require(require.resolve('rollup', { paths: [dirname(require.resolve('tsup'))] })) as typeof Rollup

/** All SVG renders already fetch the shared core and its static dependencies.
 * Co-locate that closure, excluding initial modules and demand-loaded providers.
 * This removes request/encoding overhead without promoting family or solver
 * implementations into the initial download. Rollup hashes the final compressed
 * bytes and references, including changes to this compression profile. */
export async function compactBrowserLazy(): Promise<void> {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const metadataPath = resolve(root, 'dist/metafile-esm.json')
  const original = JSON.parse(await readFile(metadataPath, 'utf8')) as Metafile
  const outputNames = Object.keys(original.outputs)
  const entryFor = (source: string): string => {
    const matches = outputNames.filter(path => original.outputs[path]!.entryPoint === source)
    if (matches.length !== 1) throw new Error(`Expected one browser entry for ${source}`)
    return matches[0]!
  }
  const entry = entryFor('src/browser-lazy.ts')
  const core = entryFor('src/browser-lazy/render-core.ts')
  const closure = (path: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(path)) return seen
    seen.add(path)
    for (const dependency of original.outputs[path]!.imports) {
      if (dependency.kind !== 'dynamic-import') closure(dependency.path, seen)
    }
    return seen
  }
  const initial = closure(entry), shared = closure(core)
  const bundle = await rollup({
    input: resolve(root, entry),
    preserveEntrySignatures: 'strict',
    plugins: [{
      name: 'compress-browser-modules',
      async renderChunk(code) { return { code: await compressBrowserModule(code) } },
    }],
  })
  try {
    const { output } = await bundle.generate({
      format: 'esm',
      entryFileNames: 'browser-lazy/index.js',
      chunkFileNames: chunk => `browser-lazy/chunks/${chunk.name.replace(/-[A-Z0-9]+$/, '')}-[hash].js`,
      onlyExplicitManualChunks: true,
      manualChunks(id) {
        const path = relative(root, id)
        return path !== core && shared.has(path) && !initial.has(path) ? 'render-runtime' : undefined
      },
    })
    const outputs: Metafile['outputs'] = {}
    for (const chunk of output) {
      if (chunk.type !== 'chunk') throw new Error(`Unexpected browser asset: ${chunk.fileName}`)
      // Preserve esbuild's source attribution before final chunk compression;
      // import ownership and transfer bytes describe the final emitted graph.
      const inputs: Metafile['outputs'][string]['inputs'] = {}
      for (const module of Object.keys(chunk.modules)) {
        const prior = original.outputs[relative(root, module)]
        if (!prior) throw new Error(`Unknown browser module: ${module}`)
        for (const [source, contribution] of Object.entries(prior.inputs)) {
          inputs[source] = { bytesInOutput: (inputs[source]?.bytesInOutput ?? 0) + contribution.bytesInOutput }
        }
      }
      outputs[`dist/${chunk.fileName}`] = {
        bytes: Buffer.byteLength(chunk.code), inputs,
        imports: [
          ...chunk.imports.map(path => ({ path: `dist/${path}`, kind: 'import-statement' as const })),
          ...chunk.dynamicImports.map(path => ({ path: `dist/${path}`, kind: 'dynamic-import' as const })),
        ],
        exports: chunk.exports,
        ...(chunk.facadeModuleId && original.outputs[relative(root, chunk.facadeModuleId)]?.entryPoint
          ? { entryPoint: original.outputs[relative(root, chunk.facadeModuleId)]!.entryPoint } : {}),
      }
    }
    // Only replace the exact generated JS graph. Node/IIFE outputs and lazy
    // declarations are siblings owned by other build steps.
    for (const path of outputNames) {
      if (!path.startsWith('dist/browser-lazy/') || !path.endsWith('.js')) throw new Error(`Unexpected browser output: ${path}`)
    }
    await Promise.all(outputNames.map(path => rm(resolve(root, path))))
    await Promise.all(output.map(async chunk => {
      if (chunk.type !== 'chunk') return
      const path = resolve(root, 'dist', chunk.fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, chunk.code)
    }))
    await writeFile(metadataPath, JSON.stringify({ ...original, outputs }))
  } finally { await bundle.close() }
}
