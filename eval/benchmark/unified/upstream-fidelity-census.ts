import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

export interface OriginalDeclaration { name: string; line: number; endLine: number; modifiers: string[] }
export interface OriginalDeclarationInventory { files: { path: string; family: string; declarations: OriginalDeclaration[] }[]; counts: { files: number; declarations: number; disabledOrTodoDeclarations: number }; scope: string }
const canonical = (family: string) => ({ git: 'gitgraph', gitGraph: 'gitgraph', 'user-journey': 'journey', 'quadrant-chart': 'quadrant' } as Record<string, string>)[family] ?? family.toLowerCase()

/** Pure source census: it neither imports a renderer nor replays harvested input.
 * This keeps original-runner admission independent of Agentic product source. */
export function inventoryOriginalDeclarations(upstream: string): OriginalDeclarationInventory {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: upstream, encoding: 'utf8' }).split('\0').filter(path => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))
  const modifiers = new Set(['only', 'skip', 'todo', 'each', 'fails', 'concurrent', 'sequential', 'runIf', 'skipIf', 'for'])
  const callee = (node: ts.Expression): string[] | undefined => ts.isIdentifier(node) && ['it', 'test'].includes(node.text) ? [node.text] : ts.isPropertyAccessExpression(node) ? callee(node.expression)?.concat(node.name.text) : ts.isCallExpression(node) ? callee(node.expression) : undefined
  const files = tracked.map(path => {
    const source = ts.createSourceFile(path, readFileSync(join(upstream, path), 'utf8'), ts.ScriptTarget.Latest, true)
    const parts = path.split('/'), diagrams = parts.indexOf('diagrams'), rendering = parts.indexOf('rendering')
    const family = diagrams >= 0 ? canonical(parts[diagrams + 1]!) : rendering >= 0 ? canonical(parts[rendering + 1]!) : '<shared>'
    const declarations: OriginalDeclaration[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const chain = callee(node.expression), first = node.arguments[0]
        if (chain && chain.slice(1).every(modifier => modifiers.has(modifier)) && first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)) && (node.arguments.some(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) || chain.includes('todo'))) declarations.push({ name: ts.isTemplateExpression(first) ? first.getText(source) : first.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, endLine: source.getLineAndCharacterOfPosition(node.end).line + 1, modifiers: chain.slice(1) })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return { path, family, declarations }
  })
  return { files, counts: { files: files.length, declarations: files.reduce((sum, file) => sum + file.declarations.length, 0), disabledOrTodoDeclarations: files.flatMap(file => file.declarations).filter(declaration => declaration.modifiers.some(modifier => ['skip', 'todo'].includes(modifier))).length }, scope: 'Every Git-tracked spec/test JS/TS file in the pinned upstream repository. Counts are declarations, distinct from expanded executed callbacks and assertions. No source replay or implementation admission contributes a pass.' }
}
