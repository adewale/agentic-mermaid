// Gantt syntax parser tests (docs/design/gantt.md §Test tiers, parser row):
// Mermaid docs examples as fixtures, malformed headers, duplicate ids, task
// labels containing `#`/`;`/keywords, click href/call, multiple excludes/
// includes, structured errors for unsupported/invalid syntax — plus a
// differential check against the mermaid-ast oracle (parity on titles,
// sections, task names/ids/raw date expressions).

import { describe, test, expect } from 'bun:test'
import { Gantt } from 'mermaid-ast'
import { parseGanttModel, parseGanttTaskMeta, renderGanttTaskMeta, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { GanttError } from '../gantt/types.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

function modelOf(src: string) {
  return parseGanttModel(normalizeMermaidSource(src).lines)
}

// The two examples agents are most likely to try first, taken from
// https://mermaid.js.org/syntax/gantt.html (docs as fixtures).
const DOCS_BASIC = `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d
`

const DOCS_FULL = `gantt
    dateFormat  YYYY-MM-DD
    title       Adding GANTT diagram functionality to mermaid
    excludes    weekends

    section A section
    Completed task            :done,    des1, 2014-01-06,2014-01-08
    Active task               :active,  des2, 2014-01-09, 3d
    Future task               :         des3, after des2, 5d
    Future task2              :         des4, after des3, 5d
`

const DOCS_MILESTONE = `gantt
    dateFormat HH:mm
    axisFormat %H:%M
    Initial milestone : milestone, m1, 17:49, 2m
    Task A : 10m
    Task B : 5m
    Final milestone : milestone, m2, 18:08, 4m
`

describe('gantt parser — Mermaid docs examples', () => {
  test('basic docs example: title, sections, ids, after refs, durations', () => {
    const m = modelOf(DOCS_BASIC)
    expect(m.title).toBe('A Gantt Diagram')
    expect(m.dateFormat).toBe('YYYY-MM-DD')
    expect(m.sections.map(s => s.label)).toEqual([undefined, 'Section', 'Another'])
    expect(m.tasks.map(t => t.label)).toEqual(['A task', 'Another task', 'Task in Another', 'another task'])
    expect(m.tasks[0]).toMatchObject({ id: 'a1', start: { kind: 'date', raw: '2014-01-01' }, end: { kind: 'duration', raw: '30d' } })
    expect(m.tasks[1]!.start).toEqual({ kind: 'after', refs: ['a1'] })
    // `another task :24d` has no start: it inherits the previous task's end.
    expect(m.tasks[3]!.start).toBeUndefined()
    expect(m.tasks[3]!.end).toEqual({ kind: 'duration', raw: '24d' })
  })

  test('full docs example: status tags, excludes weekends, compact comma', () => {
    const m = modelOf(DOCS_FULL)
    expect(m.excludes).toEqual([{ kind: 'weekends' }])
    expect(m.tasks[0]).toMatchObject({ label: 'Completed task', id: 'des1', tags: ['done'] })
    // `2014-01-06,2014-01-08` — no space after the comma still splits.
    expect(m.tasks[0]!.end).toEqual({ kind: 'date', raw: '2014-01-08' })
    expect(m.tasks[1]!.tags).toEqual(['active'])
    expect(m.tasks[2]!.tags).toEqual([])
    expect(m.tasks[2]!.start).toEqual({ kind: 'after', refs: ['des2'] })
  })

  test('milestone docs example: time-only dateFormat, milestone tags', () => {
    const m = modelOf(DOCS_MILESTONE)
    expect(m.dateFormat).toBe('HH:mm')
    expect(m.axisFormat).toBe('%H:%M')
    expect(m.tasks[0]!.tags).toEqual(['milestone'])
    expect(m.tasks[0]!.id).toBe('m1')
    expect(m.tasks[1]!.start).toBeUndefined()
  })
})

describe('gantt parser — directives', () => {
  test('all calendar/display directives parse', () => {
    const m = modelOf(`gantt
      dateFormat YYYY-MM-DD
      axisFormat %m/%d
      tickInterval 1week
      inclusiveEndDates
      topAxis
      excludes weekends 2024-01-15
      includes 2024-01-13
      weekend friday
      weekday monday
      todayMarker stroke-width:5px
      Task :t1, 2024-01-01, 5d
    `)
    expect(m.axisFormat).toBe('%m/%d')
    expect(m.tickInterval).toEqual({ count: 1, unit: 'week' })
    expect(m.inclusiveEndDates).toBe(true)
    expect(m.topAxis).toBe(true)
    expect(m.excludes).toEqual([{ kind: 'weekends' }, { kind: 'date', raw: '2024-01-15' }])
    expect(m.includes).toEqual([{ kind: 'date', raw: '2024-01-13' }])
    expect(m.weekendStart).toBe('friday')
    expect(m.weekStart).toBe('monday')
    expect(m.todayMarker).toEqual({ off: false, style: 'stroke-width:5px' })
  })

  test('multiple excludes lines accumulate (mermaid PR #7772)', () => {
    const m = modelOf(`gantt
      excludes weekends
      excludes 2024-01-15
      excludes friday
      Task :t1, 2024-01-01, 5d
    `)
    expect(m.excludes).toEqual([
      { kind: 'weekends' },
      { kind: 'date', raw: '2024-01-15' },
      { kind: 'weekday', day: 'friday' },
    ])
  })

  test('todayMarker off parses as off', () => {
    expect(modelOf('gantt\n  todayMarker off\n  T :t, 2024-01-01, 1d').todayMarker).toEqual({ off: true })
  })

  test('accTitle / accDescr inline and block', () => {
    const m = modelOf(`gantt
      accTitle: Accessible title
      accDescr: Inline description
      Task :t1, 2024-01-01, 1d
    `)
    expect(m.accTitle).toBe('Accessible title')
    expect(m.accDescr).toBe('Inline description')
    const block = modelOf('gantt\n  accDescr {\n    Long description\n  }\n  Task :t1, 2024-01-01, 1d')
    expect(block.accDescr).toBe('Long description')
  })

  test('click href and click call are parsed, never executed', () => {
    const m = modelOf(`gantt
      Task :t1, 2024-01-01, 1d
      click t1 href "https://example.com"
      click t1 call doThing(arg1, arg2)
    `)
    expect(m.clicks).toHaveLength(2)
    expect(m.clicks[0]).toMatchObject({ taskId: 't1', action: 'href' })
    expect(m.clicks[1]).toMatchObject({ taskId: 't1', action: 'call' })
  })
})

describe('gantt parser — task labels keep #, ;, and keywords (mermaid PR #5095)', () => {
  test.each([
    ['Fix bug #123 in parser', 'Fix bug #123 in parser'],
    ['Ship v1; celebrate', 'Ship v1; celebrate'],
    ['Review gantt spec', 'Review gantt spec'],
    ['title-screen polish', 'title-screen polish'],
  ])('label %j parses verbatim', (label, expected) => {
    const m = modelOf(`gantt\n  ${label} :t1, 2024-01-01, 1d`)
    expect(m.tasks[0]!.label).toBe(expected)
  })
})

describe('gantt parser — structured errors', () => {
  function errorOf(src: string): GanttError {
    try {
      modelOf(src)
    } catch (e) {
      if (e instanceof GanttError) return e
      throw e
    }
    throw new Error('expected GanttError')
  }

  test('duplicate task ids are a structured parse error', () => {
    const e = errorOf('gantt\n  A :x, 2024-01-01, 1d\n  B :x, 2024-01-02, 1d')
    expect(e.code).toBe('GANTT_DUPLICATE_TASK_ID')
    expect(e.line).toBe(3)
  })

  test('invalid tickInterval is ignored like Mermaid (auto ticks; bounded generation is the guard)', () => {
    // Mermaid's own docs include `tickInterval 1decade`; upstream ignores
    // values outside its regex rather than erroring (PR #7197's fix bounds
    // tick GENERATION). Lenient parse keeps the docs corpus rendering.
    for (const bad of ['0day', 'banana', '1decade']) {
      const m = modelOf(`gantt\n  tickInterval ${bad}\n  A :a, 2024-01-01, 1d`)
      expect(m.tickInterval).toBeUndefined()
    }
  })

  test('invalid weekday / weekend values are structured errors', () => {
    expect(errorOf('gantt\n  weekday someday\n  A :a, 2024-01-01, 1d').code).toBe('GANTT_BAD_DIRECTIVE')
    expect(errorOf('gantt\n  weekend monday\n  A :a, 2024-01-01, 1d').code).toBe('GANTT_BAD_DIRECTIVE')
  })

  test('malformed task metadata is a structured error with its line', () => {
    const e = errorOf('gantt\n  Task :')
    expect(e.code).toBe('GANTT_BAD_DIRECTIVE') // header-like junk line (no metadata after colon)
    const e2 = errorOf('gantt\n  Task :a, b, c, d, e')
    expect(e2.code).toBe('GANTT_BAD_TASK')
    expect(e2.line).toBe(2)
  })

  test('unrecognized non-task lines are structured errors, never silently dropped', () => {
    const e = errorOf('gantt\n  Task one 2024-01-01 1d')
    expect(e.code).toBe('GANTT_BAD_DIRECTIVE')
    expect(e.message).toContain('Task one 2024-01-01 1d')
  })

  test('non-gantt header is rejected', () => {
    expect(() => parseGanttModel(['ganttX', 'A :a, 2024-01-01, 1d'])).toThrow(GanttError)
  })
})

describe('gantt task metadata helper (shared with the agent body)', () => {
  test.each([
    ['done, des1, 2014-01-06, 2014-01-08', { tags: ['done'], id: 'des1' }],
    ['crit, active, a1, 2024-01-01, 24h', { tags: ['crit', 'active'], id: 'a1' }],
    ['milestone, m1, 2024-01-02, 0d', { tags: ['milestone'], id: 'm1' }],
    ['vert, v1, 2024-01-04, 0d', { tags: ['vert'], id: 'v1' }],
    ['after a1 b2 c3, 5d', { tags: [], id: undefined }],
    ['x1, 2024-01-01, until rel', { tags: [], id: 'x1' }],
  ])('parses %j', (raw, expected) => {
    const meta = parseGanttTaskMeta(raw)
    expect(meta).not.toBeNull()
    if (expected.tags) expect(meta!.tags).toEqual(expected.tags as never)
    expect(meta!.id).toBe(expected.id as never)
  })

  test('until in the end position resolves to until refs', () => {
    const meta = parseGanttTaskMeta('x1, 2024-01-01, until rel other')!
    expect(meta.end).toEqual({ kind: 'until', refs: ['rel', 'other'] })
  })

  test('render(parse(meta)) is canonical and parse(render(x)) is identity', () => {
    const samples = [
      'done, des1, 2014-01-06, 2014-01-08',
      'active, a, 2024-01-01, 3d',
      'after a1 b2, 5d',
      'm1, 17:49, 2m',
      'x, 2024-01-01, until rel',
      '24d',
    ]
    for (const raw of samples) {
      const meta = parseGanttTaskMeta(raw)!
      const rendered = renderGanttTaskMeta(meta)
      expect(renderGanttTaskMeta(parseGanttTaskMeta(rendered)!)).toBe(rendered)
    }
  })

  test('rejects malformed metadata shapes', () => {
    for (const raw of ['', 'a, b, c, d', 'done,', ',2024-01-01', 'done, done, 2024-01-01, 1d', 'bad id!, 2024-01-01, 1d']) {
      expect(parseGanttTaskMeta(raw)).toBeNull()
    }
  })
})

describe('gantt frontmatter config', () => {
  test('displayMode compact from top level and config.gantt', () => {
    const top = normalizeMermaidSource('---\ndisplayMode: compact\n---\ngantt\n  A :a, 2024-01-01, 1d')
    const m1 = applyGanttFrontmatterConfig(parseGanttModel(top.lines), top.frontmatter)
    expect(m1.displayMode).toBe('compact')
    const nested = normalizeMermaidSource('---\nconfig:\n  gantt:\n    displayMode: compact\n    barHeight: 30\n---\ngantt\n  A :a, 2024-01-01, 1d')
    const m2 = applyGanttFrontmatterConfig(parseGanttModel(nested.lines), nested.frontmatter)
    expect(m2.displayMode).toBe('compact')
    expect(m2.barHeight).toBe(30)
  })

  test('init directive config flows through the same path', () => {
    const n = normalizeMermaidSource("%%{init: {'gantt': {'topAxis': true}}}%%\ngantt\n  A :a, 2024-01-01, 1d")
    const m = applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
    expect(m.topAxis).toBe(true)
  })
})

describe('gantt differential vs mermaid-ast oracle', () => {
  // mermaid-ast wraps mermaid's own langium-adjacent gantt parsing; parity on
  // structure (title, dateFormat, sections, task names/ids/raw exprs) catches
  // drift between our grammar subset and upstream.
  const SAMPLES = [DOCS_BASIC, DOCS_FULL, DOCS_MILESTONE]

  for (const [i, src] of SAMPLES.entries()) {
    test(`sample ${i}: section/task structure matches the oracle`, () => {
      const ours = modelOf(src)
      const oracle = Gantt.parse(src).toAST()
      expect(ours.title ?? undefined).toBe(oracle.title ?? undefined)
      expect(ours.dateFormat).toBe(oracle.dateFormat ?? 'YYYY-MM-DD')
      const oracleSections = oracle.sections.map(s => s.name)
      const ourLabeled = ours.sections.filter(s => s.label !== undefined).map(s => s.label)
      expect(ourLabeled).toEqual(oracleSections)
      const oracleTasks = [...oracle.tasks, ...oracle.sections.flatMap(s => s.tasks)]
      const ourTasks = ours.tasks
      expect(ourTasks.map(t => t.label)).toEqual(oracleTasks.map(t => t.name))
      expect(ourTasks.map(t => t.id)).toEqual(oracleTasks.map(t => t.id ?? undefined))
    })
  }
})
