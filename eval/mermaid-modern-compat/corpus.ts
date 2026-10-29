import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import ts from 'typescript'

export interface Provenance {
  kind: 'docs' | 'spec' | 'probe' | 'authored' | 'mutation'
  file: string
  line: number
  familyHint: string
  parent?: string
}
export interface Sample {
  id: string
  source: string
  provenance: Provenance[]
  expectedSvgLabels?: string[]
}

// One source harvest for the rendering assessment and grammar diagnostics.
export function canonical(type: string): string {
  const lowered = type.toLowerCase()
  if (/^flowchart/.test(lowered) || lowered === 'graph') return 'flowchart'
  if (/^class/.test(lowered)) return 'class'
  if (/^state/.test(lowered)) return 'state'
  if (/^railroad/.test(lowered)) return 'railroad'
  return ({ git: 'gitgraph', userjourney: 'journey', 'user-journey': 'journey', quadrantchart: 'quadrant', 'quadrant-chart': 'quadrant', sequencediagram: 'sequence', entityrelationshipdiagram: 'er', requirementdiagram: 'requirement', swimlanes: 'swimlane' } as Record<string, string>)[lowered] ?? lowered
}
function docFamily(file: string): string {
  return canonical(basename(file, '.md')) === 'userjourney' ? 'journey' : canonical(basename(file, '.md'))
}

export function harvestModernCorpus(upstream: string, includeSpecs: boolean) {
  const corpus = new Map<string, Sample>()
  function add(source: string, provenance: Provenance): void {
    source = source.trim()
    if (!source || source.length > 50_000) return
    const id = createHash('sha256').update(source).digest('hex').slice(0, 20)
    const previous = corpus.get(id)
    if (previous) previous.provenance.push(provenance)
    else corpus.set(id, { id, source, provenance: [provenance] })
  }
  const docsDir = join(upstream, 'packages/mermaid/src/docs/syntax')
  const docFiles = readdirSync(docsDir)
    .filter(file => file.endsWith('.md') && !['examples.md', 'zenuml.md'].includes(file))
    .sort()
  const expectedFamilies = new Set(docFiles.map(docFamily))
  for (const file of docFiles) {
    const full = join(docsDir, file),
      text = readFileSync(full, 'utf8')
    for (const match of text.matchAll(/^[ \t]*```(?:mermaid[\w-]*|mmd)(?:[^\n]*)\n([\s\S]*?)^[ \t]*```/gm)) {
      add(match[1]!, { kind: 'docs', file: relative(upstream, full), line: text.slice(0, match.index).split('\n').length + 1, familyHint: docFamily(file) })
    }
  }
  add('info', { kind: 'probe', file: '<manual info pseudo-diagram probe>', line: 1, familyHint: 'info' })

  let skippedInterpolatedTemplates = 0
  if (includeSpecs) {
    const firstHeader =
      /^(?:---|(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirement(?:Diagram)?|gitGraph|C4\w+|mindmap|timeline|sankey|xychart|block|packet|kanban|architecture|radar|eventmodeling|treemap|venn|ishikawa|wardley|cynefin|treeView|railroad|agentflow|usecase|swimlane|info)\b)/i
    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(?:spec|test)\.[jt]s$/.test(entry.name)) continue
        const source = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
        function visit(node: ts.Node): void {
          if (ts.isTemplateExpression(node)) skippedInterpolatedTemplates++
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const text = node.text.trim()
            if (firstHeader.test(text)) {
              const familyDir = relative(join(upstream, 'packages/mermaid/src/diagrams'), full).split('/')[0]!
              add(text, { kind: 'spec', file: relative(upstream, full), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, familyHint: canonical(familyDir) })
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
    walk(join(upstream, 'packages/mermaid/src/diagrams'))
  }
  return { corpus, expectedFamilies, docFiles, skippedInterpolatedTemplates }
}
