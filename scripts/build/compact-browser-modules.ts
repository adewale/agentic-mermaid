import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { Plugin } from 'esbuild'
import { minifyBrowserRuntime } from './runtime-minify.ts'

const require = createRequire(import.meta.url)
const swcVersion = (require('@swc/core/package.json') as { version: string }).version

/** esbuild computes chunk names before onEnd. Put the complete optimizer
 * recipe in its input banner so an optimizer change also changes those names.
 * The ordinary non-license comment is removed by the following compressor. */
export function browserOptimizerRecipe(): string {
  const recipe = createHash('sha256').update(swcVersion)
  for (const name of ['compact-browser-modules.ts', 'runtime-minify.ts']) {
    recipe.update(name).update('\0').update(readFileSync(new URL(name, import.meta.url)))
  }
  return recipe.digest('hex')
}

export function compactBrowserModulesPlugin(): Plugin {
  const recipe = browserOptimizerRecipe()
  return {
    name: 'compact-browser-modules',
    setup(build) {
      if (build.initialOptions.write !== false || build.initialOptions.format !== 'esm'
        || build.initialOptions.sourcemap || !build.initialOptions.metafile) {
        throw new Error('Browser compaction requires in-memory ESM, a metafile and no source maps')
      }
      const banner = `/* browser optimizer recipe ${recipe} */`
      build.initialOptions.banner = { ...build.initialOptions.banner,
        js: [build.initialOptions.banner?.js, banner].filter(Boolean).join('\n') }
      const workingDirectory = build.initialOptions.absWorkingDir ?? process.cwd()
      build.onEnd(async result => {
        if (result.errors.length) return
        if (!result.outputFiles || !result.metafile) throw new Error('Browser compaction requires emitted modules and their metafile')
        const outputs = new Map(Object.entries(result.metafile.outputs).map(([path, output]) => [resolve(workingDirectory, path), output]))
        const sizes: Record<string, { beforeBytes: number; afterBytes: number }> = {}
        for (const [index, file] of result.outputFiles.entries()) {
          if (!/\.m?js$/.test(file.path)) continue
          const output = outputs.get(file.path)
          if (!output) throw new Error(`No metafile output for browser module: ${file.path}`)
          const code = await minifyBrowserRuntime(file.text)
          const contents = Buffer.from(code, 'utf8')
          sizes[file.path] = { beforeBytes: file.contents.byteLength, afterBytes: contents.byteLength }
          // esbuild's text getter closes over its original contents. Replace
          // the complete record so tsup's later writer receives the new text.
          result.outputFiles[index] = { path: file.path, contents, text: code,
            hash: createHash('sha256').update(contents).digest('hex') }
          output.bytes = contents.byteLength
        }
        // Input contributions and import edges describe the esbuild stage;
        // output byte counts describe the bytes the following writer receives.
        Object.assign(result.metafile, { browserCompaction: {
          optimizer: `@swc/core@${swcVersion}`, recipe,
          inputContributions: 'esbuild-before-compaction', importEdges: 'esbuild-before-compaction',
          outputBytes: 'after-compaction', modules: sizes,
        } })
      })
    },
  }
}

/** Bun has already written these file-backed artifacts. Read each complete
 * module before replacing its file; rewriting an artifact onto itself truncates
 * it. Callers bind browserOptimizerRecipe into Bun's banner before name hashing. */
export async function compactBunBrowserModules(outputs: readonly { path: string; text(): Promise<string> }[]): Promise<void> {
  const modules = await Promise.all(outputs.filter(output => /\.m?js$/.test(output.path)).map(async output => ({
    path: output.path, code: await minifyBrowserRuntime(await output.text()),
  })))
  await Promise.all(modules.map(module => Bun.write(module.path, module.code)))
}
