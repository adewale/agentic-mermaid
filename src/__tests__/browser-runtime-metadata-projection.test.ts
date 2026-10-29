import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, transformSync } from 'esbuild'
import ts from 'typescript'
import { runtimeRenderContractPlugin } from '../../scripts/build/runtime-render-contract.ts'
import { compactBrowserModulesPlugin } from '../../scripts/build/compact-browser-modules.ts'
import { validateJsonSchema } from '../shared/schema-validation.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'mermaid-runtime-metadata-'))
afterAll(() => rmSync(temporary, { recursive: true, force: true }))

type ProjectionOptions = Parameters<typeof runtimeRenderContractPlugin>[0]

function project(path: string, options: ProjectionOptions = {}): string {
  const loaders: Array<{
    filter: RegExp
    load: (args: { path: string }) => { contents: string; loader: 'ts'; resolveDir: string } | undefined
  }> = []
  runtimeRenderContractPlugin(options).setup({
    onLoad({ filter }, load) { loaders.push({ filter, load }) },
    onResolve() { throw new Error('Source-only projections must not register module resolvers') },
  })
  return loaders.find(loader => loader.filter.test(path))?.load({ path })?.contents ?? readFileSync(path, 'utf8')
}

function fixture(relative: string, source: string): string {
  const path = join(temporary, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  return path
}

const printer = ts.createPrinter({ removeComments: true })
function conformanceStructure(source: string) {
  const file = ts.createSourceFile('backend-conformance.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls: Array<{ arguments: string[]; literalObservation: boolean; observation?: string; evaluatedObservation?: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'outcome') {
      const observation = node.arguments[1]
      const literal = observation && (ts.isStringLiteral(observation) || ts.isNoSubstitutionTemplateLiteral(observation)) ? observation : undefined
      const discarded = observation && ts.isParenthesizedExpression(observation) ? observation.expression : undefined
      const evaluated = discarded && ts.isBinaryExpression(discarded) && discarded.operatorToken.kind === ts.SyntaxKind.CommaToken ? discarded.left : undefined
      calls.push({
        arguments: node.arguments.map(argument => printer.printNode(ts.EmitHint.Expression, argument, file)),
        literalObservation: literal !== undefined,
        observation: literal?.text,
        evaluatedObservation: evaluated && printer.printNode(ts.EmitHint.Expression, evaluated, file),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  const functions = new Map(file.statements.flatMap(statement => ts.isFunctionDeclaration(statement) && statement.name
    ? [[statement.name.text, printer.printNode(ts.EmitHint.Unspecified, statement, file)] as const] : []))
  return { calls, functions }
}

describe('browser runtime metadata projection', () => {
  test('leaves conformance reports untouched unless explicitly opted out', () => {
    const path = join(root, 'src/scene/backend-conformance.ts'), source = readFileSync(path, 'utf8')
    expect(project(path)).toBe(source)
    expect(project(path, { conformanceObservations: true })).toBe(source)
  })

  test('preserves predicates, diagnostics and observation evaluation in the real executable conformance module', () => {
    const path = join(root, 'src/scene/backend-conformance.ts')
    const before = conformanceStructure(readFileSync(path, 'utf8'))
    const after = conformanceStructure(project(path, { conformanceObservations: false }))
    expect(after.calls.length).toBe(before.calls.length)
    expect(before.calls.filter(call => call.literalObservation).length).toBeGreaterThan(0)
    for (const [index, original] of before.calls.entries()) {
      const projected = after.calls[index]!
      expect(projected.arguments[0]).toBe(original.arguments[0])
      expect(projected.arguments.slice(2)).toEqual(original.arguments.slice(2))
      if (original.literalObservation) expect(projected.observation).toBe('')
      else expect(projected.evaluatedObservation).toBe(original.arguments[1])
    }
    // These owners preserve witness IDs, claim statuses/limitations, report
    // acceptance and failure diagnostics independently of observation prose.
    for (const name of ['outcome', 'runCapabilityClaims', 'runBackendConformance']) {
      expect(before.functions.has(name)).toBe(true)
      expect(after.functions.get(name)).toBe(before.functions.get(name))
    }
  })

  test('preserves evaluation, coercion, throws and diagnostics after minifying projected observations', () => {
    const source = [
      'function outcome(passed, observation, diagnostic) { return passed ? { passed, observation } : { passed, observation, diagnostic }; }',
      'function run() {',
      '  const events = [];',
      "  const check = () => { events.push('check'); return false; };",
      "  const observe = () => { events.push('observe'); return 'dynamic observation'; };",
      "  const diagnose = () => { events.push('diagnose'); return 'failure diagnostic'; };",
      "  const object = { toString() { events.push('coerce'); return 'coerced observation'; } };",
      '  const results = [',
      "    outcome(check(), 'literal observation', diagnose()),",
      "    outcome(true, `plain template observation`, 'unused diagnostic'),",
      '    outcome(false, observe(), diagnose()),',
      "    outcome(true, `computed ${observe()}`, 'template diagnostic'),",
      "    outcome(true, check() ? 'yes' : 'no', diagnose()),",
      "    outcome(true, `object ${object}`, diagnose()),",
      '  ];',
      '  let thrown;',
      "  try { outcome(true, (() => { events.push('throw'); throw new Error('observation failure'); })(), diagnose()); }",
      '  catch (error) { thrown = error.message; }',
      '  return { events, results, thrown };',
      '}',
    ].join('\n')
    const path = fixture('src/scene/backend-conformance.ts', source)
    const before = Function(`${source}\nreturn run();`)() as { events: string[]; results: Array<{ passed: boolean; observation: string; diagnostic?: string }>; thrown?: string }
    const projected = project(path, { conformanceObservations: false })
    const minified = transformSync(`${projected}\ncapture(run());`, { loader: 'js', minify: true }).code
    let emitted: typeof before | undefined
    Function('capture', minified)((value: typeof before) => { emitted = value })
    const direct = Function(`${projected}\nreturn run();`)() as typeof before
    for (const after of [direct, emitted!]) {
      expect(after.events).toEqual(before.events)
      expect(after.thrown).toBe(before.thrown)
      expect(after.results.map(({ passed, diagnostic }) => ({ passed, diagnostic }))).toEqual(before.results.map(({ passed, diagnostic }) => ({ passed, diagnostic })))
      expect(after.results.map(result => result.observation)).toEqual(before.results.map(() => ''))
    }
  })

  test('keeps schema prose and terminal metadata independently configurable', () => {
    const source = [
      'const SHARED_RENDER_OPTION_FIELD_DESCRIPTORS = Object.freeze({',
      '  style: {',
      "    typeScript: 'string', defaultLabel: 'default label', description: 'option prose',",
      "    validationExpectation: 'required diagnostic expectation', terminal: 'projected', terminalNote: 'required terminal note',",
      "    schema: { type: 'object', description: 'schema prose', properties: { description: { type: 'string', description: 'property prose' } } },",
      '  },',
      '});',
      "function paintSchema(description) { return { type: 'string', description }; }",
      "const PAINT_SCHEMA = paintSchema('helper schema prose');",
      "const ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES = { width: { type: 'number', minimum: 1, description: 'property-map prose' }, description: { type: 'string', description: (() => 'evaluated metadata')() } };",
      "const STYLE_SPEC_FIELD_DESCRIPTORS = Object.freeze({ width: { kind: 'number', group: 'layout', minimum: 1, description: 'width metadata' } });",
      "const ROLE_STYLE_PROPERTY_DESCRIPTORS = Object.freeze({ fontSize: { kind: 'number', minimum: 1, maximum: 256, expected: 'between 1 and 256', description: 'role typography metadata' } });",
      "function rolePropertyJsonSchemas() { return Object.fromEntries(Object.entries(ROLE_STYLE_PROPERTY_DESCRIPTORS).map(([name, property]) => [name, { type: property.kind, minimum: property.minimum, maximum: property.maximum, description: property.description }])); }",
      "function fieldsJsonSchema() { return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.test/schema', title: 'Schema metadata', type: 'object', properties: { $schema: { type: 'string' }, $id: { type: 'string' }, title: { type: 'string' } }, required: ['title'], additionalProperties: false }; }",
      'function run() { return { field: SHARED_RENDER_OPTION_FIELD_DESCRIPTORS.style, paint: PAINT_SCHEMA, properties: ARCHITECTURE_VISUAL_SCHEMA_PROPERTIES, styleFields: STYLE_SPEC_FIELD_DESCRIPTORS, roleFields: ROLE_STYLE_PROPERTY_DESCRIPTORS, roleSchemas: rolePropertyJsonSchemas(), schema: fieldsJsonSchema() }; }',
    ].join('\n')
    const path = fixture('src/render-contract.ts', source)
    const terminalRenderer = Function(`${project(path, { schemaDocumentation: false, terminalAdapter: true })}\nreturn run();`)()
    expect(terminalRenderer.field.terminal).toBe('projected')
    expect(terminalRenderer.field.terminalNote).toBe('required terminal note')
    expect(terminalRenderer.field.validationExpectation).toBe('required diagnostic expectation')
    expect(terminalRenderer.field.schema).toEqual({ type: 'object', properties: { description: { type: 'string' } } })
    expect(terminalRenderer.paint).toEqual({ type: 'string' })
    expect(terminalRenderer.properties).toEqual({ width: { type: 'number', minimum: 1 }, description: { type: 'string', description: 'evaluated metadata' } })
    expect(terminalRenderer.styleFields.width).toEqual({ kind: 'number', minimum: 1 })
    expect(terminalRenderer.roleFields.fontSize).toEqual({ kind: 'number', minimum: 1, maximum: 256, expected: 'between 1 and 256' })
    expect(terminalRenderer.roleSchemas.fontSize).toEqual({ type: 'number', minimum: 1, maximum: 256 })
    expect(terminalRenderer.schema).toEqual({ type: 'object', properties: { $schema: { type: 'string' }, $id: { type: 'string' }, title: { type: 'string' } }, required: ['title'], additionalProperties: false })
    const lazy = Function(`${project(path, { schemaDocumentation: false, terminalAdapter: false })}\nreturn run();`)()
    expect(lazy.field.terminal).toBeUndefined()
    expect(lazy.field.terminalNote).toBeUndefined()
    expect(lazy.field.validationExpectation).toBe(terminalRenderer.field.validationExpectation)
    expect(lazy.field.schema).toEqual(terminalRenderer.field.schema)
    const inspector = Function(`${project(path)}\nreturn run();`)()
    expect(inspector.field.schema.description).toBe('schema prose')
    expect(inspector.paint.description).toBe('helper schema prose')
    expect(inspector.properties.width.description).toBe('property-map prose')
    expect(inspector.styleFields.width.group).toBe('layout')
    expect(inspector.roleFields.fontSize.description).toBe('role typography metadata')
    expect(inspector.schema.$id).toBe('https://example.test/schema')
    for (const value of [0, 1, 2, 'invalid']) expect(validateJsonSchema(value, terminalRenderer.properties.width))
      .toEqual(validateJsonSchema(value, inspector.properties.width))
    for (const value of [0, 1, 256, 257, 'invalid']) expect(validateJsonSchema(value, terminalRenderer.roleSchemas.fontSize))
      .toEqual(validateJsonSchema(value, inspector.roleSchemas.fontSize))
    for (const value of [{}, { title: 'kept', $schema: 'input dialect', $id: 'input id' }, { title: 1 }, { title: 'kept', unknown: true }]) expect(validateJsonSchema(value, terminalRenderer.schema))
      .toEqual(validateJsonSchema(value, inspector.schema))
    expect(inspector.field.terminalNote).toBe('required terminal note')
    const editor = Function(`${project(path, { conformanceObservations: false })}\nreturn run();`)()
    expect(editor).toEqual(inspector)
  })
})

test('coalesced SVG consumers retain text, source, ownership and one default backend', async () => {
  const result = await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import { sourceLineStarts, sourceSpan } from './src/shared/source-spans.ts';
      import { createSubgraphMembership } from './src/shared/subgraph-membership.ts';
      import { formatSvgNumber, formatSvgNumericAttribute } from './src/shared/svg-number.ts';
      import { seedFrom } from './src/scene/seed.ts';
      import { buildAccessibilityAttrs } from './src/shared/svg-a11y.ts';
      import { layoutTextRows, layoutTextColumns } from './src/shared/text-rows.ts';
      import { preparePixelText } from './src/shared/prepared-text.ts';
      import { diagnoseFamilyConfig } from './src/shared/family-config-diagnostics.ts';
      import { getBackend, isOriginalEnrolledDefaultBackend, knownBackendDescriptors } from './src/scene/backend.ts';
      import './src/scene/default-backend.ts';
      import './src/scene/default-backend.ts';
      export function run() {
        const starts = sourceLineStarts('A\\r\\n日本\\nB');
        const membership = createSubgraphMembership();
        const inner = membership.close('inner', ['A', 'A']);
        const outer = membership.close('outer', ['A', 'B']);
        const rows = layoutTextRows(['a', 'b'].map(text => ({ block: preparePixelText(text, { fontSize: 10, fontWeight: 400 }) })), { gap: 3 });
        const columns = layoutTextColumns(['a', 'b', 'c', 'd'].map(text => ({ block: preparePixelText(text, { fontSize: 10, fontWeight: 400 }) })), { gap: 3, columnGap: 8, leadingWidth: 12, maxWidth: 100 });
        return {
          starts, span: sourceSpan(starts, 3, 5), inner, outer,
          numeric: formatSvgNumber(1.234567890123456), literal: formatSvgNumericAttribute('data-label', '1.234567890123456'),
          seed: seedFrom('a'), accessibility: buildAccessibilityAttrs('Title', 'Description', 'title-id', 'description-id'),
          rows: rows.rows.map(row => row.item.block.text), positiveBounds: rows.width > 0 && rows.height > 0,
          columns: columns.columns, readingOrder: columns.rows.map(row => row.item.block.text),
          diagnostics: diagnoseFamilyConfig('flowchart', { root: { flowchart: { unknown: 1 } }, config: { section: 'flowchart', keys: [] } }),
          defaults: knownBackendDescriptors().filter(value => value.inputName === 'default').length,
          original: isOriginalEnrolledDefaultBackend(getBackend('default')),
        };
      }
    ` },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [runtimeRenderContractPlugin({ coalesceRuntimePrimitives: true, sourceOnlySceneAdmission: true, conformanceObservations: false })],
  })
  const consumer = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles![0]!.text).toString('base64')}`) as { run(): unknown }
  expect(consumer.run()).toEqual({
    starts: [0, 3, 6], span: { start: { offset: 3, line: 2, col: 1 }, end: { offset: 5, line: 2, col: 3 } }, inner: ['A'], outer: ['B'],
    numeric: '1.23456789012', literal: '1.234567890123456', seed: 3826002220,
    accessibility: { role: 'img', 'aria-labelledby': 'title-id', 'aria-describedby': 'description-id' }, rows: ['a', 'b'], positiveBounds: true, columns: 2, readingOrder: ['a', 'b', 'c', 'd'],
    diagnostics: [{ code: 'INEFFECTIVE_CONFIG', field: 'flowchart.unknown', message: 'flowchart config field "unknown" is unknown and has no effect; check the spelling or remove it.' }],
    defaults: 1, original: true,
  })
})

test('compacted ESM preserves live bindings, observable getters, arity and recipe-addressed chunks', async () => {
  fixture('compact/shared.ts', `
    export let count = 0;
    export function step() { count++; }
    export function arity(first, second) { return first; }
    const events = [];
    export function observe() {
      const value = { get field() { events.push('read'); return 9; } };
      value.field;
      return events.slice();
    }
  `)
  fixture('compact/bridge.ts', "export { count, step, arity, observe } from './shared.ts';")
  const entry = fixture('compact/entry.ts', "export { count, step, arity, observe } from './bridge.ts'; export const peer = () => import('./peer.ts');")
  const peer = fixture('compact/peer.ts', "import { count, step } from './bridge.ts'; export function advance() { step(); return count; }")
  const chunkNames: string[][] = []
  for (const generation of ['first', 'changed']) {
    const before = new Map<string, string>()
    const outdir = join(temporary, 'compacted')
    const result = await build({
      absWorkingDir: temporary, entryPoints: [entry, peer], outdir,
      bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
      minify: true, write: false, metafile: true, entryNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]', outExtension: { '.js': '.mjs' },
      // The incoming recipe models the optimizer changing between releases.
      // Both banners reach esbuild before its chunk-content hashes are made.
      banner: { js: `/* fixture optimizer recipe ${generation} */` },
      plugins: [{ name: 'retain-pre-compaction-contributions', setup(build) {
        build.onEnd(result => { for (const [path, output] of Object.entries(result.metafile!.outputs)) before.set(path, JSON.stringify(output.inputs)) })
      } }, compactBrowserModulesPlugin()],
    })
    for (const file of result.outputFiles!) {
      expect(file.text).toBe(Buffer.from(file.contents).toString('utf8'))
      const metadata = Object.entries(result.metafile!.outputs).find(([path]) => resolve(temporary, path) === file.path)![1]
      expect(metadata.bytes).toBe(file.contents.byteLength)
      mkdirSync(dirname(file.path), { recursive: true })
      writeFileSync(file.path, file.contents)
    }
    for (const [path, output] of Object.entries(result.metafile!.outputs)) {
      const originalContributions = before.get(path)
      if (originalContributions === undefined) throw new Error(`Missing pre-compaction input contributions: ${path}`)
      expect(JSON.stringify(output.inputs)).toBe(originalContributions)
    }
    const compaction = (result.metafile as typeof result.metafile & { browserCompaction: { inputContributions: string; outputBytes: string } })!.browserCompaction
    expect(compaction.inputContributions).toBe('esbuild-before-compaction')
    expect(compaction.outputBytes).toBe('after-compaction')
    const entryOutput = Object.entries(result.metafile!.outputs).find(([, value]) => value.entryPoint && resolve(temporary, value.entryPoint) === entry)![0]
    const consumer = await import(pathToFileURL(resolve(temporary, entryOutput)).href) as { count: number; step(): void; arity: (first: number, second: number) => number; observe(): string[]; peer(): Promise<{ advance(): number }> }
    expect(consumer.count).toBe(0)
    expect(consumer.arity.length).toBe(2)
    expect(consumer.arity(7, 8)).toBe(7)
    expect(consumer.observe()).toEqual(['read'])
    consumer.step()
    expect(consumer.count).toBe(1)
    expect((await consumer.peer()).advance()).toBe(2)
    expect(consumer.count).toBe(2)
    expect(consumer.observe()).toEqual(['read', 'read'])
    chunkNames.push(result.outputFiles!.filter(file => dirname(file.path).endsWith('chunks')).map(file => basename(file.path)).sort())
  }
  expect(chunkNames[0]!.length).toBeGreaterThan(0)
  expect(chunkNames[1]).not.toEqual(chunkNames[0])
})
