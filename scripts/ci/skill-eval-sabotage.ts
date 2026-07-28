import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Assertion {
  name: string
  type: 'contains' | 'contains_all' | 'contains_any' | 'excludes_any' | 'regex' | 'file_exists'
  value?: string
  values?: string[]
  pattern?: string
}

interface EvalCase { id: string; assertions?: Assertion[] }
interface Fixture { case_id: string; control: string }

export function assertionPasses(assertion: Assertion, output: string): boolean {
  switch (assertion.type) {
    case 'contains': return output.includes(assertion.value ?? '')
    case 'contains_all': return (assertion.values ?? []).every(value => output.includes(value))
    case 'contains_any': return (assertion.values ?? []).some(value => output.includes(value))
    case 'excludes_any': return !(assertion.values ?? []).some(value => output.includes(value))
    case 'regex': return new RegExp(assertion.pattern ?? '').test(output)
    case 'file_exists': throw new Error('file_exists sabotage requires a filesystem runner and is not a text assertion')
  }
}

function removeAll(output: string, value: string): string {
  return value ? output.split(value).join('') : output
}

export function sabotageAssertion(assertion: Assertion, control: string): string {
  switch (assertion.type) {
    case 'contains': return removeAll(control, assertion.value ?? '')
    case 'contains_all': return removeAll(control, assertion.values?.[0] ?? '')
    case 'contains_any': return (assertion.values ?? []).reduce(removeAll, control)
    case 'excludes_any': return `${control}\n${assertion.values?.[0] ?? '__forbidden__'}`
    case 'regex': return control.replace(new RegExp(assertion.pattern ?? '', 'g'), '')
    case 'file_exists': throw new Error('file_exists sabotage requires a filesystem runner and is not a text assertion')
  }
}

export function runSkillEvalSabotage(repo = join(import.meta.dir, '../..')): { controls: number; mutations: number; assertionTypes: string[] } {
  const manifest = JSON.parse(readFileSync(join(repo, 'skill-evals/shared-benchmark.json'), 'utf8')) as { cases: EvalCase[] }
  const fixtures = JSON.parse(readFileSync(join(repo, 'eval/skill-evidence/sabotage-fixtures.json'), 'utf8')) as { cases: Fixture[] }
  const byId = new Map(manifest.cases.map(entry => [entry.id, entry]))
  const exercised = new Set<string>()
  let mutations = 0

  for (const fixture of fixtures.cases) {
    const evalCase = byId.get(fixture.case_id)
    if (!evalCase) throw new Error(`sabotage fixture references unknown case ${fixture.case_id}`)
    const assertions = evalCase.assertions ?? []
    if (!assertions.length) throw new Error(`sabotage fixture ${fixture.case_id} has no assertions`)
    for (const assertion of assertions) {
      if (assertion.type === 'file_exists') continue
      if (!assertionPasses(assertion, fixture.control)) throw new Error(`control unexpectedly fails ${fixture.case_id}/${assertion.name}`)
      const sabotaged = sabotageAssertion(assertion, fixture.control)
      if (assertionPasses(assertion, sabotaged)) throw new Error(`evaluator survived sabotage ${fixture.case_id}/${assertion.name}`)
      exercised.add(assertion.type)
      mutations++
    }
  }

  const required = ['contains', 'contains_all', 'contains_any', 'excludes_any', 'regex']
  for (const type of required) if (!exercised.has(type)) throw new Error(`no sabotage exercise for assertion type ${type}`)
  return { controls: fixtures.cases.length, mutations, assertionTypes: [...exercised].sort() }
}

if (import.meta.main) console.log(JSON.stringify(runSkillEvalSabotage(), null, 2))
