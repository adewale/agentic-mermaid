import { createHash } from 'node:crypto'
import { basename, dirname, relative, resolve } from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { BuildResult, Metafile, OutputFile } from 'esbuild'
import { rollup } from 'rollup'
import { minifyBrowserRuntime } from './runtime-minify.ts'

/** Consolidate only the intersection of complete built-in SVG closures. Initial
 * detection, family implementations and demanded providers retain lazy owners.
 * Rollup links live ESM bindings; no function or class is copied into a facade. */
interface BrowserRuntimeGraph {
  entry: string
  core?: string
  families: string
}
const publicSvgGraph: BrowserRuntimeGraph = {
  entry: 'src/browser-lazy.ts', families: 'src/browser-lazy/families/',
}
const editorWorkerGraph: BrowserRuntimeGraph = {
  entry: 'src/browser-preview-worker.ts', core: 'src/agent/verify.ts', families: 'src/browser-lazy/generated/verified/',
}

export async function consolidateBrowserRuntime(result: Pick<BuildResult, 'outputFiles' | 'metafile'>, cwd: string, recipe: string, graph = publicSvgGraph): Promise<void> {
  const meta = result.metafile!
  const entries = Object.entries(meta.outputs)
  const entry = entries.find(([, output]) => output.entryPoint === graph.entry)
  if (!entry) return // The optional ZenUML build owns a different public graph.
  const core = graph.core ? entries.find(([, output]) => output.entryPoint === graph.core) : undefined
  const families = entries.filter(([, output]) => output.entryPoint?.startsWith(graph.families))
  if (graph.core && !core || !families.length) throw new Error('Browser consolidation requires its declared core and family entrypoints')
  const closure = (roots: string[]) => {
    const seen = new Set<string>()
    const visit = (path: string) => {
      if (seen.has(path)) return
      seen.add(path)
      for (const edge of meta.outputs[path]!.imports) if (edge.kind !== 'dynamic-import') visit(edge.path)
    }
    roots.forEach(visit)
    return seen
  }
  const initial = closure([entry[0]])
  const closures = families.map(([path]) => closure(core ? [core[0], path] : [path]))
  const shared = new Set([...closures[0]!].filter(path => !initial.has(path) && !meta.outputs[path]!.entryPoint && closures.every(group => group.has(path))))
  if (shared.size < 2) return
  const files = new Map(result.outputFiles!.filter(file => file.path.endsWith('.js')).map(file => [file.path, file]))
  const oldOutputs = new Map(entries.map(([path, output]) => [resolve(cwd, path), output]))
  const sharedIds = new Set([...shared].map(path => resolve(cwd, path)))
  const digest = createHash('sha256').update(recipe)
  for (const id of [...sharedIds].sort()) digest.update(basename(id)).update(files.get(id)!.text)
  const sharedName = 'chunk-' + digest.digest('hex').slice(0, 8).toUpperCase()
  const root = dirname(resolve(cwd, entry[0]))
  const entryName = graph === publicSvgGraph ? 'index' : basename(entry[0], '.js')
  const bundle = await rollup({
    input: Object.fromEntries(entries.filter(([, output]) => output.entryPoint).map(([path]) => [path === entry[0] ? entryName : basename(path, '.js'), resolve(cwd, path)])),
    preserveEntrySignatures: 'strict', treeshake: false,
    plugins: [{ name: 'emitted-browser-modules',
      resolveId(source, importer) {
        const id = importer ? resolve(dirname(importer), source) : source
        if (!files.has(id)) throw new Error(`Unowned browser import: ${source}`)
        return id
      },
      load: id => files.get(id)!.text,
    }],
    onwarn(warning, warn) { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning) },
  })
  try {
    const linked = await bundle.generate({ format: 'es', entryFileNames: chunk => chunk.name === entryName ? `${entryName}.js` : 'chunks/[name].js', chunkFileNames: 'chunks/[name].js',
      manualChunks: id => sharedIds.has(id) ? sharedName : undefined, onlyExplicitManualChunks: true,
      hoistTransitiveImports: false, generatedCode: 'es2015',
    })
    const outputs: Metafile['outputs'] = {}
    const emitted: OutputFile[] = result.outputFiles!.filter(file => !file.path.endsWith('.js'))
    for (const chunk of linked.output) {
      if (chunk.type !== 'chunk') throw new Error('Unexpected browser asset during consolidation')
      const path = resolve(root, chunk.fileName), code = await minifyBrowserRuntime(chunk.code), contents = Buffer.from(code)
      emitted.push({ path, contents, text: code, hash: createHash('sha256').update(contents).digest('hex') })
      const inputs = Object.assign({}, ...Object.keys(chunk.modules).map(id => oldOutputs.get(id)!.inputs))
      const original = chunk.facadeModuleId ? oldOutputs.get(chunk.facadeModuleId) : undefined
      outputs[relative(cwd, path)] = { bytes: contents.length, inputs, imports: [
        ...chunk.imports.map(file => ({ path: relative(cwd, resolve(root, file)), kind: 'import-statement' as const })),
        ...chunk.dynamicImports.map(file => ({ path: relative(cwd, resolve(root, file)), kind: 'dynamic-import' as const })),
      ], exports: chunk.exports, ...(original?.entryPoint ? { entryPoint: original.entryPoint } : {}) }
    }
    result.outputFiles = emitted
    meta.outputs = outputs
    Object.assign(meta, { browserSharedRuntime: { modules: shared.size, owner: sharedName, policy: 'all-family static intersection, excluding initial detection and public entry facades' } })
  } finally { await bundle.close() }
}

/** Normalize Bun's outdir-relative metadata into the same emitted-module graph
 * consumed by the public ESM linker. Only this build's files are replaced. */
export async function consolidateEditorWorker(outputs: readonly { path: string; text(): Promise<string> }[], metafile: Pick<Bun.BuildMetafile, 'outputs'>, outdir: string, cwd: string, recipe: string): Promise<void> {
  const modules = await Promise.all(outputs.map(async output => {
    const code = await output.text(), contents = Buffer.from(code)
    return { path: output.path, contents, text: code, hash: createHash('sha256').update(contents).digest('hex') }
  }))
  const normalized: Metafile = { inputs: {}, outputs: Object.fromEntries(Object.entries(metafile.outputs).map(([path, output]) => [resolve(outdir, path), {
    ...output, ...(output.entryPoint ? { entryPoint: relative(cwd, resolve(cwd, output.entryPoint)) } : {}),
    imports: output.imports.map(edge => ({ ...edge, kind: edge.kind === 'dynamic-import' ? 'dynamic-import' : 'import-statement', path: resolve(outdir, edge.path) })),
  }])) }
  const result = { outputFiles: modules, metafile: normalized }
  await consolidateBrowserRuntime(result, cwd, recipe, editorWorkerGraph)
  for (const output of outputs) rmSync(output.path)
  for (const output of result.outputFiles!) {
    mkdirSync(dirname(output.path), { recursive: true })
    writeFileSync(output.path, output.contents)
  }
}
