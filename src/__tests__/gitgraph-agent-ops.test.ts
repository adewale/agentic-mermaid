import { describe, expect, test } from 'bun:test'
import {
  mutateGitGraph, parseGitGraphBody, renderGitGraphBody, verifyGitGraph,
} from '../agent/gitgraph-body.ts'
import type { GitGraphBody, GitGraphMutationOp, MutationError, Result } from '../agent/types.ts'

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

function body(): GitGraphBody { return parseGitGraphBody(BASE) }

function apply(op: GitGraphMutationOp, input = body()): GitGraphBody {
  const result = mutateGitGraph(input, op)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function expectError(
  op: GitGraphMutationOp,
  code: MutationError['code'],
  message: string,
  input = body(),
): void {
  const result = mutateGitGraph(input, op)
  expect(result).toEqual({ ok: false, error: { code, message } })
}

function commit(input: GitGraphBody, id: string) { return input.commits.find(item => item.id === id) }

describe('GitGraph typed operations — discriminating replay contract', () => {
  test('append_commit preserves all authored attributes, escaping, current branch, and input immutability', () => {
    const input = body()
    const next = apply({
      kind: 'append_commit', id: 'quoted"id', message: 'path \\ ready', type: 'REVERSE', tags: ['one', 'two'],
    }, input)
    expect(commit(next, 'quoted"id')).toMatchObject({
      id: 'quoted"id', message: 'path \\ ready', type: 'REVERSE', tags: ['one', 'two'], branch: 'main', source: 'commit', customId: true,
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
      type: 'MERGE', customType: 'REVERSE', source: 'merge', mergeBranch: 'feature', branch: 'side', parents: ['side1', 'feat'], tags: ['rc'],
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
      type: 'CHERRY_PICK', source: 'cherry-pick', cherrySource: 'feature-merge', cherryParent: 'f1', branch: 'main', tags: ['backport', 'v2'], parents: ['base', 'feature-merge'],
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
    const picked = apply({ kind: 'cherry_pick', id: 'feat' })
    const cherryId = picked.commits.at(-1)!.id
    expectError({ kind: 'set_commit_message', id: cherryId, message: null }, 'INVALID_OP', `Commit '${cherryId}' is produced by cherry-pick; its generated message cannot be replaced`, picked)
  })

  test('set_commit_type changes authored commits but refuses semantic merge/cherry-pick commits', () => {
    expect(commit(apply({ kind: 'set_commit_type', id: 'base', type: 'REVERSE' }), 'base')?.type).toBe('REVERSE')
    expectError({ kind: 'set_commit_type', id: 'missing', type: 'NORMAL' }, 'NODE_NOT_FOUND', "gitGraph commit 'missing' not found")
    expectError({ kind: 'set_commit_type', id: 'merge', type: 'NORMAL' }, 'INVALID_OP', "Commit 'merge' is produced by merge; its semantic type cannot be replaced")
    const picked = apply({ kind: 'cherry_pick', id: 'feat' })
    expect(picked.commits.at(-1)?.tags).toEqual(['cherry-pick:feat'])
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
    expect(renamed.statements.filter(statement => statement.kind === 'merge')).toEqual([
      { kind: 'merge', ref: 'merge', branch: 'product' },
    ])
    expect(commit(renamed, 'merge')).toMatchObject({
      mergeBranch: 'product', message: 'merged branch product into main',
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
      branch: 'product', mergeBranch: 'topic', message: 'merged branch topic into product',
    })
    expect(commit(destinationRenamed, 'f1')?.message).toBeUndefined()
    expect(commit(destinationRenamed, 't1')?.message).toBeUndefined()
    expect(parseGitGraphBody(renderGitGraphBody(destinationRenamed))).toEqual(destinationRenamed)

    const unrelatedRenamed = apply({ kind: 'rename_branch', from: 'side', to: 'lane' })
    expect(commit(unrelatedRenamed, 'merge')).toMatchObject({
      branch: 'main', mergeBranch: 'feature', message: 'merged branch feature into main',
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
    expect(warnings.map(warning => warning.code)).toEqual([
      'LABEL_OVERFLOW', 'EDGE_MISANCHORED', 'LABEL_OVERFLOW', 'LABEL_OVERFLOW',
    ])
    expect(warnings).toContainEqual({ code: 'EDGE_MISANCHORED', edge: 'ghost->base', to: 'base' })
    expect(verifyGitGraph(body(), { labelCharCap: 100 })).toEqual([])
  })
})
