// Every fence of the pinned official Mermaid syntax pages named by the upstream
// policy, in page order. Shared by the official-fence corpus test and the
// release benchmark so both observe the same inputs.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const UPSTREAM_DOCS = join(ROOT, 'skills', 'agentic-mermaid-diagram-workflow', 'references', 'upstream')

export interface OfficialFence {
  id: string
  family: string
  source: string
}

/** Distinct Mermaid fences of a markdown page in first-occurrence order. */
function extractMermaidFences(markdown: string): string[] {
  const sources: string[] = []
  for (const match of markdown.matchAll(/^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm)) {
    const source = match[1]!.trim()
    if (source && !sources.includes(source)) sources.push(source)
  }
  return sources
}

/** Every fence, named `<family>:official-syntax/<page>#<index>`. */
export function extractOfficialCorpus(): OfficialFence[] {
  /** The reviewed family -> official syntax page mapping. */
  const officialPages = Object.entries((JSON.parse(readFileSync(join(ROOT, 'docs', 'project', 'upstream-mermaid-policy.json'), 'utf8')) as {
    officialSyntaxPages: Record<string, string>
  }).officialSyntaxPages)
  return officialPages.flatMap(([family, file]) =>
    extractMermaidFences(readFileSync(join(UPSTREAM_DOCS, file), 'utf8'))
      .map((source, index) => ({ id: `${family}:official-syntax/${file}#${index}`, family, source })))
}
