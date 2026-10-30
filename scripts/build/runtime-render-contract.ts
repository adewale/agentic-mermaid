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
  const styleFieldObjects = new Set<ts.ObjectLiteralExpression>()
  const schemaPropertyObjects = new Set<ts.ObjectLiteralExpression>()
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
      const initializer = unwrap(declaration.initializer)
      if (declaration.name.text.endsWith('_SCHEMA_PROPERTIES') && ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(unwrap(property.initializer))) schemaPropertyObjects.add(unwrap(property.initializer) as ts.ObjectLiteralExpression)
      }
      if (declaration.name.text !== 'SHARED_RENDER_OPTION_FIELD_DESCRIPTORS' && (schemaDocumentation || !declaration.name.text.endsWith('_DESCRIPTORS'))) continue
      const call = unwrap(declaration.initializer)
      const value = ts.isCallExpression(call) && call.arguments[0] ? unwrap(call.arguments[0]) : undefined
      if (!value || !ts.isObjectLiteralExpression(value)) continue
      for (const property of value.properties) if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
        fieldObjects.add(property.initializer)
        if (declaration.name.text === 'STYLE_SPEC_FIELD_DESCRIPTORS') styleFieldObjects.add(property.initializer)
      }
    }
  }
  if (!fieldObjects.size) throw new Error('Browser render-option projection could not find the canonical manifest')
  const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
  const inSchema = (node: ts.Node): boolean => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) && parent.name.text === 'schema') return true
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text.endsWith('_SCHEMA')) return true
      if (ts.isFunctionDeclaration(parent) && (parent.name?.text.endsWith('Schema') || parent.name?.text === 'rolePropertyJsonSchemas')) return true
      if (ts.isArrowFunction(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name) && parent.parent.name.text.endsWith('Schema')) return true
    }
    return false
  }
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isObjectLiteralExpression(node)) {
        const fields = fieldObjects.has(node)
        const schemaRoot = inSchema(node) && node.properties.some(property => ts.isPropertyAssignment(property)
          && propertyName(property) === '$schema' && ts.isStringLiteral(property.initializer)
          && property.initializer.text.startsWith('https://json-schema.org/'))
        const properties = node.properties.filter(property => {
          const name = propertyName(property)
          return !(fields && (name === 'typeScript' || name === 'defaultLabel' || name === 'description'
            || (!terminalAdapter && (name === 'terminal' || name === 'terminalNote')))) && !(!schemaDocumentation && inSchema(node) && name === 'description'
            && !(ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)))
            && !(!schemaDocumentation && schemaPropertyObjects.has(node) && name === 'description' && ts.isPropertyAssignment(property)
              && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)))
            && !(!schemaDocumentation && styleFieldObjects.has(node) && name === 'group' && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer))
            && !(!schemaDocumentation && schemaRoot && (name === '$schema' || name === '$id' || name === 'title')
              && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer))
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

/** Inline only canonical declaration leaves; runtime imports or initialization
 * statements need an explicit owner instead of silently widening a host. */
function runtimeDeclarations(path: string, names: readonly string[], localTypeImport?: string): string {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statements = file.statements.filter(statement => {
    if (!ts.isImportDeclaration(statement)) return true
    if (!statement.importClause?.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) throw new Error(`Unexpected runtime leaf import: ${path}`)
    return statement.moduleSpecifier.text !== localTypeImport
  })
  const declarations = statements.filter(statement => !ts.isImportDeclaration(statement))
  if (declarations.length !== names.length || declarations.some((statement, index) => {
    const name = ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      ? statement.declarationList.declarations[0]!.name
      : ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ? statement.name : undefined
    return !name || !ts.isIdentifier(name) || name.text !== names[index]
  })) throw new Error(`Unsupported runtime leaf declarations: ${path}`)
  return ts.createPrinter().printFile(ts.factory.updateSourceFile(file, statements))
}

function withoutRuntimeImport(source: string, path: string, module: string, names: readonly string[]): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let removed = 0
  const statements = file.statements.filter(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== module) return true
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== names.length || bindings.elements.some((element, index) =>
      element.propertyName || element.name.text !== names[index])) throw new Error(`Unsupported coalesced import: ${path}`)
    removed++
    return false
  })
  if (removed !== 1) throw new Error(`Expected one coalesced import: ${path}`)
  return ts.createPrinter().printFile(ts.factory.updateSourceFile(file, statements))
}

function runtimeFamilyDiagnosticsSource(source: string, path: string): string {
  const leafPath = resolve(dirname(path), 'shared/family-config-diagnostics.ts')
  const leaf = ts.createSourceFile(leafPath, readFileSync(leafPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statements = leaf.statements.flatMap<ts.Statement>(statement => {
    if (!ts.isImportDeclaration(statement)) return [statement]
    if (!ts.isStringLiteral(statement.moduleSpecifier)) throw new Error('Unsupported family config import')
    if (statement.moduleSpecifier.text === '../agent/types.ts' || statement.moduleSpecifier.text === '../types.ts') {
      const bindings = statement.importClause?.namedBindings
      const expected = statement.moduleSpecifier.text === '../types.ts' ? 'ConfigDiagnostic' : 'FamilyId'
      if (!statement.importClause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1
        || bindings.elements[0]!.propertyName || bindings.elements[0]!.name.text !== expected) throw new Error('Unsupported shared config types')
      return []
    }
    return [ts.factory.updateImportDeclaration(statement, statement.modifiers, statement.importClause,
      ts.factory.createStringLiteral(resolve(dirname(leafPath), statement.moduleSpecifier.text)), statement.attributes)]
  })
  const declarations = ts.createPrinter().printFile(ts.factory.updateSourceFile(leaf, statements))
  return `${declarations}\n${withoutRuntimeImport(source, path, './shared/family-config-diagnostics.ts', ['explicitFamilyConfigDiagnostics'])}`
}

function runtimeDefaultBackendSource(source: string, path: string): string {
  const leafPath = resolve(dirname(path), 'default-backend.ts')
  const leaf = ts.createSourceFile(leafPath, readFileSync(leafPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const [imported, registration] = leaf.statements
  if (leaf.statements.length !== 2 || !imported || !ts.isImportDeclaration(imported)
    || !ts.isStringLiteral(imported.moduleSpecifier) || imported.moduleSpecifier.text !== './backend.ts') throw new Error('Unsupported default backend module')
  const bindings = imported.importClause?.namedBindings
  if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 2 || bindings.elements.some((element, index) =>
    element.propertyName || element.name.text !== ['DefaultBackend', 'registerBuiltInBackend'][index])) throw new Error('Unsupported default backend import')
  if (!registration || !ts.isExpressionStatement(registration) || !ts.isCallExpression(registration.expression)
    || !ts.isIdentifier(registration.expression.expression) || registration.expression.expression.text !== 'registerBuiltInBackend'
    || registration.expression.arguments.length !== 1 || !ts.isIdentifier(registration.expression.arguments[0]!)
    || registration.expression.arguments[0]!.text !== 'DefaultBackend') throw new Error('Unsupported default backend registration')
  // Registration remains once per module, after the registry and backend are
  // initialized. Only the private SVG build redirects the side-effect facade.
  return `${source}\n${ts.createPrinter().printNode(ts.EmitHint.Unspecified, registration, leaf)}`
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
  const gaps = readFileSync(resolve(dirname(path), 'link-rank-gap.ts'), 'utf8')
  const seeds = runtimeDeclarations(resolve(dirname(path), '../scene/seed.ts'), ['seedFrom', 'hashId', 'makeRng', 'nodeSeed', 'nodeRng'])
  return `${errors}\n${identities}\n${gaps}\n${seeds}\n${ts.createPrinter().printFile(ts.factory.updateSourceFile(file, statements))}`
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

/** The private editor validates mutation shapes but does not expose SDK op
 * discovery. Omit only literal notes from the owned pure annotation helper. */
function runtimeMutationSchemaSource(source: string, path: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const helpers = file.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'withNote') : [])
  const helper = helpers[0]?.initializer
  const body = helper && ts.isArrowFunction(helper) && ts.isParenthesizedExpression(helper.body) ? helper.body.expression : undefined
  if (helpers.length !== 1 || !helper || !ts.isArrowFunction(helper) || helper.modifiers?.length
    || helper.parameters.length !== 2 || helper.parameters.some((parameter, index) => !ts.isIdentifier(parameter.name)
      || parameter.name.text !== ['spec', 'note'][index] || parameter.initializer || parameter.dotDotDotToken)
    || !body || !ts.isObjectLiteralExpression(body) || body.properties.length !== 2
    || !ts.isSpreadAssignment(body.properties[0]!) || !ts.isIdentifier(body.properties[0]!.expression) || body.properties[0]!.expression.text !== 'spec'
    || !ts.isShorthandPropertyAssignment(body.properties[1]!) || body.properties[1]!.name.text !== 'note') {
    throw new Error('Unsupported mutation schema note helper')
  }
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'withNote'
        && node.arguments.length === 2 && !ts.isSpreadElement(node.arguments[0]!)
        && (ts.isStringLiteral(node.arguments[1]!) || ts.isNoSubstitutionTemplateLiteral(node.arguments[1]!))) {
        return ts.factory.createObjectLiteralExpression([ts.factory.createSpreadAssignment(ts.visitNode(node.arguments[0]!, visit) as ts.Expression)])
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try { return ts.createPrinter().printFile(transformed.transformed[0]!) }
  finally { transformed.dispose() }
}

/** Structural plugin interface works in both esbuild and Bun builds. */
export function runtimeRenderContractPlugin({ schemaDocumentation = true, terminalAdapter = true, conformanceObservations = true, familyEditorMetadata = true, coalesceRuntimePrimitives = false, sourceOnlySceneAdmission = false } = {}) {
  return {
    name: 'runtime-render-contract',
    setup(build: BrowserBuild) {
      if (sourceOnlySceneAdmission && !schemaDocumentation) build.onLoad({ filter: /[\\/]src[\\/]agent[\\/]op-schema-definitions\.ts$/ }, ({ path }) => ({
        contents: runtimeMutationSchemaSource(readFileSync(path, 'utf8'), path), loader: 'ts', resolveDir: dirname(path),
      }))
      if (sourceOnlySceneAdmission) {
        // These private consumers accept source/options/output operations,
        // never Scene input or extension registration. Share native checks;
        // public Node, Scene and IIFE consumers retain full external admission.
        const admission = fileURLToPath(new URL('../../src/scene/external-data-snapshot.ts', import.meta.url))
        const sourceAdmission = fileURLToPath(new URL('../../src/scene/external-data-snapshot.browser.ts', import.meta.url))
        build.onResolve({ filter: /[\\/]external-data-snapshot\.ts$/ }, args =>
          resolve(args.resolveDir, args.path) === admission ? { path: sourceAdmission } : undefined)
      }
      if (coalesceRuntimePrimitives) {
        const grammarPath = fileURLToPath(new URL('../../src/shared/grammar-text.ts', import.meta.url))
        const syntaxPath = resolve(dirname(grammarPath), 'syntax-error.ts')
        const spansPath = resolve(dirname(grammarPath), 'source-spans.ts')
        const membershipPath = resolve(dirname(grammarPath), 'subgraph-membership.ts')
        build.onResolve({ filter: /[\\/]syntax-error\.ts$/ }, args => resolve(args.resolveDir, args.path) === syntaxPath ? { path: grammarPath } : undefined)
        build.onResolve({ filter: /[\\/]source-spans\.ts$/ }, args => resolve(args.resolveDir, args.path) === spansPath ? { path: grammarPath } : undefined)
        build.onResolve({ filter: /[\\/]subgraph-membership\.ts$/ }, args => resolve(args.resolveDir, args.path) === membershipPath ? { path: grammarPath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]shared[\\/]grammar-text\.ts$/ }, ({ path }) => path !== grammarPath ? undefined : ({
          contents: `${readFileSync(path, 'utf8')}\n${readFileSync(syntaxPath, 'utf8')}\n${runtimeDeclarations(spansPath, ['sourceLineStarts', 'sourcePointAt', 'sourceSpan'])}\n${runtimeDeclarations(membershipPath, ['SubgraphMembers', 'resolveSubgraphMembership', 'SubgraphMembership', 'createSubgraphMembership'])}`, loader: 'ts', resolveDir: dirname(path),
        }))
        const backendPath = fileURLToPath(new URL('../../src/layout/backend.ts', import.meta.url))
        const errorPath = resolve(dirname(backendPath), 'certification-error.ts')
        const identityPath = resolve(dirname(backendPath), '../shared/generated-identity.ts')
        const gapPath = resolve(dirname(backendPath), 'link-rank-gap.ts')
        const seedPath = resolve(dirname(backendPath), '../scene/seed.ts')
        build.onResolve({ filter: /[\\/]link-rank-gap\.ts$/ }, args => resolve(args.resolveDir, args.path) === gapPath ? { path: backendPath } : undefined)
        build.onResolve({ filter: /[\\/]generated-identity\.ts$/ }, args => resolve(args.resolveDir, args.path) === identityPath ? { path: backendPath } : undefined)
        build.onResolve({ filter: /[\\/]certification-error\.ts$/ }, args => resolve(args.resolveDir, args.path) === errorPath ? { path: backendPath } : undefined)
        build.onResolve({ filter: /[\\/]seed\.ts$/ }, args => resolve(args.resolveDir, args.path) === seedPath ? { path: backendPath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]layout[\\/]backend\.ts$/ }, ({ path }) => path !== backendPath ? undefined : ({
          contents: runtimeLayoutBackendSource(readFileSync(path, 'utf8'), path), loader: 'ts', resolveDir: dirname(path),
        }))
        const preparedTextPath = fileURLToPath(new URL('../../src/shared/prepared-text.ts', import.meta.url))
        const rowsPath = resolve(dirname(preparedTextPath), 'text-rows.ts')
        build.onResolve({ filter: /[\\/]text-rows\.ts$/ }, args => resolve(args.resolveDir, args.path) === rowsPath ? { path: preparedTextPath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]shared[\\/]prepared-text\.ts$/ }, ({ path }) => path !== preparedTextPath ? undefined : ({
          contents: `${readFileSync(path, 'utf8')}\n${runtimeDeclarations(rowsPath, ['layoutTextRows', 'layoutTextColumns'], './prepared-text.ts')}`, loader: 'ts', resolveDir: dirname(path),
        }))
        const themePath = fileURLToPath(new URL('../../src/theme.ts', import.meta.url))
        const accessibilityPath = resolve(dirname(themePath), 'shared/svg-a11y.ts')
        build.onResolve({ filter: /[\\/]svg-a11y\.ts$/ }, args => resolve(args.resolveDir, args.path) === accessibilityPath ? { path: themePath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]theme\.ts$/ }, ({ path }) => path !== themePath ? undefined : ({
          contents: `${readFileSync(path, 'utf8')}\n${runtimeDeclarations(accessibilityPath, ['buildAccessibilityAttrs'])}`, loader: 'ts', resolveDir: dirname(path),
        }))
        const multilinePath = fileURLToPath(new URL('../../src/multiline-utils.ts', import.meta.url))
        const numbersPath = resolve(dirname(multilinePath), 'shared/svg-number.ts')
        build.onResolve({ filter: /[\\/]svg-number\.ts$/ }, args => resolve(args.resolveDir, args.path) === numbersPath ? { path: multilinePath } : undefined)
        build.onLoad({ filter: /[\\/]src[\\/]multiline-utils\.ts$/ }, ({ path }) => path !== multilinePath ? undefined : ({
          contents: `${withoutRuntimeImport(readFileSync(path, 'utf8'), path, './shared/svg-number.ts', ['formatSvgNumber'])}\n${runtimeDeclarations(numbersPath, ['SVG_NUMBER', 'SVG_LONG_DECIMAL', 'SCALAR_SVG_NUMBER', 'SVG_NUMERIC_ATTRIBUTES', 'numberSpellings', 'attributeSpellings', 'formatSvgNumber', 'formatSvgNumericAttribute'])}`, loader: 'ts', resolveDir: dirname(path),
        }))
        const renderContractPath = fileURLToPath(new URL('../../src/render-contract.ts', import.meta.url))
        const diagnosticsPath = resolve(dirname(renderContractPath), 'shared/family-config-diagnostics.ts')
        build.onResolve({ filter: /[\\/]family-config-diagnostics\.ts$/ }, args => resolve(args.resolveDir, args.path) === diagnosticsPath ? { path: renderContractPath } : undefined)
        if (sourceOnlySceneAdmission) {
          const sceneBackendPath = fileURLToPath(new URL('../../src/scene/backend.ts', import.meta.url))
          const defaultBackendPath = resolve(dirname(sceneBackendPath), 'default-backend.ts')
          build.onResolve({ filter: /[\\/]default-backend\.ts$/ }, args => resolve(args.resolveDir, args.path) === defaultBackendPath ? { path: sceneBackendPath } : undefined)
          build.onLoad({ filter: /[\\/]src[\\/]scene[\\/]backend\.ts$/ }, ({ path }) => path !== sceneBackendPath ? undefined : ({
            contents: runtimeDefaultBackendSource(readFileSync(path, 'utf8'), path), loader: 'ts', resolveDir: dirname(path),
          }))
        }
      }
      build.onLoad({ filter: /[\\/]src[\\/]layout-engine\.ts$/ }, ({ path }) => ({
        contents: runtimeLayoutSource(readFileSync(path, 'utf8'), path),
        loader: 'ts',
        resolveDir: dirname(path),
      }))
      build.onLoad({ filter: /[\\/]src[\\/](?:render-contract|scene[\\/](?:style-spec|role-style-contract))\.ts$/ }, ({ path }) => !path.endsWith('render-contract.ts') && schemaDocumentation ? undefined : ({
        contents: runtimeSource(coalesceRuntimePrimitives && path.endsWith('render-contract.ts')
          ? runtimeFamilyDiagnosticsSource(readFileSync(path, 'utf8'), path) : readFileSync(path, 'utf8'), path, schemaDocumentation, terminalAdapter),
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
