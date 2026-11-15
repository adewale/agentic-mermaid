import { describe, expect, test } from 'bun:test'
import { parseWardley } from '../wardley/parser.ts'
import { buildWardley } from '../wardley/model.ts'

describe('Wardley native reader', () => {
  test('retains authored visibility/evolution, dependencies and movement', () => {
    const model = buildWardley(
      parseWardley(`wardley-beta
title Tea shop
anchor Customer [0.95, 0.6]
component Kettle [0.43, 0.35]
component Power [0.1, 0.7]
Customer -> Kettle
Kettle -> Power
evolve Kettle 0.62
note "Cheaper power" [0.3, 0.49]`),
      undefined,
    )
    expect(model.title).toBe('Tea shop')
    expect(model.nodes.map(node => [node.id, node.x, node.y])).toEqual([
      ['Customer', 60, 95],
      ['Kettle', 35, 43],
      ['Power', 70, 10],
    ])
    expect(model.links.map(link => [link.source, link.target])).toEqual([
      ['Customer', 'Kettle'],
      ['Kettle', 'Power'],
    ])
    expect(model.trends).toEqual([{ nodeId: 'Kettle', targetX: 62, targetY: 43 }])
    expect(model.notes).toEqual([{ text: 'Cheaper power', x: 49, y: 30 }])
  })

  test('keeps pipeline component identities separate from equal display names', () => {
    const model = buildWardley(
      parseWardley(`wardley-beta
component Service [0.6, 0.5]
component API [0.9, 0.9]
pipeline Service {
  component API [0.3]
  component Utility [0.8]
}
Service -> API`),
      undefined,
    )
    expect(model.nodes.map(node => node.id)).toEqual(['Service', 'API', 'Service_API', 'Service_Utility'])
    expect(model.pipelines).toEqual([{ nodeId: 'Service', componentIds: ['Service_API', 'Service_Utility'] }])
    expect(model.links[0]).toMatchObject({ source: 'Service', target: 'API' })
  })

  test('refuses malformed tails and coordinates with no domain meaning', () => {
    expect(() => parseWardley('wardley-beta\ncomponent A [0.5, 0.3]\nunknown payload')).toThrow()
    expect(() => buildWardley(parseWardley('wardley-beta\ncomponent A [0.5, 101.0]'), undefined)).toThrow('evolution')
    expect(() => parseWardley(`wardley-beta\ncomponent A [${'1'.repeat(10000)}, 0.3`)).toThrow()
  })
})
