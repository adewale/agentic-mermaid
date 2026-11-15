// Deterministic self-tests of the edit-arms scorer: no model is involved.
// Requires the pinned Mermaid 12.2.0 reference (`bun run reference:mermaid`,
// or MERMAID_REFERENCE_DIR). Run with `bun run test:edit-arms`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { loadCorpus } from './corpus.ts'
import { startOracle, type Oracle } from './oracle.ts'
import { decide, summarize, type ScoreRecord } from './run.ts'
import { extractMermaid, scoreEdit, type EditScore } from './score.ts'

const corpus = loadCorpus()
let oracle: Oracle
beforeAll(() => { oracle = startOracle() })
afterAll(() => oracle?.close())

const task = (id: string) => corpus.tasks.find(t => t.id === id) ?? (() => { throw new Error(`no task ${id}`) })()
const source = (taskId: string) => corpus.diagrams.get(task(taskId).diagram)!.text

/** Hand edit of the held-out source; independent of the scorer's patch code. */
function edit(taskId: string, ...changes: Array<[string, string]>): string {
  let out = source(taskId)
  for (const [find, replace] of changes) {
    if (out.split(find).length !== 2) throw new Error(`fixture text must occur once: ${find}`)
    out = out.replace(find, () => replace)
  }
  return out
}
const dropLines = (text: string, drop: (line: string, index: number) => boolean) =>
  text.split('\n').filter((line, i) => !drop(line, i + 1)).join('\n')

const score = (taskId: string, output: string | undefined) => scoreEdit(oracle, source(taskId), task(taskId), output)

describe('correct edits written differently from the reference score as success', () => {
  const cases: Array<[string, string, () => string, number?]> = [
    ['flowchart: new node inline in a chained edge, own class line', 'dotnet-local-service-principal.add-entra-step',
      () => edit('dotnet-local-service-principal.add-entra-step', ['    SP --> AS\n', '    SP --> Entra["Microsoft Entra ID"] --> AS\n']) + '    class Entra services\n'],
    ['sequence: note with different indentation', 'sk-mcp-oauth.add-cache-note',
      () => edit('sk-mcp-oauth.add-cache-note', ['    AuthServer-->>Client: Access token\n', '    AuthServer-->>Client: Access token\n  Note over Client: Cache token until expiry\n'])],
    ['sequence: alias rename that also declares the last participant', 'temporal-nexus-dispatch.rename-matching',
      () => edit('temporal-nexus-dispatch.rename-matching', ['sequenceDiagram\n', 'sequenceDiagram\n  participant Client\n  participant Frontend\n  participant Matching as Matching Service\n  participant Worker\n'])],
    ['er: relationship written from the other side matches the second accepted reference', 'retrospectives-frontend-erd.board-action-items',
      () => source('retrospectives-frontend-erd.board-action-items') + '    actionItem }o--|| feedbackBoard : has\n', 1],
    ['sequence: reply indented with spaces inside a tab-indented alt', 'cilium-bgp-reconcile.add-result-reply',
      () => edit('cilium-bgp-reconcile.add-result-reply', ['\t\tM ->> M: Reconcile configured BGP servers\n', '\t\tM ->> M: Reconcile configured BGP servers\n    M -->> C: Reconcile result\n'])],
    ['class: braces body and relation appended at the end', 'scarb-sources.add-cached-source',
      () => source('scarb-sources.add-cached-source') + '\n    class CachedSource {\n    }\n    CachedSource ..|> Source\n'],
    ['state: different id for the new state, description at the end', 'otel-stability-levels.add-rc',
      () => edit('otel-stability-levels.add-rc', ['    Beta --> Stable\n', '    Beta --> ReleaseCandidate\n    ReleaseCandidate --> Stable\n']) + 'ReleaseCandidate: Release candidate\n'],
    ['er: new attribute block at the end of the diagram', 'bcpt-test-suites.run-duration',
      () => source('bcpt-test-suites.run-duration') + '    "Test suite run" {\n        int duration_in_milliseconds\n    }\n'],
    ['gantt: same task with different column alignment', 'airflow-dagrun-metrics.add-queued-duration',
      () => edit('airflow-dagrun-metrics.add-queued-duration', ['    task_id.duration                : after taskN_start, 1h\n', '    task_id.duration                : after taskN_start, 1h\n    task_id.queued_duration : after taskN_sched, 1h\n'])],
  ]
  for (const [name, taskId, output, alternative] of cases) {
    test(name, async () => {
      const s = await score(taskId, output())
      expect({ parses: s.parses, intended: s.intended, collateral: s.collateral, success: s.success, missing: s.missing, unexpected: s.unexpected })
        .toEqual({ parses: true, intended: true, collateral: false, success: true, missing: [], unexpected: [] })
      expect(s.preservation!.untouched.rate).toBe(1)
      if (alternative !== undefined) expect(s.alternative).toBe(alternative)
    })
  }
})

test('returning the diagram unchanged fails the intended change for every task', async () => {
  const outcomes: Array<{ id: string; intended: boolean; collateral: boolean | null; success: boolean }> = []
  for (const t of corpus.tasks) {
    const s = await scoreEdit(oracle, corpus.diagrams.get(t.diagram)!.text, t, corpus.diagrams.get(t.diagram)!.text)
    outcomes.push({ id: t.id, intended: s.intended, collateral: s.collateral, success: s.success })
  }
  expect(outcomes.filter(o => o.intended || o.success || o.collateral !== false)).toEqual([])
  expect(outcomes.length).toBe(corpus.tasks.length)
})

describe('regeneration that drops source detail', () => {
  test('dropping comments and the init directive keeps the meaning but loses preservation', async () => {
    // dotnet-auth-environments: 32 non-blank lines; the rename edits line 25, leaving 31 untouched:
    // 10 comment lines (1-5, 14, 19, 24, 29, 35), 1 init directive (7), 9 style lines (30-33, 36, 38-41).
    const output = dropLines(edit('dotnet-auth-environments.rename-onprem', ['OnPremApp[On-premises server]', 'OnPremApp[On-premises or other cloud]']), line => /^\s*%%/.test(line))
    const s = await score('dotnet-auth-environments.rename-onprem', output)
    expect(s.success).toBe(true)
    expect(s.preservation).toEqual({
      untouched: { kept: 20, total: 31, rate: 20 / 31 },
      comments: { kept: 0, total: 10, rate: 0 },
      styles: { kept: 9, total: 9, rate: 1 },
      directives: { kept: 0, total: 1, rate: 0 },
    })
  })

  test('dropping style lines is collateral damage as well as lost preservation', async () => {
    // hugegraph-architecture: 25 non-blank lines, none edited by the reference; 3 are `style` lines.
    const output = dropLines(edit('hugegraph-architecture.add-hbase',
      ['            PD_HSTORE[PD + HStore<br/>Raft Cluster]\n', '            PD_HSTORE[PD + HStore<br/>Raft Cluster]\n            HBASE[(HBase<br/>Legacy)]\n'],
      ['    CORE --> PD_HSTORE\n', '    CORE --> PD_HSTORE\n    CORE --> HBASE\n']), line => /^\s*style /.test(line))
    const s = await score('hugegraph-architecture.add-hbase', output)
    expect({ intended: s.intended, collateral: s.collateral, success: s.success }).toEqual({ intended: true, collateral: true, success: false })
    expect(s.unexpected.sort()).toEqual(['-["style","Distributed","fill:#fff4e1"]', '-["style","Server","fill:#e1f5ff"]', '-["style","Standalone","fill:#f0f0f0"]'])
    expect(s.preservation!.untouched).toEqual({ kept: 22, total: 25, rate: 22 / 25 })
    expect(s.preservation!.styles).toEqual({ kept: 0, total: 3, rate: 0 })
  })
})

describe('edits that change something else register collateral damage', () => {
  const cases: Array<[string, string, () => string, string]> = [
    ['flowchart: requested rename plus an unrelated node rename', 'seatunnel-engine-choice.rename-spark',
      () => edit('seatunnel-engine-choice.rename-spark', ['spark["Use Spark Engine"]', 'spark["Use Spark Engine (2.x/3.x)"]'], ['flink["Use Flink Engine"]', 'flink["Use Apache Flink"]']),
      '+["label","flink","Use Apache Flink"]'],
    ['sequence: requested participant rename plus an unrelated participant rename', 'otel-pr-review-labels.rename-label-manager',
      () => edit('otel-pr-review-labels.rename-label-manager', ['participant L as label-manager', 'participant L as pr-labeler'], ['participant R as Reviewer', 'participant R as Maintainer']),
      '+["participantLabel","R","Maintainer"]'],
    ['sequence: requested message plus two unrelated messages swapped', 'dapr-workflow-fast-path.ack-commit-3',
      () => edit('dapr-workflow-fast-path.ack-commit-3',
        ['    W->>S: commit history, clear inbox (commit 3)\n', '    W->>S: commit history, clear inbox (commit 3)\n    S-->>W: ok\n'],
        ['    J->>A: trigger run-activity reminder\n    A->>P: run activity body\n', '    A->>P: run activity body\n    J->>A: trigger run-activity reminder\n']),
      '+["next","message","A","P","run activity body","→","message","J","A","trigger run-activity reminder"]'],
  ]
  for (const [name, taskId, output, expectedUnexpected] of cases) {
    test(name, async () => {
      const s = await score(taskId, output())
      expect({ intended: s.intended, collateral: s.collateral, damage: s.damage, success: s.success }).toEqual({ intended: true, collateral: true, damage: true, success: false })
      expect(s.unexpected).toContain(expectedUnexpected)
    })
  }
})

test('a new node outside the group the request names misses the intended change', async () => {
  const s = await score('cloudberry-segments.add-segment', edit('cloudberry-segments.add-segment', ['  end\n', '  end\n  S2["Segment 2<br/>Catalog + data shard"]:::s\n']))
  expect({ intended: s.intended, collateral: s.collateral, success: s.success }).toEqual({ intended: false, collateral: false, success: false })
  expect(s.missing).toEqual(['+["parent","+Segment 2\\nCatalog + data shard","SEGS"]'])
})

test('output Mermaid 12.2.0 cannot parse is damage, not success', async () => {
  const s = await score('sk-process-dapr.remove-b', 'flowchart LR\n    Kickoff --> A[unclosed\n')
  expect({ parses: s.parses, collateral: s.collateral, damage: s.damage, success: s.success }).toEqual({ parses: false, collateral: null, damage: true, success: false })
})

test('the scored source is the fence under "Updated Mermaid", with indentation kept', () => {
  const response = 'Original:\n```mermaid\nflowchart LR\n  A --> B\n```\n\nUpdated Mermaid\n\n```mermaid\n\n    gitGraph\n      commit\n```\n\nNotes\nDone.'
  expect(extractMermaid(response)).toBe('    gitGraph\n      commit\n')
  expect(extractMermaid('No diagram here.')).toBeUndefined()
})

describe('preregistered decision rule', () => {
  const record = (taskId: string, arm: 'A' | 'B', damage: boolean, success: boolean): ScoreRecord => ({
    requestId: `${taskId}--${arm}--r1`, taskId, diagram: taskId, family: 'flowchart', arm, run: 1, provider: 'p', model: 'm', captured: true, verbs: null, compliance: 'unobserved',
    score: { taskId, extracted: true, parses: true, intended: success, collateral: damage, damage, success, missing: [], unexpected: [], alternative: 0, preservation: null, strength: 'full', limitations: [] } satisfies EditScore,
  })
  const ids = Array.from({ length: 20 }, (_, i) => `case-${i}`)
  test('B with clearly less damage and no loss of success is SUPPORTED', () => {
    const records = ids.flatMap((id, i) => [record(id, 'A', i % 2 === 0, i % 2 !== 0), record(id, 'B', false, true)])
    expect(decide(summarize(records, ['A', 'B']))).toStartWith('SUPPORTED')
  })
  test('arms that behave the same are NOT SUPPORTED', () => {
    const records = ids.flatMap((id, i) => [record(id, 'A', i % 4 === 0, i % 4 !== 0), record(id, 'B', i % 4 === 0, i % 4 !== 0)])
    expect(decide(summarize(records, ['A', 'B']))).toStartWith('NOT SUPPORTED')
  })
})
