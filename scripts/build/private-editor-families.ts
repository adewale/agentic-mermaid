import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { runtimeRenderContractPlugin } from './runtime-render-contract.ts'

type RuntimePlugin = ReturnType<typeof runtimeRenderContractPlugin>
const hooks = /[\\/]src[\\/]agent[\\/](?:families-builtin|stable-family-adapters|eventmodeling-body|zenuml-body)\.ts$/

/** The private editor accepts source/options and returns render artifacts. Its
 * descriptors still parse, serialize, verify and map authored source, but no
 * worker message exposes typed mutation. Drop only that unreachable authority
 * before bundling, so its implementation can be removed rather than retained
 * behind a runtime object projection. Public library descriptors stay complete. */
export function privateEditorFamilySource(source: string, path: string): string {
  const registry = basename(path) === 'family-registry.ts'
  const stable = basename(path) === 'stable-family-adapters.ts'
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let projected = 0
  const nameOf = (node: ts.ObjectLiteralElementLike): string | undefined =>
    node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isObjectLiteralExpression(node)) {
        if (registry) {
          const mutation = node.properties.some(property => ts.isPropertyAssignment(property)
            && nameOf(property) === 'capability' && ts.isStringLiteral(property.initializer) && property.initializer.text === 'mutation')
          let owner: ts.Node | undefined = node.parent
          while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent
          if (mutation && owner && ts.isFunctionDeclaration(owner) && owner.name?.text === 'builtinFamilyCapabilityEvidence') {
            projected++
            return ts.factory.updateObjectLiteralExpression(node, node.properties.map(property =>
              ts.isPropertyAssignment(property) && nameOf(property) === 'state'
                ? ts.factory.updatePropertyAssignment(property, property.name, ts.factory.createStringLiteral('diagnosed'))
                : property))
          }
        } else {
          const properties = node.properties.filter(property => {
            if (nameOf(property) !== 'mutate') return true
            if (!ts.isPropertyAssignment(property)) throw Error('Unsupported private editor mutation hook')
            projected++
            return false
          })
          return ts.visitEachChild(ts.factory.updateObjectLiteralExpression(node, properties), visit, context)
        }
      }
      if (stable && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'hooks') {
        const mutation = node.arguments[3]
        if (!mutation || !ts.isIdentifier(mutation) || !/^mutate[A-Z]/.test(mutation.text)) throw Error('Unsupported stable-family mutation argument')
        return ts.visitEachChild(ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
          node.arguments.map((argument, index) => index === 3 ? ts.factory.createVoidZero() : argument)), visit, context)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    if (!projected || (registry && projected !== 1)) throw Error('Private editor family projection did not find its owning contract')
    return ts.createPrinter().printFile(transformed.transformed[0]!)
  } finally { transformed.dispose() }
}

/** Compose with the existing registry loader: a second onLoad for the same
 * file would otherwise bypass either this projection or its security/metadata
 * projection. Other runtime loaders and resolvers retain their original owner. */
export function privateEditorFamiliesPlugin(runtime: RuntimePlugin): RuntimePlugin {
  const registry = fileURLToPath(new URL('../../src/agent/family-registry.ts', import.meta.url))
  return {
    name: 'private-editor-families',
    setup(build) {
      let registryLoader = false
      runtime.setup({
        onResolve(options, resolve) { build.onResolve(options, resolve) },
        onLoad(options, load) {
          registryLoader ||= options.filter.test(registry)
          build.onLoad(options, args => {
            const result = load(args)
            return result && args.path === registry ? { ...result, contents: privateEditorFamilySource(result.contents, args.path) } : result
          })
        },
      })
      if (!registryLoader) throw Error('Private editor must compose the registry metadata projection')
      build.onLoad({ filter: hooks }, ({ path }) => ({ contents: privateEditorFamilySource(readFileSync(path, 'utf8'), path), loader: 'ts', resolveDir: dirname(path) }))
    },
  }
}
