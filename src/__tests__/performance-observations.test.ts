import { expect, spyOn, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { withPerformanceObserver, type PerformanceObservation } from '../performance-observations.ts'
import { inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { cachedPositioned, retainPositioned } from '../experimental/position-cache.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { certifyLayoutCandidates } from '../layout/certification.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { resolveRenderStyle } from '../styles.ts'
import * as elk from '../elk-instance.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)
const GANTT_SOURCE = 'gantt\n  dateFormat YYYY-MM-DD\n  title Delivery\n  section Build\n    Design :a1, 2026-01-01, 3d\n    Implement :after a1, 4d'

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

test('a rotation larger than the positioned cache keeps hitting, without losing immediate reuse or a new working set', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import { cachedPositioned, retainPositioned } from './src/experimental/position-cache.ts'
    const family = {}
    const use = key => {
      if (cachedPositioned(family, key)) return 1
      retainPositioned(family, key, { positioned: { width: 1, height: 1, label: key + 'x'.repeat(key.startsWith('heavy') ? 1_000_000 : key.startsWith('light') ? 40_000 : 0) } })
      return 0
    }
    const pass = keys => keys.reduce((hits, key) => hits + use(key), 0)
    const keys = (prefix, count) => Array.from({ length: count }, (_, index) => prefix + index)
    // A few heavy layouts fill the weight budget; medium ones fit only by displacing them.
    const mixed = [...keys('heavy-', 12), ...keys('light-', 100)]
    const mixedPasses = [pass(mixed), pass(mixed), pass(mixed)]
    // A larger rotation then replaces that working set.
    const rotation = keys('rotation-', 200)
    const rotationPasses = Array.from({ length: 6 }, () => pass(rotation))
    // Render then verify of new text while the cache is saturated.
    use('fresh')
    const immediate = cachedPositioned(family, 'fresh') !== undefined
    const afterImmediate = pass(rotation)
    // New text reused after other layouts were stored joins the cache.
    use('working'); use('other'); const reused = use('working')
    for (const key of keys('later-', 5)) use(key)
    console.log(JSON.stringify({ mixedPasses, rotationPasses, immediate, afterImmediate, reused, working: use('working'), other: use('other') }))
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env } })
  expect(child.status, child.stderr).toBe(0)
  const result = JSON.parse(child.stdout)
  // Lighter layouts displace heavy ones instead of thrashing behind them.
  expect(result.mixedPasses[2]).toBeGreaterThanOrEqual(100)
  // The cache holds 128 layouts; a protected rotation reuses all of them.
  expect(result.rotationPasses.at(-1)).toBe(128)
  expect(result.immediate).toBe(true)
  expect(result.afterImmediate).toBe(128)
  expect({ reused: result.reused, working: result.working, other: result.other }).toEqual({ reused: 1, working: 1, other: 0 })
}, 20_000)

test('a diagram repeated while the positioned cache is hot reuses its drawing', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import { renderMermaidSVG } from './src/index.ts'
    import { cachedPositioned, retainPositioned } from './src/experimental/position-cache.ts'
    import { withPerformanceObserver } from './src/performance-observations.ts'
    const filler = {}
    for (let index = 0; index < 128; index++) retainPositioned(filler, 'filler-' + index, { positioned: { width: 1, height: 1 } })
    for (let index = 0; index < 128; index++) cachedPositioned(filler, 'filler-' + index)
    const outcomes = Array.from({ length: 3 }, () => {
      const events = []
      withPerformanceObserver(event => { if (event.kind === 'cache' && event.owner === 'native-drawing') events.push(event.outcome) }, () => renderMermaidSVG('flowchart LR\\n  Hot --> Repeat'))
      return events
    })
    console.log(JSON.stringify(outcomes))
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect(child.status, child.stderr).toBe(0)
  const outcomes = JSON.parse(child.stdout) as string[][]
  expect(outcomes.at(-1)).toContain('hit')
}, 20_000)

test('identical repeats reuse positioned layouts: keys grow with authored text and layouts stay cloneable', () => {
  const columns = Array.from({ length: 12 }, (_, column) => [`  stage${column}[Stage ${column}]`,
    ...Array.from({ length: 20 }, (_, task) => `    task${column}_${task}[Task ${column}.${task}]@{assigned: "Owner ${task % 4}", ticket: "AM-${column * 20 + task}"}`)].join('\n'))
  const services = Array.from({ length: 40 }, (_, index) => `  Container(s${index}, "Service ${index}", "TypeScript", "Handles workload ${index}")`)
  const calls = Array.from({ length: 39 }, (_, index) => `Rel(s${index}, s${index + 1}, "Calls", "HTTPS")`)
  const cases = [
    // Derived grammar views once made this key about eight times the source.
    { name: 'large kanban', source: ['kanban', ...columns].join('\n'), minimum: 12_000 },
    // C4 layouts carry their identity allocator, which must be data, not a callback.
    { name: 'small C4', source: 'C4Context\n  Person(u, "User")\n  System(s, "System")\n  Rel(u, s, "Uses")', minimum: 0 },
    // The parsed C4 model in familyConfig is derived from the keyed source.
    { name: 'large C4', source: ['C4Container', '  Person(user, "User")', '  System_Boundary(platform, "Platform") {', ...services, '  }', 'Rel(user, s0, "Uses")', ...calls].join('\n'), minimum: 3_000 },
    // Gantt reads no clock; its today marker comes only from a keyed option.
    { name: 'gantt', source: GANTT_SOURCE, minimum: 0 },
  ]
  for (const { name, source, minimum } of cases) {
    expect(source.length).toBeGreaterThan(minimum)
    const outcomes = (): string[] => {
      const events: PerformanceObservation[] = []
      withPerformanceObserver(event => events.push(event), () => renderMermaidSVG(source))
      return events.flatMap(event => event.kind === 'cache' && event.owner === 'positioned-layout' ? [event.reason ? `${event.outcome}:${event.reason}` : event.outcome] : [])
    }
    outcomes()
    expect({ name, outcomes: outcomes() }).toEqual({ name, outcomes: expect.arrayContaining(['hit']) })
  }
  // A different clock is a different key and moves the today marker.
  const at = (ganttToday: string) => {
    const events: PerformanceObservation[] = []
    const svg = withPerformanceObserver(event => events.push(event), () => renderMermaidSVG(GANTT_SOURCE, { ganttToday }))
    return { svg, hit: events.some(event => event.kind === 'cache' && event.owner === 'positioned-layout' && event.outcome === 'hit') }
  }
  const first = at('2026-01-03'), repeat = at('2026-01-03'), later = at('2026-01-05')
  expect([first.hit, repeat.hit, later.hit]).toEqual([false, true, false])
  expect(repeat.svg).toBe(first.svg)
  expect(later.svg).not.toBe(first.svg)
  expect(at('2026-01-05').svg).toBe(later.svg)
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
