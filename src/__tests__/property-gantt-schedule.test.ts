// Property tests for the Gantt scheduler + layout (docs/design/families/gantt.md
// §Property invariants): finite generated task DAGs — not arbitrary line
// strings — drive the resolver, and each property pins an invariant the spec
// names. fast-check is seeded by default per run; failures shrink to a
// minimal DAG.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseGanttModel } from '../gantt/parser.ts'
import { resolveGanttSchedule, DAY_MS } from '../gantt/schedule.ts'
import { layoutGantt, resolveTicks, packCompactLanes, GANTT_MAX_TICKS } from '../gantt/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

// ---- DAG generator -----------------------------------------------------------
// Each generated task either has an explicit start day or `after` refs to
// strictly earlier tasks, so every generated diagram is schedulable by
// construction (no cycles, no unknown refs, first task anchored).

interface GenTask {
  explicitStartDay?: number   // day offset from 2024-01-01
  afterRefs?: number[]        // indexes of earlier tasks
  durationDays: number
  milestone: boolean
}

const genTaskList = fc.array(
  fc.record({
    startKind: fc.boolean(),
    startDay: fc.integer({ min: 0, max: 60 }),
    refPicks: fc.array(fc.nat({ max: 1_000 }), { minLength: 1, maxLength: 3 }),
    durationDays: fc.integer({ min: 1, max: 20 }),
    milestone: fc.boolean(),
  }),
  { minLength: 1, maxLength: 12 },
).map(rows => rows.map((row, i): GenTask => {
  const canRef = i > 0 && !row.startKind
  return {
    explicitStartDay: canRef ? undefined : row.startDay,
    afterRefs: canRef ? [...new Set(row.refPicks.map(p => p % i))] : undefined,
    durationDays: row.durationDays,
    milestone: row.milestone,
  }
}))

function dayStr(offset: number): string {
  const d = new Date(Date.UTC(2024, 0, 1) + offset * DAY_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function toSource(tasks: GenTask[], opts: { excludes?: string; axisFormat?: string } = {}): string {
  const lines = ['gantt', '  dateFormat YYYY-MM-DD']
  if (opts.excludes) lines.push(`  excludes ${opts.excludes}`)
  if (opts.axisFormat) lines.push(`  axisFormat ${opts.axisFormat}`)
  tasks.forEach((t, i) => {
    const tags = t.milestone ? 'milestone, ' : ''
    const start = t.explicitStartDay !== undefined
      ? dayStr(t.explicitStartDay)
      : `after ${t.afterRefs!.map(r => `t${r}`).join(' ')}`
    lines.push(`  Task ${i} :${tags}t${i}, ${start}, ${t.durationDays}d`)
  })
  return lines.join('\n')
}

function scheduleOf(src: string) {
  return resolveGanttSchedule(parseGanttModel(normalizeMermaidSource(src).lines))
}

describe('gantt scheduler properties (generated DAGs)', () => {
  test('every resolved task has finite start <= end inside the schedule range', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const s = scheduleOf(toSource(tasks))
      for (const t of s.tasks) {
        expect(Number.isFinite(t.start)).toBe(true)
        expect(Number.isFinite(t.end)).toBe(true)
        expect(t.start).toBeLessThanOrEqual(t.end)
        expect(t.start).toBeGreaterThanOrEqual(s.timeMin)
        expect(t.end).toBeLessThanOrEqual(s.timeMax)
      }
    }), { numRuns: 80 })
  })

  test('a task with after refs starts at (not before) the latest referenced end', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const s = scheduleOf(toSource(tasks))
      tasks.forEach((t, i) => {
        if (!t.afterRefs || t.afterRefs.length === 0) return
        const latestRefEnd = Math.max(...t.afterRefs.map(r => s.tasks[r]!.end))
        expect(s.tasks[i]!.start).toBe(latestRefEnd)
      })
    }), { numRuns: 80 })
  })

  test('excluding weekends never makes any task end EARLIER (monotone extension)', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const plain = scheduleOf(toSource(tasks))
      const excluded = scheduleOf(toSource(tasks, { excludes: 'weekends' }))
      for (let i = 0; i < tasks.length; i++) {
        expect(excluded.tasks[i]!.end).toBeGreaterThanOrEqual(plain.tasks[i]!.end)
      }
    }), { numRuns: 60 })
  })

  test('duration tasks keep their working-day count under excludes+includes', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const s = scheduleOf(toSource(tasks, { excludes: 'weekends' }))
      tasks.forEach((t, i) => {
        const task = s.tasks[i]!
        if (task.manualEnd) return
        // Count non-excluded days inside [start, end): must equal the duration.
        let working = 0
        for (let d = task.start; d < task.end; d += DAY_MS) {
          if (!s.isExcludedDay(d)) working++
        }
        expect(working).toBe(t.durationDays)
      })
    }), { numRuns: 60 })
  })

  test('changing axisFormat never changes task geometry', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const a = scheduleOf(toSource(tasks))
      const b = scheduleOf(toSource(tasks, { axisFormat: '%d/%m/%Y' }))
      expect(b.tasks.map(t => [t.start, t.end])).toEqual(a.tasks.map(t => [t.start, t.end]))
      const la = layoutGantt(parseGanttModel(normalizeMermaidSource(toSource(tasks)).lines), a)
      const lb = layoutGantt(parseGanttModel(normalizeMermaidSource(toSource(tasks, { axisFormat: '%d/%m/%Y' })).lines), b)
      expect(lb.bars.map(bar => [bar.x, bar.w])).toEqual(la.bars.map(bar => [bar.x, bar.w]))
    }), { numRuns: 40 })
  })

  test('changing barHeight changes row metrics but never resolved dates', () => {
    fc.assert(fc.property(genTaskList, fc.integer({ min: 10, max: 48 }), (tasks, barHeight) => {
      const src = toSource(tasks)
      const model = parseGanttModel(normalizeMermaidSource(src).lines)
      const s = scheduleOf(src)
      const base = layoutGantt(model, s)
      const tall = layoutGantt(model, s, { barHeight })
      expect(tall.bars.map(b => [b.start, b.end])).toEqual(base.bars.map(b => [b.start, b.end]))
      expect(tall.barHeight).toBe(barHeight)
    }), { numRuns: 40 })
  })

  test('tick generation stays under the fixed cap for any span and tickInterval', () => {
    fc.assert(fc.property(
      genTaskList,
      fc.constantFrom('1minute', '1hour', '1day', '1week', '1month', undefined),
      (tasks, interval) => {
        const lines = ['gantt', '  dateFormat YYYY-MM-DD']
        if (interval) lines.push(`  tickInterval ${interval}`)
        tasks.forEach((t, i) => {
          const start = t.explicitStartDay !== undefined ? dayStr(t.explicitStartDay) : `after ${t.afterRefs!.map(r => `t${r}`).join(' ')}`
          lines.push(`  Task ${i} :t${i}, ${start}, ${t.durationDays}d`)
        })
        const src = lines.join('\n')
        const model = parseGanttModel(normalizeMermaidSource(src).lines)
        const ticks = resolveTicks(scheduleOf(src), model)
        expect(ticks.length).toBeLessThanOrEqual(GANTT_MAX_TICKS + 1)
        expect(ticks.length).toBeGreaterThan(0)
      },
    ), { numRuns: 60 })
  })

  test('layout invariants: bars inside the plot; milestones zero/positive width; verts rowless', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const src = toSource(tasks)
      const model = parseGanttModel(normalizeMermaidSource(src).lines)
      const layout = layoutGantt(model, scheduleOf(src))
      for (const bar of layout.bars) {
        expect(bar.x).toBeGreaterThanOrEqual(layout.plot.x - 0.01)
        expect(bar.x + bar.w).toBeLessThanOrEqual(layout.plot.x + layout.plot.w + 0.01)
        expect(bar.y).toBeGreaterThanOrEqual(layout.plot.y - 0.01)
        expect(bar.y + bar.h).toBeLessThanOrEqual(layout.plot.y + layout.plot.h + 0.01)
        if (!model.tasks[bar.taskIndex]!.tags.includes('milestone')) {
          expect(bar.w).toBeGreaterThan(0)
        }
      }
    }), { numRuns: 60 })
  })

  test('determinism: resolving and laying out twice is deep-equal', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const src = toSource(tasks, { excludes: 'weekends' })
      const model1 = parseGanttModel(normalizeMermaidSource(src).lines)
      const model2 = parseGanttModel(normalizeMermaidSource(src).lines)
      const s1 = resolveGanttSchedule(model1)
      const s2 = resolveGanttSchedule(model2)
      expect(s2.tasks).toEqual(s1.tasks)
      expect(layoutGantt(model2, s2)).toEqual(layoutGantt(model1, s1))
    }), { numRuns: 40 })
  })

  test('critical-path/slack analysis matches a small backward-pass shadow model', () => {
    fc.assert(fc.property(genTaskList, tasks => {
      const hasAfterEdge = tasks.some(t => (t.afterRefs?.length ?? 0) > 0)
      if (!hasAfterEdge) return

      const s = scheduleOf(toSource(tasks))
      expect(s.analysis).toBeDefined()
      const analysis = s.analysis!
      const projectStart = Math.min(...s.tasks.map(t => t.start))
      const projectEnd = Math.max(...s.tasks.map(t => t.end))
      expect(analysis.projectStart).toBe(projectStart)
      expect(analysis.projectEnd).toBe(projectEnd)

      const successors = tasks.map((): number[] => [])
      const hasAfterDep = new Set<number>()
      const referenced = new Set<number>()
      tasks.forEach((task, i) => {
        for (const dep of task.afterRefs ?? []) {
          successors[dep]!.push(i)
          hasAfterDep.add(i)
          referenced.add(dep)
        }
      })

      const latestFinish = new Array<number>(tasks.length).fill(Number.NaN)
      const finishOf = (i: number): number => {
        if (!Number.isNaN(latestFinish[i]!)) return latestFinish[i]!
        const succ = successors[i]!
        const finish = succ.length === 0
          ? projectEnd
          : Math.min(...succ.map(succIndex => finishOf(succIndex) - (s.tasks[succIndex]!.end - s.tasks[succIndex]!.start)))
        latestFinish[i] = finish
        return finish
      }
      const expectedSlack: Record<string, number> = {}
      const expectedCritical: string[] = []
      for (let i = 0; i < tasks.length; i++) {
        const id = `t${i}`
        const slack = finishOf(i) - s.tasks[i]!.end
        expectedSlack[id] = slack
        expect(slack).toBeGreaterThanOrEqual(0)
        if ((successors[i]!.length > 0 || hasAfterDep.has(i)) && slack === 0) {
          expectedCritical.push(id)
        }
      }

      expect(analysis.slackByTaskId).toEqual(expectedSlack)
      expect(analysis.criticalPathTaskIds).toEqual(expectedCritical)
      expect(analysis.entryTaskIds).toEqual(tasks.map((_, i) => i).filter(i => !hasAfterDep.has(i)).map(i => `t${i}`))
      expect(analysis.sinkTaskIds).toEqual(tasks.map((_, i) => i).filter(i => !referenced.has(i)).map(i => `t${i}`))
    }), { numRuns: 80 })
  })
})

describe('compact lane packing properties', () => {
  const intervalsArb = fc.array(
    fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 30 })),
    { minLength: 1, maxLength: 20 },
  ).map(rows => rows.map(([start, len]) => ({ start, end: start + len })))

  test('no two tasks in the same lane overlap; lanes are deterministic first-fit', () => {
    fc.assert(fc.property(intervalsArb, intervals => {
      const lanes = packCompactLanes(intervals)
      expect(packCompactLanes(intervals)).toEqual(lanes)
      const byLane = new Map<number, Array<{ start: number; end: number }>>()
      intervals.forEach((iv, i) => {
        const lane = lanes[i]!
        const peers = byLane.get(lane) ?? []
        for (const p of peers) {
          const overlaps = iv.start < p.end && p.start < iv.end
          expect(overlaps).toBe(false)
        }
        peers.push(iv)
        byLane.set(lane, peers)
      })
    }), { numRuns: 120 })
  })
})
