import { expect, spyOn, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { withPerformanceObserver, type PerformanceObservation } from '../performance-observations.ts'
import { createSvgInspector, inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { cachedPositioned, retainPositioned } from '../experimental/position-cache.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { certifyLayoutCandidates } from '../layout/certification.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { resolveRenderStyle } from '../styles.ts'
import * as elk from '../elk-instance.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

test('capability reuse reports hits, bounded capacity and oversized bypass without retaining a different tuple', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import './src/index.ts'
    import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
    import { resolveRenderRequest } from './src/render-contract.ts'
    import { withPerformanceObserver } from './src/performance-observations.ts'
    const original = getFamily('flowchart')
    const source = 'flowchart LR\\n PrivateCapabilitySource --> End'
    const capture = version => {
      const restore = replaceFamilyForTest('flowchart', {
        ...original, identity: Object.freeze({ ...original.identity, version }),
      })
      const events = []
      try {
        const request = withPerformanceObserver(event => {
          if (event.kind === 'cache' && event.owner === 'capability-decision') events.push(event)
        }, () => resolveRenderRequest(source))
        const row = request.capabilityDecision.resolutions.find(value => value.id === original.identity.id)
        return { events, correct: row?.version === version && row.range === version && row.status === 'selected' }
      } finally { restore() }
    }
    const filled = Array.from({length: 40}, (_, index) => capture('1.0.' + (100 + index)))
    console.log(JSON.stringify({ filled, first: capture('1.0.100'), last: capture('1.0.139'), huge: capture('1.0.' + '1'.repeat(5000)) }))
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env } })
  expect(child.status, child.stderr).toBe(0)
  expect(child.stderr).toBe('')
  const result = JSON.parse(child.stdout) as {
    filled: Array<{ events: PerformanceObservation[]; correct: boolean }>
    first: { events: PerformanceObservation[]; correct: boolean }
    last: { events: PerformanceObservation[]; correct: boolean }
    huge: { events: PerformanceObservation[]; correct: boolean }
  }
  expect([...result.filled, result.first, result.last, result.huge].every(row => row.correct)).toBe(true)
  expect(result.first.events).toContainEqual({ version: 1, kind: 'cache', owner: 'capability-decision', outcome: 'hit' })
  expect(result.last.events).toContainEqual({ version: 1, kind: 'cache', owner: 'capability-decision', outcome: 'store-skipped', reason: 'capacity' })
  expect(result.huge.events).toContainEqual({ version: 1, kind: 'cache', owner: 'capability-decision', outcome: 'bypass', reason: 'tuple-budget' })
  expect(JSON.stringify(result)).not.toContain('PrivateCapabilitySource')
}, 20_000)

test('inspection observations distinguish actual reuse, rewritten bytes and bypass without exposing bytes', () => {
  const events: PerformanceObservation[] = []
  let inspections = 0
  const source = '<svg>private source</svg>'
  const inspect = () => ++inspections
  withPerformanceObserver(event => events.push(event), () => {
    inspectSvgOnce('probe', source, inspect)
    withSvgInspectionCache(() => {
      expect(inspectSvgOnce('probe', source, inspect)).toBe(2)
      expect(inspectSvgOnce('probe', source, inspect)).toBe(2)
      expect(inspectSvgOnce('probe', source + ' ', inspect)).toBe(3)
    })
  })
  expect(inspections).toBe(3)
  expect(events).toEqual([
    { version: 1, kind: 'cache', owner: 'svg-inspection', outcome: 'bypass', reason: 'outside-graphical-scope', detail: 'probe' },
    { version: 1, kind: 'scope', owner: 'graphical' },
    { version: 1, kind: 'cache', owner: 'svg-inspection', outcome: 'miss', detail: 'probe' },
    { version: 1, kind: 'cache', owner: 'svg-inspection', outcome: 'hit', detail: 'probe' },
    { version: 1, kind: 'cache', owner: 'svg-inspection', outcome: 'miss', detail: 'probe' },
  ])
  expect(JSON.stringify(events)).not.toContain('private source')
  expect(events.every(Object.isFrozen)).toBe(true)
})

test('owned inspections isolate equal labels and diagnostic reentry across nested scopes', () => {
  const source = '<svg>private owned source</svg>', events: PerformanceObservation[] = []
  let calls = 0, primed = false
  const owned = createSvgInspector('owned-probe', () => ++calls)
  const foreign = createSvgInspector('owned-probe', () => -1)
  withPerformanceObserver(event => {
    events.push(event)
    if (!primed && event.kind === 'cache' && event.owner === 'svg-inspection' && event.outcome === 'miss') {
      primed = true
      inspectSvgOnce('owned-probe', source, () => -2)
      foreign(source)
    }
  }, () => withSvgInspectionCache(() => {
    expect(owned(source)).toBe(1)
    expect(owned(source)).toBe(1)
    expect(foreign(source)).toBe(-1)
    withSvgInspectionCache(() => expect(owned(source)).toBe(2))
    expect(owned(source)).toBe(1)
  }))
  expect(calls).toBe(2)
  expect(JSON.stringify(events)).not.toContain('private owned source')
  expect(events.filter(event => event.kind === 'cache').every(event => event.detail === 'owned-probe')).toBe(true)
})

test('positioned cache reports real lookup results and an uncached uncloneable artifact', () => {
  const family = {}, events: PerformanceObservation[] = []
  const value = { positioned: { width: 1, height: 1 } }
  const uncloneable = { positioned: { width: 1, height: 1, planner: () => {} } }
  withPerformanceObserver(event => events.push(event), () => {
    expect(cachedPositioned(family, 'private-key')).toBeUndefined()
    retainPositioned(family, 'private-key', value)
    expect(cachedPositioned(family, 'private-key')).toEqual(value)
    retainPositioned(family, 'callback', uncloneable)
    expect(cachedPositioned(family, 'callback')).toBeUndefined()
  })
  expect(events).toEqual([
    { version: 1, kind: 'cache', owner: 'positioned-layout', outcome: 'miss' },
    { version: 1, kind: 'cache', owner: 'positioned-layout', outcome: 'hit' },
    { version: 1, kind: 'cache', owner: 'positioned-layout', outcome: 'store-skipped', reason: 'uncloneable' },
    { version: 1, kind: 'cache', owner: 'positioned-layout', outcome: 'miss' },
  ])
  expect(JSON.stringify(events)).not.toContain('private-key')
})

test('public rendering signals support and actual position-cache bypass; observer failures cannot affect output', () => {
  const source = 'pie\n "Telemetry privacy" : 2\n "Other" : 1'
  const events: PerformanceObservation[] = []
  const expected = withPerformanceExperiments([], () => renderMermaidSVG(source))
  const actual = withPerformanceObserver(event => events.push(event), () => withPerformanceExperiments([], () => renderMermaidSVG(source)))
  expect(actual).toBe(expected)
  expect(events).toContainEqual({ version: 1, kind: 'scope', owner: 'graphical' })
  expect(events).toContainEqual({ version: 1, kind: 'cache', owner: 'positioned-layout', outcome: 'bypass', reason: 'disabled' })
  expect(events).toContainEqual({ version: 1, kind: 'cache', owner: 'backend-registry', outcome: 'hit' })
  expect(JSON.stringify(events)).not.toContain('Telemetry privacy')
  expect(withPerformanceObserver(() => { throw Error('diagnostic consumer failed') }, () => renderMermaidSVG(source))).toBe(expected)
  const enclosing: PerformanceObservation[] = []
  withPerformanceObserver(event => enclosing.push(event), () => {
    expect(() => withPerformanceObserver(() => {}, () => { throw Error('render failed') })).toThrow('render failed')
    withSvgInspectionCache(() => {})
  })
  expect(enclosing).toEqual([{ version: 1, kind: 'scope', owner: 'graphical' }])
})

test('a rejected layout producer reports its fallback, while later readability exploration stays distinct', () => {
  const graph = parseMermaid('flowchart LR\n TelemetryFirst --> TelemetrySecond')
  const clean = layoutGraphSync(graph)
  const events: PerformanceObservation[] = []
  const selected = withPerformanceObserver(event => events.push(event), () => certifyLayoutCandidates(graph, resolveRenderStyle({}), [
    { strategy: 'first', produce: () => { throw Error('private producer detail') } },
    { strategy: 'second', produce: () => clean, preferNext: () => true },
    { strategy: 'readable', produce: () => clean },
  ]))
  expect(selected.certification?.strategy).toBe('readable')
  expect(events.filter(event => event.kind === 'fallback')).toEqual([
    { version: 1, kind: 'fallback', owner: 'layout-candidate', reason: 'candidate-rejected', attempt: 2 },
  ])
  expect(JSON.stringify(events)).not.toContain('private producer detail')
})

test.each(['exception', 'non-finite-geometry'] as const)('ELK reports a real degradation after %s', reason => {
  const original = elk.elkLayoutSync
  let attempts = 0
  const spy = spyOn(elk, 'elkLayoutSync').mockImplementation(graph => {
    if (++attempts === 1) {
      if (reason === 'exception') throw Error('private ELK exception')
      return { ...graph, width: NaN }
    }
    return original(graph)
  })
  const events: PerformanceObservation[] = []
  try {
    const result = withPerformanceObserver(event => events.push(event), () => withPerformanceExperiments([], () =>
      layoutGraphSync(parseMermaid('flowchart LR\n ElkretryTelemetryA --> ElkretryTelemetryB'))))
    expect(result.nodes).toHaveLength(2)
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(events).toContainEqual({ version: 1, kind: 'fallback', owner: 'elk-degradation', reason, attempt: 2 })
    expect(JSON.stringify(events)).not.toContain('private ELK exception')
  } finally { spy.mockRestore() }
})

test('the installed-compatible symbol observes actual ELK and native cache hits under production admission', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import { renderMermaidSVG } from './src/index.ts'
    import { clearElkLayoutCache, elkLayoutSync } from './src/elk-instance.ts'
    import { resolveRenderRequestForExecution } from './src/render-contract.ts'
    import { positionResolvedFamily } from './src/positioning.ts'
    import { retainedNativeDrawing, retainedPositionedScene } from './src/scene/positioned.ts'
    const events = []
    const symbol = Symbol.for('agentic-mermaid.performance-observer.v1')
    globalThis[symbol] = event => events.push(event)
    const graph = () => ({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered' },
      children: [{ id: 'A', width: 40, height: 30 }, { id: 'B', width: 40, height: 30 }],
      edges: [{ id: 'e', sources: ['A'], targets: ['B'] }] })
    clearElkLayoutCache()
    elkLayoutSync(graph()); elkLayoutSync(graph())
    const source = 'sequenceDiagram\\n TelemetryAlice->>TelemetryBob: Hello'
    const request = resolveRenderRequestForExecution(source, {}, 'svg')
    const layout = positionResolvedFamily('sequence', request)
    retainedNativeDrawing(request, layout); retainedNativeDrawing(request, layout)
    retainedPositionedScene(request, layout); retainedPositionedScene(request, layout)
    const strict = resolveRenderRequestForExecution(source, { layoutSafety: 'strict' }, 'svg')
    retainedNativeDrawing(strict, layout)
    renderMermaidSVG(source)
    const lookups = []
    const captureLookup = callback => {
      const start = events.length
      callback()
      lookups.push(events.slice(start).filter(event => event.kind === 'cache' && event.owner === 'positioned-layout').map(event => event.outcome))
    }
    const countedSource = 'sequenceDiagram\\n CountedAlice->>CountedBob: one logical lookup'
    captureLookup(() => renderMermaidSVG(countedSource))
    captureLookup(() => renderMermaidSVG(countedSource))
    let publicPosition
    captureLookup(() => {
      const request = resolveRenderRequestForExecution(countedSource, {}, 'svg')
      publicPosition = positionResolvedFamily('sequence', request)
    })
    publicPosition.positioned.width = NaN
    captureLookup(() => renderMermaidSVG(countedSource))
    delete globalThis[symbol]
    console.log(JSON.stringify({ events, lookups }))
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' } })
  expect(child.status).toBe(0)
  expect(child.stderr).toBe('')
  const { events, lookups } = JSON.parse(child.stdout) as { events: PerformanceObservation[]; lookups: string[][] }
  expect(lookups).toEqual([['miss'], ['hit'], ['hit'], ['hit']])
  for (const owner of ['elk-layout', 'positioned-layout', 'native-drawing', 'positioned-scene'] as const) {
    expect(events).toContainEqual({ version: 1, kind: 'cache', owner, outcome: 'miss' })
    expect(events).toContainEqual({ version: 1, kind: 'cache', owner, outcome: 'hit' })
  }
  expect(events).toContainEqual({ version: 1, kind: 'fallback', owner: 'native-drawing', reason: 'scene-assertions' })
  expect(events).toContainEqual({ version: 1, kind: 'scope', owner: 'graphical' })
})
