import { describe, expect, test } from 'bun:test'
import { parseCynefinBody, renderCynefin, mutateCynefin } from '../agent/cynefin-body.ts'
import { layoutCynefin } from '../cynefin/layout.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

describe('Cynefin native domains and transitions', () => {
  test('refuses overwritten domain blocks and retains authored self-loop labels', () => {
    expect(() => parseCynefinBody('cynefin-beta\nclear\n"First"\nclear\n"Second"')).toThrow('earlier items')
    expect(parseCynefinBody('cynefin-beta\nclear --> clear: "Keep this label"').transitions[0]?.label).toBe('Keep this label')
  })
  test('canonical items and transitions retain pinned Mermaid native semantics', async () => {
    const body = parseCynefinBody('cynefin-beta\ncomplex\n"Explore"\nclear\n"Use experience"\ncomplex --> clear: "Learning"')
    const edited = mutateCynefin(body, { kind: 'add_item', domain: 'confusion', label: '%%{init: {}}%%\nLiteral text' })
    if (!edited.ok) throw new Error(edited.error.message)
    const upstream = startUpstreamMermaid()
    try {
      const actual = await upstream.project(renderCynefin(edited.value), diagram => ({ domains: [...diagram.db.getDomains().values()], transitions: diagram.db.getTransitions() }))
      expect(actual).toEqual({ ok: true, value: { domains: edited.value.domains, transitions: edited.value.transitions } })
    } finally { upstream.close() }
  })
  test('keeps repeated item labels in their domains and preserves transition labels', () => {
    const body = parseCynefinBody('cynefin-beta:\ntitle Decisions\ncomplex\n"Explore"\nclear\n"Explore"\n"Repeat reliably"\ncomplex --> clear: "Learned practice"')
    expect(body.domains).toEqual([{ name: 'complex', items: [{ label: 'Explore' }] }, { name: 'clear', items: [{ label: 'Explore' }, { label: 'Repeat reliably' }] }])
    expect(body.transitions).toEqual([{ from: 'complex', to: 'clear', label: 'Learned practice' }])
    expect(parseCynefinBody(renderCynefin(body))).toEqual(body)
    const edit = mutateCynefin(body, { kind: 'set_item', domain: 'clear', index: 0, label: 'Apply' })
    if (!edit.ok) throw new Error(edit.error.message)
    expect(edit.value.domains.map(domain => domain.items.map(item => item.label))).toEqual([['Explore'], ['Apply', 'Repeat reliably']])
    expect(body.domains[1]!.items[0]!.label).toBe('Explore')
  })
  test('grows every domain to retain all items, including a large confusion domain', () => {
    const labels = Array.from({ length: 60 }, (_, index) => `Item ${index}: ${'a complete explanation '.repeat(8)}`)
    const body = parseCynefinBody(`cynefin-beta\nconfusion\n${labels.map(label => JSON.stringify(label)).join('\n')}`)
    const layout = layoutCynefin(body), confusion = layout.domains.find(domain => domain.name === 'confusion')!
    expect(layout.domains).toHaveLength(5)
    expect(confusion.items.map(item => item.text)).toEqual(labels)
    for (const item of confusion.items) {
      expect(item.y - item.block.height / 2).toBeGreaterThanOrEqual(confusion.y)
      expect(item.y + item.block.height / 2).toBeLessThanOrEqual(confusion.y + confusion.height)
    }
    expect(layout.height).toBeGreaterThan(1000)
  })
  test('rejects invalid domain edits without changing the original body', () => {
    const body = parseCynefinBody('cynefin-beta\nclear\n"Keep"'), before = JSON.stringify(body)
    expect(mutateCynefin(body, { kind: 'remove_item', domain: 'complex', index: 0 }).ok).toBe(false)
    expect(JSON.stringify(body)).toBe(before)
    const edited = mutateCynefin(body, { kind: 'add_item', domain: 'complex', label: '%%{init: {}}%%\nclear' })
    if (!edited.ok) throw new Error(edited.error.message)
    expect(renderCynefin(edited.value)).not.toContain('%%{')
    expect(parseCynefinBody(renderCynefin(edited.value)).domains[1]!.items).toEqual([{ label: '%%{init: {}}%%\nclear' }])
  })
})

// Transition readability is a geometry contract, independent of a particular
// routing algorithm or upstream renderer. The prior midpoint routes failed it.
test('Cynefin repeated, reverse and self transitions retain distinct readable routes', () => {
  const body = parseCynefinBody('cynefin-beta\ncomplex --> clear: "Promote practice"\ncomplex --> clear: "Confirm evidence"\nclear --> complex: "Challenge assumptions"\nclear --> clear: "Reassess"'), chart = layoutCynefin(body)
  const bounds = chart.transitions.map(edge => {
    const label = edge.label!
    expect(edge.points.length).toBeGreaterThan(2)
    expect(edge.points[0]).not.toEqual(edge.points.at(-1))
    for (const point of edge.points) { expect(point.x).toBeGreaterThanOrEqual(0); expect(point.y).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(chart.width); expect(point.y).toBeLessThanOrEqual(chart.height) }
    for (const domain of chart.domains) if (domain.name !== edge.from && domain.name !== edge.to)
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const enters = a.x === b.x ? a.x > domain.x && a.x < domain.x + domain.width && Math.max(a.y, b.y) > domain.y && Math.min(a.y, b.y) < domain.y + domain.height : a.y > domain.y && a.y < domain.y + domain.height && Math.max(a.x, b.x) > domain.x && Math.min(a.x, b.x) < domain.x + domain.width
        expect(enters).toBe(false)
      }
    return { x: label.x - label.block.width / 2, y: label.y - label.block.height / 2, width: label.block.width, height: label.block.height }
  })
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i]!, b = bounds[j]!
    expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false)
  }
  const styled = layoutCynefin(body, {}, resolveStyleStackWithFace({ roles: { node: { textTransform: 'uppercase' }, edge: { textTransform: 'uppercase', fontSize: 17 }, group: { textTransform: 'uppercase', fontSize: 19 } } }).face)
  expect(styled.domains[0]?.heading.block.text).toBe('COMPLEX')
  expect(styled.transitions[0]?.label?.block.text).toBe('PROMOTE PRACTICE')
  expect(styled.transitions[0]?.label?.block.fontSize).toBe(17)
})
