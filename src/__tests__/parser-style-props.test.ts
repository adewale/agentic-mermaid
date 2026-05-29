// Loop 12 M4: style-statement props split on TOP-LEVEL commas only, so
// rgb()/rgba()/hsl() function values survive instead of being mangled.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'

function nodeStyle(line: string, id = 'A'): Record<string, string> | undefined {
  return parseMermaid(`flowchart TD\n  A\n  ${line}`).nodeStyles.get(id)
}

describe('M4 style props — comma-aware splitting', () => {
  test('rgb() fill is preserved intact', () => {
    expect(nodeStyle('style A fill:rgb(10,10,10)')).toEqual({ fill: 'rgb(10,10,10)' })
  })

  test('rgba() fill with alpha is preserved', () => {
    expect(nodeStyle('style A fill:rgba(0,0,0,0.5)')).toEqual({ fill: 'rgba(0,0,0,0.5)' })
  })

  test('hsl() fill with percentages is preserved', () => {
    expect(nodeStyle('style A fill:hsl(120,50%,50%)')).toEqual({ fill: 'hsl(120,50%,50%)' })
  })

  test('rgb() fill + a second prop split correctly', () => {
    expect(nodeStyle('style A fill:rgba(0,0,0,0.5),stroke:#00f')).toEqual({ fill: 'rgba(0,0,0,0.5)', stroke: '#00f' })
  })

  test('plain hex multi-prop still splits (no regression)', () => {
    expect(nodeStyle('style A fill:#f00,stroke:#00f,stroke-width:2px')).toEqual({
      fill: '#f00', stroke: '#00f', 'stroke-width': '2px',
    })
  })

  test('classDef with rgb() also preserved', () => {
    const g = parseMermaid('flowchart TD\n  A\n  classDef hot fill:rgb(255,0,0),stroke:#000\n  class A hot')
    expect(g.classDefs.get('hot')).toEqual({ fill: 'rgb(255,0,0)', stroke: '#000' })
  })

  test('trailing semicolon still tolerated with rgb()', () => {
    expect(nodeStyle('style A fill:rgb(1,2,3);')).toEqual({ fill: 'rgb(1,2,3)' })
  })
})
