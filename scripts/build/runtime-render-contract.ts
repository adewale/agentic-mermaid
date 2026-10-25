import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  onResolve(options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path: string } | undefined): void
}

/** Share canonical runtime primitives through the existing browser backend
 * chunk. Error and generated-identity leaves keep one module identity without
 * separate requests. Source and Node retain their original modules. */
function runtimeLayoutBackendSource(source: string, path: string): string {
  const errorPath = resolve(dirname(path), 'certification-error.ts')
  const errors = readFileSync(errorPath, 'utf8')
  const leaf = ts.createSourceFile(errorPath, errors, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = ['LayoutCertificationAttempt', 'LayoutCertificationError', 'DeferredDependencyError', 'deferredDependency']
  if (leaf.statements.length !== declarations.length || leaf.statements.some((statement, index) =>
    !(ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement))
    || statement.name?.text !== declarations[index])) throw new Error('Unsupported canonical layout error declarations')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let imports = 0, exports = 0
  const statements = file.statements.filter(statement => {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== './certification-error.ts') return true
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1
        || bindings.elements[0]!.propertyName || bindings.elements[0]!.name.text !== 'LayoutCertificationError') throw new Error('Unsupported layout error facade import')
      imports++
    } else {
      const bindings = statement.exportClause
      if (!bindings || !ts.isNamedExports(bindings) || bindings.elements.length !== 3 || bindings.elements.some((element, index) =>
        element.propertyName || element.name.text !== ['DeferredDependencyError', 'LayoutCertificationError', 'LayoutCertificationAttempt'][index])) throw new Error('Unsupported layout error facade exports')
      exports++
    }
    return false
  })
  if (imports !== 1 || exports !== 1) throw new Error('Expected one canonical layout error import and export')
  const identities = readFileSync(resolve(dirname(path), '../shared/generated-identity.ts'), 'utf8')
  const identityFile = ts.createSourceFile('generated-identity.ts', identities, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (identityFile.statements.length !== 2 || !ts.isTypeAliasDeclaration(identityFile.statements[0]!)
    || identityFile.statements[0]!.name.text !== 'GeneratedIdentityKey'
    || !ts.isFunctionDeclaration(identityFile.statements[1]!) || identityFile.statements[1]!.name?.text !== 'generatedIds') {
    throw new Error('Unsupported canonical generated identity declarations')
  }
  return `${errors}\n${identities}\n${ts.createPrinter().printFile(ts.factory.updateSourceFile(file, statements))}`
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
 * every executable witness and failure diagnostic. Evaluate nonliteral
 * observations before discarding their result, preserving coercion and throws;
 * the minifier may then remove prose from expressions it proves pure. */
function runtimeConformanceSource(source: string, path: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let projected = 0
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'outcome') {
        const observation = node.arguments[1]
        if (observation) {
          projected++
          const discarded = ts.isStringLiteral(observation) || ts.isNoSubstitutionTemplateLiteral(observation)
            ? ts.factory.createStringLiteral('')
            : ts.factory.createParenthesizedExpression(ts.factory.createCommaListExpression([observation, ts.factory.createStringLiteral('')]))
          return ts.visitEachChild(ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
            node.arguments.map((argument, index) => index === 1 ? discarded : argument)), visit, context)
        }
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    if (!projected) throw new Error('Browser conformance projection could not find observations')
    return ts.createPrinter().printFile(transformed.transformed[0]!)
  } finally { transformed.dispose() }
}

/** The private standalone worker offers rendering/verification, not the SDK's
 * editor catalog. The page already embeds that catalog from canonical source.
 * Remove only pure literal editor fields from the two exact owned seed tables;
 * reject new table shapes rather than discarding unknown evaluation/metadata. */
function runtimeFamilyEditorSource(source: string, path: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const stable = path.endsWith('stable-family-metadata.ts')
  const tableName = stable ? 'STABLE_FAMILY_DESCRIPTOR_SEEDS' : 'BUILTIN_FAMILY_DESCRIPTOR_SEEDS'
  const editorFields = new Set(['editorDiagramType', 'editorLabel', 'editorDescription', 'editorExampleId', 'editorGlyph', 'editorExample'])
  let projected = 0, tables = 0
  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression
    return node
  }
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === tableName && node.initializer) {
        if (!ts.isVariableDeclarationList(node.parent) || !ts.isVariableStatement(node.parent.parent) || !ts.isSourceFile(node.parent.parent.parent) || ++tables !== 1) throw new Error('Private editor projection requires one exact module seed table')
        const table = unwrap(node.initializer)
        if (!ts.isArrayLiteralExpression(table)) throw new Error('Unsupported private editor family seed table')
        const elements = table.elements.map(seed => {
          if (!stable && ts.isSpreadElement(seed) && ts.isIdentifier(seed.expression) && seed.expression.text === 'STABLE_FAMILY_DESCRIPTOR_SEEDS') return seed
          if (!ts.isObjectLiteralExpression(seed)) throw new Error('Unsupported private editor family seed')
          const omitted = new Set<string>()
          const properties = seed.properties.filter(property => {
            if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) throw new Error('Unsupported private editor family seed property')
            const name = property.name.text
            if (!editorFields.has(name)) return true
            if (omitted.has(name) || (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer))) throw new Error('Private editor metadata must remain unique pure literals')
            omitted.add(name)
            return false
          })
          if (omitted.size !== editorFields.size) throw new Error('Incomplete private editor family metadata')
          projected++
          return ts.factory.updateObjectLiteralExpression(seed, properties)
        })
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateArrayLiteralExpression(table, elements))
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    if (!projected) throw new Error('Private editor projection could not find family seeds')
    return ts.createPrinter().printFile(transformed.transformed[0]!)
  } finally { transformed.dispose() }
}

/** Structural plugin interface works in both esbuild and Bun builds. */
export function runtimeRenderContractPlugin({ schemaDocumentation = true, terminalAdapter = true, conformanceObservations = true, familyEditorMetadata = true, coalesceRuntimePrimitives = false } = {}) {
  return {
    name: 'runtime-render-contract',
    setup(build: BrowserBuild) {
      if (coalesceRuntimePrimitives) {
        const backendPath = fileURLToPath(new URL('../../src/layout/backend.ts', import.meta.url))
        const errorPath = resolve(dirname(backendPath), 'certification-error.ts')
        const identityPath = resolve(dirname(backendPath), '../shared/generated-identity.ts')
        build.onResolve({ filter: /[\\/]generated-identity\.ts$/ }, args => resolve(args.resolveDir, args.path) === identityPath ? { path: backendPath } : undefined)
        build.onResolve({ filter: /[\\/]certification-error\.ts$/ }, args => resolve(args.resolveDir, args.path) === errorPath ? { path: backendPath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]layout[\\/]backend\.ts$/ }, ({ path }) => path !== backendPath ? undefined : ({
          contents: runtimeLayoutBackendSource(readFileSync(path, 'utf8'), path), loader: 'ts', resolveDir: dirname(path),
        }))
      }
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
      if (!familyEditorMetadata) build.onLoad({ filter: /[\\/]src[\\/]agent[\\/](?:family-registry|stable-family-metadata)\.ts$/ }, ({ path }) => ({
        contents: runtimeFamilyEditorSource(readFileSync(path, 'utf8'), path),
        loader: 'ts',
        resolveDir: dirname(path),
      }))
    },
  }
}
