import { dirname, join, resolve } from 'node:path'

const EDITOR = resolve(import.meta.dir, '../../../editor/js')

/** Load the shipped module through its exported boundary while injecting the
 * other UI modules from the test's browser context. Mutable UI state belongs
 * to that same isolated context, rather than a process-global module cache. */
export async function editorModuleScript(name: string): Promise<string> {
  const target = join(EDITOR, name)
  const entry = `import * as subject from ${JSON.stringify(target)}; for (const key of Object.keys(subject)) Object.defineProperty(globalThis, key, { configurable: true, get: () => subject[key] }); subject.initialize();`
  const result = await Bun.build({
    entrypoints: ['editor-module-test'],
    target: 'browser',
    format: 'iife',
    plugins: [
      {
        name: 'injected-editor-boundary',
        setup(build) {
          build.onResolve({ filter: /^editor-module-test$/ }, () => ({ path: 'entry.js', namespace: 'editor-test-entry' }))
          build.onLoad({ filter: /.*/, namespace: 'editor-test-entry' }, () => ({ contents: entry, loader: 'js', resolveDir: EDITOR }))
          build.onResolve({ filter: /\.js$/ }, args => {
            const path = resolve(args.resolveDir, args.path)
            return path === target ? { path } : { path, namespace: 'editor-test-dependency' }
          })
          build.onLoad({ filter: /.*/, namespace: 'editor-test-dependency' }, args => {
            if (args.path.endsWith('/context.js')) return { contents: 'export const ui = globalThis;', loader: 'js' }
            // CommonJS named imports are live property reads, so a cancellation
            // token changed by an injected renderer remains visible across awaits.
            return { contents: 'module.exports = globalThis;', loader: 'js', resolveDir: dirname(args.path) }
          })
        },
      },
    ],
  })
  if (!result.success) throw new AggregateError(result.logs, `Cannot load editor module ${name}`)
  return result.outputs[0]!.text()
}
