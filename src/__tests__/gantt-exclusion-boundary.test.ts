// Exclude-boundary model — upstream parity (family-elevation-plan §Gantt
// item 6; resolves the eval/mermaid-gantt-bench `exclude-boundary-model`
// ledger entries e3/e4 by ADOPTING upstream's semantics instead of pinning a
// divergence):
//
//   - The exclusion walk counts excluded days in (start, end] — mermaid's
//     fixTaskDates starts its cursor one day AFTER the task start, so a task
//     STARTING on an excluded day gets that day free.
//   - Chain end (`end`) and drawn bar end (`renderEnd`) split exactly like
//     upstream's endTime/renderEndTime: trailing excluded days extend the
//     chain end (successors start after them) without stretching the bar.
//
// Expectations below are transcribed from mermaid's ganttDb.spec.ts
// ("should ignore weekends") — the boundary oracle, not our own output.

import { describe, test, expect } from 'bun:test'
import { parseGanttModel } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

const UTC = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

function scheduleOf(src: string) {
  return resolveGanttSchedule(parseGanttModel(normalizeMermaidSource(src).lines))
}

describe('exclude-boundary: (start, end] walk (upstream fixTaskDates)', () => {
  test('a task STARTING on an excluded day gets that day free', () => {
    // 2024-01-06 is a Saturday. Upstream counts excluded days strictly after
    // the start, so the 1d of work lands on Monday: chain end = Jan 8.
    const s = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-06, 1d')
    expect(s.tasks[0]!.start).toBe(UTC(2024, 1, 6))
    expect(s.tasks[0]!.end).toBe(UTC(2024, 1, 8))
    // The drawn bar keeps the raw duration (upstream renderEndTime).
    expect(s.tasks[0]!.renderEnd).toBe(UTC(2024, 1, 7))
  })

  test('trailing excluded days extend the chain end, not the drawn bar', () => {
    // Mon 2024-01-01 + 5d: raw end Sat Jan 6. Sat+Sun are excluded, so the
    // successor chain resumes Monday Jan 8 — but the bar still ends Saturday
    // midnight (= Friday end of day), exactly upstream's renderEndTime.
    const s = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-01, 5d\n  B :b, after a, 1d')
    expect(s.tasks[0]!.end).toBe(UTC(2024, 1, 8))
    expect(s.tasks[0]!.renderEnd).toBe(UTC(2024, 1, 6))
    expect(s.tasks[1]!.start).toBe(UTC(2024, 1, 8))
    expect(s.tasks[1]!.end).toBe(UTC(2024, 1, 9))
  })

  test('mid-task exclusions extend chain AND bar (renderEnd catches up)', () => {
    // Fri 2024-01-05 + 3d: the weekend falls inside the walk and working days
    // continue after it, so renderEnd converges back onto the chain end.
    const s = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-05, 3d')
    expect(s.tasks[0]!.end).toBe(UTC(2024, 1, 10))
    expect(s.tasks[0]!.renderEnd).toBe(UTC(2024, 1, 10))
  })

  test('manual end dates and milestones never split renderEnd from end', () => {
    const s = scheduleOf(`gantt
      excludes weekends
      A :a, 2024-01-05, 2024-01-08
      M :milestone, m, 2024-01-06, 0d
    `)
    expect(s.tasks[0]!.renderEnd).toBe(s.tasks[0]!.end)
    expect(s.tasks[1]!.renderEnd).toBe(s.tasks[1]!.end)
  })

  test('renderEnd is always within [start, end]', () => {
    const s = scheduleOf(`gantt
      excludes weekends 2024-01-10
      A :a, 2024-01-06, 1d
      B :b, after a, 4d
      C :c, after b, 2d
    `)
    for (const t of s.tasks) {
      expect(t.renderEnd).toBeGreaterThanOrEqual(t.start)
      expect(t.renderEnd).toBeLessThanOrEqual(t.end)
    }
  })

  test('the schedule range covers drawn bars, not phantom trailing exclusions', () => {
    // With no successor, the axis should end at the drawn bar (renderEnd),
    // not at a chain end nothing starts from.
    const s = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-01, 5d')
    expect(s.timeMax).toBe(UTC(2024, 1, 6))
  })

  // Upstream ganttDb.spec.ts "should ignore weekends", transcribed verbatim
  // (excludes weekends + explicit 2019-02-06 + fridays). Previously ledgered
  // as exclusions.json e3 (exclude-boundary-model); now a parity case.
  test('upstream mega case: all seven chain instants match ganttDb.spec.ts', () => {
    const s = scheduleOf(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends 2019-02-06,friday
      section weekends skip test
        test1 :id1,2019-02-01,1d
        test2 :id2,after id1,2d
        test3 :id3,after id2,7d
        test4 :id4,2019-02-01,2019-02-20
        test5 :id5,after id4,1d
      section full ending task on last day
        test6 :id6,2019-02-13,2d
        test7 :id7,after id6,1d
    `)
    const expected: Array<[number, number, number]> = [
      [UTC(2019, 2, 1), UTC(2019, 2, 4), UTC(2019, 2, 2)],   // test1 (starts excluded Friday)
      [UTC(2019, 2, 4), UTC(2019, 2, 7), UTC(2019, 2, 6)],   // test2 (ends into excluded Wed)
      [UTC(2019, 2, 7), UTC(2019, 2, 20), UTC(2019, 2, 20)], // test3
      [UTC(2019, 2, 1), UTC(2019, 2, 20), UTC(2019, 2, 20)], // test4 (manual end)
      [UTC(2019, 2, 20), UTC(2019, 2, 21), UTC(2019, 2, 21)], // test5
      [UTC(2019, 2, 13), UTC(2019, 2, 18), UTC(2019, 2, 15)], // test6 (trailing run)
      [UTC(2019, 2, 18), UTC(2019, 2, 19), UTC(2019, 2, 19)], // test7
    ]
    expected.forEach(([start, end, renderEnd], i) => {
      expect({ i, start: s.tasks[i]!.start, end: s.tasks[i]!.end, renderEnd: s.tasks[i]!.renderEnd })
        .toEqual({ i, start, end, renderEnd })
    })
  })

  test('excluding everything but one weekday still resolves (upstream not-throw case)', () => {
    // Previously ledgered as exclusions.json e4. 2019-02-01 is a Friday — the
    // only working weekday — so each week contributes exactly one working day.
    const s = scheduleOf(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends,monday,tuesday,wednesday,thursday
      weekend saturday
      section weekends skip test
        test1 :id1,2019-02-01,7d
    `)
    // (start, end] must contain exactly 7 working Fridays: 02-08 … 03-22.
    expect(s.tasks[0]!.start).toBe(UTC(2019, 2, 1))
    expect(s.tasks[0]!.end).toBe(UTC(2019, 3, 22))
  })
})
