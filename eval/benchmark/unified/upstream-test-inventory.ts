import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { canonical, harvestModernCorpus } from '../../mermaid-modern-compat/corpus.ts'

/** Declarations are counted, not guessed expanded test cases. Source candidates
 * reuse the existing upstream collector without running either implementation. */
export function inventoryUpstreamTests(upstream: string) {
  const collected = harvestModernCorpus(upstream, true)
  const literals = [...collected.corpus.values()].filter(input => input.provenance.some(provenance => provenance.kind === 'spec')).map(input => ({ ...input, provenance: input.provenance.filter(provenance => provenance.kind === 'spec') }))
  const files: Array<{ path: string; family: string; declarations: Array<{ name: string; line: number; endLine: number; modifiers: string[]; literalSources: string[]; interpolatedTemplates: number; scope: string }> }> = []
  const callee = (node: ts.Expression): string[] | undefined => (ts.isIdentifier(node) && ['it', 'test'].includes(node.text) ? [node.text] : ts.isPropertyAccessExpression(node) ? callee(node.expression)?.concat(node.name.text) : ts.isCallExpression(node) ? callee(node.expression) : undefined)
  const testModifiers = new Set(['only', 'skip', 'todo', 'each', 'fails', 'concurrent', 'sequential', 'runIf', 'skipIf', 'for'])
  const tracked = execFileSync('git', ['-C', upstream, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(path => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))
  for (const path of tracked) {
    const full = join(upstream, path),
      parts = path.split('/'),
      diagramIndex = parts.indexOf('diagrams'),
      renderingIndex = parts.indexOf('rendering')
    const family = diagramIndex >= 0 ? (diagramIndex + 2 < parts.length ? canonical(parts[diagramIndex + 1]!) : '<diagram-shared>') : renderingIndex >= 0 ? canonical(parts[renderingIndex + 1]!) : '<shared>'
    const source = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
    const declarations: (typeof files)[number]['declarations'] = []
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const chain = callee(node.expression),
          first = node.arguments[0]
        if (
          chain &&
          chain.slice(1).every(modifier => testModifiers.has(modifier)) &&
          first &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)) &&
          (node.arguments.some(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) || chain.includes('todo'))
        ) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            endLine = source.getLineAndCharacterOfPosition(node.end).line + 1
          const candidates = literals.filter(input => input.provenance.some(provenance => provenance.file === path && provenance.line >= line && provenance.line <= endLine))
          let interpolatedTemplates = 0
          const templates = (child: ts.Node): void => {
            if (ts.isTemplateExpression(child)) interpolatedTemplates++
            ts.forEachChild(child, templates)
          }
          templates(node)
          const modifiers = chain.slice(1)
          declarations.push({
            name: ts.isTemplateExpression(first) ? first.getText(source) : first.text,
            line,
            endLine,
            modifiers,
            literalSources: candidates.map(input => input.id),
            interpolatedTemplates,
            scope: modifiers.includes('skip') || modifiers.includes('todo') ? 'disabled-or-todo' : candidates.length ? 'literal-source-replay-only' : interpolatedTemplates ? 'dynamic-source-or-assertions-unprojected' : 'internal-or-no-direct-source-unprojected',
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    files.push({ path, family, declarations })
  }
  const declarations = files.flatMap(file => file.declarations)
  return {
    scope:
      'All Git-tracked spec/test JS/TS files in the pinned Mermaid repository, including library, parser packages and end-to-end tests. Counts are AST test declarations, not expanded/generated test runs. Public-source replay candidates come only from the existing diagrams collector; other files remain inventoried and unprojected.',
    collectorLimits:
      'Existing collector admits direct literals <=50,000 characters with its fixed known-header detector; concatenation, interpolation, generated inputs, external fixtures and unknown headers can remain unextracted. No implementation acceptance filter. No declaration is credited as an assertion pass from a literal replay.',
    files,
    literals,
    counts: {
      files: files.length,
      declarations: declarations.length,
      literalSources: literals.length,
      literalSourceDeclarations: declarations.filter(row => row.literalSources.length > 0).length,
      disabledOrTodoDeclarations: declarations.filter(row => row.scope === 'disabled-or-todo').length,
      dynamicOrUnprojectedDeclarations: declarations.filter(row => row.scope === 'dynamic-source-or-assertions-unprojected').length,
      internalOrUnprojectedDeclarations: declarations.filter(row => row.scope === 'internal-or-no-direct-source-unprojected').length,
      skippedInterpolatedTemplates: collected.skippedInterpolatedTemplates,
    },
    families: [...new Set(files.map(file => file.family))].sort().map(family => ({
      family,
      files: files.filter(file => file.family === family).length,
      declarations: files.filter(file => file.family === family).reduce((sum, file) => sum + file.declarations.length, 0),
      literalSources: literals.filter(input => input.provenance.some(provenance => provenance.familyHint === family)).length,
    })),
  }
}
