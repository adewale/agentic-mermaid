import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('finished bootstrap failures cannot become a complete invocation attempt census', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-attempt-census-'))
  try {
    const packageRoot = join(directory, 'package')
    mkdirSync(packageRoot)
    mkdirSync(join(directory, 'invocation/library'), { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ exports: { '.': { import: './dist/index.js' } } }))
    const script = `import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('benchmark_charts',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=pathlib.Path(sys.argv[2]);package=root/'package'
inputs={'workloads':[{'id':'authored-input','family':'flowchart','source':'flowchart LR; A-->B'}]}
result={'finishedAt':'2026-10-25T00:00:00Z','observations':[{'surface':s,'operation':'surface-start','status':'failed'}for s in ('library','cli','mcp','browser')]}
census=module.invocation_attempt_census(root,result,inputs,package)
duplicate={'exportName':'.','round':1}
for name in ('node-first-1.job.json','node-second-1.job.json'):(root/'invocation/library'/name).write_text(json.dumps(duplicate))
try:module.invocation_attempt_census(root,result,inputs,package);rejected=False
except ValueError as error:rejected='Duplicate actual invocation library job slot'in str(error)
print(json.dumps({'census':census,'duplicateRejected':rejected}))`
    const evidence = JSON.parse(execFileSync('python3', ['-B', '-c', script, resolve(import.meta.dir, '../unified/charts.py'), directory], { encoding: 'utf8' }))
    expect(evidence.census.completeAttempts).toBe(false)
    expect(evidence.census.libraryImportCohort).toHaveLength(9)
    expect(evidence.census.libraryImportCohort.every((slot: { actualJob: boolean }) => !slot.actualJob)).toBe(true)
    expect(evidence.census.gaps.some((gap: string) => gap.includes('representative family attempts'))).toBe(true)
    expect(evidence.duplicateRejected).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
