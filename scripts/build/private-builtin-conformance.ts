import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'
import { decodePrivateBuiltinReports, privateBuiltinClaimTemplate, restorePrivateBuiltinReport, type PackedPrivateBuiltinReport } from '../../src/scene/private-builtin-conformance.ts'
import type { BackendConformanceReport } from '../../src/scene/backend-conformance.ts'
import type { PrimitiveCapabilityClaim } from '../../src/scene/capabilities.ts'
import type { runtimeRenderContractPlugin } from './runtime-render-contract.ts'

type RuntimePlugin = ReturnType<typeof runtimeRenderContractPlugin>
const sourceVerifiers = new WeakMap<RuntimePlugin, () => void>()
const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'src/scene')
const backendPath = join(scene, 'backend.ts')
const owners = new Map<string, readonly [string, number]>([
  [backendPath, ['DefaultBackend', 0] as const],
  [join(scene, 'rough-backend.ts'), ['RoughBackend', 1] as const],
  [join(scene, 'hybrid-backend.ts'), ['HybridBackend', 2] as const],
])

function sourceSnapshot(): Map<string, string> {
  const values = new Map<string, string>()
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && entry.name !== '__tests__') visit(path)
      else if (/\.(?:ts|js|json)$/.test(entry.name)) values.set(path, readFileSync(path, 'utf8'))
    }
  }
  for (const directory of ['src', 'scripts/build']) visit(join(root, directory))
  for (const name of ['package.json', 'bun.lock']) values.set(join(root, name), readFileSync(join(root, name), 'utf8'))
  return values
}

export function assertConformanceSourceSnapshot(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): void {
  if (after.size !== before.size || [...before].some(([path, contents]) => after.get(path) !== contents)) {
    throw new Error('Sources changed during built-in conformance certification; rebuild from a stable tree')
  }
}

/** Preserve the report values exactly while sharing repeated JSON strings.
 * Each decoded object/array remains distinct; only immutable strings are shared. */
function encodedReport(report: BackendConformanceReport, capabilities: readonly PrimitiveCapabilityClaim[]): string {
  if (report.claims.length !== capabilities.length) throw new Error('Executed built-in report does not cover its capability manifest')
  const { claims, ...summary } = report
  const packed: PackedPrivateBuiltinReport = { report: summary, rows: claims.map((claim, index) => {
    const template = privateBuiltinClaimTemplate(capabilities[index]!, report.fixtureId)
    const actual = claim as unknown as Record<string, unknown>
    const removed = Object.keys(template).filter(key => !Object.hasOwn(actual, key))
    const changed = Object.fromEntries(Object.entries(actual).filter(([key, value]) => !Object.hasOwn(template, key) || !isDeepStrictEqual(template[key], value)))
    return [removed, changed] as const
  }) }
  const strings: string[] = []
  const ids = new Map<string, number>()
  const stringId = (value: string): number => {
    const existing = ids.get(value)
    if (existing !== undefined) return existing
    ids.set(value, strings.length)
    strings.push(value)
    return strings.length - 1
  }
  const encode = (value: unknown): unknown => {
    if (typeof value === 'string') return stringId(value)
    if (typeof value === 'number') return ['n', value]
    if (Array.isArray(value)) return ['a', ...value.map(encode)]
    if (value && typeof value === 'object') return ['o', ...Object.entries(value).flatMap(([key, child]) => [stringId(key), encode(child)])]
    return value
  }
  const encoded = encode(packed)
  const serialized = JSON.stringify(encoded)
  const decoded = decodePrivateBuiltinReports(strings, JSON.parse(serialized)) as PackedPrivateBuiltinReport
  if (!isDeepStrictEqual(restorePrivateBuiltinReport(decoded, capabilities), report)) throw new Error('Built-in conformance report codec changed its input')
  return `import {decodePrivateBuiltinReports,restorePrivateBuiltinReport} from ${JSON.stringify(join(scene, 'private-builtin-conformance.ts'))};
const packed=decodePrivateBuiltinReports(${JSON.stringify(strings)},${serialized});
export function privateBuiltinReport(capabilities:any){return restorePrivateBuiltinReport(packed as any,capabilities)};
`
}

function privateBackendSource(source: string, path: string, owner: string, index: number): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let removedHost = 0, replacedLazy = 0, guarded = 0, captured = 0
  const statements: ts.Statement[] = []
  const capture = ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createIdentifier('capturePrivateBuiltinConformance'), undefined,
    [ts.factory.createIdentifier(owner), ts.factory.createCallExpression(ts.factory.createIdentifier('privateBuiltinReport'), undefined,
      [ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(owner), 'capabilities')])]))
  for (const statement of file.statements) {
    if (path === backendPath && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === './backend-conformance.ts' && !statement.importClause?.isTypeOnly) continue
    if (path === backendPath && ts.isFunctionDeclaration(statement)) {
      if (statement.name?.text === 'registerBackend') {
        removedHost++
        // Keep renderer-barrel re-exports linkable, while refusing unsupported
        // private mutation. This entry accepts source and options only.
        statements.push(ts.factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name,
          statement.typeParameters, statement.parameters, statement.type, ts.factory.createBlock([
            ts.factory.createThrowStatement(ts.factory.createNewExpression(ts.factory.createIdentifier('Error'), undefined,
              [ts.factory.createStringLiteral('Custom backend registration is unavailable in this private source renderer')])),
          ], true)))
        continue
      }
      if (statement.name?.text === 'lazyBuiltInConformance') { replacedLazy++; continue }
      if (statement.name?.text === 'registerBuiltInBackend') {
        if (!statement.body) throw new Error('Missing built-in registration body')
        const guard = ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
          ts.factory.createVariableDeclaration('certifiedReport', undefined, undefined,
            ts.factory.createCallExpression(ts.factory.createIdentifier('requirePrivateBuiltinConformance'), undefined, [ts.factory.createIdentifier('backend')]))
        ], ts.NodeFlags.Const))
        // Put the identity check before reads, callbacks, or canonical wrappers.
        const body = ts.factory.updateBlock(statement.body, [guard, ...statement.body.statements])
        const transformed = ts.transform(body, [context => root => {
          const visit: ts.Visitor = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazyBuiltInConformance'
            ? (guarded++, ts.factory.createObjectLiteralExpression([
              ts.factory.createPropertyAssignment('running', ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, ts.factory.createFalse())),
              ts.factory.createPropertyAssignment('report', ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, ts.factory.createIdentifier('certifiedReport'))),
            ])) : ts.visitEachChild(node, visit, context)
          return ts.visitNode(root, visit) as ts.Block
        }])
        statements.push(ts.factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name,
          statement.typeParameters, statement.parameters, statement.type, transformed.transformed[0]))
        transformed.dispose()
        continue
      }
    }
    statements.push(statement)
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === owner)) {
      statements.push(capture)
      captured++
    }
  }
  if (captured !== 1 || (path === backendPath && (removedHost !== 1 || replacedLazy !== 1 || guarded !== 1))) {
    throw new Error(`Unsupported private built-in declaration: ${path}`)
  }
  const imports = `import {capturePrivateBuiltinConformance,requirePrivateBuiltinConformance} from ${JSON.stringify(join(scene, 'private-builtin-conformance.ts'))};\nimport {privateBuiltinReport} from 'private-builtin-conformance-reports/${index}';\n`
  return imports + ts.createPrinter().printFile(ts.factory.updateSourceFile(file, statements))
}

/** Private closed-source renderers reuse proof of immutable first-party code.
 * Host/custom backend enrollment deliberately remains a public-build concern. */
export function verifyPrivateBuiltinConformanceSource(plugin: RuntimePlugin): void {
  const verify = sourceVerifiers.get(plugin)
  if (!verify) throw new Error('Not a private built-in conformance plugin')
  verify()
}

export function privateBuiltinConformancePlugin(runtime: RuntimePlugin): RuntimePlugin {
  const snapshot = sourceSnapshot()
  const verifySourceSnapshot = (): void => {
    assertConformanceSourceSnapshot(snapshot, sourceSnapshot())
  }
  const child = spawnSync('bun', [fileURLToPath(new URL('./private-builtin-conformance-producer.ts', import.meta.url))], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
  })
  if (child.error || child.status !== 0) throw new Error(`Built-in conformance certification failed: ${child.error?.message ?? child.stderr}`)
  const { reports, capabilities } = JSON.parse(child.stdout) as { reports: BackendConformanceReport[]; capabilities: PrimitiveCapabilityClaim[][] }
  if (!Array.isArray(reports) || reports.length !== owners.size || reports.some((report, index) => report.backendId !== `backend:${['default', 'rough', 'hybrid'][index]}` || report.passed !== true)) {
    throw new Error('Built-in conformance producer returned invalid reports')
  }
  verifySourceSnapshot()
  if (!Array.isArray(capabilities) || capabilities.length !== reports.length) throw new Error('Built-in conformance producer omitted capability manifests')
  const reportSources = reports.map((report, index) => encodedReport(report, capabilities[index]!))
  const plugin: RuntimePlugin = {
    name: 'private-builtin-conformance',
    setup(build) {
      const handled = new Set<string>()
      runtime.setup({ onResolve: (options, callback) => build.onResolve(options, callback), onLoad(options, callback) {
        build.onLoad(options, args => {
          const result = callback(args)
          const owner = owners.get(args.path)
          if (!result || !owner) return result
          handled.add(args.path)
          return { ...result, contents: privateBackendSource(result.contents, args.path, ...owner) }
        })
      } })
      build.onResolve({ filter: /^private-builtin-conformance-reports\/[0-2]$/ }, args => ({ path: join(scene, `__private-builtin-conformance-reports-${args.path.at(-1)}.ts`) }))
      build.onLoad({ filter: /[\\/]__private-builtin-conformance-reports-[0-2]\.ts$/ }, ({ path }) => ({
        contents: reportSources[Number(path.at(-4))]!, loader: 'ts', resolveDir: scene,
      }))
      build.onLoad({ filter: /[\\/]src[\\/]scene[\\/](?:backend|rough-backend|hybrid-backend)\.ts$/ }, ({ path }) => {
        const owner = owners.get(path)
        if (!owner || handled.has(path)) return undefined
        return { contents: privateBackendSource(snapshot.get(path)!, path, ...owner), loader: 'ts', resolveDir: dirname(path) }
      })
      const withEnd = build as typeof build & { onEnd?: (callback: () => void) => void }
      withEnd.onEnd?.(verifySourceSnapshot)
    },
  }
  sourceVerifiers.set(plugin, verifySourceSnapshot)
  return plugin
}
