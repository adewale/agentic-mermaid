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
