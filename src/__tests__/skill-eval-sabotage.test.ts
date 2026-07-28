import { expect, test } from 'bun:test'
import { runSkillEvalSabotage } from '../../scripts/ci/skill-eval-sabotage.ts'

test('every deterministic text assertion fails under a targeted sabotage', () => {
  expect(runSkillEvalSabotage()).toEqual({
    controls: 4,
    mutations: 12,
    assertionTypes: ['contains', 'contains_all', 'contains_any', 'excludes_any', 'regex'],
  })
})
