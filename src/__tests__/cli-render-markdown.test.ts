// Loop 12 M5 (#543): render-markdown converts fenced mermaid blocks and
// SKIPS invalid diagrams instead of failing the whole file.

import { describe, test, expect } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cli from '../cli/index.ts'
const { renderMarkdownBlocks, verifyMarkdownBlocks, runCli } = cli
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

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
    expect(blocks[1]!.error!.code).toBe('UNKNOWN_HEADER')
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
    const dir = temp.dir('am-render-md-')
    const tmp = join(dir, 'doc.md')
    writeFileSync(tmp, MD)
    const capture = (argv: string[]) => {
      const chunks: string[] = []
      const orig = process.stdout.write.bind(process.stdout)
      ;(process.stdout as any).write = (s: string) => { chunks.push(String(s)); return true }
      try { expect(runCli(argv)).toBe(0) } finally { (process.stdout as any).write = orig }
      return JSON.parse(chunks.join('')) as { blocks: Array<{ format?: string; output?: string }> }
    }
    for (const argv of [['render-markdown', tmp, '--ascii'], ['render-markdown', '--ascii', tmp]]) {
      const { blocks } = capture(argv)
      // The default format is svg, so an ignored --ascii would still yield 3 blocks.
      expect({ argv, count: blocks.length, format: blocks[0]!.format, svg: blocks.some(b => b.output?.includes('<svg')) })
        .toEqual({ argv, count: 3, format: 'ascii', svg: false })
    }
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


describe('Markdown verification', () => {
  test('checks tilde and long fences without interpreting fenced Markdown examples', () => {
    const md = ['# Example', '````markdown', '```mermaid', 'not a diagram', '```', '````', '', '~~~mermaid', 'flowchart LR', 'A --> B', '~~~', '', '````mermaid', 'flowchart TD', 'A[bad', '````'].join('\r\n')
    const blocks = verifyMarkdownBlocks(md)
    expect(blocks.map(block => [block.startLine, block.ok])).toEqual([[9, true], [14, false]])
    expect(blocks[1]!.warnings.find(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toMatchObject({ line: 15 })
    expect(renderMarkdownBlocks(md, 'ascii').map(block => block.ok)).toEqual([true, false])
  })

  test('the CLI checks every block and fails verification without changing the file', () => {
    const file = join(temp.dir('am-verify-md-'), 'doc.md')
    writeFileSync(file, MD)
    const chunks: string[] = []
    const original = process.stdout.write
    ;(process.stdout as any).write = (text: string) => { chunks.push(String(text)); return true }
    try { expect(runCli(['verify', file, '--markdown', '--json'])).toBe(3) }
    finally { process.stdout.write = original }
    const result = JSON.parse(chunks.join(''))
    expect(result).toMatchObject({ ok: false, file })
    expect(result.blocks.map((block: {ok:boolean}) => block.ok)).toEqual([true, false, true])
    expect(result.blocks[1].warnings[0]).toMatchObject({ line: 11, lineIsBlockStart: true })
  })

  test.each([
    ['<!--', '-->'], ['<pre>', '</pre>'], ['<script>', '</script>'],
    ['<style>', '</style>'], ['<textarea>', '</textarea>'],
    ['<?instruction', '?>'], ['<!DOCTYPE', '>'], ['<![CDATA[', ']]>'],
    ['<div>', ''], ['<custom-widget data-name="example">', ''],
  ])('ignores fence-looking text inside the HTML block %s', (open, close) => {
    const md = [open, '```mermaid', 'not a diagram', '```', close, '', '~~~mermaid', 'flowchart LR', 'A-->B', '~~~'].join('\n')
    const blocks = verifyMarkdownBlocks(md)
    expect(blocks.map(block => [block.startLine, block.ok])).toEqual([[8, true]])
    expect(renderMarkdownBlocks(md, 'ascii').map(block => block.ok)).toEqual([true])
  })

  test('HTML-looking text inside code and inline tags do not hide a later diagram', () => {
    for (const prefix of ['```text\n<!--\n```', 'Paragraph\n<custom-widget>', '```not`a-fence\n<custom-widget>', '# Heading\n<custom-widget>\nnot a diagram\n']) {
      const md = `${prefix}\n~~~mermaid\nflowchart LR\nA-->B\n~~~`
      expect(verifyMarkdownBlocks(md).map(block => block.ok)).toEqual([true])
    }
  })

  test('empty Markdown and indented example fences contain no Mermaid blocks', () => {
    expect(verifyMarkdownBlocks('No diagrams.')).toEqual([])
    expect(verifyMarkdownBlocks('    ```mermaid\n    wrong\n    ```')).toEqual([])
  })
})
