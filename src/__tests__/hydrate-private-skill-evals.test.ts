import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hydratePrivateManifest } from '../../scripts/eval/hydrate-private-skill-evals.ts'

test('private hydration rejects public answer keys and resolves every input', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-private-eval-'))
  try {
    mkdirSync(join(root, 'skill-evals/private/holdback'), { recursive: true })
    mkdirSync(join(root, 'skill-evals/fixtures/case'), { recursive: true })
    mkdirSync(join(root, 'skills/a'), { recursive: true })
    writeFileSync(join(root, 'skill-evals/private/holdback/case.prompt.md'), 'Private prompt')
    writeFileSync(join(root, 'skill-evals/fixtures/case/input.mmd'), 'flowchart LR\nA-->B')
    const publicPath = join(root, 'skill-evals/manifest.json')
    const privatePath = join(root, 'skill-evals/private/cases.json')
    const publicManifest = {
      skill_paths: ['../skills/a'],
      cases: [{ id: 'case', split: 'holdback', prompt_ref: 'private/holdback/case.prompt.md', files: ['fixtures/case/input.mmd'] }],
    }
    writeFileSync(publicPath, JSON.stringify(publicManifest))
    writeFileSync(privatePath, JSON.stringify({ version: 1, cases: [{ id: 'case', expected_behavior: ['answer'], assertions: [] }] }))
    const hydrated = hydratePrivateManifest(publicPath, privatePath)
    expect(hydrated.skill_paths).toEqual([join(root, 'skills/a')])
    expect(hydrated.cases[0]).toMatchObject({
      prompt_ref: join(root, 'skill-evals/private/holdback/case.prompt.md'),
      files: [join(root, 'skill-evals/fixtures/case/input.mmd')],
      expected_behavior: ['answer'],
      assertions: [],
    })

    writeFileSync(publicPath, JSON.stringify({ ...publicManifest, cases: [{ ...publicManifest.cases[0], expected_behavior: ['leak'] }] }))
    expect(() => hydratePrivateManifest(publicPath, privatePath)).toThrow('public hidden case case leaks expected_behavior')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
