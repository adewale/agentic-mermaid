import { describe, expect, test } from 'bun:test'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { mutateGitGraph, parseGitGraphBody, renderGitGraphBody, verifyGitGraph } from '../agent/gitgraph-body.ts'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { GitGraphBody, GitGraphMutationOp, MutationError, Result } from '../agent/types.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const BASE = `gitGraph
  commit id:"base" msg:"Foundation"
  branch feature order:2
  commit id:"feat" type:HIGHLIGHT tag:"alpha"
  checkout main
  commit id:"main2"
  merge feature id:"merge" tag:"v1"
  branch side
  checkout side
  commit id:"side1"
  checkout main
`

function body(): GitGraphBody {
  return parseGitGraphBody(BASE)
}

function apply(op: GitGraphMutationOp, input = body()): GitGraphBody {
  const result = mutateGitGraph(input, op)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function expectError(op: GitGraphMutationOp, code: MutationError['code'], message: string, input = body()): void {
  const result = mutateGitGraph(input, op)
  expect(result).toEqual({ ok: false, error: { code, message } })
}

function commit(input: GitGraphBody, id: string) {
  return input.commits.find(item => item.id === id)
}

describe('GitGraph typed operations — discriminating replay contract', () => {
  test('quoted payloads use the pinned STRING codec through save, public parsing and independent edits', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [raw, expected] of [
        ['x\n%%y', 'x\n%%y'],
        ['x\u2028%%y', 'x\u2028%%y'],
        ['x\u2029%%y', 'x\u2029%%y'],
        [String.raw`x\n%%y`, 'x\n%%y'],
        [String.raw`x\\n%%y`, String.raw`x\n%%y`],
        [String.raw`x\b\f\n\r\t\v\0y`, 'x\b\f\n\r\t\v\0y'],
        [String.raw`x\q\u0041\x41y`, 'xqu0041x41y'],
        [String.raw`x\%\%{literal}\%\%`, 'x%%{literal}%%'],
        [String.raw`x\"\'y`, 'x"\'y'],
        [String.raw`#0\; #b\; #n\; #t\; #amp\; #35\; #quot\;`, '#0; #b; #n; #t; #amp; #35; #quot;'],
        [String.raw`sty\le a:#abc; class\Def a:#123;`, 'style a:#abc; classDef a:#123;'],
      ] satisfies Array<[string, string]>) {
        for (const delimiter of ['"', "'"]) {
          const source = `gitGraph\ncommit id:${delimiter}${raw}${delimiter} msg:${delimiter}${raw}${delimiter} tag:${delimiter}${raw}${delimiter}\ncommit id:"next"`
          const parsed = parseRegisteredMermaid(source)
          if (!parsed.ok || parsed.value.body.kind !== 'gitgraph') throw new Error('Expected structured GitGraph')
          const expectedCommit = { id: expected, message: expected, tags: [expected], parents: [] }
          expect(parsed.value.body.commits[0]).toMatchObject(expectedCommit)
          expect(parsed.value.body.commits[1]?.parents).toEqual([expected])
          const saved = serializeMermaid(parsed.value)
          const reloaded = parseRegisteredMermaid(saved)
          if (!reloaded.ok) throw new Error('Expected reload')
          expect(reloaded.value.body).toEqual(parsed.value.body)
          if (!/[\0\b\f\r\v]/.test(expected)) expect(renderMermaidSVG(saved)).toBe(renderMermaidSVG(parsed.value))
          expect(verifyMermaid(parsed.value).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
          expect(await upstream.project(saved, d => [...d.db.getCommits().values()].map(c => ({ id: c.id, message: c.message, tags: c.tags, parents: c.parents })))).toEqual({ ok: true, value: [expectedCommit, { id: 'next', message: '', tags: [], parents: [expected] }] })
          const edited = mutate(parsed.value, { kind: 'append_commit', id: 'tail\n%%comment', message: expected, tags: [expected] })
          if (!edited.ok || edited.value.body.kind !== 'gitgraph') throw new Error('Expected independent append')
          expect(edited.value.body.commits[0]).toEqual(parsed.value.body.commits[0])
          expect(edited.value.body.commits.at(-1)).toMatchObject({ id: 'tail\n%%comment', message: expected, tags: [expected], parents: ['next'] })
          expect(await upstream.project(serializeMermaid(edited.value), d => [...d.db.getCommits().values()].at(-1).id)).toEqual({ ok: true, value: 'tail\n%%comment' })
        }
      }
      // Generous bare tokens are not STRINGs: incomplete delimiters and
      // escape endings retain their literal authored bytes until quoted.
      for (const raw of ['"', "'", '"unfinished', "'unfinished", '"tail\\', "'tail\\", '"escaped\\"', "'escaped\\'", 'tail\\']) {
        const parsed = parseRegisteredMermaid(`gitGraph commit id:${raw}`)
        if (!parsed.ok || parsed.value.body.kind !== 'gitgraph') throw new Error('Expected readable bare-token extension')
        expect(parsed.value.body.commits[0]?.id).toBe(raw)
        const edited = mutate(parsed.value, { kind: 'append_commit', id: 'next' })
        if (!edited.ok) throw new Error(edited.error.message)
        const saved = serializeMermaid(edited.value)
        const reloaded = parseRegisteredMermaid(saved)
        expect(reloaded.ok && reloaded.value.body).toEqual(edited.value.body)
        expect(renderMermaidSVG(parsed.value)).toContain('<svg')
        expect(await upstream.project(saved, d => [...d.db.getCommits().values()].map(c => ({ id: c.id, parents: c.parents })))).toEqual({ ok: true, value: [{ id: raw, parents: [] }, { id: 'next', parents: [raw] }] })
      }
    } finally { upstream.close() }
  })

  test('branch spelling preserves identities and references through native drawing and portable export', async () => {
    const upstream = startUpstreamMermaid()
    try {
      // Numeric prefixes, reference punctuation, and reserved tokens all need
      // quoting. Neighbouring portable names must retain the same identities.
      for (const name of ['1', '01', '1a', '-dev', '/dev', '.dev', 'dev/', 'dev.', 'titleWorker', 'NORMAL', 'LR', 'gitGraph', '_1', 'true', 'dev-', 'dev/path', 'dev.1']) {
        const source = `gitGraph
  commit id:"base"
  branch ${name}
  commit id:"feat"
  switch ${name}
  checkout main
  commit id:"head"
  merge ${name} id:"joined"
`
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok || parsed.value.body.kind !== 'gitgraph') throw new Error(`Expected structured GitGraph for ${name}`)
        const exported = serializeMermaid(parsed.value)
        const reloaded = parseRegisteredMermaid(exported)
        expect(reloaded.ok && reloaded.value.body, name).toEqual(parsed.value.body)
        expect(await upstream.project(exported, diagram => ({
          branches: [...diagram.db.getBranches().keys()],
          commits: [...diagram.db.getCommits().values()].map((commit: any) => ({ id: commit.id, branch: commit.branch, parents: commit.parents })),
        })), name).toEqual({ ok: true, value: {
          branches: ['main', name],
          commits: [
            { id: 'base', branch: 'main', parents: [] },
            { id: 'feat', branch: name, parents: ['base'] },
            { id: 'head', branch: 'main', parents: ['base'] },
            { id: 'joined', branch: 'main', parents: ['head', 'feat'] },
          ],
        } })
        expect(renderMermaidSVG(exported), name).toBe(renderMermaidSVG(source))
        expect(renderMermaidASCII(exported), name).toBe(renderMermaidASCII(source))
      }
    } finally {
      upstream.close()
    }
  })

  test('typed creation and rename to numeric branch names export portable declarations and references', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const parsed = parseRegisteredMermaid(BASE)
      if (!parsed.ok || parsed.value.body.kind !== 'gitgraph') throw new Error('Expected structured GitGraph')
      const renamed = mutate(parsed.value, { kind: 'rename_branch', from: 'feature', to: '42' })
      if (!renamed.ok || renamed.value.body.kind !== 'gitgraph') throw new Error('Expected renamed GitGraph')
      const checked = mutate(renamed.value, { kind: 'checkout_branch', name: '42' })
      if (!checked.ok) throw new Error('Expected checkout')
      const created = mutate(checked.value, { kind: 'create_branch', name: '1a' })
      if (!created.ok || created.value.body.kind !== 'gitgraph') throw new Error('Expected created branch')
      const exported = serializeMermaid(created.value)
      expect(await upstream.accepts(exported)).toBe(true)
      expect(exported).toContain('branch "42" order: 2')
      expect(exported).toContain('merge "42" id:"merge"')
      expect(exported).toContain('checkout "42"')
      expect(exported).toContain('branch "1a"')
      expect(created.value.body.branches.map(branch => branch.name)).toEqual(['main', '42', 'side', '1a'])
      expect(created.value.body.commits.find(commit => commit.id === 'feat')).toMatchObject({ branch: '42', parents: ['base'] })
      expect(created.value.body.commits.find(commit => commit.id === 'merge')).toMatchObject({ branch: 'main', mergeBranch: '42', parents: ['main2', 'feat'] })
      const reloaded = parseRegisteredMermaid(exported)
      expect(reloaded.ok && reloaded.value.body).toEqual(created.value.body)
      expect(parsed.value.body.branches.map(branch => branch.name)).toEqual(['main', 'feature', 'side'])
    } finally {
      upstream.close()
    }
  })

  test('append_commit preserves all authored attributes, escaping, current branch, and input immutability', () => {
    const input = body()
    const next = apply(
      {
        kind: 'append_commit',
        id: 'quoted"id',
        message: 'path \\ ready',
        type: 'REVERSE',
        tags: ['one', 'two'],
      },
      input,
    )
    expect(commit(next, 'quoted"id')).toMatchObject({
      id: 'quoted"id',
      message: 'path \\ ready',
      type: 'REVERSE',
      tags: ['one', 'two'],
      branch: 'main',
      source: 'commit',
      customId: true,
    })
    expect(commit(input, 'quoted"id')).toBeUndefined()
    expect(renderGitGraphBody(next)).toContain('commit id:"quoted\\"id" type:REVERSE tag:"one" tag:"two" msg:"path \\\\ ready"')

    const generated = apply({ kind: 'append_commit' })
    expect(generated.commits.at(-1)).toMatchObject({ id: 'c5', type: 'NORMAL', tags: [], branch: 'main', customId: false })
    expect(renderGitGraphBody(apply({ kind: 'append_commit', id: 'normal', type: 'NORMAL' }))).toContain('commit id:"normal"\n')
    expect(renderGitGraphBody(apply({ kind: 'append_commit', id: 'normal', type: 'NORMAL' }))).not.toContain('type:NORMAL')

    const customMain = parseGitGraphBody('gitGraph\n  commit id:"root"\n', { mainBranchName: 'trunk' })
    const onCustomMain = apply({ kind: 'append_commit', id: 'next' }, customMain)
    expect(onCustomMain.mainBranchName).toBe('trunk')
    expect(commit(onCustomMain, 'next')?.branch).toBe('trunk')
  })

  test('create_branch honors explicit/default order and validates names and duplicate replay', () => {
    const ordered = apply({ kind: 'create_branch', name: '  release  ', order: 7 })
    expect(ordered.branches.find(branch => branch.name === 'release')).toMatchObject({ order: 7, head: 'merge' })
    expect(ordered.statements.at(-1)).toEqual({ kind: 'branch', name: 'release', order: 7 })
    const defaultOrder = apply({ kind: 'create_branch', name: 'release' })
    expect(defaultOrder.branches.find(branch => branch.name === 'release')?.order).toBe(0.3)
    expect(defaultOrder.statements.at(-1)).toEqual({ kind: 'branch', name: 'release', order: undefined })
    expectError({ kind: 'create_branch', name: 42 as never }, 'INVALID_OP', 'gitGraph branch name must be a non-empty single-line string')
    expectError({ kind: 'create_branch', name: '\n' }, 'INVALID_OP', 'gitGraph branch name must be a non-empty single-line string')
    const duplicate = mutateGitGraph(body(), { kind: 'create_branch', name: 'feature' })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe('INVALID_OP')
      expect(duplicate.error.message).toBe("Trying to create existing branch 'feature'; use checkout feature instead.")
    }
  })

  test('checkout_branch replays only existing branches and tracks the active branch', () => {
    const checked = apply({ kind: 'checkout_branch', name: '  feature  ' })
    expect(checked.statements.at(-1)).toEqual({ kind: 'checkout', branch: 'feature', keyword: 'checkout' })
    expect(apply({ kind: 'append_commit', id: 'after-checkout' }, checked).commits.at(-1)?.branch).toBe('feature')
    expectError({ kind: 'checkout_branch', name: '' }, 'INVALID_OP', 'gitGraph branch name must be a non-empty single-line string')
    const missing = mutateGitGraph(body(), { kind: 'checkout_branch', name: 'missing' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.message).toBe("Trying to checkout branch 'missing' before it is created.")
  })

  test('merge_branch retains semantic MERGE while carrying authored id, type, tags, and second parent', () => {
    const onSide = apply({ kind: 'checkout_branch', name: 'side' })
    const merged = apply({ kind: 'merge_branch', name: 'feature', id: 'side-merge', type: 'REVERSE', tags: ['rc'] }, onSide)
    expect(commit(merged, 'side-merge')).toMatchObject({
      type: 'MERGE',
      customType: 'REVERSE',
      source: 'merge',
      mergeBranch: 'feature',
      branch: 'side',
      parents: ['side1', 'feat'],
      tags: ['rc'],
    })
    expect(merged.statements.at(-1)).toEqual({ kind: 'merge', ref: 'side-merge', branch: 'feature' })
    expectError({ kind: 'merge_branch', name: '\n' }, 'INVALID_OP', 'gitGraph branch name must be a non-empty single-line string')
    const self = mutateGitGraph(body(), { kind: 'merge_branch', name: 'main' })
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.error.message).toContain("Cannot merge branch 'main' into itself")
  })

  test('cherry_pick records source, optional parent, tags, and rejects invalid replay', () => {
    const source = parseGitGraphBody(`gitGraph
  commit id:"base"
  branch feature
  commit id:"f1"
  branch topic
  commit id:"t1"
  checkout feature
  merge topic id:"feature-merge"
  checkout main
`)
    const picked = apply({ kind: 'cherry_pick', id: 'feature-merge', parent: 'f1', tags: ['backport', 'v2'] }, source)
    const cherry = picked.commits.at(-1)!
    expect(cherry).toMatchObject({
      type: 'CHERRY_PICK',
      source: 'cherry-pick',
      cherrySource: 'feature-merge',
      cherryParent: 'f1',
      branch: 'main',
      tags: ['backport', 'v2'],
      parents: ['base', 'feature-merge'],
    })
    expect(picked.statements.at(-1)).toEqual({ kind: 'cherry-pick', ref: cherry.id, source: 'feature-merge', parent: 'f1' })
    expect(parseGitGraphBody(renderGitGraphBody(picked))).toEqual(picked)
    expectError({ kind: 'cherry_pick', id: ' ' }, 'INVALID_OP', 'gitGraph cherry-pick id must be a non-empty single-line string')
    const missing = mutateGitGraph(body(), { kind: 'cherry_pick', id: 'absent' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.message).toBe("Cherry-pick source commit 'absent' does not exist.")
  })

  test('cherry-pick round trips authored tags that share the synthetic-tag prefix', () => {
    const source = `gitGraph
  commit id:"base"
  branch feature
  commit id:"work"
  checkout main
  cherry-pick id:"work" tag:"cherry-pick:release" tag:"stable"
`
    const parsed = parseGitGraphBody(source)
    expect(parsed.commits.at(-1)?.tags).toEqual(['cherry-pick:release', 'stable'])
    const serialized = renderGitGraphBody(parsed)
    expect(serialized).toContain('tag:"cherry-pick:release" tag:"stable"')
    expect(parseGitGraphBody(serialized)).toEqual(parsed)
  })

  test('duplicate occurrence allocation reserves future authored names and retains exact parents', () => {
    const input = parseGitGraphBody(`gitGraph
  commit
  commit id:"Boston"
  commit id:"Boston"
  commit id:"Boston#1"
  commit id:"c0"
  commit id:"Boston"
`)
    expect(input.commits.map(c => c.id)).toEqual(['c0#1', 'Boston', 'Boston#2', 'Boston#1', 'c0', 'Boston#3'])
    expect(input.commits.map(c => c.parents)).toEqual([[], ['c0#1'], ['Boston'], ['Boston#2'], ['Boston#1'], ['c0']])
    expect(input.commits.filter(c => c.sourceId === 'Boston').map(c => c.id)).toEqual(['Boston#2', 'Boston#3'])
    expect(parseGitGraphBody(renderGitGraphBody(input))).toEqual(input)
    const changed = apply({ kind: 'set_commit_tags', id: 'Boston#2', tags: ['transfer'] }, input)
    expect(changed.commits.find(c => c.id === 'Boston#2')?.tags).toEqual(['transfer'])
    expect(changed.commits.find(c => c.id === 'Boston#1')?.tags).toEqual([])
    expect(mutateGitGraph(input, { kind: 'append_commit', id: 'Boston#2' })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_NODE' } })
  })

  test('cherry-pick resolves latest preceding authored occurrence without silently retargeting typed identities', () => {
    const input = parseGitGraphBody(`gitGraph
  commit id:"base"
  branch feature
  commit id:"same"
  commit id:"same"
  checkout main
`)
    const picked = apply({ kind: 'cherry_pick', id: 'same#1', tags: ['backport'] }, input)
    expect(picked.commits.at(-1)).toMatchObject({ cherrySource: 'same#1', parents: ['base', 'same#1'] })
    expect(renderGitGraphBody(picked)).toContain('cherry-pick id:"same" tag:"backport"')
    expect(parseGitGraphBody(renderGitGraphBody(picked))).toEqual(picked)
    const ambiguous = mutateGitGraph(input, { kind: 'cherry_pick', id: 'same' })
    expect(ambiguous).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('shadowed') } })
    const sourceOrder = parseGitGraphBody(`gitGraph
  commit id:"base"
  branch feature
  commit id:"same"
  checkout main
  cherry-pick id:"same"
  checkout feature
  commit id:"same"
`)
    expect(sourceOrder.commits[2]?.cherrySource).toBe('same')
    expect(parseGitGraphBody(renderGitGraphBody(sourceOrder))).toEqual(sourceOrder)
  })

  test('set_commit_message sets, trims, clears, validates, and preserves the input', () => {
    const input = body()
    const changed = apply({ kind: 'set_commit_message', id: 'base', message: '  New foundation  ' }, input)
    expect(commit(changed, 'base')?.message).toBe('New foundation')
    expect(commit(input, 'base')?.message).toBe('Foundation')
    changed.commits[0]!.tags.push('local')
    changed.commits[0]!.parents.push('local-parent')
    expect(commit(input, 'base')).toMatchObject({ tags: [], parents: [] })
    expect(commit(apply({ kind: 'set_commit_message', id: 'base', message: null }), 'base')?.message).toBeUndefined()
    expectError({ kind: 'set_commit_message', id: 'missing', message: 'x' }, 'NODE_NOT_FOUND', "gitGraph commit 'missing' not found")
    expectError({ kind: 'set_commit_message', id: 'base', message: '\n' }, 'INVALID_OP', 'gitGraph commit message must be a non-empty single-line string')
    expectError({ kind: 'set_commit_message', id: 'merge', message: 'new' }, 'INVALID_OP', "Commit 'merge' is produced by merge; its generated message cannot be replaced")
    const picked = apply({ kind: 'cherry_pick', id: 'side1' })
    const cherryId = picked.commits.at(-1)!.id
    expectError({ kind: 'set_commit_message', id: cherryId, message: null }, 'INVALID_OP', `Commit '${cherryId}' is produced by cherry-pick; its generated message cannot be replaced`, picked)
  })

  test('set_commit_type changes authored commits but refuses semantic merge/cherry-pick commits', () => {
    expect(commit(apply({ kind: 'set_commit_type', id: 'base', type: 'REVERSE' }), 'base')?.type).toBe('REVERSE')
    expectError({ kind: 'set_commit_type', id: 'missing', type: 'NORMAL' }, 'NODE_NOT_FOUND', "gitGraph commit 'missing' not found")
    expectError({ kind: 'set_commit_type', id: 'merge', type: 'NORMAL' }, 'INVALID_OP', "Commit 'merge' is produced by merge; its semantic type cannot be replaced")
    const picked = apply({ kind: 'cherry_pick', id: 'side1' })
    expect(picked.commits.at(-1)?.tags).toEqual(['cherry-pick:side1'])
    const cherryId = picked.commits.at(-1)!.id
    expectError({ kind: 'set_commit_type', id: cherryId, type: 'HIGHLIGHT' }, 'INVALID_OP', `Commit '${cherryId}' is produced by cherry-pick; its semantic type cannot be replaced`, picked)
  })

  test('set_commit_tags copies, validates, clears, and does not alias caller or input arrays', () => {
    const tags = ['release', 'stable']
    const input = body()
    const changed = apply({ kind: 'set_commit_tags', id: 'base', tags }, input)
    tags.push('later')
    expect(commit(changed, 'base')?.tags).toEqual(['release', 'stable'])
    expect(commit(input, 'base')?.tags).toEqual([])
    expect(commit(apply({ kind: 'set_commit_tags', id: 'feat', tags: [] }), 'feat')?.tags).toEqual([])
    expectError({ kind: 'set_commit_tags', id: 'missing', tags: [] }, 'NODE_NOT_FOUND', "gitGraph commit 'missing' not found")
    expectError({ kind: 'set_commit_tags', id: 'base', tags: ['ok', 'bad\ntag'] }, 'INVALID_OP', 'gitGraph tag must be a non-empty single-line string')
  })

  test('rename_branch rewrites branch state plus branch/checkout/merge statements only for the target', () => {
    const renamed = apply({ kind: 'rename_branch', from: 'feature', to: '  product  ' })
    expect(renamed.branches.map(branch => branch.name)).toEqual(['main', 'product', 'side'])
    expect(renamed.commits.filter(item => item.branch === 'product').map(item => item.id)).toEqual(['feat'])
    expect(commit(renamed, 'feat')?.message).toBeUndefined()
    expect(commit(renamed, 'base')?.message).toBe('Foundation')
    expect(renamed.commits.find(item => item.id === 'main2')?.branch).toBe('main')
    expect(renamed.statements.filter(statement => statement.kind === 'branch')).toEqual([
      { kind: 'branch', name: 'product', order: 2 },
      { kind: 'branch', name: 'side' },
    ])
    expect(renamed.statements.filter(statement => statement.kind === 'merge')).toEqual([{ kind: 'merge', ref: 'merge', branch: 'product' }])
    expect(commit(renamed, 'merge')).toMatchObject({
      mergeBranch: 'product',
      message: 'merged branch product into main',
    })
    expect(parseGitGraphBody(renderGitGraphBody(renamed))).toEqual(renamed)
    expect(renamed.statements.filter(statement => statement.kind === 'commit').every(statement => !('branch' in statement))).toBe(true)

    const withCheckout = parseGitGraphBody('gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"feat"\n  checkout main\n  checkout feature\n')
    const checkoutRenamed = apply({ kind: 'rename_branch', from: 'feature', to: 'product' }, withCheckout)
    expect(checkoutRenamed.statements.filter(statement => statement.kind === 'checkout')).toEqual([
      { kind: 'checkout', branch: 'main', keyword: 'checkout' },
      { kind: 'checkout', branch: 'product', keyword: 'checkout' },
    ])

    const withTwoMerges = parseGitGraphBody(`gitGraph
  commit id:"base"
  branch first
  commit id:"f1"
  checkout main
  merge first id:"m1"
  branch second
  commit id:"s1"
  checkout main
  merge second id:"m2"
`)
    const oneMergeRenamed = apply({ kind: 'rename_branch', from: 'first', to: 'product' }, withTwoMerges)
    expect(oneMergeRenamed.statements.filter(statement => statement.kind === 'merge')).toEqual([
      { kind: 'merge', ref: 'm1', branch: 'product' },
      { kind: 'merge', ref: 'm2', branch: 'second' },
    ])
    expect(commit(oneMergeRenamed, 'm1')).toMatchObject({ mergeBranch: 'product', message: 'merged branch product into main' })
    expect(commit(oneMergeRenamed, 'm2')).toMatchObject({ mergeBranch: 'second', message: 'merged branch second into main' })

    const destinationSource = parseGitGraphBody(`gitGraph
  commit id:"base"
  branch feature
  commit id:"f1"
  branch topic
  commit id:"t1"
  checkout feature
  merge topic id:"fm"
`)
    const destinationRenamed = apply({ kind: 'rename_branch', from: 'feature', to: 'product' }, destinationSource)
    expect(commit(destinationRenamed, 'fm')).toMatchObject({
      branch: 'product',
      mergeBranch: 'topic',
      message: 'merged branch topic into product',
    })
    expect(commit(destinationRenamed, 'f1')?.message).toBeUndefined()
    expect(commit(destinationRenamed, 't1')?.message).toBeUndefined()
    expect(parseGitGraphBody(renderGitGraphBody(destinationRenamed))).toEqual(destinationRenamed)

    const unrelatedRenamed = apply({ kind: 'rename_branch', from: 'side', to: 'lane' })
    expect(commit(unrelatedRenamed, 'merge')).toMatchObject({
      branch: 'main',
      mergeBranch: 'feature',
      message: 'merged branch feature into main',
    })
    expect(commit(unrelatedRenamed, 'side1')?.message).toBeUndefined()

    expectError({ kind: 'rename_branch', from: 'main', to: 'trunk' }, 'INVALID_OP', 'Renaming the configured main branch requires gitGraph.mainBranchName config; source syntax cannot express it')
    expectError({ kind: 'rename_branch', from: 'missing', to: 'x' }, 'NODE_NOT_FOUND', "gitGraph branch 'missing' not found")
    expectError({ kind: 'rename_branch', from: 'feature', to: '\n' }, 'INVALID_OP', 'gitGraph branch name must be a non-empty single-line string')
    expectError({ kind: 'rename_branch', from: 'feature', to: 'side' }, 'DUPLICATE_NODE', "gitGraph branch 'side' already exists")
  })

  test('accessibility operations set, trim, clear, validate, and remain independent', () => {
    const input = body()
    const titled = apply({ kind: 'set_accessibility_title', title: '  Release history  ' }, input)
    expect(titled.accessibilityTitle).toBe('Release history')
    expect(titled.commits).toEqual(input.commits)
    titled.commits.find(item => item.id === 'feat')!.tags.push('local')
    titled.commits.find(item => item.id === 'merge')!.parents.push('local-parent')
    expect(commit(input, 'feat')?.tags).toEqual(['alpha'])
    expect(commit(input, 'merge')?.parents).toEqual(['main2', 'feat'])
    expect(apply({ kind: 'set_accessibility_title', title: null }, titled).accessibilityTitle).toBeUndefined()
    expectError({ kind: 'set_accessibility_title', title: '' }, 'INVALID_OP', 'gitGraph accessibility title must be a non-empty single-line string')

    const described = apply({ kind: 'set_accessibility_description', description: '  Branch topology  ' })
    expect(described.accessibilityDescription).toBe('Branch topology')
    expect(apply({ kind: 'set_accessibility_description', description: null }, described).accessibilityDescription).toBeUndefined()
    expectError({ kind: 'set_accessibility_description', description: '\n' }, 'INVALID_OP', 'gitGraph accessibility description must be a non-empty single-line string')
  })

  test('unknown operations fail with the exact self-discovery menu', () => {
    const result = mutateGitGraph(body(), { kind: 'rebase' } as never) as Result<GitGraphBody, MutationError>
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'INVALID_OP',
        message: 'Unknown gitgraph op "rebase" — valid ops: append_commit, create_branch, checkout_branch, merge_branch, cherry_pick, set_commit_message, set_commit_type, set_commit_tags, rename_branch, set_accessibility_title, set_accessibility_description',
      })
    }
  })

  test('verification checks message overflow, id fallback, custom cap, and missing parents', () => {
    const malformed = body()
    commit(malformed, 'base')!.parents.push('ghost')
    commit(malformed, 'side1')!.message = 'long message'
    const warnings = verifyGitGraph(malformed, { labelCharCap: 5 })
    expect(warnings.map(warning => warning.code)).toEqual(['LABEL_OVERFLOW', 'EDGE_MISANCHORED', 'LABEL_OVERFLOW'])
    expect(warnings.filter(warning => warning.code === 'LABEL_OVERFLOW').map(warning => warning.target)).toEqual(['base', 'side1'])
    expect(layoutGitGraph(body()).commits.find(item => item.id === 'merge')?.labelBlock?.text).toBe('merge')
    expect(warnings).toContainEqual({ code: 'EDGE_MISANCHORED', edge: 'ghost->base', to: 'base' })
    expect(verifyGitGraph(body(), { labelCharCap: 100 })).toEqual([])
  })
})
