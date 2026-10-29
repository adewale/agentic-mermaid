import { normalizeMermaidSource } from '../mermaid-source.ts'
import { describe, expect, spyOn, test } from 'bun:test'
import type { ElkNode } from 'elkjs'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import * as elkAdapter from '../elk-instance.ts'
import * as terminalGrid from '../ascii/grid.ts'
import * as terminalConverter from '../ascii/converter.ts'
import * as preparedText from '../shared/prepared-text.ts'
import * as cellText from '../ascii/prepared-text.ts'
import { assertLayoutGraphWork, assertMermaidGraphWork, DIAGRAM_WORK_LIMITS, DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseArchitectureDiagram, architectureToMermaidGraph } from '../architecture/parser.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { layoutBlockDiagram } from '../block/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import { layoutTreemapDiagram } from '../treemap/layout.ts'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import { layoutIshikawaDiagram } from '../ishikawa/layout.ts'

function cartesian(sources: number, targets: number): string {
  const from = Array.from({ length: sources }, (_, i) => `a${i}`).join(' & ')
  const to = Array.from({ length: targets }, (_, i) => `b${i}`).join(' & ')
  return `flowchart TD\n${from} --> ${to}`
}

describe('graph work admission', () => {
  test('rejects Cartesian expansion before allocating an oversized edge set', () => {
    expect(() => { parseMermaid(cartesian(100, 100)) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
  })

  test('admits exactly 5000 expanded edges and counts cumulative statements', () => {
    const source = cartesian(100, 50)
    expect(parseMermaid(source).edges).toHaveLength(5000)
    expect(() => { parseMermaid(`${source}\na0 --> b0`) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
  })

  test('rejects excessive declarations while reading the source', () => {
    const source = `flowchart TD\n${Array.from({ length: 5001 }, (_, i) => `n${i}`).join('\n')}`
    expect(() => { parseMermaid(source) }).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
  })

  test('rejects excessive graph nesting before recursive projection', () => {
    const source = `flowchart TD\n${Array.from({ length: 65 }, (_, i) => `subgraph g${i}`).join('\n')}\nA\n${'end\n'.repeat(65)}`
    expect(() => { parseMermaid(source) }).toThrow(/DIAGRAM_WORK_LIMIT.*nesting/)
  })

  test('bounds state transitions and generated concurrency containers', () => {
    const transitions = `stateDiagram-v2\n${'A --> B\n'.repeat(5001)}`
    expect(() => { parseMermaid(transitions) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
    const regions = `stateDiagram-v2\nstate C {\nA\n${'--\n'.repeat(5000)}}`
    expect(() => { parseMermaid(regions) }).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
    // Forward references can establish deep ownership even when each block
    // is written at root level. Admit the resolved tree before projection.
    const chain = (count: number) => `stateDiagram-v2\n${Array.from({ length: count }, (_, i) => `state C${i} { C${i + 1} }`).join('\n')}`
    expect(() => parseMermaid(chain(64))).not.toThrow()
    expect(() => parseMermaid(chain(65))).toThrow(/DIAGRAM_WORK_LIMIT.*nesting 65/)
  })

  test('source configuration cannot raise the work budget for SVG or terminal output', () => {
    const source = `---\nconfig:\n  maxEdges: 20000\n---\n${cartesian(100, 100)}`
    // Keep a missing admission check from performing the oversized layout in
    // the regression probe, including when CI runs it against base production.
    const elk = spyOn(elkAdapter, 'elkLayoutSync').mockImplementation(() => { throw new Error('ELK started before work admission') })
    const grid = spyOn(terminalGrid, 'createMapping').mockImplementation(() => { throw new Error('terminal layout started before work admission') })
    try {
      for (const render of [renderMermaidSVG, renderMermaidASCII]) {
        expect(() => render(source)).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
      }
      expect(elk).not.toHaveBeenCalled()
      expect(grid).not.toHaveBeenCalled()
    } finally {
      elk.mockRestore()
      grid.mockRestore()
    }
  })

  test('a source too long for the render request receipt is a work limit, not malformed request data', () => {
    // The receipt digests the authored and the normalized source together, so
    // a long leading comment alone can exceed its budget.
    const source = `%% ${'x'.repeat(DIAGRAM_WORK_LIMITS.sourceCharacters)}\nflowchart LR\n  A --> B`
    expect(() => renderMermaidSVG(source)).toThrow(DiagramWorkLimitError)
    expect(() => renderMermaidSVG(source)).toThrow(/DIAGRAM_WORK_LIMIT: authored plus normalized source/)
    // It also digests the parsed configuration, so a source that fits the
    // character check alone can still exceed it: the same work limit.
    const configured = `---\ntitle: T\nconfig:\n  themeVariables:\n    primaryColor: "#ffffff"\n---\nflowchart LR\n  A["${'y'.repeat(998_000)}"] --> B`
    expect(configured.length + normalizeMermaidSource(configured).text.length).toBeLessThanOrEqual(DIAGRAM_WORK_LIMITS.sourceCharacters)
    expect(() => renderMermaidSVG(configured)).toThrow(DiagramWorkLimitError)
    expect(() => renderMermaidSVG(configured)).toThrow(/, with its configuration, exceeds/)
  })

  test('metadata YAML expansion shares the source budget and retains its resource error', () => {
    const alphabet = Array.from({ length: 0x1900 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
    const value = alphabet.repeat(20) + '#x;'.repeat(40_000)
    for (const source of [`flowchart LR\n A@{ marker: "${value}" }`, `kanban\nTodo\n card[Work]@{ marker: "${value}" }`, `sequenceDiagram\n participant A@{ alias: "${value}" }`]) {
      expect(source.length + normalizeMermaidSource(source).text.length).toBeLessThan(DIAGRAM_WORK_LIMITS.sourceCharacters)
      expect(() => renderMermaidSVG(source)).toThrow(DiagramWorkLimitError)
      const verified = verifyMermaid(source)
      expect(verified.ok).toBe(false)
      expect(verified.checks?.renderability).toBe('failed')
      expect(verified.warnings).toContainEqual({ code: 'RENDER_FAILED', origin: 'source', reason: expect.stringContaining('DIAGRAM_WORK_LIMIT') })
    }
  })

  test('programmatic graphs are bounded before graph conversion', () => {
    const graph = parseMermaid('flowchart TD\nA --> B')
    graph.edges = Array.from({ length: 5001 }, () => ({ ...graph.edges[0]! }))
    const elk = spyOn(elkAdapter, 'elkLayoutSync').mockImplementation(() => { throw new Error('ELK started before work admission') })
    try {
      expect(() => layoutGraphSync(graph)).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
      expect(elk).not.toHaveBeenCalled()
    } finally { elk.mockRestore() }
  })

  test('counts existing containers when later source statements add nodes', () => {
    for (const [header, group] of [['flowchart TD', 'subgraph G\nend'], ['stateDiagram-v2', 'state G {\n}']]) {
      const source = `${header}\n${group}\n${Array.from({ length: 5000 }, (_, i) => `n${i}`).join('\n')}`
      expect(() => parseMermaid(source)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes 5001/)
    }
  })

  test('admits exactly 5000 combined objects and replaces a referenced State with one container', () => {
    const nodes = Array.from({ length: 4999 }, (_, i) => `n${i}`).join('\n')
    const flow = parseMermaid(`flowchart TD\nsubgraph G\nend\n${nodes}`)
    expect(flow.nodes.size + flow.subgraphs.length).toBe(5000)
    const state = parseMermaid(`stateDiagram-v2\nS\n${nodes}\nstate S {\n}`)
    expect(state.nodes.size + state.subgraphs.length).toBe(5000)
    expect(state.nodes.has('S')).toBe(false)
    expect(state.subgraphs[0]?.id).toBe('S')
  })

  test('terminal conversion admits programmatic aggregate counts before allocating output', () => {
    const graph = parseMermaid('flowchart TD\nA')
    graph.subgraphs = Array.from({ length: 5000 }, (_, i) => ({ id: `g${i}`, label: `g${i}`, nodeIds: [], children: [] }))
    expect(() => terminalConverter.convertToAsciiGraph(graph, {} as never)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes 5001/)
  })

  test('Class, ER and Architecture authored work is refused before measurement in public and programmatic paths', () => {
    const cases = [
      `architecture-beta\n${Array.from({ length: 5001 }, (_, i) => `service S${i}[Service]`).join('\n')}`,
      `classDiagram\n${Array.from({ length: 5001 }, (_, i) => `class C${i}`).join('\n')}`,
      `erDiagram\n${Array.from({ length: 5001 }, (_, i) => `subgraph G${i}\nend`).join('\n')}`,
      `erDiagram\n${Array.from({ length: 65 }, (_, i) => `subgraph G${i}`).join('\n')}\n${'end\n'.repeat(65)}`,
      `classDiagram\n${Array.from({ length: 65 }, (_, i) => `namespace N${i} {`).join('\n')}\nclass C\n${'}\n'.repeat(65)}`,
    ]
    const measurement = spyOn(preparedText, 'preparePixelText').mockImplementation(() => { throw new Error('measurement before admission') })
    try {
      for (const source of cases) {
        for (const render of [renderMermaidSVG, renderMermaidASCII]) expect(() => render(source)).toThrow(/DIAGRAM_WORK_LIMIT/)
      }
      const classes = parseClassDiagram(['classDiagram', 'class C'])
      classes.classes = Array.from({ length: 5001 }, (_, i) => ({ ...classes.classes[0]!, id: `C${i}` }))
      expect(() => layoutClassDiagram(classes)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
      const er = parseErDiagram(['erDiagram', 'A'])
      er.groups = Array.from({ length: 5000 }, (_, i) => ({ id: `G${i}`, label: `G${i}`, entityIds: [] }))
      expect(() => layoutErDiagram(er)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
      const architecture = parseArchitectureDiagram(['architecture-beta', 'service S[Service]'])
      architecture.services = Array.from({ length: 5001 }, (_, i) => ({ id: `S${i}`, label: 'Service' }))
      expect(() => architectureToMermaidGraph(architecture)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
      expect(measurement).not.toHaveBeenCalled()
    } finally { measurement.mockRestore() }
  })

  test('graph and ELK admission count exactly 64 containers without counting the leaf as nesting', () => {
    const source = `flowchart TD\n${Array.from({ length: 64 }, (_, i) => `subgraph g${i}`).join('\n')}\nA\n${'end\n'.repeat(64)}`
    const graph = parseMermaid(source)
    expect(() => assertMermaidGraphWork(graph)).not.toThrow()
    const root: ElkNode = { id: 'root', children: [] }
    let parent = root
    for (let i = 0; i < 64; i++) {
      const group: ElkNode = { id: `g${i}`, children: [] }
      parent.children!.push(group)
      parent = group
    }
    parent.children!.push({ id: 'A' })
    expect(() => assertLayoutGraphWork(root)).not.toThrow()
    parent.children!.push({ id: 'too-deep', children: [] })
    expect(() => assertLayoutGraphWork(root)).toThrow(/DIAGRAM_WORK_LIMIT.*nesting 65/)
  })

  test('direct ELK adapters reject oversized input before selecting an algorithm', () => {
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'not-an-algorithm' },
      children: Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}`, width: 20, height: 20 })),
    }
    expect(() => elkLayoutSync(graph)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
  })

  test('native families refuse expanded nodes, relations and nesting before SVG or terminal measurement', () => {
    const cases = [
      `packet\n${'+1: "x"\n'.repeat(5001)}`,
      `packet\ntitle Guarded before measurement\n0-160000: "spanning"`,
      `kanban\n  todo[Todo]\n${Array.from({ length: 5000 }, (_, i) => `    t${i}[Task]`).join('\n')}`,
      `requirementDiagram\n${Array.from({ length: 5001 }, (_, i) => `requirement r${i} {\n}`).join('\n')}`,
      `requirementDiagram\nrequirement A {\n}\n${'A - traces -> A\n'.repeat(5001)}`,
      'block\nspace:5001',
      `block\nA B\n${'A --> B\n'.repeat(5001)}`,
      `block\n${'block\n'.repeat(65)}A\n${'end\n'.repeat(65)}`,
      `treemap\n${'"Leaf": 1\n'.repeat(5001)}`,
      `treemap\n${Array.from({ length: 65 }, (_, i) => `${' '.repeat(i)}"Group"`).join('\n')}`,
      `ishikawa\nEffect\n${'Cause\n'.repeat(5000)}`,
      `ishikawa\nEffect\n${Array.from({ length: 65 }, (_, i) => `${' '.repeat(i)}Cause`).join('\n')}`,
    ]
    const measurement = spyOn(preparedText, 'preparePixelText').mockImplementation(() => { throw new Error('measurement before admission') })
    const terminalMeasurement = spyOn(cellText, 'prepareCellText').mockImplementation(() => { throw new Error('terminal measurement before admission') })
    try {
      for (const source of cases) for (const render of [renderMermaidSVG, renderMermaidASCII]) expect(() => render(source)).toThrow(/DIAGRAM_WORK_LIMIT/)
      expect(measurement).not.toHaveBeenCalled()
      expect(terminalMeasurement).not.toHaveBeenCalled()
    } finally { measurement.mockRestore(); terminalMeasurement.mockRestore() }
  })

  test('native programmatic bodies are admitted before preparing text and count container depth without the leaf', () => {
    const block = parseBlockDiagram('block\nA'), requirement = parseRequirementDiagram('requirementDiagram\nrequirement A {\n}'),
      treemap = parseTreemapDiagram('treemap\n"A": 1'), ishikawa = parseIshikawaDiagram('ishikawa\nEffect')
    block.root.children = Array.from({ length: 5001 }, (_, i) => ({ id: `b${i}`, type: 'square' }))
    requirement.relations = Array.from({ length: 5001 }, (_, i) => ({ id: `r${i}`, src: 'A', dst: 'A', type: 'traces' }))
    treemap.nodes = Array.from({ length: 5001 }, (_, i) => ({ id: `t${i}`, label: 'Leaf', value: 1 }))
    ishikawa.nodes = Array.from({ length: 5001 }, (_, i) => ({ id: `i${i}`, label: 'Cause' }))
    const measurement = spyOn(preparedText, 'preparePixelText').mockImplementation(() => { throw new Error('measurement before admission') })
    try {
      for (const layout of [() => layoutBlockDiagram(block), () => layoutRequirementDiagram(requirement), () => layoutTreemapDiagram(treemap), () => layoutIshikawaDiagram(ishikawa)]) expect(layout).toThrow(/DIAGRAM_WORK_LIMIT/)
      expect(measurement).not.toHaveBeenCalled()
    } finally { measurement.mockRestore() }
    const nested = `block\n${'block\n'.repeat(64)}A\n${'end\n'.repeat(64)}`
    expect(() => parseBlockDiagram(nested)).not.toThrow()
    expect(parseTreemapDiagram(`treemap\n${Array.from({ length: 64 }, (_, i) => `${' '.repeat(i)}"Group"`).join('\n')}\n${' '.repeat(64)}"Leaf": 1`).nodes).toHaveLength(65)
    expect(parseIshikawaDiagram(`ishikawa\nEffect\n${Array.from({ length: 64 }, (_, i) => `${' '.repeat(i)}Cause`).join('\n')}`).nodes).toHaveLength(65)
  })
})
