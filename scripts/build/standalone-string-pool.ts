import ts from 'typescript'

export interface StandaloneStringPoolResult {
  readonly code: string
  readonly beforeBytes: number
  readonly afterBytes: number
  readonly pooledStrings: number
  readonly replacements: number
  readonly reason?: string
}

interface Occurrence { readonly start: number; readonly end: number; readonly raw: string }
interface Scope { readonly body: ts.SourceFile | ts.Block; readonly values: Map<string, Occurrence[]> }
interface Edit { readonly start: number; readonly end: number; readonly text: string }

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8')
const functionLike = (node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
  | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
  || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)

function asmDirective(body: ts.Block): boolean {
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    if (statement.expression.text === 'use asm') return true
  }
  return false
}

function insertionPosition(scope: Scope, file: ts.SourceFile): number {
  let position = ts.isBlock(scope.body) ? scope.body.getStart(file) + 1 : scope.body.statements[0]?.getStart(file) ?? 0
  for (const statement of scope.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    position = statement.end
  }
  return position
}

/** Build-only compaction for a self-contained standalone module. A function's
 * constants stay inside its own block, including when Function#toString is
 * used to serialize it into another realm. Concise arrows and class fields
 * retain their original expressions. No public/lazy module uses this pass. */
export function poolStandaloneRuntimeStrings(source: string): StandaloneStringPoolResult {
  const beforeBytes = bytes(source)
  const unchanged = (reason: string): StandaloneStringPoolResult => ({ code: source, beforeBytes, afterBytes: beforeBytes,
    pooledStrings: 0, replacements: 0, reason })
  if (source.startsWith('#!')) return unchanged('hashbang')
  let file: ts.SourceFile
  try { file = ts.createSourceFile('standalone-runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) }
  catch { return unchanged('parse-failed') }
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return unchanged('parse-failed')
  const identifiers = new Set<string>()
  const top: Scope = { body: file, values: new Map() }
  const scopes: Scope[] = [top]
  const stack: { node: ts.Node; scope?: Scope; excluded: boolean }[] = [{ node: file, scope: top, excluded: false }]
  // Iterative traversal avoids a recursive visitor over ELK's deep comma trees.
  while (stack.length) {
    const { node, scope, excluded } = stack.pop()!
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)
      || ts.isExportAssignment(node) || node.kind === ts.SyntaxKind.ExportKeyword || ts.isWithStatement(node)) return unchanged('open-module-or-eval')
    if (ts.isCallExpression(node)) {
      let callee = node.expression
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(callee) && callee.text === 'eval') return unchanged('open-module-or-eval')
    }
    if (!excluded && scope && ts.isStringLiteral(node)) {
      const parent = node.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node }
      if (parent.name !== node && parent.propertyName !== node && !ts.isExpressionStatement(parent)) {
        const start = node.getStart(file), raw = source.slice(start, node.end)
        if (bytes(raw) >= 32) {
          const occurrences = scope.values.get(node.text) ?? []
          occurrences.push({ start, end: node.end, raw })
          scope.values.set(node.text, occurrences)
        }
      }
    }
    const ownFunction = functionLike(node) ? node : undefined
    const blocked = excluded || ts.isComputedPropertyName(node) || ts.isTaggedTemplateExpression(node)
      || ts.isDeleteExpression(node) || ts.isDecorator(node)
      || Boolean(ownFunction?.body && ts.isBlock(ownFunction.body) && asmDirective(ownFunction.body))
    let ownScope: Scope | undefined
    if (ownFunction?.body && ts.isBlock(ownFunction.body) && !blocked) {
      ownScope = { body: ownFunction.body, values: new Map() }
      scopes.push(ownScope)
    }
    ts.forEachChild(node, child => {
      let childScope = scope
      if (ownFunction) childScope = child === ownFunction.body ? ownScope : undefined
      else if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isClassStaticBlockDeclaration(node)) childScope = undefined
      stack.push({ node: child, scope: childScope, excluded: blocked })
    })
  }
  const edits: Edit[] = []
  let sequence = 0, pooledStrings = 0, replacements = 0
  for (const scope of scopes) {
    const declarations: string[] = []
    const scopeEdits: Edit[] = []
    let scopeSavings = 0, scopeStrings = 0, scopeReplacements = 0
    for (const occurrences of scope.values.values()) {
      if (occurrences.length < 2) continue
      let name: string
      do { name = `$S${(sequence++).toString(36)}` } while (identifiers.has(name))
      // Keep a spelling already escaped by SWC, including </script> escaping.
      const raw = occurrences.reduce((best, item) => bytes(item.raw) < bytes(best) ? item.raw : best, occurrences[0]!.raw)
      const declaration = `${name}=${raw}`
      const saving = occurrences.reduce((total, item) => total + bytes(item.raw) - bytes(name), 0) - bytes(declaration) - 1
      if (saving <= 0) continue
      declarations.push(declaration)
      scopeSavings += saving
      scopeStrings++
      scopeReplacements += occurrences.length
      for (const item of occurrences) scopeEdits.push({ start: item.start, end: item.end, text: name })
    }
    if (!declarations.length || scopeSavings <= 8) continue
    for (const edit of scopeEdits) edits.push(edit)
    const position = insertionPosition(scope, file)
    edits.push({ start: position, end: position, text: `;const ${declarations.join(',')};` })
    pooledStrings += scopeStrings
    replacements += scopeReplacements
  }
  if (!edits.length) return unchanged('no-benefit')
  edits.sort((left, right) => right.start - left.start || right.end - left.end)
  const chunks: string[] = []
  let cursor = source.length
  for (const edit of edits) {
    chunks.push(source.slice(edit.end, cursor), edit.text)
    cursor = edit.start
  }
  chunks.push(source.slice(0, cursor))
  const code = chunks.reverse().join('')
  const afterBytes = bytes(code)
  if (beforeBytes - afterBytes < 1024) return unchanged('below-minimum-benefit')
  return { code, beforeBytes, afterBytes, pooledStrings, replacements }
}
