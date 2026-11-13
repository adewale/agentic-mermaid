import { describe, expect, test } from 'bun:test'
import { DefaultBackend, getBackend, getFamily, validateSceneDoc } from '../agent/index.ts'
import { resolveRenderRequest, resolvedFamilyRenderContextOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import type { FamilyId } from '../agent/types.ts'
import type { GroupMark, SceneDoc, SceneNode } from '../scene/ir.ts'

const cases = [
  ['er', 'erDiagram\nA ||--|| B : owns'],
  ['sequence', 'sequenceDiagram\nA->>B: Hello'],
  ['c4', 'C4Context\nPerson(a,"A")'],
  ['gitgraph', 'gitGraph\ncommit\ncommit'],
  ['journey', 'journey\nsection Work\nBuild: 5: A'],
  ['timeline', 'timeline\n2024 : Build'],
  ['xychart', 'xychart-beta\nx-axis [A, B]\ny-axis 0 --> 10\nbar [3, 5]\nline [4, 6]'],
] as const

function fixture(id: string, source: string): SceneDoc {
  const family = getFamily(id)!
  const request = resolveRenderRequest(source, { embedFontImport: false }, 'svg')
  const layout = positionResolvedFamily(id as FamilyId, request)
  const context = { positioned: layout.positioned,
    colors: request.appearance.colors, resolved: resolvedFamilyRenderContextOf(request) }
  return family.lowerScene!(context)
}

function groups(scene: SceneDoc): GroupMark[] {
  const result: GroupMark[] = []
  const visit = (node: SceneNode): void => {
    if (node.kind !== 'group') return
    result.push(node)
    for (const child of node.children) visit(child.node)
  }
  for (const part of scene.parts) visit(part)
  return result
}

describe('public Group data compatibility', () => {
  test.each(cases)('%s wrappers remain writable before and after backend admission', (id, source) => {
    const scene = fixture(id, source)
    const original = DefaultBackend.render(scene, { seed: 0 })
    const selected = groups(scene)
    expect(selected.length).toBeGreaterThan(0)
    for (const group of selected) {
      for (const field of ['open', 'close'] as const) {
        expect(Object.getOwnPropertyDescriptor(group, field)).toEqual({
          value: group[field], enumerable: true, configurable: true, writable: true,
        })
        group[field] = group[field]
      }
      expect(Object.isFrozen(group)).toBe(false)
    }
    expect(DefaultBackend.render(scene, { seed: 0 })).toBe(original)
  })

  test.each(['default', 'rough', 'hybrid'])('%s renders accepted public wrapper edits', backendId => {
    const scene = fixture(...cases[0])
    const group = groups(scene).find(node => node.role === 'entity')!
    group.open = group.open.replace('>', ' data-user="inspected">')
    expect(validateSceneDoc(scene).valid).toBe(true)
    expect(getBackend(backendId)!.render(scene, { seed: 0 })).toContain('data-user="inspected"')
    expect(Object.isFrozen(group)).toBe(false)
  })

  test('mutable public wrapper data retains active-content rejection and recovery', () => {
    const scene = fixture(...cases[0])
    const group = groups(scene).find(node => node.role === 'entity')!
    const open = group.open
    group.open = open.replace('>', ' onload="alert(1)">')
    expect(() => DefaultBackend.render(scene, { seed: 0 })).toThrow()
    expect(Object.isFrozen(group)).toBe(false)
    group.open = open
    expect(() => DefaultBackend.render(scene, { seed: 0 })).not.toThrow()
  })

})

describe('public native leaf mutations', () => {
  test.each(['default', 'rough', 'hybrid'])('%s projects Sequence text paint, transforms and inert hooks', backendId => {
    for (const change of ['paint', 'transform', 'hook'] as const) {
      const scene = fixture('sequence', 'sequenceDiagram\nA->>B: Hello')
      const label = groups(scene).flatMap(group => group.children.map(child => child.node))
        .find(node => node.kind === 'text' && node.text === 'Hello')
      if (!label || label.kind !== 'text') throw new Error('Missing public message Text mark')
      if (change === 'paint') label.paint.opacity = '0.5'
      else if (change === 'transform') label.transform = { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }
      else label.attributes = { ...label.attributes, data: { ...label.attributes?.data, note: 'audit' } }
      expect(validateSceneDoc(scene).valid).toBe(true)
      const svg = getBackend(backendId)!.render(scene, { seed: 0 })
      const text = svg.match(/<text\b[^>]*>Hello<\/text>/)?.[0]
      expect(text).toBeDefined()
      expect(text).toContain(change === 'paint' ? 'opacity="0.5"' : change === 'transform' ? 'transform="matrix(1 0 0 1 2 3)"' : 'data-note="audit"')
      expect(Object.isFrozen(label)).toBe(false)
    }
  })

  test.each(['default', 'rough', 'hybrid'])('%s applies Architecture frame opacity', backendId => {
    const scene = fixture('architecture', getFamily('architecture')!.example)
    const frame = groups(scene).flatMap(group => group.children.map(child => child.node))
      .find(node => node.kind === 'shape' && node.id.startsWith('group-frame:'))
    if (!frame || frame.kind !== 'shape') throw new Error('Missing public Architecture frame')
    frame.paint.opacity = '0.37'
    expect(validateSceneDoc(scene).valid).toBe(true)
    expect(getBackend(backendId)!.drawNode(frame, { seed: 0 })).toContain('opacity="0.37"')
    expect(getBackend(backendId)!.render(scene, { seed: 0 })).toContain('opacity="0.37"')
  })

  test.each(['default', 'rough', 'hybrid'])('%s uses current Class geometry, text and group composition', backendId => {
    const scene = fixture('class', 'classDiagram\nclass A')
    const group = groups(scene).find(node => node.role === 'class-box')!
    const box = group.children.find(child => child.node.kind === 'shape' && child.node.role === 'class-box')!.node
    const name = group.children.find(child => child.node.kind === 'text')!.node
    if (box.kind !== 'shape' || box.geometry.kind !== 'rect' || name.kind !== 'text') throw new Error('Missing public Class marks')
    const backend = getBackend(backendId)!
    const pristine = backend.render(scene, { seed: 0 })
    box.geometry.x += 7
    expect(backend.render(scene, { seed: 0 })).not.toBe(pristine)
    box.paint.fill = '#123456'
    name.paint.fill = '#654321'
    group.join = ' '
    expect(validateSceneDoc(scene).valid).toBe(true)
    const changed = backend.render(scene, { seed: 0 })
    expect(changed).not.toBe(pristine)
    expect(changed).toContain('#123456')
    expect(changed).toContain('#654321')
    expect(changed).toContain(`${group.open} `)
    expect(Object.isFrozen(scene)).toBe(false)
  })

  test.each(['er', 'sequence', 'class', 'architecture', 'journey', 'xychart'])('%s connectors project accepted inert hooks', id => {
    const scene = fixture(id, id === 'xychart' ? cases[6][1] : getFamily(id)!.example)
    const selected: SceneNode[] = []
    const visit = (node: SceneNode): void => {
      if (node.kind === 'connector') selected.push(node)
      if (node.kind === 'group') node.children.forEach(child => visit(child.node))
    }
    scene.parts.forEach(visit)
    expect(selected.length).toBeGreaterThan(0)
    for (const connector of selected) {
      connector.attributes = { ...connector.attributes, data: { ...connector.attributes?.data, note: 'caller-connector' } }
      expect(DefaultBackend.drawNode(connector, { seed: 0 })).toContain('data-note="caller-connector"')
    }
    expect(validateSceneDoc(scene).valid).toBe(true)
    for (const backendId of ['default', 'rough', 'hybrid']) {
      expect(getBackend(backendId)!.render(scene, { seed: 0 })).toContain('data-note="caller-connector"')
    }
  })
})
