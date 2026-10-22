import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import ts from 'typescript'

/** Keep the canonical source manifest. Browser renderers need validation and
 * schema projection, not the Node SDK/Markdown documentation fields. Schema
 * prose and terminal metadata have independent owners: omitting render-only
 * schema descriptions must never disable an offered terminal adapter. */
function runtimeSource(source: string, path: string, schemaDocumentation: boolean, terminalAdapter: boolean): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fieldObjects = new Set<ts.ObjectLiteralExpression>()
  const descriptionArguments = new Map<string, Set<number>>()
  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression
    return node
  }
  const parameters = (name: string, values: readonly ts.ParameterDeclaration[]): void => {
    const indices = new Set(values.flatMap((value, index) => ts.isIdentifier(value.name) && value.name.text === 'description' ? [index] : []))
    if (indices.size) descriptionArguments.set(name, indices)
  }
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.name.text.endsWith('Schema')) parameters(statement.name.text, statement.parameters)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      if (ts.isArrowFunction(declaration.initializer) && declaration.name.text.endsWith('Schema')) parameters(declaration.name.text, declaration.initializer.parameters)
      if (declaration.name.text !== 'SHARED_RENDER_OPTION_FIELD_DESCRIPTORS' && (schemaDocumentation || !declaration.name.text.endsWith('_DESCRIPTORS'))) continue
      const call = unwrap(declaration.initializer)
      const value = ts.isCallExpression(call) && call.arguments[0] ? unwrap(call.arguments[0]) : undefined
      if (!value || !ts.isObjectLiteralExpression(value)) continue
      for (const property of value.properties) if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) fieldObjects.add(property.initializer)
    }
  }
  if (!fieldObjects.size) throw new Error('Browser render-option projection could not find the canonical manifest')
  const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
  const inSchema = (node: ts.Node): boolean => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) && parent.name.text === 'schema') return true
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text.endsWith('_SCHEMA')) return true
      if (ts.isFunctionDeclaration(parent) && parent.name?.text.endsWith('Schema')) return true
      if (ts.isArrowFunction(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name) && parent.parent.name.text.endsWith('Schema')) return true
    }
    return false
  }
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isObjectLiteralExpression(node)) {
        const fields = fieldObjects.has(node)
        const properties = node.properties.filter(property => {
          const name = propertyName(property)
          return !(fields && (name === 'typeScript' || name === 'defaultLabel' || name === 'description'
            || (!terminalAdapter && (name === 'terminal' || name === 'terminalNote')))) && !(!schemaDocumentation && inSchema(node) && name === 'description'
            && !(ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)))
        })
        return ts.visitEachChild(ts.factory.updateObjectLiteralExpression(node, properties), visit, context)
      }
      if (!schemaDocumentation && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const positions = descriptionArguments.get(node.expression.text)
        if (positions) return ts.visitEachChild(ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
          node.arguments.map((argument, index) => positions.has(index) ? ts.factory.createVoidZero() : argument)), visit, context)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try { return ts.createPrinter().printFile(transformed.transformed[0]!) }
  finally { transformed.dispose() }
}

interface BrowserBuild {
  onLoad(options: { filter: RegExp }, callback: (args: { path: string }) => { contents: string; loader: 'ts'; resolveDir: string } | undefined): void
}

/** Pipeline prose is for Node-side inspection and generated documentation.
 * Keep the executable pass contracts intact in the browser renderer. */
function runtimeLayoutSource(source: string, path: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'LAYOUT_PIPELINE'
        && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
        const passes = node.initializer.elements.map(pass => ts.isObjectLiteralExpression(pass)
          ? ts.factory.updateObjectLiteralExpression(pass, pass.properties.filter(property =>
            !(property.name && ts.isIdentifier(property.name) && property.name.text === 'doc')))
          : pass)
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateArrayLiteralExpression(node.initializer, passes))
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try { return ts.createPrinter().printFile(transformed.transformed[0]!) }
  finally { transformed.dispose() }
}

/** Render-only entries do not publish backend conformance observations. Keep
 * every executable witness and failure diagnostic; erase only literal prose in
 * outcome's observation position, never an expression that may do work. */
function runtimeConformanceSource(source: string, path: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let projected = 0
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'outcome') {
        const observation = node.arguments[1]
        if (observation && (ts.isStringLiteral(observation) || ts.isNoSubstitutionTemplateLiteral(observation))) {
          projected++
          return ts.visitEachChild(ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
            node.arguments.map((argument, index) => index === 1 ? ts.factory.createStringLiteral('') : argument)), visit, context)
        }
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    if (!projected) throw new Error('Browser conformance projection could not find literal observations')
    return ts.createPrinter().printFile(transformed.transformed[0]!)
  } finally { transformed.dispose() }
}

/** Structural plugin interface works in both esbuild and Bun builds. */
export function runtimeRenderContractPlugin({ schemaDocumentation = true, terminalAdapter = true, conformanceObservations = true } = {}) {
  return {
    name: 'runtime-render-contract',
    setup(build: BrowserBuild) {
      build.onLoad({ filter: /[\\/]src[\\/]layout-engine\.ts$/ }, ({ path }) => ({
        contents: runtimeLayoutSource(readFileSync(path, 'utf8'), path),
        loader: 'ts',
        resolveDir: dirname(path),
      }))
      build.onLoad({ filter: /[\\/]src[\\/](?:render-contract|scene[\\/]style-spec)\.ts$/ }, ({ path }) => path.endsWith('style-spec.ts') && schemaDocumentation ? undefined : ({
        contents: runtimeSource(readFileSync(path, 'utf8'), path, schemaDocumentation, terminalAdapter),
        loader: 'ts',
        resolveDir: dirname(path),
      }))
      if (!conformanceObservations) build.onLoad({ filter: /[\\/]src[\\/]scene[\\/]backend-conformance\.ts$/ }, ({ path }) => ({
        contents: runtimeConformanceSource(readFileSync(path, 'utf8'), path),
        loader: 'ts',
        resolveDir: dirname(path),
      }))
    },
  }
}
