import { expect, test } from 'bun:test'
import { performanceExperimentEnabled, withPerformanceExperiments } from '../experimental-performance.ts'
import { cachedPositioned, retainPositioned } from '../experimental/position-cache.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid } from '../agent/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import type { PositionedKanbanDiagram } from '../kanban/types.ts'
import { withRenderStageObserver } from '../render-stages.ts'

test('performance scope restores nested flags after exceptions', () => {
  withPerformanceExperiments([], () => {
    expect(performanceExperimentEnabled('text-spans')).toBe(false)
    expect(() => withPerformanceExperiments(['text-spans'], () => { expect(performanceExperimentEnabled('text-spans')).toBe(true); throw Error('probe') })).toThrow('probe')
    expect(performanceExperimentEnabled('text-spans')).toBe(false)
  })
})

test('positioned reuse shares one bounded residency budget across isolated family identities', () => {
  const families = [{}, {}, {}]
  const value = { positioned: { width: 1, height: 1, payload: 'x'.repeat(1536 * 1024) } }
  retainPositioned(families[0]!, 'same-key', value)
  expect(cachedPositioned(families[1]!, 'same-key')).toBeUndefined()
  retainPositioned(families[1]!, 'same-key', value)
  retainPositioned(families[2]!, 'same-key', value)
  expect(cachedPositioned(families[0]!, 'same-key')).toBeUndefined()
  expect(cachedPositioned(families[1]!, 'same-key')).toEqual(value)
  expect(cachedPositioned(families[2]!, 'same-key')).toEqual(value)
})

test('text reuse preserves Unicode, typography, source spans and custom measurer isolation', () => {
  for (const source of ['a **bold** word', '東京 👩‍💻 café\nΩ', '<i>x</i> &lt;span&gt;', '']) {
    const baseline = withPerformanceExperiments([], () => prepareDisplayText(source))
    withPerformanceExperiments(['text-spans'], () => {
      expect(prepareDisplayText(source)).toEqual(baseline)
      expect(prepareDisplayText(source)).toBe(prepareDisplayText(source))
      const options = { fontSize: 16, fontWeight: 500, maxWidth: 72 }
      expect(preparePixelText(source, options)).toEqual(withPerformanceExperiments([], () => preparePixelText(source, options)))
    })
  }
  withPerformanceExperiments(['text-spans'], () => {
    const measured = (width: number) => withTextMeasurementExecution(createTextMeasurementExecution({ id: 'test-measurer', version: '1.0.0', measure: () => width }, 'Inter'), () => preparePixelText('custom', { fontSize: 16, fontWeight: 500 }).width)
    expect(measured(40)).not.toBe(measured(90))
  })
})

test('position cache reuses complete layout, respects cache opt-out and keeps prepared evidence', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  const input = 'flowchart LR\n CacheA[Prepared label] --> CacheB[Other label]'
  try {
    process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
    withPerformanceExperiments(['position-cache'], () => {
      const first = renderMermaidSVG(input); const elk: number[] = []
      const second = withRenderStageObserver(s => { if (s.stage === 'elk') elk.push(s.ms) }, () => renderMermaidSVG(input))
      expect(second).toBe(first); expect(elk).toHaveLength(0)
      expect(renderMermaidSVG(input, { idPrefix: 'different-' })).not.toBe(first)
      process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
      withRenderStageObserver(s => { if (s.stage === 'elk') elk.push(s.ms) }, () => renderMermaidSVG(input))
      expect(elk.length).toBeGreaterThan(0)
    })
  } finally { if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE; else process.env.AGENTIC_MERMAID_ELK_CACHE = prior }
})


test('entity-heavy source remains eligible for positioned geometry reuse', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
  try {
    withPerformanceExperiments(['position-cache'], () => {
      const source = 'flowchart LR\n' + Array.from({ length: 100 }, (_, index) => `ReceiptCache${index}["&amp; #quot; label ${index}"]`).join('\n')
      const firstStages: string[] = [], secondStages: string[] = []
      const first = withRenderStageObserver(stage => { firstStages.push(stage.stage) }, () => renderMermaidSVG(source))
      const second = withRenderStageObserver(stage => { secondStages.push(stage.stage) }, () => renderMermaidSVG(source))
      expect(firstStages).toContain('elk')
      expect(secondStages).not.toContain('elk')
      expect(second).toBe(first)
    })
  } finally { if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE; else process.env.AGENTIC_MERMAID_ELK_CACHE = prior }
})

test('positioned reuse keeps distinct authored CR and entity identities and their source spans', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
  try {
    withPerformanceExperiments(['position-cache'], () => {
      const cases = [
        { payload: 'Cache&amp;\rX', id: 'Cache&\rX' },
        { payload: 'Cache&#38;\nX', id: 'Cache&\nX' },
      ]
      for (const sample of [...cases, ...cases.slice().reverse()]) {
        const source = `kanban\n["${sample.payload}"]`
        for (let repeat = 0; repeat < 2; repeat++) {
          const tags = scanSvgStartTags(renderMermaidSVG(source, { embedFontImport: false }))
          expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-id') !== undefined).map(tag => decodedSvgAttributeValue(tag, 'data-id'))).toEqual([sample.id])
          expect(renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).regions.filter(region => region.kind === 'band').map(region => region.id)).toEqual([sample.id])
          const parsed = parseRegisteredMermaid(source)
          if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
          if (parsed.value.body.kind !== 'kanban') throw Error('Expected native Kanban')
          const span = parsed.value.source.spans?.labels.get(`group:${parsed.value.body.columns[0]!.id}`)
          expect(span).toBeDefined()
          expect(source.slice(span!.start.offset, span!.end.offset)).toBe(sample.payload)
        }
      }
    })
  } finally { if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE; else process.env.AGENTIC_MERMAID_ELK_CACHE = prior }
})


test('explicit positioning source overrides retain their payload authority in cache keys', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
  try {
    withPerformanceExperiments(['position-cache'], () => {
      const request = resolveRenderRequestForExecution('kanban\nOriginal', {}, 'svg')
      const override = (payloadText: string) => ({ ...request.source, cleanup: { ...request.source.cleanup!, payloadText } })
      const first = override('kanban\nFirstOverride'), second = override('kanban\nSecondOverride')
      const ids = (source: typeof first) => (positionResolvedFamily('kanban', request, source).positioned as PositionedKanbanDiagram).columns.map(column => column.id)
      expect(ids(first)).toEqual(['FirstOverride'])
      expect(ids(second)).toEqual(['SecondOverride'])
      expect(ids(first)).toEqual(['FirstOverride'])
    })
  } finally { if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE; else process.env.AGENTIC_MERMAID_ELK_CACHE = prior }
})

test('positioned residency accounts for Map contents and rejects oversized snapshots', () => {
  const family = {}
  const value = { positioned: { width: 1, height: 1, payload: new Map([['large', 'x'.repeat(5 * 1024 * 1024)]]) } }
  retainPositioned(family, 'map-budget', value)
  expect(cachedPositioned(family, 'map-budget')).toBeUndefined()
})
