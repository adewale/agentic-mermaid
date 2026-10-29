import { describe, expect, spyOn, test } from 'bun:test'
import { parseC4Diagram } from '../c4/parser.ts'
import { layoutC4Diagram } from '../c4/layout.ts'
import { renderC4Terminal } from '../ascii/c4.ts'
import * as pixelText from '../shared/prepared-text.ts'
import * as cellText from '../ascii/prepared-text.ts'
import type { C4Body } from '../c4/types.ts'
import { assertC4DiagramWork } from '../shared/diagram-limits.ts'

const SOURCE = 'C4Deployment\nNode(parent,"Production","Linux") {\nContainer(api,"API","Go")\n}\nRel(api,parent,"Reports")'

function body(): C4Body { return parseC4Diagram(SOURCE) }

describe('C4 authored work admission', () => {
  test('the exact aggregate and nesting limits admit leaf work without counting a leaf as another boundary', () => {
    const aggregate = body()
    aggregate.elements = Array.from({ length: 4999 }, (_, index) => ({ ...aggregate.elements[0]!, id: `node${index}` }))
    Object.assign(aggregate.relationships[0]!, { from: 'node0', source: 'node0' })
    aggregate.layout.hints = Array.from({ length: 4999 }, (_, index) => ({ from: 'node0', to: 'parent', direction: 'LR', statementId: `hint${index}` }))
    expect(() => assertC4DiagramWork(aggregate)).not.toThrow()
    aggregate.layout.hints.push({ from: 'node0', to: 'parent', direction: 'LR', statementId: 'extra-hint' })
    expect(() => assertC4DiagramWork(aggregate)).toThrow(/DIAGRAM_WORK_LIMIT.*edges 5001/)
    aggregate.layout.hints.pop()
    aggregate.elements.push({ ...aggregate.elements[0]!, id: 'one-too-many' })
    expect(() => assertC4DiagramWork(aggregate)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes 5001/)
    const nested = body()
    nested.boundaries = Array.from({ length: 64 }, (_, index) => ({ ...nested.boundaries[0]!, id: `group${index}`, ...(index ? { parentId: `group${index - 1}` } : {}) }))
    nested.elements[0]!.parentId = 'group63'
    expect(() => assertC4DiagramWork(nested)).not.toThrow()
    nested.boundaries.push({ ...nested.boundaries[0]!, id: 'group64', parentId: 'group63' })
    expect(() => assertC4DiagramWork(nested)).toThrow(/DIAGRAM_WORK_LIMIT.*nesting 65/)
  })

  test('pixel and cell layout refuse aggregate objects, relationships, hints and depth before text preparation', () => {
    const aggregate = body()
    aggregate.elements = Array.from({ length: 5000 }, (_, index) => ({ ...aggregate.elements[0]!, id: `node${index}` }))
    const relationships = body()
    relationships.relationships = Array.from({ length: 5001 }, (_, index) => ({ ...relationships.relationships[0]!, id: `rel${index}` }))
    const hints = body()
    hints.relationships = []
    hints.layout.hints = Array.from({ length: 5001 }, (_, index) => ({ from: 'api', to: 'parent', direction: 'LR', statementId: `hint${index}` }))
    const deep = body()
    deep.boundaries = Array.from({ length: 65 }, (_, index) => ({ ...deep.boundaries[0]!, id: `group${index}`, ...(index ? { parentId: `group${index - 1}` } : {}) }))
    deep.elements[0]!.parentId = 'group64'
    deep.relationships = []
    const pixel = spyOn(pixelText, 'preparePixelText').mockImplementation(() => { throw new Error('pixel sizing before work admission') })
    const cell = spyOn(cellText, 'prepareCellText').mockImplementation(() => { throw new Error('cell sizing before work admission') })
    try {
      for (const [model, resource] of [[aggregate, 'nodes'], [relationships, 'edges'], [hints, 'edges'], [deep, 'nesting']] as const) {
        expect(() => layoutC4Diagram(model)).toThrow(new RegExp(`DIAGRAM_WORK_LIMIT.*${resource}`))
        expect(() => renderC4Terminal(model, { useAscii: true } as never)).toThrow(new RegExp(`DIAGRAM_WORK_LIMIT.*${resource}`))
      }
      expect(pixel).not.toHaveBeenCalled()
      expect(cell).not.toHaveBeenCalled()
    } finally {
      pixel.mockRestore()
      cell.mockRestore()
    }
  })

  test('cyclic ownership fails before either independent adapter sizes text', () => {
    const cyclic = body()
    cyclic.boundaries.push({ ...cyclic.boundaries[0]!, id: 'child', parentId: 'parent' })
    cyclic.boundaries[0]!.parentId = 'child'
    const pixel = spyOn(pixelText, 'preparePixelText').mockImplementation(() => { throw new Error('pixel sizing before hierarchy admission') })
    const cell = spyOn(cellText, 'prepareCellText').mockImplementation(() => { throw new Error('cell sizing before hierarchy admission') })
    try {
      expect(() => layoutC4Diagram(cyclic)).toThrow(/acyclic/)
      expect(() => renderC4Terminal(cyclic, { useAscii: true } as never)).toThrow(/acyclic/)
      expect(pixel).not.toHaveBeenCalled()
      expect(cell).not.toHaveBeenCalled()
    } finally {
      pixel.mockRestore()
      cell.mockRestore()
    }
  })
})
