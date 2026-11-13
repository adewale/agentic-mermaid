import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { asPacket, layoutMermaidWithReceipt, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { mutatePacket, parsePacketBody, renderPacket } from '../agent/packet-body.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { resolvePacketConfig } from '../packet/config.ts'
import { layoutPacketDiagram } from '../packet/layout.ts'
import { parsePacketDiagram } from '../packet/parser.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

test('Packet directive-like labels retain their exact value and interval through export and edits', async () => {
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    const source = 'packet\n0-7: "%%{field"\n8-15: "Payload"'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
    const packet = asPacket(parsed.value)!
    const written = serializeMermaid(packet)
    expect(await upstream.accepts(written)).toBe(true)
    expect(parsePacketDiagram(written)).toEqual(parsePacketDiagram(source))
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
    const edited = mutate(packet, { kind: 'set_field_label', index: 1, label: '%%{edited' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw Error(JSON.stringify(edited.error))
    const output = serializeMermaid(edited.value)
    expect(await upstream.accepts(output)).toBe(true)
    expect(parsePacketDiagram(output).fields[1]).toMatchObject({ start: 8, end: 15, label: '%%{edited' })
  } finally { upstream.close() }
})

test('Packet mirrors each word, including partial final words, without changing field widths', () => {
  const body = parsePacketDiagram('packet\n+8: "DATA"\n+4: "TYPE"\n+1: "EN"\n+6: "RESERVED"')
  const ascending = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow: 16 })
  const descending = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow: 16, bitOrder: 'descending' })
  expect(descending.fields.map(field => field.width)).toEqual(ascending.fields.map(field => field.width))
  for (const field of descending.fields) {
    const original = ascending.fields.find(other => other.id === field.id)!
    expect(field.x + original.x + field.width).toBe(2 * 24 + 16 * 32)
    expect(field.bitLabels.map(label => label.text)).toEqual(original.bitLabels.map(label => label.text).reverse())
  }
  expect(descending.fields.at(-1)!.x + descending.fields.at(-1)!.width + descending.visual.paddingX / 2).toBe(24 + 16 * 32)
})

test('Packet node padding and corners affect retained text and artwork without changing encoded widths', () => {
  const source = 'packet\n+2: "Readable field"\n+30: "Payload"',
    style = { roles: { node: { paddingX: 20, paddingY: 37, cornerRadius: 11 } } },
    before = layoutMermaidWithReceipt(source).layout,
    after = layoutMermaidWithReceipt(source, { style }).layout
  expect(after.nodes.map(node => [node.id, node.x, node.w])).toEqual(before.nodes.map(node => [node.id, node.x, node.w]))
  expect(after.nodes[0]!.h).toBeGreaterThan(before.nodes[0]!.h + 40)
  expect(after.nodes[0]!.labelBounds!.h).toBeGreaterThan(before.nodes[0]!.labelBounds!.h)
  const svg = renderMermaidSVG(source, { style })
  expect(svg).toContain('rx="11"')
  expect(svg).toContain('data-start="0" data-end="1"')
})

test('Packet count mutations maintain contiguity and reject invalid edits atomically', () => {
  const body = parsePacketDiagram('packet\n+8: "A"\n+16: "B"')
  const resized = mutatePacket(body, { kind: 'set_field_bits', index: 0, bits: 12 })
  expect(resized.ok).toBe(true)
  if (!resized.ok) throw new Error(resized.error.message)
  expect(resized.value.fields.map(({ start, end }) => [start, end])).toEqual([
    [0, 11],
    [12, 27],
  ])
  expect(body.fields.map(({ start, end }) => [start, end])).toEqual([
    [0, 7],
    [8, 23],
  ])
  expect(mutatePacket(body, { kind: 'add_field', label: 'bad', bits: 0 }).ok).toBe(false)
  expect(parsePacketBody('packet\nunsupported syntax')).toBeNull()
})

test('Packet word bit numbering follows the configured direction and single-bit anchors', () => {
  const body = parsePacketDiagram('packet\n0-7: "DATA"\n8-11: "TYPE"\n12: "EN"\n13-15: "RESERVED"')
  const ascending = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow: 16 })
  const descending = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow: 16, bitOrder: 'descending' })
  const physical = (layout: typeof ascending) => [...layout.fields].sort((a, b) => a.x - b.x)
  expect(physical(ascending).flatMap(field => field.bitLabels.map(bit => Number(bit.text)))).toEqual([0, 7, 8, 11, 12, 13, 15])
  expect(physical(descending).map(field => field.label)).toEqual(['RESERVED', 'EN', 'TYPE', 'DATA'])
  expect(physical(descending).flatMap(field => field.bitLabels.map(bit => Number(bit.text)))).toEqual([15, 13, 12, 11, 8, 7, 0])
  expect(descending.fields.find(field => field.label === 'EN')!.bitLabels).toMatchObject([{ text: '12', anchor: 'middle' }])
  expect(ascending.fields.find(field => field.label === 'EN')!.bitLabels).toMatchObject([{ text: '12', anchor: 'middle' }])
  const defaultLayout = layoutPacketDiagram(body)
  expect(layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitOrder: 'ascending' })).toEqual(defaultLayout)
})

test('Packet field inspection metadata retains unwrapped labels and exact inclusive ranges across row fragments', () => {
  const source = '---\nconfig:\n  packet:\n    bitsPerRow: 8\n---\npacket\n+3: "Mode"\n+12: "Long authentication & \\"tag\\""',
    svg = renderMermaidSVG(source),
    fragments = [...svg.matchAll(/<g[^>]*data-field-id="field-1"[^>]*>/g)].map(match => match[0])
  expect(fragments).toHaveLength(2)
  expect(fragments.every(group => group.includes('data-field-label="Long authentication &amp; &quot;tag&quot;"'))).toBe(true)
  expect(fragments[0]).toContain('data-start="3" data-end="7"')
  expect(fragments[1]).toContain('data-start="8" data-end="14"')
  expect(svg).not.toContain('tabindex=')
})

test.each(['ascending', 'descending'] as const)('Packet showBits:false hides numbering while retaining %s word geometry', bitOrder => {
  const body = parsePacketDiagram('packet\n+8: "First"\n+8: "Second"')
  const layout = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow: 8, bitOrder, showBits: false })
  expect(layout.rows).toBe(2)
  expect(layout.fields.flatMap(field => field.bitLabels)).toEqual([])
  expect(layout.fields.map(field => [field.start, field.end, field.label])).toEqual([
    [0, 7, 'First'],
    [8, 15, 'Second'],
  ])
  const mixed = layoutPacketDiagram(parsePacketDiagram('packet\n+3: "Mode"\n+1: "EN"\n+4: "Data"'), {}, { ...resolvePacketConfig(), bitsPerRow: 8, bitOrder, showBits: false })
  expect([...mixed.fields].sort((a, b) => a.x - b.x).map(field => field.label)).toEqual(bitOrder === 'descending' ? ['Data', 'EN', 'Mode'] : ['Mode', 'EN', 'Data'])
})

test('Packet multiline strings preserve blank lines, comment-looking text and trailing comments', () => {
  const source = 'packet\n0-7: "First\n\n%% literal line\nLast" %% actual comment\n\n%% between fields\n+1: \'flag\'',
    statements: [string, number | undefined][] = []
  const body = withParserObservation(
    'packet',
    event => {
      if (event.unit === 'statement' && event.kind === 'field') statements.push([event.text ?? '', event.source?.line])
    },
    () => parsePacketDiagram(source),
  )
  expect(body.fields.map(field => field.label)).toEqual(['First\n\n%% literal line\nLast', 'flag'])
  expect(parsePacketDiagram(renderPacket(body)).fields.map(field => field.label)).toEqual(body.fields.map(field => field.label))
  expect(statements.map(([, line]) => line)).toEqual([2, 8])
  expect(statements[1]![0]).toBe("+1: 'flag'")
})

test('Packet typed wrapper and all public outputs agree on title, labels and mutation', () => {
  const source = '\uFEFF---\ntitle: Register\nconfig:\n  packet:\n    bitsPerRow: 8\n    bitOrder: descending\n---\n%% retained wrapper\npacket\n+3: "Mode"\n+1: "EN"\n+4: "界"\n'
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Packet parse failed')
  const narrowed = asPacket(parsed.value)
  expect(narrowed).not.toBeNull()
  if (!narrowed) throw new Error('Packet narrowing failed')
  const changed = mutate(narrowed, { kind: 'set_field_label', index: 0, label: 'Operation' })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw new Error('Packet mutation failed')
  const serialized = serializeMermaid(changed.value)
  expect(serialized.startsWith(source.slice(0, source.indexOf('packet\n')))).toBe(true)
  expect(renderMermaidSVG(serialized)).toContain('Operation')
  const terminal = renderMermaidASCII(serialized)
  expect(terminal).toContain('界')
  expect(terminal).toContain('Register')
  expect(renderMermaidASCII(serialized, { useAscii: true })).toContain('+')
})

test('Packet conserves every authored bit across independently generated row cuts', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 70 }), { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 64 }), (widths, bitsPerRow) => {
      const body = parsePacketDiagram('packet\n' + widths.map((bits, index) => `+${bits}: "field ${index}"`).join('\n'))
      const layout = layoutPacketDiagram(body, {}, { ...resolvePacketConfig(), bitsPerRow })
      const bits = layout.fields.flatMap(field => Array.from({ length: field.end - field.start + 1 }, (_, index) => field.start + index))
      expect(bits).toEqual(Array.from({ length: widths.reduce((sum, width) => sum + width, 0) }, (_, index) => index))
      expect(renderPacket(parsePacketDiagram(renderPacket(body)))).toBe(renderPacket(body))
    }),
    fcParameters({ numRuns: 50, seed: 1202001 }),
  )
})
