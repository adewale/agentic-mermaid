import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { bundleSkillEvidence, evidencePayloadManifest, verifyEvidenceBundle } from '../../scripts/eval/bundle-skill-evidence.ts'
import { preparationReceipt } from '../../scripts/eval/prepare-skill-evidence.ts'

test('evidence bundles are content-addressed and independently verifiable', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-evidence-bundle-'))
  try {
    const baseline = join(root, 'baseline')
    const candidate = join(root, 'candidate')
    const baselineTreatment = join(root, 'baseline-treatment')
    const candidateTreatment = join(root, 'candidate-treatment')
    const workspace = join(root, 'workspace')
    const fixtures = join(root, 'fixtures')
    mkdirSync(baseline)
    mkdirSync(candidate)
    mkdirSync(join(baselineTreatment, 'skills/workflow'), { recursive: true })
    mkdirSync(join(candidateTreatment, 'skills/workflow'), { recursive: true })
    mkdirSync(workspace)
    mkdirSync(join(fixtures, 'case'), { recursive: true })
    writeFileSync(join(baselineTreatment, 'skills/workflow/SKILL.md'), 'baseline')
    writeFileSync(join(candidateTreatment, 'skills/workflow/SKILL.md'), 'candidate')
    writeFileSync(join(fixtures, 'case/input.mmd'), 'flowchart LR\nA-->B\n')
    writeFileSync(join(baseline, 'report.json'), '{"score":0}')
    writeFileSync(join(candidate, 'report.json'), '{"score":1}')
    const task = (treatmentRoot: string) => ({
      case_id: 'case',
      variant: 'with_skill',
      run_number: 1,
      repo_root: workspace,
      skill_paths: [join(treatmentRoot, 'skills/workflow')],
      input_files: [join(fixtures, 'case/input.mmd')],
      run_dir: 'case/with_skill/run-1',
      instruction: `Read ${join(treatmentRoot, 'skills/workflow')}.`,
      prompt: 'Do work.',
    })
    for (const [armRoot, treatmentRoot] of [
      [baseline, baselineTreatment],
      [candidate, candidateTreatment],
    ] as const) {
      const prepared = [task(treatmentRoot)]
      writeFileSync(join(armRoot, 'tasks.jsonl'), `${JSON.stringify(prepared[0])}\n`)
      writeFileSync(join(armRoot, 'preparation.json'), `${JSON.stringify(preparationReceipt(prepared, workspace, fixtures, treatmentRoot, prepared[0]!.skill_paths, join(root, 'runs'), 'seed'), null, 2)}\n`)
    }
    for (const name of ['comparison.json', 'runner.json', 'tasks.jsonl', 'cohort.json']) writeFileSync(join(root, name), name)
    const target = bundleSkillEvidence({
      baseline,
      candidate,
      comparison: join(root, 'comparison.json'),
      runnerManifest: join(root, 'runner.json'),
      sourceTasks: join(root, 'tasks.jsonl'),
      cohort: join(root, 'cohort.json'),
      baselineTreatment,
      candidateTreatment,
      workspace,
      fixtures,
      outRoot: join(root, 'artifacts'),
    })
    const manifest = JSON.parse(readFileSync(join(target, 'bundle-manifest.json'), 'utf8'))
    expect(basename(target)).toBe(manifest.contentDigest.slice('sha256:'.length))
    expect(evidencePayloadManifest(target)).toEqual({ contentDigest: manifest.contentDigest, files: manifest.files })
    expect(verifyEvidenceBundle(target).contentDigest).toBe(manifest.contentDigest)
    writeFileSync(join(target, 'inputs/baseline-treatment/skills/workflow/SKILL.md'), 'tampered')
    const tamperedPayload = evidencePayloadManifest(target)
    writeFileSync(join(target, 'bundle-manifest.json'), `${JSON.stringify({ schemaVersion: 1, ...tamperedPayload }, null, 2)}\n`)
    expect(() => verifyEvidenceBundle(target)).toThrow('bundled treatment does not match')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
