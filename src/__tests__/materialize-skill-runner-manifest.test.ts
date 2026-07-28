import { expect, test } from 'bun:test'
import { materializeRunnerManifest } from '../../scripts/eval/materialize-skill-runner-manifest.ts'

test('runner manifest roots skills, fixtures, prompts, and script inputs inside the repository', () => {
  const output = materializeRunnerManifest(
    {
      skill_paths: ['../skills/workflow'],
      ablations: [
        {
          id: 'no-rule',
          removed_component: 'rule',
          mechanism: 'patch',
          class: 'instructions',
          target: { skill_root: '../skills/workflow', patch: 'ablations/no-rule.patch' },
        },
      ],
      cases: [
        {
          id: 'case',
          prompt_ref: 'private/case.prompt.md',
          files: ['fixtures/input.mmd'],
          assertions: [{ type: 'script', command: ['bun', 'oracles/check.ts', '{output_dir}', '--source-file', 'fixtures/input.mmd'] }],
        },
      ],
    },
    '/repo/skill-evals/manifest.json',
    '/repo',
  ) as any
  expect(output.skill_paths).toEqual(['skills/workflow'])
  expect(output.ablations[0].target).toEqual({ skill_root: 'skills/workflow', patch: 'skill-evals/ablations/no-rule.patch' })
  expect(output.cases[0]).toMatchObject({
    prompt_ref: 'skill-evals/private/case.prompt.md',
    files: ['skill-evals/fixtures/input.mmd'],
    assertions: [{ command: ['bun', 'skill-evals/oracles/check.ts', '{output_dir}', '--source-file', '/repo/skill-evals/fixtures/input.mmd'] }],
  })
})

test('runner manifest rejects paths outside the repository', () => {
  expect(() => materializeRunnerManifest({ skill_paths: ['/other/skill'], cases: [] }, '/repo/skill-evals/manifest.json', '/repo')).toThrow('manifest path escapes repository root')
})
