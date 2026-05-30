// Loop 12 M5 (#543): render-markdown converts fenced mermaid blocks and
// SKIPS invalid diagrams instead of failing the whole file.

import { describe, test, expect } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { renderMarkdownBlocks, runCli } from '../cli/index.ts'

const MD = `# Doc

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

some prose

\`\`\`mermaid
not a valid diagram
\`\`\`

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: hi
\`\`\`
`

describe('#543 render-markdown skip-bad-diagrams', () => {
  test('renders all valid blocks and marks the invalid one without aborting', () => {
    const blocks = renderMarkdownBlocks(MD, 'ascii')
    expect(blocks.length).toBe(3)
    expect(blocks[0]!.ok).toBe(true)
    expect(blocks[1]!.ok).toBe(false)          // the invalid diagram
    expect(blocks[2]!.ok).toBe(true)           // continues past the failure
    expect(blocks[1]!.error!.code).toBe('RENDER_FAILED')
  })

  test('valid blocks carry rendered output + format', () => {
    const blocks = renderMarkdownBlocks(MD, 'ascii')
    expect(blocks[0]!.format).toBe('ascii')
    expect(typeof blocks[0]!.output).toBe('string')
    expect(blocks[0]!.output!.length).toBeGreaterThan(0)
  })

  test('--ascii markdown rendering emits 7-bit ASCII, not Unicode box drawing', () => {
    const blocks = renderMarkdownBlocks(MD, 'ascii')
    expect(blocks[0]!.output).not.toMatch(/[─│┌┐└┘├┤┬┴┼]/)
  })

  test('CLI accepts render-markdown --ascii before or after the file argument', () => {
    const tmp = `/tmp/am-render-md-${Date.now()}.md`
    writeFileSync(tmp, MD)
    const capture = (argv: string[]) => {
      const chunks: string[] = []
      const orig = process.stdout.write.bind(process.stdout)
      ;(process.stdout as any).write = (s: string) => { chunks.push(String(s)); return true }
      try { expect(runCli(argv)).toBe(0) } finally { (process.stdout as any).write = orig }
      return JSON.parse(chunks.join(''))
    }
    expect(capture(['render-markdown', tmp, '--ascii']).blocks.length).toBe(3)
    expect(capture(['render-markdown', '--ascii', tmp]).blocks.length).toBe(3)
  })

  test('block indices are stable and sequential', () => {
    const blocks = renderMarkdownBlocks(MD, 'svg')
    expect(blocks.map(b => b.index)).toEqual([0, 1, 2])
  })

  test('svg format renders <svg> for valid blocks', () => {
    const blocks = renderMarkdownBlocks(MD, 'svg')
    expect(blocks[0]!.output).toContain('<svg')
  })

  test('markdown with no mermaid blocks → empty array', () => {
    expect(renderMarkdownBlocks('# just text\n\nno diagrams here')).toEqual([])
  })

  test('all-valid markdown → all ok', () => {
    const md = '```mermaid\nflowchart TD\n A --> B\n```\n\n```mermaid\nflowchart LR\n X --> Y\n```'
    const blocks = renderMarkdownBlocks(md, 'ascii')
    expect(blocks.length).toBe(2)
    expect(blocks.every(b => b.ok)).toBe(true)
  })
})
