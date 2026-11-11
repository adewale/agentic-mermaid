import { expect, test } from 'bun:test'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

const forests = {
  usecase: 'usecase-beta\ndirection LR\nA("Root")\nB("Approve")\nC("Review")\nD("Archive")\nA --> B\nA --> C\nC --> D',
  agentflow: 'agentflow-beta LR\nA[Root] --> B[Approve]\nA --> C[Review]\nC --> D[Archive]',
}
for (const [family, input] of Object.entries(forests)) {
  test.each(['LR', 'RL', 'TB', 'BT'])(`${family} eligible forest keeps readable typed contacts in %s using the certified native producer`, direction => {
    const source = input.replace('LR', direction), stages: string[] = []
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, { style: 'github-dark' }))
    expect(stages).toContain('agentic'); expect(stages).not.toContain('elk')
    expect(rendered.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'agentic', fallback: 'elk' }))
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const { layout } = layoutMermaidWithReceipt(source, { style: 'github-dark' })
    expect(layout.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B'], ['A', 'C'], ['C', 'D']])
    expect(countPolylineCrossings(layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })) })))).toBe(0)
    for (const edge of layout.edges) {
      const from = layout.nodes.find(node => node.id === edge.from)!, to = layout.nodes.find(node => node.id === edge.to)!
      expect(direction === 'LR' ? to.x > from.x : direction === 'RL' ? to.x < from.x : direction === 'TB' ? to.y > from.y : to.y < from.y).toBe(true)
      for (const [node, point] of [[from, edge.path[0]!], [to, edge.path.at(-1)!]] as const) {
        const [x, y] = point
        if (family === 'usecase') expect(((x - node.x - node.w / 2) / (node.w / 2)) ** 2 + ((y - node.y - node.h / 2) / (node.h / 2)) ** 2).toBeCloseTo(1, 5)
        else expect(Math.min(Math.abs(x - node.x), Math.abs(x - node.x - node.w), Math.abs(y - node.y), Math.abs(y - node.y - node.h))).toBeLessThan(0.02)
      }
      for (let i = 1; i < edge.path.length; i++) for (const node of layout.nodes) if (node.id !== edge.from && node.id !== edge.to) {
        const [ax, ay] = edge.path[i - 1]!, [bx, by] = edge.path[i]!
        const enters = ax === bx ? ax > node.x && ax < node.x + node.w && Math.max(ay, by) > node.y && Math.min(ay, by) < node.y + node.h : ay > node.y && ay < node.y + node.h && Math.max(ax, bx) > node.x && Math.min(ax, bx) < node.x + node.w
        expect(enters).toBe(false)
      }
    }
    for (const text of ['Root', 'Approve', 'Review', 'Archive']) expect(rendered.svg).toContain(text)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('Expected native fixture')
    expect(renderMermaidSVGWithReceipt(parsed.value, { style: 'github-dark' }).svg).toBe(rendered.svg)
    const explicitStages: string[] = []
    withRenderStageObserver(sample => explicitStages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }))
    expect(explicitStages).toContain('elk'); expect(explicitStages).not.toContain('agentic')
  })
}

test.each([
  'usecase-beta', 'agentflow-beta TB',
])('empty native dialect scaffold renders without ELK: %s', source => {
  const stages: string[] = [], result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source))
  expect(result.svg).toContain('<svg'); expect(stages).not.toContain('elk')
})

test.each([
  'agentflow-beta TB\nflow team[Team]\nA --> B\nend',
  'agentflow-beta TB\nA --> B\nB --> A',
  'agentflow-beta TB\nA --> B\nA --> B',
  'usecase-beta\nsystemBoundary S[System]\nA("Inside")\nend',
  'usecase-beta\nA("One")\nB("Two")\nA --> B\nB --> A',
])('compound and cyclic native dialects retain ELK until separately qualified: %s', source => {
  const stages: string[] = []
  withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source))
  expect(stages).toContain('elk'); expect(stages).not.toContain('agentic')
})
