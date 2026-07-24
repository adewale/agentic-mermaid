import { describe, expect, test } from 'bun:test'
import { findSankeyCycle, parseSankeyDiagram } from '../sankey/parser.ts'

const lines = (src: string) => src.split('\n')

describe('sankey parser · header and rows', () => {
  test('accepts both header spellings', () => {
    for (const header of ['sankey', 'sankey-beta', 'SANKEY', 'Sankey-Beta']) {
      const d = parseSankeyDiagram(lines(`${header}\nA,B,1`))
      expect(d.links).toEqual([{ source: 'A', target: 'B', value: 1 }])
    }
  })

  test('rejects a non-sankey header loudly', () => {
    expect(() => parseSankeyDiagram(lines('sankeyx\nA,B,1'))).toThrow(/must start with "sankey"/)
  })

  test('nodes are collected in first-appearance order (source before target, row order)', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\nB,C,1\nA,B,2\nC,D,3'))
    expect(d.nodes).toEqual(['B', 'C', 'A', 'D'])
  })

  test('unquoted fields are trimmed; empty lines and %% comments are skipped', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\n\n%% source,target,value\n  A  ,  B  , 10 \n\nB,C,4'))
    expect(d.links).toEqual([
      { source: 'A', target: 'B', value: 10 },
      { source: 'B', target: 'C', value: 4 },
    ])
  })

  test('parallel duplicate rows are kept separate in authored order', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\nA,B,1\nA,B,2'))
    expect(d.links).toEqual([
      { source: 'A', target: 'B', value: 1 },
      { source: 'A', target: 'B', value: 2 },
    ])
  })
})

describe('sankey parser · RFC 4180 quoting', () => {
  test('quoted fields preserve commas and internal spacing exactly', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\nPumped heat,"Heating and cooling, homes",193.026'))
    expect(d.links[0]!.target).toBe('Heating and cooling, homes')
  })

  test('a doubled quote inside a quoted field is a literal quote', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\nA,"Heating ""commercial""",70.672'))
    expect(d.links[0]!.target).toBe('Heating "commercial"')
  })

  test('whitespace may surround a quoted field', () => {
    const d = parseSankeyDiagram(lines('sankey-beta\n  "A"  ,  "B"  ,1'))
    expect(d.links[0]).toEqual({ source: 'A', target: 'B', value: 1 })
  })

  test('an unterminated quote errors loudly with the row named', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\n"A,B,1'))).toThrow(/row 2.*unterminated quoted field/)
  })

  test('text after a closing quote errors loudly (never silently merged)', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\n"A"x,B,1'))).toThrow(/text after a closing quote/)
  })
})

describe('sankey parser · loud row diagnostics (faithfulness contract)', () => {
  test('wrong column counts error with the row and count named', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,B'))).toThrow(/row 2 has 2 columns/)
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,B,1,extra'))).toThrow(/row 2 has 4 columns/)
  })

  test('empty source/target labels are rejected', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\n,B,1'))).toThrow(/empty source label/)
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,,1'))).toThrow(/empty target label/)
  })

  test('non-numeric and negative values are rejected; zero is legal (upstream parity)', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,B,lots'))).toThrow(/invalid value "lots"/)
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,B,-1'))).toThrow(/invalid value "-1"/)
    expect(parseSankeyDiagram(lines('sankey-beta\nA,B,0')).links[0]!.value).toBe(0)
    expect(parseSankeyDiagram(lines('sankey-beta\nA,B,.5')).links[0]!.value).toBe(0.5)
  })

  test('a diagram with no data rows errors loudly', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\n%% nothing here'))).toThrow(/at least one source,target,value row/)
  })

  test('self-loops are rejected at parse time', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,A,1'))).toThrow(/self-loop/)
  })

  test('cycles are rejected with the offending path named', () => {
    expect(() => parseSankeyDiagram(lines('sankey-beta\nA,B,1\nB,C,1\nC,A,1'))).toThrow(/cycle: "A" -> "B" -> "C" -> "A"/)
  })
})

describe('sankey cycle finder (shared with the structured body)', () => {
  test('returns undefined for a DAG and a closed path for a cycle', () => {
    expect(findSankeyCycle([{ source: 'A', target: 'B', value: 1 }])).toBeUndefined()
    const cycle = findSankeyCycle([
      { source: 'A', target: 'B', value: 1 },
      { source: 'B', target: 'A', value: 1 },
    ])
    expect(cycle).toEqual(['A', 'B', 'A'])
  })

  test('deep chains do not overflow the stack (iterative DFS)', () => {
    const chain = Array.from({ length: 20000 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}`, value: 1 }))
    expect(findSankeyCycle(chain)).toBeUndefined()
  })
})
