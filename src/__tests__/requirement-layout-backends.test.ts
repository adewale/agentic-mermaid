import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import { segmentEntersLabelRect } from '../shared/edge-label-geometry.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { useTestChildren } from './helpers/test-child.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/requirement-backends.mmd', import.meta.url), 'utf8')
const source = (direction: string) => fixture.replace('direction TB', `direction ${direction}`)
const runChild = useTestChildren(20_000)

describe('Requirement layout backends', () => {
  test.each((['agentic', 'elk'] as const).flatMap(backend => (['scene', 'native'] as const).map(admission => ({ backend, admission }))))('retains parallel requirement occurrences and authored names with $backend through $admission', async ({ backend, admission }) => {
    // Authored relation-1 is a card name, independently of generated edge IDs;
    // the two satisfies declarations must retain separate caption owners.
    const interaction = {
      source: 'requirementDiagram\ndirection LR\nrequirement "relation-1" {\n  id: "R-1"\n  text: "Authorize release"\n  risk: medium\n  verifymethod: test\n}\nfunctionalRequirement gate {\n  id: "F-2"\n  text: "Reject stale token"\n  risk: high\n  verifymethod: analysis\n}\nelement worker {\n  type: software\n  docRef: "Spec R-1"\n}\nworker - satisfies -> "relation-1"\nworker - satisfies -> "relation-1"\n"relation-1" - derives -> gate\ngate - traces -> "relation-1"',
      direction: 'LR',
      requirements: [
        { name: 'relation-1', kind: 'requirement', requirementId: 'R-1', text: 'Authorize release', risk: 'medium', verifyMethod: 'test' },
        { name: 'gate', kind: 'functionalRequirement', requirementId: 'F-2', text: 'Reject stale token', risk: 'high', verifyMethod: 'analysis' },
      ],
      elements: [
        { name: 'worker', type: 'software', docRef: 'Spec R-1' },
      ],
      relations: [
        { from: 'worker', to: 'relation-1', kind: 'satisfies', displayLabel: '<<satisfies>>' },
        { from: 'worker', to: 'relation-1', kind: 'satisfies', displayLabel: '<<satisfies>>' },
        { from: 'relation-1', to: 'gate', kind: 'derives', displayLabel: '<<derives>>' },
        { from: 'gate', to: 'relation-1', kind: 'traces', displayLabel: '<<traces>>' },
      ],
    } as const

    const options = { graphLayout: { backend, fallback: 'none' as const }, embedFontImport: false }
    let packet: { rendered: ReturnType<typeof renderMermaidSVGWithReceipt>; parsed: ReturnType<typeof parseRegisteredMermaid>; stages: string[] }
    if (admission === 'native') {
      const child = await runChild(process.execPath, ['-e', `
        import { renderMermaidSVGWithReceipt, parseRegisteredMermaid } from './src/index.ts'
        import { withRenderStageObserver } from './src/render-stages.ts'
        const input = await Bun.stdin.text(), options = ${JSON.stringify(options)}, stages = []
        const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options))
        console.log(JSON.stringify({ rendered, parsed: parseRegisteredMermaid(input), stages }))
      `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' }, input: interaction.source })
      expect(child.status, child.stderr).toBe(0)
      packet = JSON.parse(child.stdout)
      expect(packet.stages).toContain('drawing')
      expect(packet.stages).not.toContain('scene')
    } else {
      const stages: string[] = []
      const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(interaction.source, options))
      packet = { rendered, parsed: parseRegisteredMermaid(interaction.source), stages }
      expect(stages).toContain('scene')
    }
    expect(packet.rendered.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
    if (!packet.parsed.ok) throw new Error('The independently authored interaction must parse')
    const body = packet.parsed.value.body

    if (body.kind !== 'requirement') throw new Error('Expected public structured Requirement')
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')
    expect(body.direction).toBe(interaction.direction)
    expect(body.requirements.map(requirement => ({ name: requirement.name, kind: normalized(requirement.type), requirementId: requirement.requirementId, text: requirement.text,
      risk: requirement.risk.toLowerCase(), verifyMethod: requirement.verifyMethod.toLowerCase() }))).toEqual(interaction.requirements.map(requirement => ({ ...requirement, kind: normalized(requirement.kind) })))
    expect(body.elements.map(element => ({ name: element.name, type: element.type, docRef: element.docRef }))).toEqual([...interaction.elements])
    expect(body.relations.map(relation => ({ from: relation.src, to: relation.dst, kind: relation.type, displayLabel: `<<${relation.type}>>` }))).toEqual([...interaction.relations])
    expect(new Set(body.relations.map(relation => relation.id)).size).toBe(4)
    const { JSDOM } = createRequire(import.meta.url)('jsdom')
    const dom = new JSDOM(packet.rendered.svg, { contentType: 'image/svg+xml' })
    try {
      const document = dom.window.document as Document
      const cards = [...document.querySelectorAll('g.requirement-node')]
      expect(cards.map(card => card.getAttribute('data-id')).sort()).toEqual(['gate', 'relation-1', 'worker'])
      const expectedCards = [
        { name: 'relation-1', kind: 'requirement', rows: ['ID: R-1', 'Text: Authorize release', 'Risk: Medium', 'Verification: Test'] },
        { name: 'gate', kind: 'functionalRequirement', rows: ['ID: F-2', 'Text: Reject stale token', 'Risk: High', 'Verification: Analysis'] },
        { name: 'worker', kind: 'element', rows: ['Type: software', 'Doc Ref: Spec R-1'] },
      ]
      for (const expected of expectedCards) {
        const card = cards.find(card => card.getAttribute('data-id') === expected.name)!
        const frame = card.querySelector('rect')!
        expect(Number(frame.getAttribute('width'))).toBeGreaterThan(0)
        expect(Number(frame.getAttribute('height'))).toBeGreaterThan(0)
        const ownedText = [...card.querySelectorAll('text')].map(text => text.textContent ?? '')
        expect(ownedText[0]!.endsWith(expected.name)).toBe(true)
        expect(normalized(ownedText[0]!)).toStartWith(normalized(expected.kind))
        expect(ownedText.slice(1)).toEqual(expected.rows)
      }
      const carriers = [...document.querySelectorAll('[data-role="relationship"][data-from]')]
      expect(carriers.map(carrier => ({ from: carrier.getAttribute('data-from'), to: carrier.getAttribute('data-to'), kind: carrier.getAttribute('data-relationship') })))
        .toEqual(interaction.relations.map(({ displayLabel: _label, ...relation }) => relation))
      expect(new Set(carriers.map(carrier => carrier.getAttribute('data-id'))).size).toBe(4)
      expect(carriers.map(carrier => carrier.getAttribute('data-id'))).toEqual(body.relations.map(relation => relation.id))
      for (const carrier of carriers) {
        expect(carrier.getAttribute('stroke-dasharray')).toBe('6 4')
        expect(carrier.getAttribute('marker-end')).toBe('url(#requirement-arrow)')
        expect(carrier.hasAttribute('marker-start')).toBe(false)
        const route = carrier.getAttribute('points') ?? carrier.getAttribute('d')!
        expect(route).not.toMatch(/NaN|Infinity|undefined/)
        const coordinates = route.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)!.map(Number)
        expect(coordinates.every(Number.isFinite)).toBe(true)
        expect(coordinates.length).toBeGreaterThanOrEqual(4)
      }
      const labelGroups = [...document.querySelectorAll('g.requirement-edge-label')]
      const labels = labelGroups.map(group => group.querySelector('text')!)
      expect(labels.map(label => label.textContent)).toEqual(interaction.relations.map(relation => relation.displayLabel))
      expect(labelGroups).toHaveLength(4)
      // A caption references the relationship, even when a card shares its ID.
      expect(labelGroups.map(group => group.getAttribute('data-edge-id')).sort()).toEqual(carriers.map(carrier => carrier.getAttribute('data-id')).sort())
      const captionRelations = carriers.map(carrier => {
        const captions = labelGroups.filter(group => group.getAttribute('data-edge-id') === carrier.getAttribute('data-id'))
        expect(captions).toHaveLength(1)
        const caption = captions[0]!
        return { from: carrier.getAttribute('data-from'), to: carrier.getAttribute('data-to'), kind: carrier.getAttribute('data-relationship'), displayLabel: caption.querySelector('text')!.textContent }
      })
      expect(captionRelations).toEqual([...interaction.relations])
      for (const group of labelGroups) expect(group.querySelectorAll(':scope > text')).toHaveLength(1)
      expect(labels[0]!.getAttribute('x') + ',' + labels[0]!.getAttribute('y')).not.toBe(labels[1]!.getAttribute('x') + ',' + labels[1]!.getAttribute('y'))
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
      expect(new Set(ids).size).toBe(ids.length)
      // Logical correspondence and separate owned labels are narrower than
      // actual glyph/head ink or a complete occlusion proof.
    } finally { dom.window.close() }
  })

  test.each((['agentic', 'elk'] as const).flatMap(backend => (['scene', 'native'] as const).map(admission => ({ backend, admission }))))('retains all authored cards and traces in a 100-requirement chain with $backend through $admission admission', async ({ backend, admission }) => {
    const requirements = Array.from({ length: 100 }, (_, index) => ({ name: `r${index}`, id: `R${index}`, text: `Requirement ${index}` }))
    const relations = Array.from({ length: 99 }, (_, index) => [`r${index}`, `r${index + 1}`, 'traces'])
    const input = ['requirementDiagram', ...requirements.flatMap((node, index) => [
      `  requirement ${node.name} {`, `    id: ${node.id}`, `    text: "${node.text}"`, '    risk: medium', '    verifymethod: test', '  }',
      ...(index ? [`  r${index - 1} - traces -> ${node.name}`] : []),
    ])].join('\n')
    const options = { graphLayout: { backend, fallback: 'none' as const } }
    let rendered!: ReturnType<typeof renderMermaidSVGWithReceipt>
    let layout!: ReturnType<typeof layoutMermaidWithReceipt>['layout']
    let stages: string[] = []
    if (admission === 'native') {
      // The unit preload enables Scene assertions at module import. A fresh
      // production realm must exercise the ordinary native drawing boundary.
      const child = await runChild(process.execPath, ['-e', `
        import { renderMermaidSVGWithReceipt } from './src/index.ts'
        import { layoutMermaidWithReceipt } from './src/agent/core.ts'
        import { withRenderStageObserver } from './src/render-stages.ts'
        const input = await Bun.stdin.text(), options = ${JSON.stringify(options)}, stages = []
        const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options))
        console.log(JSON.stringify({ rendered, layout: layoutMermaidWithReceipt(input, options).layout, stages }))
      `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' }, input })
      expect(child.status, child.stderr).toBe(0)
      const packet = JSON.parse(child.stdout) as { rendered: typeof rendered; layout: typeof layout; stages: string[] }
      rendered = packet.rendered
      layout = packet.layout
      stages = packet.stages
      expect(stages).toContain('drawing')
      expect(stages).not.toContain('scene')
    } else {
      expect(() => { rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options)) }).not.toThrow()
      layout = layoutMermaidWithReceipt(input, options).layout
      expect(stages).toContain('scene')
    }
    expect(rendered.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
    if (admission === 'scene') expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(layout.nodes.map(node => node.id)).toEqual(requirements.map(node => node.name))
    expect(layout.edges.map(edge => [edge.from, edge.to, edge.label?.text])).toEqual(relations.map(([from, to]) => [from, to, '<<traces>>']))

    const { JSDOM } = createRequire(import.meta.url)('jsdom')
    const dom = new JSDOM(rendered.svg, { contentType: 'image/svg+xml' })
    try {
      const document = dom.window.document as Document
      const groups = [...document.querySelectorAll('g.requirement-node')]
      expect(groups.map(group => group.getAttribute('data-id'))).toEqual(requirements.map(node => node.name))
      for (const [index, node] of requirements.entries()) {
        const group = groups[index]!, frames = [...group.querySelectorAll('rect')]
        expect(frames).toHaveLength(1)
        expect(Number(frames[0]!.getAttribute('width'))).toBeGreaterThan(0)
        expect(Number(frames[0]!.getAttribute('height'))).toBeGreaterThan(0)
        expect([...group.querySelectorAll('text')].map(text => text.textContent)).toEqual([
          `<<Requirement>>${node.name}`, `ID: ${node.id}`, `Text: ${node.text}`, 'Risk: Medium', 'Verification: Test',
        ])
      }
      const carriers = [...document.querySelectorAll('[data-role="relationship"][data-from]')]
      expect(carriers.map(carrier => [carrier.getAttribute('data-from'), carrier.getAttribute('data-to'), carrier.getAttribute('data-relationship')])).toEqual(relations)
      expect(new Set(carriers.map(carrier => carrier.getAttribute('data-id'))).size).toBe(99)
      for (const carrier of carriers) {
        expect(carrier.getAttribute('stroke-dasharray')).toBe('6 4')
        expect(carrier.getAttribute('marker-end')).toBe('url(#requirement-arrow)')
        expect(carrier.hasAttribute('marker-start')).toBe(false)
      }
      expect(document.querySelectorAll('marker#requirement-arrow')).toHaveLength(1)
      expect([...document.querySelectorAll('g.requirement-edge-label text')].map(text => text.textContent?.trim())).toEqual(Array(99).fill('<<traces>>'))
    } finally { dom.window.close() }
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('retains measured cards, relationship labels and distinct routes natively in %s', direction => {
    const model = parseRequirementDiagram(source(direction)), original = structuredClone(model)
    const placed = layoutRequirementDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutRequirementDiagram(model, native)).toEqual(placed)
    expect(placed.nodes).toHaveLength(3)
    expect(placed.edges.map(edge => [edge.src, edge.dst, edge.type])).toEqual(model.relations.map(edge => [edge.src, edge.dst, edge.type]))
    const rects = placed.edges.map(edge => ({ x: edge.labelPosition.x - edge.label.width / 2 - 6, y: edge.labelPosition.y - edge.label.height / 2 - 4, w: edge.label.width + 12, h: edge.label.height + 8 }))
    for (const [index, edge] of placed.edges.entries()) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      expect(edge.labelPosition).not.toBe(edge.points.find(point => point.x === edge.labelPosition.x && point.y === edge.labelPosition.y))
      for (const node of placed.nodes) expect(rects[index]!.x >= node.x + node.width || rects[index]!.x + rects[index]!.w <= node.x || rects[index]!.y >= node.y + node.height || rects[index]!.y + rects[index]!.h <= node.y).toBe(true)
      for (let cursor = 1; cursor < edge.points.length; cursor++) {
        const a = edge.points[cursor - 1]!, b = edge.points[cursor]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
        for (const [other, rect] of rects.entries()) if (other !== index) expect(segmentEntersLabelRect(a, b, rect)).toBe(false)
      }
    }
    const rendered = renderMermaidSVGWithReceipt(source(direction), native)
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    for (const text of ['performance-1', 'Respond quickly', 'bench suite', 'verifies', 'traces', 'refines']) expect(rendered.svg).toContain(text)
  })

  test.each(['TB', 'BT', 'LR', 'RL'].flatMap(direction => (['agentic', 'elk'] as const).map(backend => ({ direction, backend }))))('keeps emitted rounded self-loop contacts normal with fractional padding in $direction using $backend', ({ direction, backend }) => {
    const input = `requirementDiagram\ndirection ${direction}\nrequirement r {\ntext: Card\n}\nr - traces -> r`
    for (const bendRadius of [0, 12]) {
      const result = renderMermaidSVGWithReceipt(input, { padding: 32.123456789, graphLayout: { backend, fallback: 'none' }, style: { roles: { relationship: { bendRadius } } } })
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      expect(result.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
      const tags = scanSvgStartTags(result.svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
      const card = tags.find(tag => tag.name === 'rect' && tag.attrs.x !== undefined && tag.attrs.stroke !== 'none')!.attrs
      const relationships = tags.filter(tag => tag.attrs['data-role'] === 'relationship')
      expect(relationships).toHaveLength(1)
      const path = relationships[0]!.attrs
      expect(path['data-from']).toBe('r')
      expect(path['data-to']).toBe('r')
      expect(path['data-relationship']).toBe('traces')
      expect(path['marker-end']).toBe('url(#requirement-arrow)')
      expect(result.svg).toContain('Card')
      expect(result.svg).toContain('&lt;&lt;traces&gt;&gt;')
      const tokens = (path.d ?? ('M ' + path.points!.trim().split(/\s+/).join(' L '))).match(/[MLQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/ig)!
      const lines: Array<readonly [{ x: number; y: number }, { x: number; y: number }]> = []
      let point = { x: NaN, y: NaN }
      for (let index = 0; index < tokens.length;) {
        const command = tokens[index++]!
        if (command === 'Q') { index += 2; point = { x: Number(tokens[index++]), y: Number(tokens[index++]) } }
        else {
          expect(['M', 'L']).toContain(command)
          const next = { x: Number(tokens[index++]), y: Number(tokens[index++]) }
          if (command === 'L') lines.push([point, next])
          point = next
        }
      }
      if (bendRadius > 0) expect(path.d).toContain('Q')
      const normal = (at: { x: number; y: number }, toward: { x: number; y: number }) => {
        const x = Number(card.x), y = Number(card.y), right = x + Number(card.width), bottom = y + Number(card.height)
        const dx = toward.x - at.x, dy = toward.y - at.y, near = (a: number, b: number) => Math.abs(a - b) < 1e-6
        return dy === 0 && at.y > y && at.y < bottom && (near(at.x, x) && dx < 0 || near(at.x, right) && dx > 0)
          || dx === 0 && at.x > x && at.x < right && (near(at.y, y) && dy < 0 || near(at.y, bottom) && dy > 0)
      }
      // Read the serialized legs, rather than trusting the positioned polyline:
      // marker auto-orientation follows this actual last leg too.
      expect(normal(lines[0]![0], lines[0]![1])).toBe(true)
      expect(normal(lines.at(-1)![1], lines.at(-1)![0])).toBe(true)
    }
  })

  test.each(['agentic', 'elk'] as const)('paints authored dashed relationships and solid containment with %s', backend => {
    for (const type of ['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces']) for (const bendRadius of [0, 12]) {
      const input = `requirementDiagram\nrequirement r {\ntext: Card\n}\nelement proof {\ntype: evidence\n}\nproof - ${type} -> r`
      const result = renderMermaidSVGWithReceipt(input, { graphLayout: { backend, fallback: 'none' }, style: { roles: { relationship: { bendRadius } } } })
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      const relationships = scanSvgStartTags(result.svg).filter(tag => tag.attributes.some(attribute => attribute.name === 'data-role' && attribute.value === 'relationship'))
      expect(relationships).toHaveLength(1)
      const paint = Object.fromEntries(relationships[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
      expect(paint['data-from']).toBe('proof')
      expect(paint['data-to']).toBe('r')
      expect(paint['data-relationship']).toBe(type)
      if (type === 'contains') {
        expect(paint['stroke-dasharray']).toBeUndefined()
        expect(paint['marker-start']).toBe('url(#requirement-contains)')
        expect(paint['marker-end']).toBeUndefined()
      } else {
        expect(paint['stroke-dasharray']).toBe('6 4')
        expect(paint['marker-end']).toBe('url(#requirement-arrow)')
        expect(paint['marker-start']).toBeUndefined()
      }
      expect(result.svg).toContain(`&lt;&lt;${type}&gt;&gt;`)
    }
  })

  test('uses the native producer across source, parsed, layout and PNG while preserving explicit ELK', () => {
    const input = source('TB'), stages: string[] = [], parsed = parseRegisteredMermaid(input)
    const options = { ...native, padding: 33 }
    if (!parsed.ok) throw new Error('fixture must parse')
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(rendered.svg)
    expect(layoutMermaidWithReceipt(input, options).receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(input, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const legacy = renderMermaidSVGWithReceipt(input), elk = renderMermaidSVGWithReceipt(input, { graphLayout: { backend: 'elk' } })
    expect(elk.svg).toBe(legacy.svg)
    expect(legacy.receipt.layoutDecisions).toBeUndefined()
    expect(elk.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    expect(renderMermaidSVGWithReceipt(input, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    JSON.stringify(rendered.receipt)
    JSON.stringify(png.receipt)
  })

  test('retains empty native canvases without starting ELK', () => {
    const result = renderMermaidSVGWithReceipt('requirementDiagram', native)
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
