import { defineConfig } from 'vitest/config'
import { createRequire, isBuiltin } from 'node:module'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'
import { upstreamSpecFiles } from './inventory.ts'

const upstream = resolve(process.env.AM_ASSERT_UPSTREAM ?? '../mermaid-pinned')
const families = (process.env.AM_ASSERT_FAMILIES ?? 'er,sequence').split(',')
const files = upstreamSpecFiles(upstream, families)
const familyOf = new Map(files.map(file => [file.path, file.family]))
const runtime = resolve(import.meta.dirname, 'runtime.ts')
const ownRequire = createRequire(resolve('package.json'))
const referenceRequire = createRequire(resolve(process.env.AM_ASSERT_REFERENCE ?? '../probe-runtime', 'package.json'))

export default defineConfig({
  resolve: { alias: { vitest: resolve(dirname(ownRequire.resolve('vitest/package.json')), 'dist/index.js') } },
  server: { fs: { allow: [resolve('..'), ...(process.env.AM_ASSERT_NATIVE_ENTRY ? [resolve(dirname(process.env.AM_ASSERT_NATIVE_ENTRY), '../..')] : [])] } },
  plugins: [{
    name: 'native-diagram-import-adapters', enforce: 'pre',
    resolveId(source) {
      if (process.env.AM_ASSERT_NATIVE_ENTRY && source.endsWith('/mermaid-modern-compat/grammar-agentic.ts')) return resolve(process.env.AM_ASSERT_NATIVE_ENTRY)
      if (process.env.AM_ASSERT_NATIVE_ENTRY && source.endsWith('/shared/parser-observation.ts')) return resolve(dirname(process.env.AM_ASSERT_NATIVE_ENTRY), '../../src/shared/parser-observation.ts')
      if (isBuiltin(source)) return
      if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('node:') && source !== 'vitest') {
        try { return referenceRequire.resolve(source) } catch { /* Vite reports unavailable external dependencies. */ }
      }
    },
    transform(code, id) {
      const path = id.split('?')[0]!
      const helper = path === resolve(upstream, 'packages/parser/tests/test-util.ts')
      const family = familyOf.get(path)
      if (!family && !helper) return
      const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true)
      const edits: Array<{ start: number; end: number; text: string }> = []
      let ordinal = 0
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const source = statement.moduleSpecifier.text
        // Keep the test runner, external utilities and its own assertion helper.
        if (!source.startsWith('.') || /(?:^|\/)test-util\.js$|\/tests\/util\.js$/.test(source)) continue
        const clause = statement.importClause
        if (clause?.isTypeOnly) continue
        const name = `__am_module_${ordinal++}`
        const bindings: string[] = []
        if (clause?.name) bindings.push(`const ${clause.name.text} = ${name}.default;`)
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.push(`const ${clause.namedBindings.name.text} = ${name};`)
        else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) {
          if (!entry.isTypeOnly) bindings.push(`const ${entry.name.text} = ${name}[${JSON.stringify(entry.propertyName?.text ?? entry.name.text)}];`)
        }
        edits.push({ start: statement.getStart(ast), end: statement.end,
          text: `const ${name} = (await import(${JSON.stringify(runtime)})).moduleFor(${JSON.stringify(family ?? 'parser-helper')}, ${JSON.stringify(source)}, ${JSON.stringify(path)});\n${bindings.join('\n')}` })
      }
      // Only import declarations change. Test source, data and assertions keep
      // their exact bytes, and remain under their original snapshot paths.
      for (const edit of edits.reverse()) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
      return { code, map: null }
    },
  }],
  test: {
    root: upstream,
    include: files.map(file => file.path),
    globals: true,
    environment: 'jsdom',
    setupFiles: [resolve(import.meta.dirname, 'setup.ts')],
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 10_000,
    hookTimeout: 20_000,
    restoreMocks: true,
    reporters: ['json'],
    outputFile: process.env.AM_ASSERT_RESULTS ?? resolve(dirname(upstream), 'upstream-assertion-vitest.json'),
  },
})
