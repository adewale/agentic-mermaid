import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentTreeDigest, preparationReceipt, prepareSkillEvidence } from '../../scripts/eval/prepare-skill-evidence.ts'

function checkoutLayout(): {
  root: string
  source: string
  target: string
  neutral: string
  treatment: string
  fixtures: string
  runs: string
} {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-prepare-layout-'))
  const source = join(root, 'source')
  const target = join(root, 'target')
  const neutral = join(root, 'neutral')
  const treatment = join(root, 'treatment')
  const fixtures = join(root, 'fixtures')
  const runs = join(root, 'runs')
  for (const checkout of [source, target, treatment]) {
    for (const skill of ['a', 'workflow', 'editor']) {
      mkdirSync(join(checkout, 'skills', skill), { recursive: true })
      writeFileSync(join(checkout, 'skills', skill, 'SKILL.md'), `${checkout}:${skill}`)
    }
  }
  for (const fixtureRoot of [source, target, fixtures]) {
    mkdirSync(join(fixtureRoot, 'skill-evals/fixtures'), { recursive: true })
    writeFileSync(join(fixtureRoot, 'skill-evals/fixtures/a.mmd'), 'flowchart LR\nA-->B\n')
  }
  mkdirSync(neutral, { recursive: true })
  mkdirSync(runs, { recursive: true })
  return { root, source, target, neutral, treatment, fixtures, runs }
}

test('re-homes target checkouts and makes run artifacts gradeable', () => {
  const layout = checkoutLayout()
  try {
    const [task] = prepareSkillEvidence(
      [
        {
          case_id: 'artifact',
          variant: 'with_skill',
          run_number: 2,
          repo_root: join(layout.source, 'skill-evals'),
          skill_paths: [join(layout.source, 'skills/a')],
          input_files: [join(layout.source, 'skill-evals/fixtures/a.mmd')],
          run_dir: 'artifact/with_skill/run-2',
          instruction: `Read ${join(layout.source, 'skills/a')}.`,
          prompt: 'Write outputs/final.mmd and outputs/verify.json.',
        },
      ],
      layout.target,
      layout.runs,
      new Set(),
    )
    expect(task).toMatchObject({
      repo_root: layout.target,
      skill_paths: [join(layout.target, 'skills/a')],
      input_files: [join(layout.target, 'skill-evals/fixtures/a.mmd')],
    })
    expect(task!.instruction).toContain(join(layout.target, 'skills/a'))
    expect(task!.prompt).toContain(join(layout.runs, 'artifact/with_skill/run-2/outputs/final.mmd'))
    expect(task!.prompt).toContain(join(layout.runs, 'artifact/with_skill/run-2/outputs/verify.json'))
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('supports runner manifests rooted at the repository instead of assuming a nested manifest', () => {
  const layout = checkoutLayout()
  try {
    const [task] = prepareSkillEvidence(
      [
        {
          case_id: 'rooted',
          variant: 'with_skill',
          run_number: 1,
          repo_root: layout.source,
          skill_paths: [join(layout.source, 'skills/a')],
          input_files: [join(layout.source, 'skill-evals/fixtures/a.mmd')],
          run_dir: 'rooted/with_skill/run-1',
          instruction: `Read ${join(layout.source, 'skills/a')}.`,
          prompt: 'Inspect input.',
        },
      ],
      layout.neutral,
      layout.runs,
      new Set(),
      { skillCheckout: layout.treatment, fixtureCheckout: layout.fixtures },
    )
    expect(task).toMatchObject({
      repo_root: layout.neutral,
      skill_paths: [join(layout.treatment, 'skills/a')],
      input_files: [join(layout.fixtures, 'skill-evals/fixtures/a.mmd')],
    })
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('isolates treatment skills, fixtures, workspace, and without-skill rows', () => {
  const layout = checkoutLayout()
  try {
    const tasks = (['with_skill', 'without_skill'] as const).map(variant => ({
      case_id: 'hosted',
      variant,
      run_number: 1,
      repo_root: join(layout.source, 'skill-evals'),
      skill_paths: [join(layout.source, 'skills/workflow'), join(layout.source, 'skills/editor')],
      input_files: [join(layout.source, 'skill-evals/fixtures/a.mmd')],
      run_dir: `hosted/${variant}/run-1`,
      instruction: variant === 'with_skill' ? `Read and follow: ${join(layout.source, 'skills/workflow')}, ${join(layout.source, 'skills/editor')}.` : 'Do not read or use the skill.',
      prompt: 'Inspect the fixture.',
    }))
    const prepared = prepareSkillEvidence(tasks, layout.neutral, layout.runs, new Set(), {
      skillCheckout: layout.treatment,
      fixtureCheckout: layout.fixtures,
      skillNames: new Set(['workflow']),
      seed: 'paired-1',
    })
    const withSkill = prepared.find(task => task.variant === 'with_skill')!
    const withoutSkill = prepared.find(task => task.variant === 'without_skill')!
    expect(withSkill.repo_root).toBe(layout.neutral)
    expect(withSkill.skill_paths).toEqual([join(layout.treatment, 'skills/workflow')])
    expect(withSkill.input_files).toEqual([join(layout.fixtures, 'skill-evals/fixtures/a.mmd')])
    expect(withSkill.instruction).not.toContain('editor')
    expect(withoutSkill.skill_paths).toEqual([])
    expect(withoutSkill.instruction).not.toContain(join(layout.treatment, 'skills'))
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('keeps a candidate treatment path when the skill checkout is the source repository', () => {
  const layout = checkoutLayout()
  try {
    const sourceSkill = join(layout.source, 'skills/workflow')
    const [task] = prepareSkillEvidence(
      [
        {
          case_id: 'candidate',
          variant: 'with_skill',
          run_number: 1,
          repo_root: join(layout.source, 'skill-evals'),
          skill_paths: [sourceSkill],
          input_files: [],
          run_dir: 'candidate/with_skill/run-1',
          instruction: `Read and follow: ${sourceSkill}.`,
          prompt: 'Do work.',
        },
      ],
      layout.neutral,
      layout.runs,
      new Set(),
      { skillCheckout: layout.source, skillNames: new Set(['workflow']) },
    )
    expect(task!.skill_paths).toEqual([sourceSkill])
    expect(task!.instruction).toContain(sourceSkill)
    expect(task!.instruction).not.toContain(join(layout.neutral, 'skills/workflow'))
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('maps a selected non-first skill by source identity instead of array position', () => {
  const layout = checkoutLayout()
  try {
    const editor = join(layout.source, 'skills/editor')
    const workflow = join(layout.source, 'skills/workflow')
    const [task] = prepareSkillEvidence(
      [
        {
          case_id: 'filtered',
          variant: 'with_skill',
          run_number: 1,
          repo_root: join(layout.source, 'skill-evals'),
          skill_paths: [editor, workflow],
          input_files: [],
          run_dir: 'filtered/with_skill/run-1',
          instruction: `Read and follow: ${editor}, ${workflow}.`,
          prompt: 'Do work.',
        },
      ],
      layout.neutral,
      layout.runs,
      new Set(),
      { skillCheckout: layout.treatment, skillNames: new Set(['workflow']) },
    )
    expect(task!.skill_paths).toEqual([join(layout.treatment, 'skills/workflow')])
    expect(task!.instruction).toContain(join(layout.treatment, 'skills/workflow'))
    expect(task!.instruction).not.toContain('editor')
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('receipts distinguish treatment content while holding stimuli fixed', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-preparation-receipt-'))
  try {
    const fixtures = join(root, 'fixtures')
    const workspace = join(root, 'workspace')
    const oldTreatment = join(root, 'old')
    const newTreatment = join(root, 'new')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(fixtures, 'case'), { recursive: true })
    mkdirSync(join(oldTreatment, 'skills/workflow'), { recursive: true })
    mkdirSync(join(newTreatment, 'skills/workflow'), { recursive: true })
    writeFileSync(join(fixtures, 'case/input.mmd'), 'flowchart LR\nA-->B')
    writeFileSync(join(oldTreatment, 'skills/workflow/SKILL.md'), 'old')
    writeFileSync(join(newTreatment, 'skills/workflow/SKILL.md'), 'new')
    const beforeTask = {
      case_id: 'case',
      variant: 'with_skill',
      run_number: 1,
      repo_root: workspace,
      skill_paths: [join(oldTreatment, 'skills/workflow')],
      input_files: [join(fixtures, 'case/input.mmd')],
      skill_tree_hash: 'old-treatment-hash',
      run_dir: 'case/with_skill/run-1',
      instruction: `Read ${join(oldTreatment, 'skills/workflow')}.`,
      prompt: 'Write /before-runs/case/with_skill/run-1/outputs/result.md.',
    }
    const afterTask = {
      ...beforeTask,
      skill_paths: [join(newTreatment, 'skills/workflow')],
      skill_tree_hash: 'new-treatment-hash',
      instruction: `Read ${join(newTreatment, 'skills/workflow')}.`,
      prompt: 'Write /after-runs/case/with_skill/run-1/outputs/result.md.',
    }
    const before = preparationReceipt([beforeTask], workspace, fixtures, oldTreatment, [join(oldTreatment, 'skills/workflow')], '/before-runs', 'seed')
    const after = preparationReceipt([afterTask], workspace, fixtures, newTreatment, [join(newTreatment, 'skills/workflow')], '/after-runs', 'seed')
    expect(before.stimulusDigest).toBe(after.stimulusDigest)
    expect(before.fixtureDigest).toBe(after.fixtureDigest)
    expect(before.treatmentDigest).not.toBe(after.treatmentDigest)
    expect(before.scheduleDigest).toBe(after.scheduleDigest)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('receipts reject model-visible instruction and workspace-content drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-stimulus-drift-'))
  try {
    const workspace = join(root, 'workspace')
    const fixtures = join(root, 'fixtures')
    const treatment = join(root, 'treatment')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(fixtures, { recursive: true })
    mkdirSync(join(treatment, 'skills/workflow'), { recursive: true })
    writeFileSync(join(workspace, 'README.md'), 'neutral v1')
    writeFileSync(join(treatment, 'skills/workflow/SKILL.md'), 'skill')
    const task = {
      case_id: 'case',
      variant: 'with_skill',
      run_number: 1,
      repo_root: workspace,
      skill_paths: [join(treatment, 'skills/workflow')],
      input_files: [],
      run_dir: 'case/with_skill/run-1',
      instruction: 'BASELINE-ONLY instruction',
      prompt: 'Do work.',
    }
    const baseline = preparationReceipt([task], workspace, fixtures, treatment, task.skill_paths, join(root, 'runs'), 'seed')
    const changedInstruction = preparationReceipt([{ ...task, instruction: 'CANDIDATE-ONLY hidden hint' }], workspace, fixtures, treatment, task.skill_paths, join(root, 'runs'), 'seed')
    expect(changedInstruction.stimulusDigest).not.toBe(baseline.stimulusDigest)
    writeFileSync(join(workspace, 'README.md'), 'neutral v2')
    const changedWorkspace = preparationReceipt([task], workspace, fixtures, treatment, task.skill_paths, join(root, 'runs'), 'seed')
    expect(changedWorkspace.workspaceDigest).not.toBe(baseline.workspaceDigest)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('content receipts reject paths outside their declared root', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-digest-root-'))
  try {
    const inside = join(root, 'inside')
    const outside = join(root, 'outside.txt')
    mkdirSync(inside)
    writeFileSync(outside, 'outside')
    expect(() => contentTreeDigest([outside], inside)).toThrow('escapes digest root')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
