import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { GanttError, type GanttCalendarToken, type GanttModel, type GanttWeekday } from '../gantt/types.ts'

const dayMs = 86_400_000
const sunday = Date.UTC(2024, 0, 7)
const weekdays: GanttWeekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const overflow = { code: 'GANTT_SCHEDULE_OVERFLOW', message: 'GANTT_SCHEDULE_OVERFLOW: Calendar exclusion walk exceeded 10000 days (is every day excluded?)', line: 17 }

function calendarModel(start: number, duration: number, excludes: GanttCalendarToken[], includes: GanttCalendarToken[] = []): GanttModel {
  return {
    dateFormat: 'x', inclusiveEndDates: false, topAxis: false, excludes, includes, weekendStart: 'saturday', weekStart: 'monday',
    sections: [{ taskIndexes: [0] }], clicks: [],
    tasks: [{ index: 0, id: 'task', label: 'Calendar task', tags: [], start: { kind: 'date', raw: String(start) }, end: { kind: 'duration', raw: `${duration}d` }, sectionIndex: 0, line: 17 }],
  }
}

// The original day-by-day contract, with native Date weekday arithmetic and
// caller-owned exclusion rules rather than the optimized calendar metadata.
function exactWalk(start: number, duration: number, excluded: (instant: number) => boolean): unknown {
  let cursor = start + dayMs, result = start + Math.round(duration * dayMs), renderEnd = result, invalid = false, steps = 0
  while (cursor <= result) {
    if (++steps > 10_000) return overflow
    if (!invalid) renderEnd = result
    invalid = excluded(cursor)
    if (invalid) result += dayMs
    cursor += dayMs
  }
  return { end: result, renderEnd }
}

function scheduled(model: GanttModel, enabled = true): unknown {
  return withPerformanceExperiments(enabled ? ['gantt-intervals'] : [], () => {
    try {
      const task = resolveGanttSchedule(model).tasks[0]!
      return { end: task.end, renderEnd: task.renderEnd }
    } catch (cause) {
      if (!(cause instanceof GanttError)) throw cause
      return { code: cause.code, message: cause.message, line: cause.line }
    }
  })
}

describe('weekly Gantt calendar experiment', () => {
  test('every weekly mask preserves exact end and renderEnd for every start weekday and fractional duration', () => {
    for (let mask = 0; mask < 128; mask++) {
      const excludes = weekdays.flatMap((day, index) => mask & 1 << index ? [{ kind: 'weekday' as const, day }] : [])
      const excluded = (instant: number): boolean => (mask & 1 << new Date(instant).getUTCDay()) !== 0
      for (let weekday = 0; weekday < 7; weekday++) {
        const start = sunday + weekday * dayMs + (weekday % 2 ? 0.375 * dayMs : 0)
        for (const duration of [0, 0.125, 0.999, 1, 1.5, 6, 7, 7.125, 15.25, 120.5]) {
          expect(scheduled(calendarModel(start, duration, excludes))).toEqual(exactWalk(start, duration, excluded))
        }
      }
    }
  }, 20_000)

  test('all weekly masks preserve the 10000-step boundary instead of bypassing the safety limit', () => {
    for (let mask = 0; mask < 128; mask++) {
      const excludes = weekdays.flatMap((day, index) => mask & 1 << index ? [{ kind: 'weekday' as const, day }] : [])
      const excluded = (instant: number): boolean => (mask & 1 << new Date(instant).getUTCDay()) !== 0
      const workDays = weekdays.filter((_, index) => !(mask & 1 << index)).length
      for (let weekday = 0; weekday < 7; weekday++) {
        const start = sunday + weekday * dayMs
        for (const extra of [0, 1, 4.25]) {
          const duration = workDays === 0 ? 1 + extra : workDays * 1428 + extra
          expect(scheduled(calendarModel(start, duration, excludes))).toEqual(exactWalk(start, duration, excluded))
        }
      }
    }
  }, 20_000)

  test('weekday and weekend includes override exclusions under either weekend policy', () => {
    for (const weekendStart of ['friday', 'saturday'] as const) {
      const excludedWeekend = weekendStart === 'friday' ? [5, 6] : [6, 0]
      const model = calendarModel(sunday + 0.375 * dayMs, 1000.25, [{ kind: 'weekends' }, { kind: 'weekday', day: 'monday' }], [{ kind: 'weekday', day: 'saturday' }])
      model.weekendStart = weekendStart
      const excluded = (instant: number): boolean => {
        const day = new Date(instant).getUTCDay()
        return day !== 6 && (day === 1 || excludedWeekend.includes(day))
      }
      expect(scheduled(model)).toEqual(exactWalk(sunday + 0.375 * dayMs, 1000.25, excluded))
      model.includes = [{ kind: 'weekends' }]
      expect(scheduled(model)).toEqual(exactWalk(sunday + 0.375 * dayMs, 1000.25, instant => new Date(instant).getUTCDay() === 1))
    }
  })

  test('explicit date exceptions retain the exact fallback, including dates outside the task interval', () => {
    const included = sunday + 6 * dayMs, extraExcluded = sunday + 10 * dayMs
    for (const outside of [false, true]) {
      const model = calendarModel(sunday, 1000.25, [{ kind: 'weekends' }, { kind: 'date', raw: String(outside ? sunday + 20_000 * dayMs : extraExcluded) }], [{ kind: 'date', raw: String(included) }])
      const excluded = (instant: number): boolean => {
        const dayStart = Math.floor(instant / dayMs) * dayMs
        return dayStart !== included && ((!outside && dayStart === extraExcluded) || [0, 6].includes(new Date(instant).getUTCDay()))
      }
      expect(scheduled(model)).toEqual(exactWalk(sunday, 1000.25, excluded))
      expect(scheduled(model)).toEqual(scheduled(model, false))
    }
  })

  test('manual ends bypass calendar extension and all-excluded nonempty walks keep their structured error', () => {
    const excludes = weekdays.map(day => ({ kind: 'weekday' as const, day }))
    const model = calendarModel(sunday, 20, excludes)
    expect(scheduled(model)).toEqual(overflow)
    model.tasks[0]!.end = { kind: 'date', raw: String(sunday + 20 * dayMs) }
    expect(scheduled(model)).toEqual({ end: sunday + 20 * dayMs, renderEnd: sunday + 20 * dayMs })
    const empty = calendarModel(sunday, 0.5, excludes)
    expect(scheduled(empty)).toEqual({ end: sunday + 0.5 * dayMs, renderEnd: sunday + 0.5 * dayMs })
  })
})
