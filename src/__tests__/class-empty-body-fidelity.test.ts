import { expect, test } from 'bun:test'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

test('an inline empty class body keeps its class identity across public surfaces', () => {
  for (const declaration of ['class EmptyClass {}', 'class EmptyClass { }']) {
    const source = `classDiagram\n  ${declaration}\n`
    const native = parseClassDiagram(source.trim().split('\n').map(line => line.trim()))
    expect(native.classes.map(node => node.id)).toEqual(['EmptyClass'])

    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) continue
    expect(parsed.value.body.kind).toBe('class')
    expect(verifyMermaid(parsed.value).ok).toBe(true)
    expect(renderMermaidSVG(source)).toContain('class="class-node" data-id="EmptyClass"')

    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(reparsed.value.body.kind).toBe('class')

    const renamed = mutate(parsed.value, { kind: 'rename_class', from: 'EmptyClass', to: 'RenamedClass' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(renderMermaidSVG(serializeMermaid(renamed.value))).toContain('data-id="RenamedClass"')
  }
})
