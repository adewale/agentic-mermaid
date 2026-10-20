import { expect, test } from 'bun:test'
import { performanceExperimentEnabled, withPerformanceExperiments } from '../experimental-performance.ts'
import { cachedPositioned, retainPositioned } from '../experimental/position-cache.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { renderMermaidSVG } from '../index.ts'
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
