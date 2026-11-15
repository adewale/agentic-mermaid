import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { runtimeRenderContractPlugin } from '../../scripts/build/runtime-render-contract.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'standalone-family-metadata-'))
afterAll(() => rmSync(temporary, { recursive: true, force: true }))
const editorFields = new Set(['editorDiagramType', 'editorLabel', 'editorDescription', 'editorExampleId', 'editorGlyph', 'editorExample'])
const printer = ts.createPrinter({ removeComments: true })

function project(path: string, options: Parameters<typeof runtimeRenderContractPlugin>[0] = {}): string {
  const loaders: Array<{ filter: RegExp; load: (args: { path: string }) => { contents: string } | undefined }> = []
  runtimeRenderContractPlugin(options).setup({
    onLoad({ filter }, load) { loaders.push({ filter, load }) },
    onResolve() { throw new Error('Source-only projections must not register module resolvers') },
  })
  return loaders.find(loader => loader.filter.test(path))?.load({ path })?.contents ?? readFileSync(path, 'utf8')
}

function fixture(table = 'BUILTIN_FAMILY_DESCRIPTOR_SEEDS', extra = '', fields = [
  "editorDiagramType: 'Flowchart'", "editorLabel: 'Flowchart'", "editorDescription: 'Pure prose'",
  "editorExampleId: 'flowchart-basic'", "editorGlyph: 'F'", 'editorExample: `flowchart LR\nA-->B`',
]): string {
  return `${extra}\nconst ${table} = [{ id: 'flowchart', headers: ['flowchart', 'graph'], example: 'flowchart LR', ${fields.join(',')} }];`
}

function writeFixture(source: string, stable = false): string {
  const path = join(temporary, 'src/agent', stable ? 'stable-family-metadata.ts' : 'family-registry.ts')
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source)
  return path
}

function tableStructure(source: string, name: string) {
  const file = ts.createSourceFile('family-registry.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, file)
  const declarations = file.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  const declaration = declarations.find(value => ts.isIdentifier(value.name) && value.name.text === name)!
  let table = declaration.initializer!
  while (ts.isAsExpression(table) || ts.isSatisfiesExpression(table) || ts.isParenthesizedExpression(table)) table = table.expression
  if (!ts.isArrayLiteralExpression(table)) throw new Error('Expected source seed array')
  return table.elements.map(seed => {
    if (!ts.isObjectLiteralExpression(seed)) return { spread: print(seed) }
    const all = seed.properties.map(property => ({ name: property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined, text: print(property) }))
    return { editor: all.filter(property => property.name && editorFields.has(property.name)), runtime: all.filter(property => !property.name || !editorFields.has(property.name)) }
  })
}

test('public Node/IIFE/lazy and default build metadata projection remain untouched', () => {
  for (const relative of ['src/agent/family-registry.ts', 'src/agent/stable-family-metadata.ts']) {
    const path = join(root, relative), before = readFileSync(path, 'utf8')
    expect(project(path)).toBe(before)
    expect(project(path, { familyEditorMetadata: true })).toBe(before)
  }
})

test('both real exact seed tables preserve every runtime field, witness and known spread', () => {
  for (const [relative, name] of [['src/agent/family-registry.ts', 'BUILTIN_FAMILY_DESCRIPTOR_SEEDS'], ['src/agent/stable-family-metadata.ts', 'STABLE_FAMILY_DESCRIPTOR_SEEDS']]) {
    const path = join(root, relative!)
    const before = tableStructure(readFileSync(path, 'utf8'), name!)
    const after = tableStructure(project(path, { familyEditorMetadata: false }), name!)
    expect(after.length).toBe(before.length)
    for (const [index, original] of before.entries()) {
      const changed = after[index]!
      if ('spread' in original) expect(changed).toEqual(original)
      else {
        expect(original.editor?.length).toBe(6)
        expect(changed.editor).toEqual([])
        expect(changed.runtime).toEqual(original.runtime)
      }
    }
  }
})

test('retains non-editor expression evaluation and all runtime values', () => {
  const source = fixture().replace("example: 'flowchart LR'", "example: (() => { events.push('witness'); return 'flowchart LR'; })()")
  const path = writeFixture(source)
  const evaluate = (text: string) => Function(`const events = []; ${text}; return { events, seed: BUILTIN_FAMILY_DESCRIPTOR_SEEDS[0] };`)() as { events: string[]; seed: Record<string, unknown> }
  const before = evaluate(source), after = evaluate(project(path, { familyEditorMetadata: false }))
  expect(after.events).toEqual(before.events)
  expect(after.seed).toEqual(Object.fromEntries(Object.entries(before.seed).filter(([key]) => !editorFields.has(key))))
})

test('preserves hosted/public projection unless the private standalone flag is false', () => {
  const path = writeFixture(fixture())
  expect(project(path, { conformanceObservations: false })).toBe(readFileSync(path, 'utf8'))
  expect(project(path, { familyEditorMetadata: false })).not.toContain('Pure prose')
  const unrelated = join(temporary, 'src/agent/families-builtin.ts')
  writeFileSync(unrelated, fixture())
  expect(project(unrelated, { familyEditorMetadata: false })).toBe(readFileSync(unrelated, 'utf8'))
})

test('rejects dynamic/coercing/editor getters rather than suppressing their evaluation', () => {
  for (const replacement of [
    "editorDescription: observe()", 'editorDescription: `computed ${observe()}`',
    "get editorDescription() { return observe(); }", "['editor' + 'Description']: 'prose'",
    "editorDescription: 'prose', ...unknownFields", "editorDescription: 'first', editorDescription: 'second'",
  ]) {
    const path = writeFixture(fixture().replace("editorDescription: 'Pure prose'", replacement))
    expect(() => project(path, { familyEditorMetadata: false })).toThrow()
  }
})

test('rejects missing metadata and unsupported table/seed/spread shapes', () => {
  const cases = [
    fixture().replace("editorDescription: 'Pure prose',", ''),
    'const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = createSeeds();',
    'const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = [createSeed()];',
    'const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = [...unknownSeeds];',
    `function shadow() { ${fixture()} }`,
    'const UNRELATED_TABLE = [];',
  ]
  for (const source of cases) expect(() => project(writeFixture(source), { familyEditorMetadata: false })).toThrow()
  expect(() => project(writeFixture('const STABLE_FAMILY_DESCRIPTOR_SEEDS = [...STABLE_FAMILY_DESCRIPTOR_SEEDS];', true), { familyEditorMetadata: false })).toThrow()
})
