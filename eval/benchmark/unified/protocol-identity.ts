import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

/** Git already identifies our sources. Follow executable imports, and require
 * callers to supply roots for spawned workers and other non-imported producers.
 * Report files outside this closure do not invalidate retained measurements. */
export function protocolIdentity(root: string, entryPoints: readonly string[]): string[] {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const tracked = new Set(git('ls-files').split('\n'))
  const paths = new Set<string>()
  const visit = (path: string) => {
    if (paths.has(path)) return
    if (path.startsWith('..') || !tracked.has(path) || !existsSync(resolve(root, path))) throw Error(`Uncommitted or external measurement producer: ${path}`)
    paths.add(path)
    if (!/\.(?:ts|mjs|js)$/.test(path)) return
    const source = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
    const follow = (specifier: string) => {
      if (!specifier.startsWith('.')) return
      const base = resolve(dirname(resolve(root, path)), specifier)
      const candidates = [base, base + '.ts', base + '.mjs', base + '.js', resolve(base, 'index.ts'), ...(base.endsWith('.js') ? [base.slice(0, -3) + '.ts'] : [])]
      const found = candidates.find(candidate => tracked.has(relative(root, candidate)) && existsSync(candidate))
      if (!found) throw Error(`Unresolved measurement dependency: ${path}: ${specifier}`)
      visit(relative(root, found))
    }
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        const typeOnly = clause?.isTypeOnly || (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly))
        if (!typeOnly) follow(node.moduleSpecifier.text)
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(item => !item.isTypeOnly)) follow(node.moduleSpecifier.text)
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) follow(node.arguments[0].text)
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  if (!entryPoints.length) throw Error('Measurement producer roots are required')
  for (const entry of entryPoints) visit(entry)
  const selected = [...paths].sort()
  if (git('status', '--porcelain', '--untracked-files=all', '--', ...selected)) throw Error('Commit measurement producers before collecting or reusing benchmark records')
  return git('ls-tree', '-r', 'HEAD', '--', ...selected).split('\n').filter(Boolean)
}
