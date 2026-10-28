import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const directories: Record<string, string> = {
  gitgraph: 'mermaid/src/diagrams/git',
  journey: 'mermaid/src/diagrams/user-journey',
  quadrant: 'mermaid/src/diagrams/quadrant-chart',
  zenuml: 'mermaid-zenuml/src',
}

/** Inventory files, not harvested literals. Vitest expands their loops and
 * parameter tables; the original test bodies and expectations are untouched. */
export function upstreamSpecFiles(upstream: string, families: readonly string[]): Array<{ family: string; path: string }> {
  const files: Array<{ family: string; path: string }> = []
  const walk = (directory: string, family: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path, family)
      else if (/\.(?:spec|test)\.[jt]s$/.test(entry.name)) files.push({ family, path: resolve(path) })
    }
  }
  for (const family of families) {
    walk(join(upstream, 'packages', directories[family] ?? `mermaid/src/diagrams/${family}`), family)
    const parser = join(upstream, 'packages/parser/tests', `${family === 'gitgraph' ? 'gitGraph' : family}.test.ts`)
    const parent = join(upstream, 'packages/parser/tests')
    if (readdirSync(parent).includes(parser.slice(parent.length + 1))) files.push({ family, path: resolve(parser) })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
