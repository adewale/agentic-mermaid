import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asJourney, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { observeJourneyExtensionReceipt } from './journey-extension-receipt.ts'

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
  test('cross-surface extension receipt stays separate from upstream-native feature claims', () => {
    const projectRoot = join(import.meta.dir, '..', '..')
    const receipt = JSON.parse(readFileSync(join(projectRoot, 'docs/project/agentic-extension-receipts.json'), 'utf8'))
    expect(receipt).toEqual({ schemaVersion: 1, extensions: [observeJourneyExtensionReceipt()] })
    const extension = receipt.extensions[0]
    expect(extension.classification).toBe('agentic-extension')
    expect(extension.upstreamFeatureId).toBeNull()
    expect(extension.capabilityProjection).toBe('excluded-from-mermaid-native-features')
    expect(extension.upstream).toMatchObject({ acceptsSource: false, parseError: true })
    expect(extension.surfaces.agent).toMatchObject({ disposition: 'diagnosed-extension', tasks: ['A:5', 'B:3'], warningCode: 'UNSUPPORTED_SYNTAX', warningLine: 2 })
    expect(extension.surfaces.render).toMatchObject({ disposition: 'rendered-extension', markerScores: [5, 3], taskLabelsVisible: true })
    expect(extension.surfaces.serialize).toMatchObject({ disposition: 'portable-newline-output', tasks: ['A:5', 'B:3'], extensionWarningCleared: true })
    expect(extension.surfaces.mutate).toMatchObject({ disposition: 'portable-newline-output', tasks: ['A:5', 'B:4'] })
    const official = JSON.parse(readFileSync(join(projectRoot, 'docs/project/fidelity-capability-report.json'), 'utf8'))
    expect(official.features.flatMap((feature: { caseIds: string[] }) => feature.caseIds)).not.toContain(extension.id)
    expect(official.features.find((feature: { featureId: string }) => feature.featureId === 'official-doc:journey:section:user-journey-diagram').disposition).toBe('native')
  })

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

  test.each(['accTitle', 'accDescr'])('semicolon inside inline %s is portable text', directive => {
    const inline = `journey\n  ${directive}: A; B\n  Task: 3: Me`
    expect(upstreamProbe(inline).exitCode).toBe(0)
    expect(verifyMermaid(inline).warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_semicolon_statement_extension',
    }))
    const rendered = parseJourneyDiagram(inline.split('\n'))
    expect(rendered.sections[0]!.tasks.map(task => task.text)).toEqual(['Task'])
    expect(directive === 'accTitle' ? rendered.accessibilityTitle : rendered.accessibilityDescription).toBe('A; B')
  })

  test.each([
    ['leading comment', '%% hi\njourney\n  A: 5: Me; B: 3: Me', 3],
    ['init directive', '%%{init: {"theme":"default"}}%%\njourney\n  A: 5: Me; B: 3: Me', 3],
    ['frontmatter', '---\ntitle: Example\n---\njourney\n  A: 5: Me; B: 3: Me', 5],
    ['in-body blank and comment', 'journey\n\n  %% body comment\n  A: 5: Me; B: 3: Me', 4],
  ])('warning uses authored physical line with %s', (_name, input, line) => {
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const target of [input, parsed.value]) {
      expect(verifyMermaid(target).warnings).toContainEqual(expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_semicolon_statement_extension', line,
      }))
    }
  })
})
