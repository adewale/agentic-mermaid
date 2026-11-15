import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCliRenderInvocation } from '../unified/invocation.ts'

test('shared installed/native CLI protocol consumes genuine PNG/file artifacts in every round and rejects stale success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-native-rounds-'))
  try {
    const script = join(directory, 'fixture.cjs'),
      source = join(directory, 'input.mmd'),
      log = join(directory, 'calls.jsonl'),
      out = join(directory, 'artifacts')
    mkdirSync(out)
    writeFileSync(source, 'flowchart LR\nA[Start]')
    writeFileSync(
      script,
      `const fs=require('node:fs'),args=process.argv.slice(2),input=args[1],format=args[args.indexOf('--format')+1],output=args[args.indexOf('--output')+1];const source=fs.readFileSync(input==='-'?0:input,'utf8');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({input,format,source,output})+'\\n');if(source.includes('MISSING'))process.exit(0);fs.writeFileSync(output,format==='png'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gM0AAAAASUVORK5CYII=','base64'):'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start</text></svg>');`,
    )
    const workload = { id: 'fixture', family: 'flowchart', source: readFileSync(source, 'utf8'), features: [], provenance: 'authored process/artifact contract regression', expectedLabels: ['Start'] }
    const common = { command: process.execPath, prefix: [script], cwd: directory, out, sourceFile: source, workload, rounds: 3, surface: 'fixture:cli', runtime: 'fixture-runtime' }
    const png = await runCliRenderInvocation({ ...common, format: 'png', inputMode: 'stdin' }),
      svg = await runCliRenderInvocation({ ...common, format: 'svg', inputMode: 'file' })
    expect(png.row.status).toBe('passed')
    expect(svg.row.status).toBe('passed')
    expect(png.row.samplesMs).toHaveLength(3)
    expect(svg.row.metrics).toMatchObject({ attemptedRounds: 3, qualifiedRounds: 3, inputMode: 'file' })
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(calls.filter(call => call.input === '-')).toHaveLength(3)
    expect(calls.filter(call => call.input === source)).toHaveLength(3)
    expect(new Set(calls.map(call => call.output)).size).toBe(6)
    const missing = await runCliRenderInvocation({ ...common, workload: { ...workload, source: 'MISSING' }, format: 'svg', inputMode: 'stdin' })
    expect(missing.row.status).toBe('failed')
    expect(missing.row.samplesMs).toHaveLength(0)
    expect(missing.row.metrics).toMatchObject({ attemptedRounds: 3, qualifiedRounds: 0 })
    expect(JSON.parse(readFileSync(String(missing.row.metrics!.roundEvidenceFile), 'utf8')).every((entry: any) => entry.status === 'failed' && entry.wallMs > 0)).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
