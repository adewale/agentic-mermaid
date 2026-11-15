import '../index.ts'
import { describe, expect, spyOn, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import * as terminalCertification from '../ascii/terminal-certification.ts'
import { certifyTerminalLayout, TERMINAL_CERTIFICATION_LIMITS } from '../ascii/terminal-certification.ts'
import { measuredText, TerminalDocument, type TerminalOwner, terminalDocumentOf } from '../ascii/terminal-document.ts'
import { paintTerminalFrame } from '../ascii/terminal-geometry.ts'
import { allocateTerminalRoute, paintTerminalRoute } from '../ascii/terminal-route.ts'
import type { ColorMode } from '../ascii/types.ts'
import { renderContractDigest } from '../render-contract.ts'
import { secureTerminalHtmlOutput } from '../terminal-security.ts'
import { flowchartTree } from '../../eval/shared/graph-fixtures.ts'

const owner = (id: string): TerminalOwner => ({ id, kind: 'node' })
const inspect = (document: TerminalDocument, colorMode: ColorMode = 'none') => {
  const encoded = document.serialize({ colorMode })
  return certifyTerminalLayout(document, colorMode === 'html' ? secureTerminalHtmlOutput(encoded) : encoded, colorMode)
}

function markerDocument(connected = false) {
  const document = new TerminalDocument(10, 4)
  const edge: TerminalOwner = { id: 'r', kind: 'edge', from: 'A', to: 'B', ...(connected ? { route: 'connected' as const } : {}) }
  paintTerminalFrame(document, { x: 0, y: 0, width: 3, height: 3 }, owner('A'), false)
  paintTerminalFrame(document, { x: 7, y: 0, width: 3, height: 3 }, owner('B'), false)
  document.port(edge, { nodeId: 'A', end: 'start', side: 'R', x: 3, y: 1, markers: [] })
  document.port(edge, { nodeId: 'B', end: 'end', side: 'L', x: 6, y: 1, markers: [{ shape: 'arrow', direction: 'R' }] })
  for (let x = 3; x < 6; x++) document.stroke(x, 1, 10, { owner: edge })
  document.marker(6, 1, { shape: 'arrow', direction: 'R' }, { owner: edge })
  document.textBlock(0, 3, measuredText('界 👩‍💻'), { owner: owner('wide') })
  return document
}

describe('final terminal cell certification', () => {
  test.each(BUILTIN_FAMILY_METADATA.map(family => [family.id, family.example] as const))('native %s exposes complete final cell evidence', (_id, source) => {
    const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
    const certificate = result.receipt.layoutCertification
    expect(certificate).toMatchObject({ status: 'passed', unit: 'cell', scope: 'terminal-cells', coverage: { unownedCells: 0 }, budget: { exhausted: false } })
    expect(certificate?.issues).toEqual([])
  })

  test('State note attachments retain explicit marker expectations under strict safety', () => {
    const source = 'stateDiagram-v2\n s1 : Sa Sb\n s1 --> s2 : Ta Tb\n note right of s1 : Na Nb'
    const rendered = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', layoutSafety: 'strict' })
    expect(rendered.text).toContain('Na Nb')
    expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', unit: 'cell', issues: [] })
  })

  test.each([
    ['vertical grid', 'xychart\nx-axis [comedy, romance, mystery, crime, other, last]\ny-axis 0 --> 30\nbar [12,2,20,25,17,24]', [12, 2, 20, 25, 17, 24], 1],
    [
      'vertical mixed series',
      'xychart\nx-axis [jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec]\ny-axis 4000 --> 11000\nbar [5000,6000,7500,8200,9500,10500,11000,10200,9200,8500,7000,6000]\nline [5000,6000,7500,8200,9500,10500,11000,10200,9200,8500,7000,6000]',
      [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000],
      1,
    ],
    ['horizontal mixed series', 'xychart horizontal\nx-axis [A,B,C]\ny-axis 0 --> 30\nbar [2,17,24]\nline [2,17,24]', [2, 17, 24], 1],
    ['paired vertical bars', 'xychart\nx-axis [A,B,C,D,E,F]\ny-axis 4000 --> 11000\nbar [10500,11000,10200,9200,8500,7000]\nbar [10500,11000,10200,9200,8500,7000]', [10500, 11000, 10200, 9200, 8500, 7000], 2],
  ] as const)('retained %s value labels reserve their actual cells before plot paint', (_name, body, values, seriesCount) => {
    const source = `---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\n${body}`
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(source, { colorMode, layoutSafety: 'strict' })
      expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
      const document = terminalDocumentOf(rendered)!
      const allocations = [...document.layoutEvidence().textAllocations]
      for (let series = 0; series < seriesCount; series++)
        for (const [index, value] of values.entries()) {
          const allocation = allocations.find(item => item.owners.some(identity => identity.id === `series-${series}:value-${index}`))!
          expect(allocation.text.lines.map(line => line.map(cluster => cluster.glyph).join('')).join('\n')).toBe(String(value))
          for (const cluster of allocation.text.lines[0]!) {
            const cell = document.cell(allocation.x + cluster.x, allocation.y)!
            expect(cell.glyph).toBe(cluster.glyph)
            expect(cell.owners).toContainEqual(expect.objectContaining({ id: `series-${series}:value-${index}`, kind: 'label' }))
          }
          if (seriesCount > 1) expect(document.cell(allocation.x + Math.floor(allocation.text.width / 2), allocation.y + 1)?.owners).toContainEqual(expect.objectContaining({ id: `series-${series}`, kind: 'node' }))
        }
    }
  })

  test('cross-group Sequence message text reserves its full footprint before participant frames', () => {
    const source = 'sequenceDiagram\nbox Purple Alice & John\nparticipant A\nparticipant J\nend\nbox Another Group\nparticipant B\nparticipant C\nend\nA->>J: Hello John, how are you?\nJ->>A: Great!\nA->>B: Hello Bob, how is Charley?\nB->>C: Hello Charley, how are you?'
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(source, { colorMode, layoutSafety: 'strict' })
      expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
      const document = terminalDocumentOf(rendered)!
      const allocation = [...document.layoutEvidence().textAllocations].find(item => item.owners.some(identity => identity.id === 'message:2'))!
      expect(allocation.text.lines[0]!.map(cluster => cluster.glyph).join('')).toBe('Hello Bob, how is Charley?')
      for (const cluster of allocation.text.lines[0]!) {
        const cell = document.cell(allocation.x + cluster.x, allocation.y)!
        expect(cell.glyph).toBe(cluster.glyph)
        expect(cell.owners).toContainEqual(expect.objectContaining({ id: 'message:2', kind: 'edge', from: 'A', to: 'B' }))
      }
    }
  })

  test.each(['none', 'ansi16', 'html'] as const)('binds stable certification to the actual %s output', colorMode => {
    // Report-mode text-only callers must not pay for certification
    // (docs/layout-certification.md). Internal evidence enumeration is free
    // to change; the expensive certificate boundary is the work budget.
    const certify = spyOn(terminalCertification, 'certifyTerminalLayout')
    try {
      const result = renderMermaidASCIIWithReceipt('flowchart LR\n A["界 & <b>wide</b>"] --> B[Done]', { colorMode })
      expect(result.text).toContain('界')
      expect(certify).not.toHaveBeenCalled()
      const certificate = structuredClone(result.receipt.layoutCertification)
      expect(certificate).toMatchObject({ version: 1, scope: 'terminal-cells', unit: 'cell', status: 'passed', outputDigest: renderContractDigest(result.text), budget: { exhausted: false } })
      expect(certify).toHaveBeenCalled()
      expect(result.receipt.layoutCertification).toEqual(certificate)
    } finally {
      certify.mockRestore()
    }
  })

  test('retains every measured occurrence through grouped composition and readable reflection', () => {
    const layer = new TerminalDocument(12, 5),
      identity = owner('value'),
      first = measuredText('界\n\nB'),
      second = measuredText('🧑🏽‍💻')
    layer.textBlock(1, 0, first, { owner: identity, textGroup: 'label' })
    layer.textBlock(8, 1, second, { owner: identity, textGroup: 'label' })
    const document = new TerminalDocument()
    document.overlay(layer, 2, 1)
    document.flip(true, true)
    const allocations = [...document.layoutEvidence().textAllocations]
    expect(allocations).toHaveLength(2)
    expect(allocations[0]!.text).toBe(first)
    expect(allocations[1]!.text).toBe(second)
    expect(inspect(document)).toMatchObject({ status: 'passed', coverage: { textAllocations: 2, textClusters: 3 } })
    expect(inspect(layer).status).toBe('passed')
  })

  test.each(['whole-document', 'partial-compartment', 'scoped-overlay'] as const)('retains semantic attribution from the actual %s composition boundary', boundary => {
    const document = new TerminalDocument(),
      identity = owner('actual')
    if (boundary === 'scoped-overlay') {
      const layer = new TerminalDocument()
      layer.textBlock(0, 0, measuredText('界 AB'))
      document.scope(identity, () => document.overlay(layer, 1, 1))
    } else {
      document.textBlock(0, 0, measuredText('界 AB'), boundary === 'whole-document' ? {} : { owner: identity })
      if (boundary === 'whole-document') document.attribute(identity)
      else document.attributeWithin({ id: 'field', kind: 'compartment', parent: { id: identity.id, kind: 'node' } }, { x: 3, y: 0, width: 2, height: 1 })
    }
    document.flip(true, true)
    expect(inspect(document).status).toBe('passed')
    const allocation = [...document.layoutEvidence().textAllocations][0]!
    const x = allocation.x + (boundary === 'partial-compartment' ? 3 : 0),
      y = allocation.y
    // The forged owner is also declared, so an identity tally cannot detect the reassignment.
    const replacement = boundary === 'partial-compartment' ? document.owners([identity]) : document.owners([owner('other')])
    document.cell(x, y)!.owners = replacement
    const certificate = inspect(document)
    expect(certificate.status).toBe('failed')
    expect(certificate.issues).toContainEqual(expect.objectContaining({ code: 'TERMINAL_TEXT_OWNER_CHANGED', elementId: boundary === 'partial-compartment' ? 'field' : identity.id }))
  })

  test('retains an entirely empty measured allocation without fabricating occupied cells', () => {
    const document = new TerminalDocument(),
      prepared = measuredText(['', ''])
    document.textBlock(0, 0, prepared, { owner: owner('blank') })
    const layer = new TerminalDocument()
    layer.overlay(document, 2, 1)
    layer.flip(false, true)
    expect([...layer.layoutEvidence().textAllocations][0]!.text).toBe(prepared)
    expect(layer.occupiedCells).toBe(0)
    expect(inspect(layer)).toMatchObject({ status: 'passed', coverage: { cells: 0, textAllocations: 1, textClusters: 0 } })
  })

  test('checks final wide graphemes and endpoint markers against retained allocations', () => {
    const document = markerDocument()
    expect(inspect(document)).toMatchObject({ status: 'passed', coverage: { ports: 2, markerContracts: 2 } })
    // Fault injection represents a corrupt final paint adapter after successful allocation.
    document.cell(1, 3)!.glyph = 'x'
    document.cell(6, 1)!.marker = { shape: 'triangle', direction: 'R' }
    const certificate = certifyTerminalLayout(document, document.layoutEvidence().emittedText!, 'none')
    expect(certificate.status).toBe('failed')
    expect(certificate.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['TERMINAL_OUTPUT_CELLS', 'TERMINAL_GRAPHEME_HEAD', 'TERMINAL_GRAPHEME_SPLIT', 'TERMINAL_MARKER_CONTRACT_FAILED']))
  })

  test('rejects same-width primitive substitutions and split wide-character ownership', () => {
    const document = markerDocument()
    document.cell(4, 1)!.glyph = '|'
    document.cell(1, 3)!.owners = document.owners([owner('foreign')])
    const certificate = inspect(document)
    expect(certificate.status).toBe('failed')
    expect(certificate.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['TERMINAL_PRIMITIVE_GLYPH_CHANGED', 'TERMINAL_GRAPHEME_OWNER_SPLIT']))
  })

  test('does not equate a measured count with retained text or ownership', () => {
    const document = new TerminalDocument()
    document.textBlock(0, 0, measuredText('AB'), { owner: owner('authored') })
    document.cell(1, 0)!.glyph = 'Z'
    const output = document.serialize()
    expect(certifyTerminalLayout(document, output, 'none').issues).toContainEqual(expect.objectContaining({ code: 'TERMINAL_TEXT_CHANGED', elementId: 'authored' }))
    document.cell(0, 0)!.owners = new TerminalDocument().owners([owner('foreign')])
    const certificate = certifyTerminalLayout(document, document.serialize(), 'none')
    expect(certificate.status).toBe('failed')
    expect(certificate.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['TERMINAL_TEXT_OWNER_CHANGED', 'TERMINAL_CELL_OWNER_UNKNOWN']))
  })

  test('checks explicit membership and endpoint identities without inferring from boxes', () => {
    const document = new TerminalDocument()
    const parent: TerminalOwner = { id: 'group', kind: 'cluster', members: ['child'] }
    document.element(parent)
    document.element({ id: 'other', kind: 'cluster' })
    document.text(0, 0, 'child', { owner: { id: 'child', kind: 'node', parent: { id: 'other', kind: 'cluster' } } })
    document.port({ id: 'edge', kind: 'edge', from: 'group', to: 'child' }, { end: 'end', nodeId: 'other', side: 'L', x: 6, y: 0, markers: [] })
    const certificate = inspect(document)
    expect(certificate.status).toBe('failed')
    expect(certificate.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['TERMINAL_MEMBERSHIP_MISMATCH', 'TERMINAL_PORT_ENDPOINT_MISMATCH']))
  })

  test.each(['gap', 'foreign', 'corner', 'label', 'missing-face'] as const)('rejects a declared connected route with misleading %s ink', damage => {
    const document = markerDocument(true)
    expect(inspect(document).status).toBe('passed')
    if (damage === 'foreign') document.cell(4, 1)!.owners = document.owners([owner('foreign')])
    else if (damage === 'label') document.textBlock(4, 1, measuredText('x'), { owner: { id: 'r', kind: 'edge' } })
    else if (damage === 'corner') {
      document.cell(4, 1)!.stroke = { mask: 3 }
      document.cell(4, 1)!.glyph = '└'
    } else document.cell(damage === 'missing-face' ? 2 : 4, 1)!.glyph = ' '
    const certificate = inspect(document)
    expect(certificate.issues).toContainEqual(expect.objectContaining({ code: damage === 'missing-face' ? 'TERMINAL_ROUTE_CONTACT_FAILED' : 'TERMINAL_ROUTE_DISCONNECTED', elementId: 'r' }))
  })

  test.each(['ancestor', 'unrelated', 'wrong-kind', 'wrong-face'] as const)('checks explicit physical container contacts against authored item ancestry: %s', contact => {
    const document = new TerminalDocument(12, 5)
    const group: TerminalOwner = { id: 'G', kind: 'group', members: ['A'] }
    const edge: TerminalOwner = { id: 'r', kind: 'edge', from: 'A', to: 'B' }
    document.region(group, { x: 0, y: 0, width: 5, height: 5 })
    document.region({ ...owner('A'), parent: { id: 'G', kind: 'group' } }, { x: 1, y: 1, width: 3, height: 3 })
    document.region(owner('B'), { x: 9, y: 1, width: 3, height: 3 })
    document.region({ id: 'other', kind: 'group' }, { x: 0, y: 0, width: 5, height: 5 })
    // The same string can name a different typed surface; its rectangle is not authority.
    document.region(owner('G'), { x: 0, y: 0, width: 5, height: 5 })
    document.port(edge, { nodeId: 'A', boundary: { id: contact === 'unrelated' ? 'other' : 'G', kind: contact === 'wrong-kind' ? 'node' : 'group' }, end: 'start', side: contact === 'wrong-face' ? 'T' : 'R', x: 5, y: 2, markers: [{ shape: 'arrow', direction: contact === 'wrong-face' ? 'B' : 'L' }] })
    document.port(edge, { nodeId: 'B', end: 'end', side: 'L', x: 8, y: 2, markers: [{ shape: 'arrow', direction: 'R' }] })
    document.marker(5, 2, { shape: 'arrow', direction: contact === 'wrong-face' ? 'B' : 'L' }, { owner: edge })
    for (let x = 6; x < 8; x++) document.stroke(x, 2, 10, { owner: edge })
    document.marker(8, 2, { shape: 'arrow', direction: 'R' }, { owner: edge })
    if (contact === 'wrong-face') expect(() => inspect(document)).toThrow('Terminal marker contract failed')
    else {
      const certificate = inspect(document)
      if (contact === 'ancestor') expect(certificate.status).toBe('passed')
      else expect(certificate.issues).toContainEqual(expect.objectContaining({ code: 'TERMINAL_PORT_BOUNDARY_MISMATCH', elementId: 'r' }))
    }
  })

  test('checks owned content against allocated container frames without treating hierarchy as a guessed box', () => {
    const rendered = renderMermaidASCIIWithReceipt('flowchart LR\nsubgraph outer[Outer]\nsubgraph inner[Inner]\nA["界 A"] --> B[B]\nend\nend\nB --> C[C]', { colorMode: 'none' })
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    for (const annotationTarget of [undefined, { id: 'frame', kind: 'cluster' as const }]) {
      const document = new TerminalDocument()
      document.region({ id: 'frame', kind: 'cluster', members: ['child'] }, { x: 0, y: 0, width: 2, height: 2 })
      document.textBlock(3, 1, measuredText('outside'), { owner: { id: 'child', kind: 'node', parent: { id: 'frame', kind: 'cluster' }, annotationTarget } })
      expect(inspect(document)).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'TERMINAL_PARENT_FRAME_BREACH', elementId: 'child' })] })
    }
  })

  test.each(['node', 'cluster'] as const)('annotation targets resolve by identity without implying %s containment', kind => {
    const target: TerminalOwner = { id: 'target', kind, members: [] }
    const valid = new TerminalDocument()
    valid.region(target, { x: 0, y: 0, width: 2, height: 2 })
    valid.textBlock(3, 0, 'Note', { owner: { id: 'note', kind: 'node', annotationTarget: { id: 'target', kind } } })
    expect(structuredClone(inspect(valid))).toMatchObject({ status: 'passed', issues: [] })
    for (const reference of [
      { id: 'missing', kind },
      { id: 'target', kind: kind === 'node' ? ('cluster' as const) : ('node' as const) },
    ]) {
      const invalid = new TerminalDocument()
      invalid.region(target, { x: 0, y: 0, width: 2, height: 2 })
      invalid.textBlock(3, 0, 'Note', { owner: { id: 'note', kind: 'node', annotationTarget: reference } })
      expect(structuredClone(inspect(invalid))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'TERMINAL_ANNOTATION_TARGET_UNAVAILABLE', elementId: 'note' })] })
      expect(invalid.regions().find(region => region.id === 'note')?.annotationTarget).toEqual(reference)
    }
  })

  test('preserves intentional bundles, perpendicular crossings and numeric-mark occlusion', () => {
    const document = new TerminalDocument()
    const first: TerminalOwner = { id: 'first', kind: 'edge', bundle: 'trunk' },
      second: TerminalOwner = { id: 'second', kind: 'edge', bundle: 'trunk' }
    for (let x = 0; x < 5; x++) {
      document.stroke(x, 2, 10, { owner: first })
      document.stroke(x, 2, 10, { owner: second })
    }
    document.stroke(2, 1, 5, { owner: { id: 'crossing', kind: 'edge' } })
    document.stroke(2, 2, 5, { owner: { id: 'crossing', kind: 'edge' } })
    document.numericMark(3, 2, { axis: 'vertical', coverage: 3 }, { owner: { id: 'point', kind: 'node' } })
    expect(inspect(document).status).toBe('passed')
    expect(document.cell(3, 2)!.occludedOwners?.map(identity => identity.id)).toEqual(['first', 'second'])
  })

  test('reports missing geometry/ownership/measurement as unverified and declared projections separately', () => {
    expect(certifyTerminalLayout(undefined, 'arbitrary text', 'none')).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'TERMINAL_DOCUMENT_UNAVAILABLE' })] })
    const document = new TerminalDocument()
    document.text(0, 0, 'label')
    document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'radar.axes', message: 'A native ruler retains polar values in ordered rows.' })
    const certificate = inspect(document)
    expect(certificate).toMatchObject({ status: 'unverified', coverage: { unownedCells: 5 }, projections: [{ feature: 'radar.axes' }] })
    document.attribute(owner('label'))
    expect(inspect(document).status).toBe('passed')
    expect(certifyTerminalLayout(document, 'different', 'none').issues[0]?.code).toBe('TERMINAL_OUTPUT_MISMATCH')
  })

  test('bounds final inspection and never reports an exhausted check as passed', () => {
    const document = markerDocument(),
      output = document.serialize()
    const certificate = certifyTerminalLayout(document, output, 'none', { ...TERMINAL_CERTIFICATION_LIMITS, maxOperations: 5 })
    expect(certificate).toMatchObject({ status: 'unverified', budget: { operations: 5, maxOperations: 5, exhausted: true } })
    expect(certificate.issues).toContainEqual(expect.objectContaining({ code: 'TERMINAL_CERTIFICATION_LIMIT' }))
    const tooLarge = certifyTerminalLayout(document, output, 'none', { ...TERMINAL_CERTIFICATION_LIMITS, maxOutputCodeUnits: 1 })
    expect(tooLarge).toMatchObject({ status: 'unverified', budget: { exhausted: true } })
    expect(tooLarge.outputDigest).toBeUndefined()
    expect(() => certifyTerminalLayout(document, output, 'none', { ...TERMINAL_CERTIFICATION_LIMITS, maxOperations: Infinity })).toThrow(RangeError)
  })

  test('a rejected allocation produces an explicit failed cell contract rather than disappearing', () => {
    const document = new TerminalDocument()
    document.textBlock(0, 0, measuredText('kept'), { owner: owner('first') })
    expect(document.textBlock(0, 0, measuredText('lost'), { owner: owner('second') })).toBeUndefined()
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'TERMINAL_TEXT_COLLISION' })] })
  })
})

describe('original owner stroke directions', () => {
  const edge = (id: string, bundle?: string): TerminalOwner => ({ id, kind: 'edge', ...(bundle ? { bundle } : {}) })
  const crossing = (a = 10, b = 5) => {
    const document = new TerminalDocument()
    document.stroke(1, 1, a, { owner: edge('A') })
    document.stroke(1, 1, b, { owner: edge('B') })
    return document
  }
  test.each([
    [12, 5],
    [12, 3],
  ])('unbundled masks %i and %i cannot borrow straight crossing directions', (a, b) => {
    const document = crossing(a, b)
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: expect.arrayContaining([expect.objectContaining({ code: 'TERMINAL_ROUTE_OVERLAP' })]) })
  })
  test.each([
    [10, 'passed'],
    [5, 'failed'],
  ] as const)('same-owner repaint %i retains its accumulated directions', (mask, status) => {
    const document = crossing()
    document.stroke(1, 1, mask, { owner: edge('A') })
    expect(inspect(document).status).toBe(status)
  })
  test('explicit bundles permit three owners without assigning their union to each', () => {
    const document = new TerminalDocument()
    document.stroke(1, 1, 10, { owners: [edge('A', 'bundle'), edge('B', 'bundle')] })
    document.stroke(1, 1, 5, { owner: edge('C') })
    expect(inspect(document).status).toBe('passed')
  })
  test.each([false, true])('a growing shared trunk retains each crossing direction (crossing first=%s)', crossingFirst => {
    const source = new TerminalDocument()
    // Reverse registration exercises canonical owner order as the trunk grows.
    for (let route = 95; route >= 0; route--) for (let x = 0; x < 8; x++) source.stroke(x, 1, 10, { owner: edge(`route-${route}`, 'trunk') })
    const document = new TerminalDocument()
    if (crossingFirst) document.stroke(3, 1, 5, { owner: edge('crossing') })
    document.overlay(source)
    expect(inspect(document).status).toBe('passed')
    expect(document.cell(3, 1)!.owners).toHaveLength(crossingFirst ? 97 : 96)
    if (!crossingFirst) document.stroke(3, 1, 5, { owner: edge('crossing') })
    document.overlay(source)
    expect(inspect(document).status).toBe('passed')
    document.stroke(3, 1, 8, { owner: edge('crossing') })
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: expect.arrayContaining([expect.objectContaining({ code: 'TERMINAL_ROUTE_OVERLAP' })]) })
  })
  test('the release tree-300 workload remains admitted with bounded terminal evidence', () => {
    const rendered = renderMermaidASCIIWithReceipt(flowchartTree(300), { colorMode: 'none' })
    const labels = new Set([...rendered.text.matchAll(/\bNode (\d+)\b/g)].map(match => Number(match[1])))
    expect([...labels].sort((a, b) => a - b)).toEqual(Array.from({ length: 300 }, (_, index) => index))
    const certificate = rendered.receipt.layoutCertification!
    if (certificate.scope !== 'terminal-cells') throw new Error('Expected native terminal cell evidence')
    expect(certificate.status).not.toBe('failed')
    expect(certificate.budget).toMatchObject({ maxOperations: 1_000_000, maxOutputCodeUnits: 2_000_000 })
    if (certificate.status === 'unverified') {
      expect(certificate.budget.exhausted).toBe(true)
      expect(certificate.issues.map(issue => issue.code)).toEqual(['TERMINAL_CERTIFICATION_LIMIT'])
    }
  }, 120_000)
  test.each([false, true])('overlay and copied cell imports retain original directions (put=%s)', usePut => {
    const source = crossing(),
      document = new TerminalDocument()
    if (usePut) document.put(1, 1, source.cell(1, 1)!.glyph, { ...source.cell(1, 1)! })
    else document.overlay(source)
    document.stroke(1, 1, 10, { owner: edge('A') })
    expect(inspect(document).status).toBe('passed')
    document.stroke(1, 1, 5, { owner: edge('A') })
    expect(inspect(document).status).toBe('failed')
  })
  test('serialized cell snapshots cannot recreate a split from the aggregate mask', () => {
    const source = crossing(),
      document = new TerminalDocument()
    const cell = structuredClone(source.cell(1, 1)!)
    document.put(1, 1, cell.glyph, cell)
    expect(inspect(document).status).toBe('failed')
  })
  test.each([
    [true, false],
    [false, true],
    [true, true],
  ])('reflection preserves each owner mask (x=%s,y=%s)', (horizontal, vertical) => {
    const document = crossing(12, 3)
    document.flip(horizontal, vertical)
    expect(inspect(document).status).toBe('failed')
  })
  test('attribution claims unowned strokes but cannot invent an edge split for a prior crossing', () => {
    const document = new TerminalDocument()
    document.put(1, 1, '─')
    document.attribute(edge('A'))
    expect(inspect(document).status).toBe('passed')
    document.stroke(1, 1, 5, { owner: edge('B') })
    document.attribute({ id: 'part', kind: 'compartment' })
    expect(inspect(document).status).toBe('passed')
    expect(() => document.attribute(edge('invented'))).toThrow('ambiguous merged stroke')
  })
  test.each(['node', 'edge'] as const)('scope explicitly attributes previously unowned merged primitives (%s)', kind => {
    const source = new TerminalDocument()
    source.stroke(1, 1, 10)
    source.stroke(1, 1, 5)
    const document = new TerminalDocument()
    document.scope({ id: 'scoped', kind }, () => document.overlay(source))
    expect(inspect(document).status).toBe('passed')
    expect(document.cell(1, 1)!.owners.map((owner: TerminalOwner) => owner.id)).toEqual(['scoped'])
  })
  test('opaque numeric marks retire the original stroke proof', () => {
    const document = crossing(12, 3)
    document.numericMark(1, 1, { axis: 'vertical', coverage: 3 }, { owner: owner('mark') })
    expect(inspect(document).status).toBe('passed')
  })
  test.each(['mask', 'owners', 'nondirectional'] as const)('exposed %s mutation cannot acquire original directions', mutation => {
    const document = new TerminalDocument()
    document.stroke(1, 1, 10, { owner: edge('A') })
    const cell = document.cell(1, 1)!
    if (mutation === 'mask') {
      cell.stroke = { mask: 5 }
      cell.glyph = '│'
    } else if (mutation === 'nondirectional') {
      delete cell.stroke
      cell.glyph = '█'
    } else cell.owners = document.owners([edge('B')])
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: expect.arrayContaining([expect.objectContaining({ code: 'TERMINAL_STROKE_PROVENANCE_CHANGED' })]) })
  })
  const fragments = () => {
    const document = new TerminalDocument(),
      route = { ...edge('A'), from: 'S', to: 'T', route: 'connected' as const }
    for (const [id, x, y] of [
      ['S', 3, 0],
      ['T', 4, 3],
    ] as const) {
      document.region(owner(id), { x, y, width: 1, height: 1 })
      document.stroke(x, y, 10, { owner: owner(id) })
    }
    document.port(route, { nodeId: 'S', end: 'start', side: 'B', x: 3, y: 1, markers: [] })
    document.port(route, { nodeId: 'T', end: 'end', side: 'T', x: 4, y: 2, markers: [] })
    for (const x of [3, 4]) for (const y of [1, 2]) document.stroke(x, y, 5, { owner: route })
    for (const x of [3, 4]) document.stroke(x, 1, 10, { owner: edge('B') })
    return { document, route }
  }
  test('BFS cannot join adjacent vertical fragments using another owner horizontal shaft', () => {
    const { document } = fragments()
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: expect.arrayContaining([expect.objectContaining({ code: 'TERMINAL_ROUTE_DISCONNECTED', elementId: 'A' })]) })
  })
  test('a replayed canonical path witness still checks each original owner direction', () => {
    const { document, route } = fragments(),
      source = new TerminalDocument(5, 4)
    const path = allocateTerminalRoute('A', { nodeId: 'S', end: 'start', side: 'B', x: 3, y: 1, markers: [] }, { nodeId: 'T', end: 'end', side: 'T', x: 4, y: 2, markers: [] }, [
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ])
    expect(paintTerminalRoute(source, path, route, false)).toBe(true)
    const witness = [...source.layoutEvidence().pathWitnesses!][0]!
    expect(witness).toBeTruthy()
    document.registerTerminalPathWitness(route, witness.token)
    expect(inspect(document)).toMatchObject({ status: 'failed', issues: expect.arrayContaining([expect.objectContaining({ code: 'TERMINAL_ROUTE_DISCONNECTED', elementId: 'A' })]) })
  })
})
