// Gantt agent surface (docs/design/gantt.md §Test tiers, agent row):
// parseMermaid detects kind:'gantt'; the segment-preserving structured body
// keeps directives/click/comment lines VERBATIM while exposing typed ops on
// title/sections/tasks; serialize is idempotent; every declared op
// round-trips through mutate; whole-opaque fallbacks round-trip
// byte-verbatim; fast-check round-trip property; verify warnings
// (EMPTY_DIAGRAM / LABEL_OVERFLOW / EDGE_MISANCHORED); capabilities and a
// differential check against the renderer-grade parser.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { describeMermaid } from '../agent/describe.ts'
import { asGantt } from '../agent/types.ts'
import type { GanttValidDiagram, GanttMutationOp } from '../agent/types.ts'
import { MUTATION_OPS_BY_FAMILY, buildCapabilities } from '../cli/index.ts'
import { parseGanttModel } from '../gantt/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { layoutMermaid, renderMermaidASCIIWithMeta } from '../agent/index.ts'
import { ganttGeometryWarnings } from '../agent/family-layouts.ts'

const SRC = `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
    Core engine :core, 2024-01-01, 10d
    Polish :pol, after core, 5d
  section Ship
    Release :milestone, rel, after pol, 0d
  click core href "https://example.com/core"
`

function gantt(src: string = SRC): GanttValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const g = asGantt(r.value)
  if (!g) throw new Error('not a structured gantt: ' + r.value.body.kind)
  return g
}

function apply(d: GanttValidDiagram, op: GanttMutationOp): GanttValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

// Internal section/task ids are parse-order counters ("stable within one
// parse; not a durable identifier"), so post-mutation re-parse comparisons
// use the durable shape: labels, Mermaid taskIds, tags, dates, statements.
function shape(d: GanttValidDiagram) {
  return {
    title: d.body.title,
    sections: d.body.sections.map(s => ({
      label: s.label,
      tasks: s.tasks.map(({ id: _id, ...rest }) => rest),
    })),
    statements: d.body.statements,
  }
}

describe('gantt structured parse', () => {
  test('detects kind gantt and models title/sections/tasks', () => {
    const d = gantt()
    expect(d.kind).toBe('gantt')
    expect(d.body.kind).toBe('gantt')
    expect(d.body.title).toBe('Release plan')
    expect(d.body.sections.map(s => s.label)).toEqual(['Build', 'Ship'])
    expect(d.body.sections[0]!.tasks.map(t => t.label)).toEqual(['Core engine', 'Polish'])
    expect(d.body.sections[0]!.tasks[0]).toMatchObject({ taskId: 'core', start: '2024-01-01', end: '10d' })
    expect(d.body.sections[0]!.tasks[1]).toMatchObject({ start: 'after core', end: '5d' })
    expect(d.body.sections[1]!.tasks[0]!.tags).toEqual(['milestone'])
  })

  test('directives, click lines, and comments ride along as verbatim opaque segments', () => {
    const d = gantt()
    const opaque = d.body.statements!.filter(s => s.kind === 'opaque-block').flatMap(s => s.kind === 'opaque-block' ? s.lines : [])
    expect(opaque).toContain('  dateFormat YYYY-MM-DD')
    expect(opaque).toContain('  excludes weekends')
    expect(opaque).toContain('  click core href "https://example.com/core"')
    // ...and serialization re-emits them byte-verbatim, in position.
    const out = serializeMermaid(d)
    expect(out).toContain('  dateFormat YYYY-MM-DD\n')
    expect(out).toContain('  excludes weekends\n')
    expect(out).toContain('  click core href "https://example.com/core"\n')
    expect(out.indexOf('dateFormat')).toBeLessThan(out.indexOf('section Build'))
  })

  test('serialize is idempotent and bodies are equal across cycles', () => {
    const d = gantt()
    const s1 = serializeMermaid(d)
    const d2 = gantt(s1)
    expect(serializeMermaid(d2)).toBe(s1)
    expect(d2.body).toEqual(d.body)
  })

  test('tasks before any section land in an implicit unlabeled section', () => {
    const d = gantt('gantt\n  Loose :l1, 2024-01-01, 2d\n  section Named\n    Inside :i1, after l1, 1d')
    expect(d.body.sections).toHaveLength(2)
    expect(d.body.sections[0]!.label).toBeUndefined()
    expect(d.body.sections[0]!.tasks[0]!.label).toBe('Loose')
  })
})

describe('gantt whole-opaque fallback (structure-level failures)', () => {
  const opaqueCases: Array<[string, string]> = [
    ['header suffix', 'gantt LR\n  Task :t1, 2024-01-01, 1d'],
    ['duplicate task ids', 'gantt\n  A :x, 2024-01-01, 1d\n  B :x, 2024-01-02, 1d'],
    ['unclosed accDescr block', 'gantt\n  accDescr {\n    never closed\n  Task :t1, 2024-01-01, 1d'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips byte-verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asGantt(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }

  test('a malformed task line stays a verbatim opaque segment (not dropped, not whole-opaque)', () => {
    const src = 'gantt\n  Good :g1, 2024-01-01, 2d\n  Broken : a, b, c, d, e\n  Also good :g2, after g1, 1d'
    const d = gantt(src)
    expect(d.body.sections[0]!.tasks.map(t => t.taskId)).toEqual(['g1', 'g2'])
    expect(serializeMermaid(d)).toContain('  Broken : a, b, c, d, e\n')
  })
})

describe('gantt mutation ops (every declared op round-trips)', () => {
  test('declared op list matches the implementation surface', () => {
    expect([...MUTATION_OPS_BY_FAMILY.gantt]).toEqual([
      'set_title', 'add_section', 'rename_section', 'remove_section',
      'add_task', 'remove_task', 'rename_task', 'set_task_status', 'set_task_dates',
    ])
    const cap = buildCapabilities().families.find(f => f.id === 'gantt')
    expect(cap).toMatchObject({ hasMutate: true, editPolicy: 'structured-when-narrowed' })
    expect(cap!.mutationOps).toEqual([...MUTATION_OPS_BY_FAMILY.gantt])
  })

  test('set_title sets and clears', () => {
    expect(apply(gantt(), { kind: 'set_title', title: 'New plan' }).body.title).toBe('New plan')
    const cleared = apply(gantt(), { kind: 'set_title', title: null })
    expect(cleared.body.title).toBeUndefined()
    expect(cleared.canonicalSource).not.toContain('title')
  })

  test('add_section / rename_section / remove_section', () => {
    let d = apply(gantt(), { kind: 'add_section', label: 'QA' })
    expect(d.body.sections.map(s => s.label)).toEqual(['Build', 'Ship', 'QA'])
    d = apply(d, { kind: 'rename_section', index: 2, label: 'Verification' })
    expect(d.body.sections[2]!.label).toBe('Verification')
    expect(d.canonicalSource).toContain('section Verification')
    d = apply(d, { kind: 'remove_section', index: 0 })
    expect(d.body.sections.map(s => s.label)).toEqual(['Ship', 'Verification'])
    // Removing the section removed its tasks AND their statements.
    expect(d.canonicalSource).not.toContain('Core engine')
    expect(shape(gantt(d.canonicalSource))).toEqual(shape(d))
  })

  test('add_task appends inside the right section even with directives interleaved', () => {
    const d = apply(gantt(), { kind: 'add_task', sectionIndex: 0, label: 'Docs', taskId: 'docs', start: 'after core', end: '3d' })
    const out = d.canonicalSource
    expect(out.indexOf('Docs')).toBeGreaterThan(out.indexOf('Polish'))
    expect(out.indexOf('Docs')).toBeLessThan(out.indexOf('section Ship'))
    expect(shape(gantt(out))).toEqual(shape(d))
  })

  test('add_task with tags and no start (inherit previous end)', () => {
    const d = apply(gantt(), { kind: 'add_task', sectionIndex: 1, label: 'Retro', tags: ['done'], end: '1d' })
    const t = d.body.sections[1]!.tasks.find(t => t.label === 'Retro')!
    expect(t.tags).toEqual(['done'])
    expect(t.start).toBeUndefined()
    expect(d.canonicalSource).toContain('Retro :done, 1d')
  })

  test('remove_task / rename_task / set_task_status / set_task_dates', () => {
    let d = apply(gantt(), { kind: 'rename_task', sectionIndex: 0, taskIndex: 0, label: 'Engine room' })
    expect(d.body.sections[0]!.tasks[0]!.label).toBe('Engine room')
    d = apply(d, { kind: 'set_task_status', sectionIndex: 0, taskIndex: 0, status: 'done' })
    expect(d.body.sections[0]!.tasks[0]!.tags).toEqual(['done'])
    d = apply(d, { kind: 'set_task_status', sectionIndex: 0, taskIndex: 0, status: null })
    expect(d.body.sections[0]!.tasks[0]!.tags).toEqual([])
    // Status never disturbs structural tags.
    d = apply(d, { kind: 'set_task_status', sectionIndex: 1, taskIndex: 0, status: 'crit' })
    expect(d.body.sections[1]!.tasks[0]!.tags).toEqual(['crit', 'milestone'])
    d = apply(d, { kind: 'set_task_dates', sectionIndex: 0, taskIndex: 0, start: '2024-02-01', end: '4d' })
    expect(d.body.sections[0]!.tasks[0]).toMatchObject({ start: '2024-02-01', end: '4d' })
    d = apply(d, { kind: 'set_task_dates', sectionIndex: 0, taskIndex: 1, start: null })
    expect(d.body.sections[0]!.tasks[1]!.start).toBeUndefined()
    d = apply(d, { kind: 'remove_task', sectionIndex: 0, taskIndex: 1 })
    expect(d.body.sections[0]!.tasks).toHaveLength(1)
    expect(shape(gantt(d.canonicalSource))).toEqual(shape(d))
  })

  test('error paths: not-found, duplicates, values that cannot round-trip', () => {
    const cases: Array<[GanttMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_section', index: 9 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'rename_section', index: 9, label: 'X' }, 'SECTION_NOT_FOUND'],
      [{ kind: 'remove_task', sectionIndex: 0, taskIndex: 9 }, 'TASK_NOT_FOUND'],
      [{ kind: 'add_task', sectionIndex: 9, label: 'X', end: '1d' }, 'SECTION_NOT_FOUND'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'X', taskId: 'core', end: '1d' }, 'DUPLICATE_TASK'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'Has : colon', end: '1d' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'X', end: 'has, comma' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'X', taskId: 'bad id', end: '1d' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'X', end: '' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, label: 'section trap', end: '1d' }, 'INVALID_OP'],
      [{ kind: 'rename_task', sectionIndex: 0, taskIndex: 0, label: 'title trap' }, 'INVALID_OP'],
      [{ kind: 'set_title', title: '' }, 'INVALID_OP'],
      [{ kind: 'add_section', label: 'with : colon' }, 'INVALID_OP'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(gantt(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = gantt()
    apply(d, { kind: 'rename_task', sectionIndex: 0, taskIndex: 0, label: 'Changed' })
    expect(d.body.sections[0]!.tasks[0]!.label).toBe('Core engine')
  })
})

describe('gantt verify', () => {
  test('healthy diagram verifies clean; layout is the real gantt geometry', () => {
    const v = verifyMermaid(gantt())
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(0)
    expect(v.layout.nodes.length).toBe(3)
    expect(v.layout.groups.length).toBe(2)
    expect(layoutMermaid(gantt()).nodes.length).toBe(3)
  })

  test('EMPTY_DIAGRAM on a header-only gantt', () => {
    const v = verifyMermaid('gantt')
    expect(v.ok).toBe(false)
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
  })

  test('LABEL_OVERFLOW on long title/section/task labels', () => {
    const long = 'X'.repeat(60)
    const v = verifyMermaid(gantt(`gantt\n  title ${long}\n  section ${long}\n    ${long} :t1, 2024-01-01, 1d`))
    const targets = v.warnings.filter(w => w.code === 'LABEL_OVERFLOW')
    expect(targets.length).toBe(3)
  })

  test('EDGE_MISANCHORED on unknown after/until refs, quiet on known ones', () => {
    const bad = verifyMermaid(gantt('gantt\n  A :a, 2024-01-01, 2d\n  B :b, after ghost, 1d'))
    expect(bad.warnings.map(w => w.code)).toContain('EDGE_MISANCHORED')
    const ok = verifyMermaid(gantt('gantt\n  A :a, 2024-01-01, 2d\n  B :b, after a, 1d'))
    expect(ok.warnings).toHaveLength(0)
    // An id defined on a malformed (opaque) task line is still "known".
    const partial = verifyMermaid(gantt('gantt\n  Broken : x, y, z, w, v\n  B :b, after x, 1d'))
    expect(partial.warnings.map(w => w.code)).not.toContain('EDGE_MISANCHORED')
  })
})

describe('gantt describe', () => {
  test('prose covers sections, tasks, schedule range, and the critical path', () => {
    const text = describeMermaid(gantt())
    expect(text).toContain('Gantt chart')
    expect(text).toContain('Release plan')
    expect(text).toContain('Build')
    expect(text).toContain('Critical path: core -> pol -> rel')
    expect(text).toContain('2024-01-01')
  })

  test('AX tree exposes tasks as nodes, dependencies as edges, entries and sinks', () => {
    const tree = JSON.parse(describeMermaid(gantt(), { format: 'json' }))
    expect(tree.kind).toBe('gantt')
    expect(tree.nodes.map((n: { id: string }) => n.id)).toEqual(['core', 'pol', 'rel'])
    expect(tree.edges).toEqual([
      { from: 'core', to: 'pol', label: 'after' },
      { from: 'pol', to: 'rel', label: 'after' },
    ])
    expect(tree.entryPoints).toEqual(['core'])
    expect(tree.sinks).toEqual(['rel'])
  })
})

describe('gantt round-trip property (generated diagrams)', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,16}[A-Za-z0-9]$/)
    .filter(l => !/^(section|title|dateFormat|axisFormat|excludes|includes|click|gantt|todayMarker|weekday|weekend|tickInterval|inclusiveEndDates|topAxis|accTitle|accDescr)\b/i.test(l))
  const idArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
  const tagArb = fc.subarray(['active', 'done', 'crit', 'milestone'] as const, { minLength: 0, maxLength: 2 })
  const dayArb = fc.integer({ min: 1, max: 28 })
  const durArb = fc.oneof(
    fc.integer({ min: 1, max: 30 }).map(n => `${n}d`),
    fc.integer({ min: 1, max: 8 }).map(n => `${n}w`),
  )

  const diagramArb = fc.record({
    title: fc.option(labelArb, { nil: undefined }),
    sections: fc.array(fc.record({
      label: labelArb,
      tasks: fc.uniqueArray(fc.record({ label: labelArb, id: idArb, tags: tagArb, day: dayArb, dur: durArb }), {
        minLength: 1, maxLength: 4, selector: t => t.id,
      }),
    }), { minLength: 1, maxLength: 3 }),
  }).map(({ title, sections }) => {
    const lines = ['gantt']
    if (title) lines.push(`  title ${title}`)
    lines.push('  dateFormat YYYY-MM-DD')
    const seen = new Set<string>()
    for (const s of sections) {
      lines.push(`  section ${s.label}`)
      for (const t of s.tasks) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        const tags = t.tags.length ? `${t.tags.join(', ')}, ` : ''
        lines.push(`  ${t.label} :${tags}${t.id}, 2024-01-${String(t.day).padStart(2, '0')}, ${t.dur}`)
      }
    }
    return lines.join('\n') + '\n'
  })

  test('parse → serialize → parse is body-identical and serialize-idempotent', () => {
    fc.assert(fc.property(diagramArb, src => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('gantt')
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(s1)
      expect(r2.value.body).toEqual(r.value.body)
    }), { numRuns: 60 })
  })
})

describe('gantt UNRESOLVABLE_SCHEDULE (closes the verify-ok/render-throws seam)', () => {
  // Found via the upstream bench: mermaid's parser accepts `excludes weekdays`
  // and silently ignores it; we render-error — but verify used to stay silent.
  test('a parseable-but-unschedulable diagram flips verify.ok with the named reason', () => {
    const v = verifyMermaid(gantt('gantt\n  dateFormat YYYY-MM-DD\n  excludes weekdays 2019-02-01\n  A :a, 2019-02-04, 3d'))
    expect(v.ok).toBe(false)
    const w = v.warnings.find(w => w.code === 'UNRESOLVABLE_SCHEDULE') as { code: string; reason: string } | undefined
    expect(w).toBeDefined()
    expect(w!.reason).toContain('GANTT_BAD_DATE')
  })

  test('a dependency cycle among known ids surfaces (EDGE_MISANCHORED cannot catch it)', () => {
    const v = verifyMermaid(gantt('gantt\n  A :a, after c, 1d\n  B :b, after a, 1d\n  C :c, after b, 1d'))
    expect(v.ok).toBe(false)
    const w = v.warnings.find(w => w.code === 'UNRESOLVABLE_SCHEDULE') as { code: string; reason: string } | undefined
    expect(w!.reason).toContain('GANTT_DEPENDENCY_CYCLE')
  })

  test('a task-less gantt maps to EMPTY_DIAGRAM, not UNRESOLVABLE_SCHEDULE', () => {
    const v = verifyMermaid(gantt('gantt\n  title Just a title\n  dateFormat YYYY-MM-DD'))
    expect(v.ok).toBe(false)
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.warnings.map(w => w.code)).not.toContain('UNRESOLVABLE_SCHEDULE')
  })

  test('healthy diagrams and the suppress knob behave', () => {
    expect(verifyMermaid(gantt()).warnings.map(w => w.code)).not.toContain('UNRESOLVABLE_SCHEDULE')
    const suppressed = verifyMermaid(
      gantt('gantt\n  excludes weekdays\n  A :a, 2019-02-04, 3d'),
      { suppress: ['UNRESOLVABLE_SCHEDULE'] },
    )
    expect(suppressed.ok).toBe(true)
  })
})

describe('gantt geometric tripwires (issue #26 WS11)', () => {
  // The layout contains bars by construction (property-tested), so on real
  // diagrams these stay silent; the validator itself is proven reachable with
  // hand-built layouts (a validator nothing can trigger is dead code).
  test('healthy diagram: no OFF_CANVAS / GROUP_BREACH from the geometry pass', () => {
    const v = verifyMermaid(gantt())
    expect(v.warnings.filter(w => w.code === 'OFF_CANVAS' || w.code === 'GROUP_BREACH')).toEqual([])
  })

  test('a bar outside the canvas raises OFF_CANVAS per axis', () => {
    const layout = layoutMermaid(gantt())
    const doctored = {
      ...layout,
      nodes: layout.nodes.map((n, i) => i === 0 ? { ...n, x: (layout.bounds.w + 10) as typeof n.x, y: -50 as typeof n.y } : n),
    }
    const codes = ganttGeometryWarnings(doctored)
    expect(codes).toContainEqual({ code: 'OFF_CANVAS', target: 'core', axis: 'x' })
    expect(codes).toContainEqual({ code: 'OFF_CANVAS', target: 'core', axis: 'y' })
  })

  test('a bar escaping its section band raises GROUP_BREACH', () => {
    const layout = layoutMermaid(gantt())
    const band = layout.groups[0]!
    const doctored = {
      ...layout,
      nodes: layout.nodes.map(n => n.id === 'core' ? { ...n, y: (band.y + band.h + 100) as typeof n.y } : n),
    }
    const warnings = ganttGeometryWarnings(doctored)
    expect(warnings).toContainEqual({ code: 'GROUP_BREACH', group: 'section#0', member: 'core' })
  })
})

describe('gantt ASCII regions (issue #26 WS10)', () => {
  test('renderMermaidASCIIWithMeta exposes section and task regions keyed by Mermaid task id', () => {
    const { ascii, regions } = renderMermaidASCIIWithMeta(SRC)
    expect(ascii).toContain('Core engine')
    const byId = new Map(regions.map(r => [r.id, r]))
    for (const id of ['core', 'pol', 'rel']) {
      const region = byId.get(id)
      expect({ id, found: Boolean(region) }).toEqual({ id, found: true })
      // The region points at the label text in the rendered grid.
      const line = ascii.split('\n')[region!.canvasRow]!
      expect(line.slice(region!.canvasColStart, region!.canvasColEnd)).toBe(
        id === 'core' ? 'Core engine' : id === 'pol' ? 'Polish' : 'Release')
    }
    expect(regions.some(r => byId.get('core') === r && r.kind === 'node')).toBe(true)
  })
})

describe('gantt CLI mutate dispatch', () => {
  // Regression: mutateAny in src/cli/index.ts keeps its own narrower chain;
  // a new family that misses it returns UNSUPPORTED_FAMILY from `am mutate`
  // even though the library mutate works.
  test('am mutate applies a gantt op end-to-end', () => {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const { writeFileSync, mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'am-gantt-'))
    try {
      const file = join(dir, 'g.mmd')
      writeFileSync(file, 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 10d\n')
      const r = spawnSync('bun', ['run', join(import.meta.dir, '..', '..', 'bin', 'am.ts'), 'mutate', file,
        '--op', '{"kind":"add_task","sectionIndex":0,"label":"Ship","taskId":"ship","start":"after core","end":"2d"}'], { encoding: 'utf8' })
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
      expect(r.stdout).toContain('Ship :ship, after core, 2d')
      expect(r.stdout).toContain('dateFormat YYYY-MM-DD')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('gantt differential vs renderer-grade parser', () => {
  test('the canonical source the body serializer emits re-parses identically under parseGanttModel', () => {
    const d = gantt()
    const out = serializeMermaid(d)
    const model = parseGanttModel(normalizeMermaidSource(out).lines)
    expect(model.title).toBe(d.body.title)
    expect(model.sections.filter(s => s.label !== undefined).map(s => s.label))
      .toEqual(d.body.sections.filter(s => s.label !== undefined).map(s => s.label))
    expect(model.tasks.map(t => t.label)).toEqual(d.body.sections.flatMap(s => s.tasks.map(t => t.label)))
    expect(model.tasks.map(t => t.id)).toEqual(d.body.sections.flatMap(s => s.tasks.map(t => t.taskId)))
  })
})
