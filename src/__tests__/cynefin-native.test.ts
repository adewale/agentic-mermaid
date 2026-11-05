import { describe, expect, test } from 'bun:test'
import { parseCynefinBody, renderCynefin, mutateCynefin } from '../agent/cynefin-body.ts'
import { layoutCynefin } from '../cynefin/layout.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

describe('Cynefin native domains and transitions', () => {
  test('refuses drawings that would silently discard overwritten blocks or self-loop labels', () => {
    expect(() => parseCynefinBody('cynefin-beta\nclear\n"First"\nclear\n"Second"')).toThrow('earlier items')
    expect(() => parseCynefinBody('cynefin-beta\nclear --> clear: "Keep this label"')).toThrow('labels')
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
  test('rejects invalid domain edits and self loops without changing the original body', () => {
    const body = parseCynefinBody('cynefin-beta\nclear\n"Keep"'), before = JSON.stringify(body)
    expect(mutateCynefin(body, { kind: 'add_transition', from: 'clear', to: 'clear', label: 'Lost upstream' }).ok).toBe(false)
    expect(mutateCynefin(body, { kind: 'remove_item', domain: 'complex', index: 0 }).ok).toBe(false)
    expect(JSON.stringify(body)).toBe(before)
    const edited = mutateCynefin(body, { kind: 'add_item', domain: 'complex', label: '%%{init: {}}%%\nclear' })
    if (!edited.ok) throw new Error(edited.error.message)
    expect(renderCynefin(edited.value)).not.toContain('%%{')
    expect(parseCynefinBody(renderCynefin(edited.value)).domains[1]!.items).toEqual([{ label: '%%{init: {}}%%\nclear' }])
  })
})
