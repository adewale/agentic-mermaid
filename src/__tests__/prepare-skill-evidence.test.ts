import { expect, test } from 'bun:test'
import { prepareSkillEvidence } from '../../scripts/eval/prepare-skill-evidence.ts'

test('re-homes target checkouts and makes run artifacts gradeable', () => {
  const [task] = prepareSkillEvidence([{
    case_id: 'artifact', variant: 'with_skill', run_number: 2,
    repo_root: '/source/skill-evals',
    skill_paths: ['/source/skills/a'], input_files: ['/source/skill-evals/fixtures/a.mmd'],
    run_dir: 'artifact/with_skill/run-2',
    instruction: 'Read /source/skills/a.',
    prompt: 'Write outputs/final.mmd and outputs/verify.json.',
  }], '/target', '/runs', new Set())
  expect(task).toMatchObject({
    repo_root: '/target',
    skill_paths: ['/target/skills/a'],
    input_files: ['/target/skill-evals/fixtures/a.mmd'],
  })
  expect(task!.instruction).toContain('/target/skills/a')
  expect(task!.prompt).toContain('/runs/artifact/with_skill/run-2/outputs/final.mmd')
  expect(task!.prompt).toContain('/runs/artifact/with_skill/run-2/outputs/verify.json')
})
