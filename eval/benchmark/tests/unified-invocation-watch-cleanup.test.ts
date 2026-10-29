import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { awaitInvocationArtifact } from '../unified/invocation.ts'

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
test('cancelled artifact observers settle and release the filesystem wait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-watch-cancel-'))
  try {
    const abort = new AbortController(),
      waiting = awaitInvocationArtifact(join(directory, 'output.svg'), 'requested', 30_000, abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow('cancelled')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('early-exit and spawn-error watch rounds all finish without leaking30second timers or hanging cleanup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-watch-round-cleanup-'))
  try {
    const pkg = join(directory, 'package'),
      dist = join(pkg, 'dist'),
      fixture = join(pkg, 'fixture.cjs'),
      runner = join(directory, 'runner.ts'),
      summary = join(directory, 'summary.json')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ type: 'module', bin: { am: 'fixture.cjs' } }))
    writeFileSync(join(dist, 'agent-core.js'), 'export function hasOpSchema(){return false}\n')
    writeFileSync(
      fixture,
      `const fs=require('node:fs'),args=process.argv.slice(2);if(args.includes('--watch'))process.exit(42);let input='';if(args[1]==='-'||args[0]==='serialize')input=fs.readFileSync(0,'utf8');const source='flowchart LR\\nA[Start]';const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start</text></svg>';if(args.includes('--output')){fs.writeFileSync(args[args.indexOf('--output')+1],svg);process.exit(0)}switch(args[0]){case'parse':console.log('{"kind":"flowchart"}');break;case'format':case'serialize':console.log(source);break;case'batch':console.log(JSON.stringify({ok:true,data:{svg}})+'\\n{"ok":true}\\n{"ok":true}');break;case'render-markdown':console.log(JSON.stringify({blocks:[{ok:true,output:svg}]}));break;case'llms-txt':case'--help':console.log('fixture help');break;default:console.log('{}')}`,
    )
    writeFileSync(
      runner,
      `import{writeFileSync}from'node:fs';import{runInvocationCliProgram}from${JSON.stringify(join(harnessRoot, 'eval/benchmark/unified/invocation.ts'))};const results=[];for(const missing of[false,true]){const result=await runInvocationCliProgram({root:${JSON.stringify(pkg)},packageRoot:${JSON.stringify(pkg)},harnessRoot:${JSON.stringify(harnessRoot)},out:${JSON.stringify(directory)},profile:'full',rounds:3},[{id:'fixture',family:'flowchart',source:'flowchart LR\\nA[Start]',features:[],provenance:'watch cleanup regression',expectedLabels:['Start']}],{command:missing?${JSON.stringify(join(directory, 'missing-executable'))}:process.execPath,prefix:[${JSON.stringify(fixture)}],out:${JSON.stringify(directory)}+'/'+String(missing),runtime:'fixture-executor'});results.push(result.rows.find(row=>row.surface==='cli:native-binary:watch'))}writeFileSync(${JSON.stringify(summary)},JSON.stringify(results));`,
    )
    // No process.exit: a leaked watcher/readiness timer would keep this child alive.
    execFileSync(process.execPath, [runner], { cwd: harnessRoot, timeout: 10_000, stdio: 'pipe' })
    const rows = JSON.parse(readFileSync(summary, 'utf8'))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('failed')
      expect(row.samplesMs).toHaveLength(0)
      expect(row.metrics).toMatchObject({ attemptedRounds: 3, qualifiedRounds: 0 })
      const rounds = JSON.parse(readFileSync(row.metrics.roundEvidenceFile, 'utf8'))
      expect(rounds.map((value: any) => value.round)).toEqual([1, 2, 3])
      expect(rounds.every((value: any) => value.status === 'failed' && value.wallMs > 0)).toBe(true)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)
