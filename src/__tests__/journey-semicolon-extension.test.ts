import { describe, expect, test } from 'bun:test'
import { asJourney, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'

const source = 'journey\n  A: 5: Me; B: 3: Me'

function upstreamProbe(text: string): { exitCode: number; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '-e', `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(text)})
      process.stdout.write(JSON.stringify(diagram.db.getTasks().map(task => task.task)))
    `],
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  })
  return { exitCode: result.exitCode, stderr: new TextDecoder().decode(result.stderr) }
}

describe('Journey semicolon statements are a diagnosed Agentic extension', () => {
  test('pinned Mermaid 11.16 rejects a joined task line that both local parsers retain', () => {
    const upstream = upstreamProbe(source)
    expect(upstream.exitCode).not.toBe(0)
    expect(upstream.stderr).toContain('Parse error')

    expect(parseJourneyDiagram(source.split('\n')).sections[0]!.tasks.map(task => task.text)).toEqual(['A', 'B'])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asJourney(parsed.value)?.body.sections[0]!.tasks.map(task => task.text)).toEqual(['A', 'B'])
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_semicolon_statement_extension',
      line: 2,
    }))
  })

  test('serialization and mutation replace the extension with portable newlines', () => {
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('A: 5: Me\n    B: 3: Me')
    expect(upstreamProbe(serialized).exitCode).toBe(0)
    expect(verifyMermaid(serialized).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'journey_semicolon_statement_extension' }))

    const changed = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: 4 })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const changedSource = serializeMermaid(changed.value)
    expect(changedSource).toContain('B: 4: Me')
    expect(upstreamProbe(changedSource).exitCode).toBe(0)
  })

  test('trailing statement terminators are diagnosed, but block-description text is not', () => {
    const terminated = verifyMermaid('journey\n  A: 5: Me;')
    expect(terminated.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_semicolon_statement_extension', line: 2,
    }))
    const block = verifyMermaid('journey\n  accDescr {A; B}\n  Task: 3: Me')
    expect(block.warnings).not.toContainEqual(expect.objectContaining({ syntax: 'journey_semicolon_statement_extension' }))
  })
})
