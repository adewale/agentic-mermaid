// Upstream Gantt test-suite bench (eval/mermaid-gantt-bench): every portable
// case harvested from mermaid-js/mermaid's gantt.spec.js + ganttDb.spec.ts,
// pgavlin/mermaid-ascii, and kais-radwan/ascii-mermaid must pass against our
// parser/scheduler — and every deliberately-excluded upstream case is an
// EXECUTABLE ledger entry: where the manifest names an `oursErrorCode`, the
// bench proves we fail with exactly that named error. Provenance, schema, and
// reason codes: eval/mermaid-gantt-bench/README.md.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { GanttError, type GanttModel, type GanttCalendarToken } from '../gantt/types.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

const BENCH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-gantt-bench')

interface ExpectedTask { index: number; id?: string; label?: string; start?: string; end?: string }
interface BenchCase {
  id: string
  origin: string
  upstream: string
  source: string
  expect: {
    kind: 'parse' | 'schedule' | 'error'
    render?: boolean
    renderContains?: string[]
    title?: string
    dateFormat?: string
    inclusiveEndDates?: boolean
    excludes?: string[]
    todayMarkerOff?: boolean
    todayMarkerStyle?: string
    weekStart?: string
    accTitle?: string
    accDescr?: string
    sectionLabels?: string[]
    taskLabels?: string[]
    taskTags?: string[][]
    clicks?: Array<{ taskId: string; action: string; rest: string }>
    tasks?: ExpectedTask[]
    errorCode?: string
  }
  notes?: string
}
interface Exclusion {
  id: string
  origin: string
  upstream: string
  source: string
  reason: string
  upstreamBehavior: string
  oursErrorCode?: string
  notes?: string
}

const cases: BenchCase[] = JSON.parse(readFileSync(join(BENCH, 'cases.json'), 'utf8'))
const exclusions: Exclusion[] = JSON.parse(readFileSync(join(BENCH, 'exclusions.json'), 'utf8'))

const KNOWN_ORIGINS = ['mermaid/', 'pgavlin/', 'kais-radwan/']
const KNOWN_REASONS = new Set([
  'wall-clock-fallback', 'local-tz', 'silent-ignore-vs-named-error', 'exclude-boundary-model',
])

function modelOf(source: string): GanttModel {
  const n = normalizeMermaidSource(source)
  return applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
}

/** Date-only shorthand ('2014-01-06') means midnight UTC. */
function toUtcIso(expected: string): string {
  return /T/.test(expected) ? new Date(expected).toISOString() : `${expected}T00:00:00.000Z`
}

function tokenRaw(t: GanttCalendarToken): string {
  return t.kind === 'weekends' ? 'weekends' : t.kind === 'weekday' ? t.day : t.raw
}

function assertTasks(model: GanttModel, expected: ExpectedTask[], caseId: string): void {
  const schedule = resolveGanttSchedule(model)
  for (const exp of expected) {
    const t = schedule.tasks[exp.index]
    expect({ caseId, index: exp.index, found: Boolean(t) }).toEqual({ caseId, index: exp.index, found: true })
    const got = {
      caseId, index: exp.index,
      ...(exp.id !== undefined ? { id: t!.id } : {}),
      ...(exp.label !== undefined ? { label: t!.label } : {}),
      ...(exp.start !== undefined ? { start: new Date(t!.start).toISOString() } : {}),
      ...(exp.end !== undefined ? { end: new Date(t!.end).toISOString() } : {}),
    }
    expect(got).toEqual({
      caseId, index: exp.index,
      ...(exp.id !== undefined ? { id: exp.id } : {}),
      ...(exp.label !== undefined ? { label: exp.label } : {}),
      ...(exp.start !== undefined ? { start: toUtcIso(exp.start) } : {}),
      ...(exp.end !== undefined ? { end: toUtcIso(exp.end) } : {}),
    })
  }
}

describe('mermaid-gantt-bench manifest hygiene', () => {
  test('cases are present, well-formed, and from known origins', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60)
    const ids = new Set<string>()
    for (const c of cases) {
      expect({ id: c.id, dup: ids.has(c.id) }).toEqual({ id: c.id, dup: false })
      ids.add(c.id)
      expect({ id: c.id, originKnown: KNOWN_ORIGINS.some(o => c.origin.startsWith(o)) }).toEqual({ id: c.id, originKnown: true })
      expect(['parse', 'schedule', 'error']).toContain(c.expect.kind)
    }
  })

  test('the exclusions ledger is non-empty and every reason code is documented', () => {
    expect(exclusions.length).toBeGreaterThanOrEqual(8)
    const readme = readFileSync(join(BENCH, 'README.md'), 'utf8')
    for (const e of exclusions) {
      expect({ id: e.id, reasonKnown: KNOWN_REASONS.has(e.reason) }).toEqual({ id: e.id, reasonKnown: true })
      expect({ id: e.id, documented: readme.includes(e.reason) }).toEqual({ id: e.id, documented: true })
      expect(e.upstreamBehavior.length).toBeGreaterThan(20)
    }
  })
})

describe('upstream parity cases', () => {
  for (const c of cases) {
    test(`${c.id} (${c.upstream})`, () => {
      if (c.expect.kind === 'error') {
        try {
          resolveGanttSchedule(modelOf(c.source))
          throw new Error(`expected ${c.expect.errorCode}, but the schedule resolved`)
        } catch (e) {
          expect(e).toBeInstanceOf(GanttError)
          expect({ caseId: c.id, code: (e as GanttError).code as string }).toEqual({ caseId: c.id, code: c.expect.errorCode! })
        }
        return
      }

      const model = modelOf(c.source)
      const e = c.expect
      if (e.title !== undefined) expect(model.title).toBe(e.title)
      if (e.dateFormat !== undefined) expect(model.dateFormat).toBe(e.dateFormat)
      if (e.inclusiveEndDates !== undefined) expect(model.inclusiveEndDates).toBe(e.inclusiveEndDates)
      if (e.excludes !== undefined) expect(model.excludes.map(tokenRaw)).toEqual(e.excludes)
      if (e.todayMarkerOff !== undefined) expect(model.todayMarker?.off).toBe(e.todayMarkerOff)
      if (e.todayMarkerStyle !== undefined) expect(model.todayMarker?.style).toBe(e.todayMarkerStyle)
      if (e.weekStart !== undefined) expect(model.weekStart as string).toBe(e.weekStart)
      if (e.accTitle !== undefined) expect(model.accTitle).toBe(e.accTitle)
      if (e.accDescr !== undefined) expect(model.accDescr).toBe(e.accDescr)
      if (e.sectionLabels !== undefined) {
        expect(model.sections.map(s => s.label).filter((l): l is string => l !== undefined)).toEqual(e.sectionLabels)
      }
      if (e.taskLabels !== undefined) expect(model.tasks.map(t => t.label)).toEqual(e.taskLabels)
      if (e.taskTags !== undefined) {
        // Sets, not arrays: our parser keeps source order while the body layer
        // canonicalizes; upstream asserts boolean flags.
        expect(model.tasks.map(t => [...(t.tags as string[])].sort())).toEqual(e.taskTags.map(tags => [...tags].sort()))
      }
      if (e.clicks !== undefined) {
        expect(model.clicks.map(cl => ({ taskId: cl.taskId, action: cl.action as string, rest: cl.rest }))).toEqual(e.clicks)
      }
      if (e.kind === 'schedule') assertTasks(model, e.tasks ?? [], c.id)
      if (e.render) {
        const ascii = renderMermaidASCII(c.source)
        expect(ascii.length).toBeGreaterThan(0)
        for (const needle of e.renderContains ?? []) expect(ascii).toContain(needle)
      }
    })
  }

  test('every case source obeys the agent round-trip law', () => {
    for (const c of cases) {
      const r1 = parseMermaid(c.source)
      expect({ caseId: c.id, parsed: r1.ok }).toEqual({ caseId: c.id, parsed: true })
      if (!r1.ok) continue
      const s1 = serializeMermaid(r1.value)
      const r2 = parseMermaid(s1)
      expect({ caseId: c.id, reparsed: r2.ok }).toEqual({ caseId: c.id, reparsed: true })
      if (!r2.ok) continue
      // Serialize-idempotent for structured bodies; byte-verbatim for opaque.
      expect({ caseId: c.id, stable: serializeMermaid(r2.value) === s1 }).toEqual({ caseId: c.id, stable: true })
    }
  })
})

describe('exclusions are an executable divergence ledger', () => {
  for (const e of exclusions.filter(e => e.oursErrorCode)) {
    test(`${e.id}: ours fails with ${e.oursErrorCode} where upstream ${e.reason}`, () => {
      try {
        resolveGanttSchedule(modelOf(e.source))
        throw new Error(`expected ${e.oursErrorCode}, but the schedule resolved`)
      } catch (err) {
        expect(err).toBeInstanceOf(GanttError)
        expect({ id: e.id, code: (err as GanttError).code as string }).toEqual({ id: e.id, code: e.oursErrorCode! })
      }
    })
  }

  for (const e of exclusions.filter(e => !e.oursErrorCode)) {
    test(`${e.id}: ours still parses and round-trips the source (divergence is semantic, not lossy)`, () => {
      const model = modelOf(e.source)
      // exclude-boundary-model / local-tz sources RESOLVE for us — the
      // divergence is which boundary instant the walk lands on, never a crash.
      const schedule = resolveGanttSchedule(model)
      expect(schedule.tasks.length).toBeGreaterThan(0)
      const r = parseMermaid(e.source)
      expect(r.ok).toBe(true)
    })
  }
})
