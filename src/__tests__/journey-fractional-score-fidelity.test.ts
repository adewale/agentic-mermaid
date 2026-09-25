import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { asJourney, describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'

const source = 'journey\n  section Work\n  First: 3: Me\n  Review: 3.5: Me\n  Last: 4: Me'

describe('Journey fractional score fidelity', () => {
  test('pinned Mermaid 11.16 assigns exact fractional task scores', () => {
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(source)})
        process.stdout.write(JSON.stringify(diagram.db.getTasks().map(task => task.score)))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([3, 3.5, 4])
  })

  test('native and agent models retain 3.5 through serialize and mutation', () => {
    expect(parseJourneyDiagram(source.split('\n')).sections[0]?.tasks.map(task => task.score)).toEqual([3, 3.5, 4])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asJourney(parsed.value)?.body.sections[0]?.tasks.map(task => task.score)).toEqual([3, 3.5, 4])
    expect(verifyMermaid(parsed.value).ok).toBe(true)
    expect(describeMermaidFacts(parsed.value)).toContain('journey task Review score 3.5 actors Me')
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('Review: 3.5: Me')
    const reparsed = parseRegisteredMermaid(serialized)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(asJourney(reparsed.value)?.body.sections[0]?.tasks.map(task => task.score)).toEqual([3, 3.5, 4])
    const mutated = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: 4.25 })
    expect(mutated.ok).toBe(true)
    if (mutated.ok) {
      expect(asJourney(mutated.value)?.body.sections[0]?.tasks[1]?.score).toBe(4.25)
      const mutatedSource = serializeMermaid(mutated.value)
      expect(mutatedSource).toContain('Review: 4.25: Me')
      const reparsedMutation = parseRegisteredMermaid(mutatedSource)
      expect(reparsedMutation.ok).toBe(true)
      if (reparsedMutation.ok) expect(asJourney(reparsedMutation.value)?.body.sections[0]?.tasks[1]?.score).toBe(4.25)
    }
    const invalidMutation = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: Number.POSITIVE_INFINITY })
    expect(invalidMutation.ok).toBe(false)
    if (!invalidMutation.ok) expect(invalidMutation.error.code).toBe('INVALID_OP')
  })

  test('SVG positions the score between neighboring ticks and terminal output remains exact', () => {
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('data-score="3.5"')
    const markerYs = [...svg.matchAll(/<g class="journey-score-marker" data-score="([34](?:\.5)?)">\s*<circle[^>]* cy="([^"]+)"/g)]
    const positions = new Map(markerYs.map(match => [Number(match[1]), Number(match[2])]))
    expect(positions.size).toBe(3)
    expect(positions.get(4)!).toBeLessThan(positions.get(3.5)!)
    expect(positions.get(3.5)!).toBeLessThan(positions.get(3)!)
    expect(positions.get(3.5)).toBe((positions.get(3)! + positions.get(4)!) / 2)

    const unicode = renderMermaidASCII(source, { colorMode: 'none' })
    expect(unicode).toContain('●●●◐○ Review (score 3.5)')
    const ascii = renderMermaidASCII(source, { colorMode: 'none', useAscii: true })
    expect(ascii).toContain('###+. Review (score 3.5)')
    expect(ascii).toContain('scores: 3 3.5 4')
  })

  test('out-of-range, malformed, and non-finite scores remain rejected', () => {
    for (const score of ['0.5', '5.1', '3.5oops', '1e999', 'NaN', 'Infinity']) {
      expect(() => parseJourneyDiagram(`journey\nTask: ${score}: Me`.split('\n'))).toThrow()
      const parsed = parseRegisteredMermaid(`journey\nTask: ${score}: Me`)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')
    }
  })

  test('malformed long task and score fields remain bounded', () => {
    const spaces = ' '.repeat(65_536)
    const cases = [
      [`journey\nTask${spaces}: bad`, 'invalid score bad'],
      [`journey\nTask${spaces}x`, 'Invalid user journey line'],
      [`journey\nTask: x${spaces}!`, 'invalid score'],
      [`journey\nTask: 3.5${spaces}!`, 'invalid score'],
    ] as const
    const started = performance.now()
    for (const [input, diagnostic] of cases) {
      expect(() => parseJourneyDiagram(input.split('\n'))).toThrow(diagnostic)
    }
    // The old overlapping lazy/whitespace quantifiers took multiple seconds
    // on one of these inputs. Allow ample CI variance while rejecting that
    // superlinear regression at an attacker-controlled 64 KiB statement.
    expect(performance.now() - started).toBeLessThan(1_500)
  })

  test('bounded Mermaid numeric spellings normalize without truncation', () => {
    for (const [raw, expected] of [['+3.5', 3.5], ['3.5e0', 3.5], ['3.', 3], ['1.25', 1.25]] as const) {
      const input = `journey\nTask: ${raw}: Me`
      expect(parseJourneyDiagram(input.split('\n')).sections[0]?.tasks[0]?.score).toBe(expected)
      const parsed = parseRegisteredMermaid(input)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(asJourney(parsed.value)?.body.sections[0]?.tasks[0]?.score).toBe(expected)
        expect(serializeMermaid(parsed.value)).toContain(`Task: ${expected}: Me`)
      }
    }
  })

  test('facts preserve all representable score digits', () => {
    const precise = parseRegisteredMermaid('journey\nPrecise: 3.123456789012345: Me')
    expect(precise.ok).toBe(true)
    if (!precise.ok) return
    expect(describeMermaidFacts(precise.value)).toContain('journey task Precise score 3.123456789012345 actors Me')
  })

  test('fractional face sentiment changes exactly at score 3', () => {
    const mouth = (score: number): { kind: 'line' | 'curve'; endpointY: number; controlY?: number } => {
      const svg = renderMermaidSVG(`journey\nTask: ${score}: Me`)
      const path = svg.match(/<path class="journey-face-mouth" d="([^"]+)"/)
      expect(path).not.toBeNull()
      const d = path![1]!
      const coordinates = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]))
      return d.includes(' Q')
        ? { kind: 'curve', endpointY: coordinates[1]!, controlY: coordinates[3]! }
        : { kind: 'line', endpointY: coordinates[1]! }
    }
    const sad = mouth(2.75)
    const neutral = mouth(3)
    const happy = mouth(3.25)
    expect(sad.kind).toBe('curve')
    expect(sad.controlY!).toBeLessThan(sad.endpointY)
    expect(neutral.kind).toBe('line')
    expect(happy.kind).toBe('curve')
    expect(happy.controlY!).toBeGreaterThan(happy.endpointY)
  })
})
