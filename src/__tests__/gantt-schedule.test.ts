// Gantt scheduler unit tests (docs/design/families/gantt.md §3 scheduling rules):
// date/duration parsing, after/until resolution, excludes extension,
// includes override, inclusiveEndDates, structured errors (unknown refs,
// cycles named, missing first start, schedule overflow), explicit clock.
// All instants are UTC epoch ms — assertions use Date.UTC, never wall clock.

import { describe, test, expect } from 'bun:test'
import { parseGanttModel } from '../gantt/parser.ts'
import {
  resolveGanttSchedule, parseGanttDate, addGanttDuration, formatGanttInstant,
  buildExclusionPredicate, calendarFromModel, dayOfWeek, DAY_MS,
} from '../gantt/schedule.ts'
import { GanttError } from '../gantt/types.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

const UTC = (y: number, m: number, d: number, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm)

function scheduleOf(src: string, today?: string) {
  return resolveGanttSchedule(parseGanttModel(normalizeMermaidSource(src).lines), { today })
}

describe('parseGanttDate', () => {
  test.each([
    ['2024-01-15', 'YYYY-MM-DD', UTC(2024, 1, 15)],
    ['15/01/2024', 'DD/MM/YYYY', UTC(2024, 1, 15)],
    ['2024-01-15 13:45', 'YYYY-MM-DD HH:mm', UTC(2024, 1, 15, 13, 45)],
    ['17:49', 'HH:mm', UTC(1970, 1, 1, 17, 49)],
    ['24-1-5', 'YY-M-D', UTC(2024, 1, 5)],
  ])('%j with format %j', (raw, fmt, expected) => {
    expect(parseGanttDate(raw, fmt)).toBe(expected)
  })

  test('rejects mismatched and calendar-invalid dates', () => {
    expect(parseGanttDate('2024-13-01', 'YYYY-MM-DD')).toBeNull()
    expect(parseGanttDate('2024-02-30', 'YYYY-MM-DD')).toBeNull()
    expect(parseGanttDate('2024/01/01', 'YYYY-MM-DD')).toBeNull()
    expect(parseGanttDate('not a date', 'YYYY-MM-DD')).toBeNull()
    expect(parseGanttDate('2024-01-01extra', 'YYYY-MM-DD')).toBeNull()
  })

  test('leap day parses in a leap year only', () => {
    expect(parseGanttDate('2024-02-29', 'YYYY-MM-DD')).toBe(UTC(2024, 2, 29))
    expect(parseGanttDate('2023-02-29', 'YYYY-MM-DD')).toBeNull()
  })
})

describe('addGanttDuration', () => {
  const jan1 = UTC(2024, 1, 1)
  test.each([
    ['1d', jan1 + DAY_MS],
    ['2w', jan1 + 14 * DAY_MS],
    ['24h', jan1 + DAY_MS],
    ['90m', jan1 + 90 * 60_000],
    ['30s', jan1 + 30_000],
    ['500ms', jan1 + 500],
    ['1.5d', jan1 + 1.5 * DAY_MS],
  ])('%j adds a fixed span', (raw, expected) => {
    expect(addGanttDuration(jan1, raw)).toBe(expected)
  })

  test('calendar months clamp to the target month end', () => {
    expect(addGanttDuration(UTC(2024, 1, 31), '1M')).toBe(UTC(2024, 2, 29)) // leap Feb
    expect(addGanttDuration(UTC(2024, 1, 15), '1M')).toBe(UTC(2024, 2, 15))
    expect(addGanttDuration(UTC(2024, 1, 1), '1y')).toBe(UTC(2025, 1, 1))
  })

  test('invalid tokens return null', () => {
    expect(addGanttDuration(jan1, '5x')).toBeNull()
    expect(addGanttDuration(jan1, 'd')).toBeNull()
  })
})

describe('resolver — core rules', () => {
  test('explicit dates, durations, and inherited starts', () => {
    const s = scheduleOf(`gantt
      dateFormat YYYY-MM-DD
      A :a, 2024-01-01, 5d
      B :b, 2024-01-03, 2024-01-10
      C :3d
    `)
    expect(s.tasks[0]).toMatchObject({ start: UTC(2024, 1, 1), end: UTC(2024, 1, 6) })
    expect(s.tasks[1]).toMatchObject({ start: UTC(2024, 1, 3), end: UTC(2024, 1, 10), manualEnd: true })
    // C has no start: it begins at the previous task's (B's) end.
    expect(s.tasks[2]).toMatchObject({ start: UTC(2024, 1, 10), end: UTC(2024, 1, 13) })
  })

  test('after with multiple ids starts at the LATEST referenced end', () => {
    const s = scheduleOf(`gantt
      A :a, 2024-01-01, 3d
      B :b, 2024-01-01, 10d
      C :c, after a b, 2d
    `)
    expect(s.tasks[2]!.start).toBe(UTC(2024, 1, 11))
  })

  test('until ends at the referenced task start (earliest across refs)', () => {
    const s = scheduleOf(`gantt
      Release :rel, 2024-02-01, 1d
      Prep    :prep, 2024-01-20, until rel
    `)
    expect(s.tasks[1]).toMatchObject({ start: UTC(2024, 1, 20), end: UTC(2024, 2, 1) })
  })

  test('forward references resolve (until a later-defined task)', () => {
    const s = scheduleOf(`gantt
      Prep    :prep, 2024-01-20, until rel
      Release :rel, 2024-02-01, 1d
    `)
    expect(s.tasks[0]!.end).toBe(UTC(2024, 2, 1))
  })

  test('inclusiveEndDates extends explicit end dates by one day', () => {
    const base = scheduleOf('gantt\n  A :a, 2024-01-01, 2024-01-03')
    const incl = scheduleOf('gantt\n  inclusiveEndDates\n  A :a, 2024-01-01, 2024-01-03')
    expect(incl.tasks[0]!.end - base.tasks[0]!.end).toBe(DAY_MS)
  })

  test('milestones resolve like zero/short tasks', () => {
    const s = scheduleOf('gantt\n  M :milestone, m1, 2024-01-05, 0d')
    expect(s.tasks[0]).toMatchObject({ start: UTC(2024, 1, 5), end: UTC(2024, 1, 5) })
  })
})

describe('resolver — calendar exclusions', () => {
  test('excludes weekends extends working durations, never explicit ends', () => {
    // 2024-01-05 is a Friday: a 3d task starting Friday spans Sat+Sun → +2d.
    const dur = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-05, 3d')
    expect(dur.tasks[0]!.end).toBe(UTC(2024, 1, 10))
    const manual = scheduleOf('gantt\n  excludes weekends\n  A :a, 2024-01-05, 2024-01-08')
    expect(manual.tasks[0]!.end).toBe(UTC(2024, 1, 8)) // manual end respected
  })

  test('weekend friday shifts which days count as the weekend', () => {
    const cal = calendarFromModel(parseGanttModel(normalizeMermaidSource(
      'gantt\n  excludes weekends\n  weekend friday\n  A :a, 2024-01-01, 1d').lines))
    const excluded = buildExclusionPredicate(cal)
    expect(excluded(UTC(2024, 1, 5))).toBe(true)  // Friday
    expect(excluded(UTC(2024, 1, 6))).toBe(true)  // Saturday
    expect(excluded(UTC(2024, 1, 7))).toBe(false) // Sunday (not in friday-weekend)
  })

  test('explicit excluded dates and weekday names', () => {
    const cal = calendarFromModel(parseGanttModel(normalizeMermaidSource(
      'gantt\n  excludes 2024-01-15 friday\n  A :a, 2024-01-01, 1d').lines))
    const excluded = buildExclusionPredicate(cal)
    expect(excluded(UTC(2024, 1, 15))).toBe(true)  // explicit date (a Monday)
    expect(excluded(UTC(2024, 1, 12))).toBe(true)  // a Friday
    expect(excluded(UTC(2024, 1, 16))).toBe(false)
  })

  test('includes override excludes for explicit dates', () => {
    const cal = calendarFromModel(parseGanttModel(normalizeMermaidSource(
      'gantt\n  excludes weekends\n  includes 2024-01-06\n  A :a, 2024-01-01, 1d').lines))
    const excluded = buildExclusionPredicate(cal)
    expect(excluded(UTC(2024, 1, 6))).toBe(false) // Saturday, but included
    expect(excluded(UTC(2024, 1, 7))).toBe(true)  // Sunday still excluded
  })

  test('everything-excluded durations fail with GANTT_SCHEDULE_OVERFLOW, not a hang', () => {
    const src = `gantt
      excludes monday tuesday wednesday thursday friday saturday sunday
      A :a, 2024-01-01, 5d
    `
    expect(() => scheduleOf(src)).toThrow(/GANTT_SCHEDULE_OVERFLOW/)
  })
})

describe('resolver — structured errors', () => {
  function codeOf(src: string): string {
    try {
      scheduleOf(src)
    } catch (e) {
      if (e instanceof GanttError) return e.code
      throw e
    }
    return 'NO_ERROR'
  }

  test('unknown after/until refs are errors, not silent wall-clock fallbacks', () => {
    expect(codeOf('gantt\n  A :a, after ghost, 3d')).toBe('GANTT_UNKNOWN_TASK_REF')
    expect(codeOf('gantt\n  A :a, 2024-01-01, until ghost')).toBe('GANTT_UNKNOWN_TASK_REF')
  })

  test('dependency cycles are errors that NAME the cycle', () => {
    const src = 'gantt\n  A :a, after c, 1d\n  B :b, after a, 1d\n  C :c, after b, 1d'
    try {
      scheduleOf(src)
      throw new Error('expected cycle error')
    } catch (e) {
      expect(e).toBeInstanceOf(GanttError)
      const err = e as GanttError
      expect(err.code).toBe('GANTT_DEPENDENCY_CYCLE')
      for (const id of ['a', 'b', 'c']) expect(err.message).toContain(id)
    }
  })

  test('first task without a start is an error (no wall-clock default)', () => {
    expect(codeOf('gantt\n  A :3d')).toBe('GANTT_NO_START')
  })

  test('invalid dates and durations are errors', () => {
    expect(codeOf('gantt\n  A :a, 2024-13-99, 3d')).toBe('GANTT_BAD_DATE')
    expect(codeOf('gantt\n  A :a, 2024-01-01, 2024-88-88')).toBe('GANTT_BAD_DATE')
  })

  test('empty gantt is an error', () => {
    expect(codeOf('gantt\n  title Just a title')).toBe('GANTT_EMPTY')
  })
})

describe('resolver — clock and analysis', () => {
  test('today resolves only from the supplied clock; todayMarker off wins', () => {
    const plain = scheduleOf('gantt\n  A :a, 2024-01-01, 10d')
    expect(plain.today).toBeUndefined()
    const withClock = scheduleOf('gantt\n  A :a, 2024-01-01, 10d', '2024-01-05')
    expect(withClock.today).toBe(UTC(2024, 1, 5))
    const off = scheduleOf('gantt\n  todayMarker off\n  A :a, 2024-01-01, 10d', '2024-01-05')
    expect(off.today).toBeUndefined()
  })

  test('invalid clock value is a structured error', () => {
    expect(() => scheduleOf('gantt\n  A :a, 2024-01-01, 1d', 'banana')).toThrow(/GANTT_BAD_DATE/)
  })

  test('critical path covers the slack-free chain; slack measured for the rest', () => {
    const s = scheduleOf(`gantt
      A :a, 2024-01-01, 10d
      B :b, after a, 5d
      Side :side, 2024-01-01, 2d
    `)
    expect(s.analysis).toBeDefined()
    expect(s.analysis!.criticalPathTaskIds).toEqual(['a', 'b'])
    expect(s.analysis!.slackByTaskId.a).toBe(0)
    expect(s.analysis!.slackByTaskId.b).toBe(0)
    expect(s.analysis!.slackByTaskId.side).toBeGreaterThan(0)
    expect(s.analysis!.entryTaskIds).toEqual(['a', 'side'])
    expect(s.analysis!.sinkTaskIds).toEqual(['b', 'side'])
    expect(s.analysis!.projectStart).toBe(UTC(2024, 1, 1))
    expect(s.analysis!.projectEnd).toBe(UTC(2024, 1, 16))
  })

  test('no analysis without after dependencies (research-backed non-goal)', () => {
    const s = scheduleOf('gantt\n  A :a, 2024-01-01, 3d\n  B :b, 2024-01-02, 3d')
    expect(s.analysis).toBeUndefined()
  })
})

describe('formatGanttInstant (d3-format subset)', () => {
  const t = UTC(2024, 1, 5, 9, 7) // Friday 2024-01-05 09:07 UTC
  test.each([
    ['%Y-%m-%d', '2024-01-05'],
    ['%d/%m/%y', '05/01/24'],
    ['%b %Y', 'Jan 2024'],
    ['%A', 'Friday'],
    ['%a %e', 'Fri  5'],
    ['%H:%M', '09:07'],
    ['%I %p', '09 AM'],
    ['100%% done', '100% done'],
  ])('%j → %j', (fmt, expected) => {
    expect(formatGanttInstant(t, fmt)).toBe(expected)
  })

  test('dayOfWeek is anchored to the epoch (1970-01-01 = Thursday)', () => {
    expect(dayOfWeek(UTC(1970, 1, 1))).toBe(4)
    expect(dayOfWeek(UTC(2024, 1, 7))).toBe(0) // Sunday
  })
})
