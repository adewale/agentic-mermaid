import { describe, expect, test } from 'bun:test'
import { parsePieChart } from '../pie/parser.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { parseXYChart } from '../xychart/parser.ts'
import { withParserObservation, type ParserObservation } from '../shared/parser-observation.ts'

function observe<T>(family: string, parse: () => T): { result: T; events: Readonly<ParserObservation>[] } {
  const events: Readonly<ParserObservation>[] = []
  const result = withParserObservation(family, event => events.push(event), parse)
  return { result, events }
}

describe('numeric native parser observation', () => {
  test('pie records overwritten titles and duplicate handling that the result cannot replay', () => {
    const lines = ['pie showData title First', '"A": 1', 'title Last', '"A": 8', '"B": 3']
    const { result, events } = observe('pie', () => parsePieChart(lines))
    expect(result).toEqual(parsePieChart(lines))
    expect(events.filter(event => event.kind === 'setTitle').map(event => event.value)).toEqual(['First', 'Last'])
    expect(events.filter(event => event.kind === 'appendEntry').map(event => event.value)).toEqual([{ label: 'A', value: 1 }, { label: 'B', value: 3 }])
    expect(events.find(event => event.kind === 'setHasDuplicateSourceLabels')).toMatchObject({ value: true, source: { line: 4, unit: 'normalized' } })
  })

  test('a failed pie parse retains only writes completed before the invalid value', () => {
    const events: Readonly<ParserObservation>[] = []
    expect(() => withParserObservation('pie', event => events.push(event), () => parsePieChart(['pie', '"A": 1', '"B": invalid']))).toThrow('invalid value')
    expect(events.filter(event => event.unit === 'statement').map(event => event.kind)).toEqual(['header', 'entry', 'entry'])
    expect(events.filter(event => event.kind === 'appendEntry').map(event => event.value)).toEqual([{ label: 'A', value: 1 }])
  })

  test('quadrant snapshots point construction, class membership, style writes and overwritten definitions', () => {
    const lines = ['quadrantChart', 'classDef hot color: red', 'P:::hot: [0.1, 0.2] radius: 4', 'classDef hot color: blue']
    const { result, events } = observe('quadrant', () => parseQuadrantChart(lines))
    expect(result).toEqual(parseQuadrantChart(lines))
    expect(events.filter(event => event.kind === 'setClassDef').map(event => event.value)).toEqual([{ name: 'hot', style: { color: 'red' } }, { name: 'hot', style: { color: 'blue' } }])
    expect(events.find(event => event.kind === 'createPoint')?.value).toEqual({ label: 'P', x: 0.1, y: 0.2 })
    expect(events.find(event => event.kind === 'setPointClass')?.value).toEqual({ label: 'P', className: 'hot' })
    expect(events.find(event => event.kind === 'appendPoint')?.value).toEqual({ label: 'P', x: 0.1, y: 0.2, className: 'hot', style: { radius: 4 } })
  })

  test('radar records its actual scanner order and deferred keyed resolution against final axes', () => {
    const source = 'radar-beta curve m{B: 2, A: 1, A: 9} axis A,B max 4'
    const { result, events } = observe('radar', () => parseRadarChart([source]))
    expect(result).toEqual(parseRadarChart([source]))
    const statements = events.filter(event => event.unit === 'statement')
    expect(statements.map(event => event.kind)).toEqual(['header', 'curve', 'axis', 'max'])
    for (const statement of statements) {
      expect(source.slice(statement.source!.offset, statement.source!.endOffset).trim()).toBe(statement.text!.trim())
      expect(statement.source!.unit).toBe('normalized')
    }
    const mutations = events.filter(event => event.unit === 'mutation')
    expect(mutations.findIndex(event => event.kind === 'appendPendingCurve')).toBeLessThan(mutations.findIndex(event => event.kind === 'appendAxis'))
    expect(mutations.findIndex(event => event.kind === 'appendAxis')).toBeLessThan(mutations.findIndex(event => event.kind === 'setCurveAxisValue'))
    expect(mutations.filter(event => event.kind === 'setCurveAxisValue').map(event => event.value)).toEqual([{ curve: 'm', axis: 'B', value: 2 }, { curve: 'm', axis: 'A', value: 1 }])
    expect(mutations.find(event => event.kind === 'resolveCurve')?.value).toEqual({ id: 'm', label: 'm', values: [1, 2] })
  })

  test('sankey records multiline logical CSV rows with physical starts and unique node insertion order', () => {
    const lines = ['', '%% lead', 'sankey-beta', '"A', 'A",B,2', 'B,C,3']
    const { result, events } = observe('sankey', () => parseSankeyDiagram(lines))
    expect(result).toEqual(parseSankeyDiagram(lines))
    expect(events.filter(event => event.kind === 'csvRecord').map(event => ({ text: event.text, source: event.source }))).toEqual([
      { text: '"A\nA",B,2', source: { line: 4, unit: 'physical' } },
      { text: 'B,C,3', source: { line: 6, unit: 'physical' } },
    ])
    expect(events.filter(event => event.kind === 'appendNode').map(event => event.value)).toEqual(['A\nA', 'B', 'C'])
    expect(events.filter(event => event.kind === 'appendLink').map(event => event.value)).toEqual([{ source: 'A\nA', target: 'B', value: 2 }, { source: 'B', target: 'C', value: 3 }])
  })

  test('xychart records axis replacement and partial point writes before a later malformed point', () => {
    const lines = ['xychart horizontal; x-axis 0 --> 2; x-axis [A,B]; bar "Sales" [1 "One",2]']
    const { result, events } = observe('xychart', () => parseXYChart(lines, { strict: true }))
    expect(result).toEqual(parseXYChart(lines, { strict: true }))
    expect(events.filter(event => event.unit === 'statement').map(event => [event.kind, event.source?.line])).toEqual([['header', 1], ['x-axis', 2], ['x-axis', 3], ['bar', 4]])
    expect(events.find(event => event.kind === 'setAxisRange')?.value).toEqual({ axis: 'x', range: { min: 0, max: 2 } })
    expect(events.find(event => event.kind === 'deleteAxisRange')?.value).toBe('x')
    expect(events.find(event => event.kind === 'appendSeries')?.value).toEqual({ type: 'bar', label: 'Sales', data: [1, 2], pointLabels: ['One', null] })
    const failed: Readonly<ParserObservation>[] = []
    expect(() => withParserObservation('xychart', event => failed.push(event), () => parseXYChart(['xychart', 'bar [1, invalid]'], { strict: true }))).toThrow('Invalid XYChart point')
    expect(failed.filter(event => event.kind === 'appendSeriesValue').map(event => event.value)).toEqual([{ index: 0, value: 1 }])
    expect(failed.some(event => event.kind === 'appendSeries')).toBe(false)
  })
})
