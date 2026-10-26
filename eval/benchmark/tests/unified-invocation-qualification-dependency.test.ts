import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildInvocationLibraryHarness } from '../unified/invocation.ts'

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
test('relocated actual library worker resolves real harness saxes and independently accepts/rejects SVG', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-relocated-qualifier-'))
  try {
    const candidate = join(directory, 'isolated-candidate'),
      out = join(directory, 'isolated-evidence')
    mkdirSync(candidate)
    writeFileSync(join(candidate, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.mjs' } }))
    const entry = join(candidate, 'index.mjs')
    writeFileSync(entry, `export function renderMermaidSVG(source){return source.includes('INVALID')?'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start & broken</text></svg>':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start</text></svg>'}\n`)
    const built = await buildInvocationLibraryHarness({ out, harnessRoot }),
      result = join(out, 'result.json'),
      job = join(out, 'job.json')
    expect(existsSync(join(candidate, 'node_modules'))).toBe(false)
    const workload = { family: 'flowchart', features: [], provenance: 'authored relocated qualification regression', expectedLabels: ['Start'] }
    writeFileSync(
      job,
      JSON.stringify({
        root: candidate,
        entry,
        qualifier: built.qualifier,
        exportName: '.',
        workloads: [
          { ...workload, id: 'valid', source: 'flowchart LR\nA[Start]' },
          { ...workload, id: 'invalid', source: 'INVALID' },
        ],
        full: false,
        out: result,
        round: 1,
      }),
    )
    execFileSync(process.env.NODE_BIN ?? 'node', [built.worker, job], { cwd: candidate, timeout: 30_000 })
    const rows = JSON.parse(readFileSync(result, 'utf8')).rows as { caseId: string; operation: string; status: string; detail?: string }[]
    const valid = rows.filter(row => row.caseId === 'valid' && row.operation === 'renderMermaidSVG'),
      invalid = rows.filter(row => row.caseId === 'invalid' && row.operation === 'renderMermaidSVG')
    expect(valid.length).toBeGreaterThan(0)
    expect(valid.every(row => row.status === 'passed')).toBe(true)
    expect(invalid.length).toBeGreaterThan(0)
    expect(invalid.every(row => row.status === 'failed')).toBe(true)
    expect(rows.some(row => row.detail?.includes('requires the saxes'))).toBe(false)
    const qualifier = await import(pathToFileURL(built.qualifier).href)
    expect(qualifier.svgQualificationProvenance().nodeXmlParser).toEqual(built.provenance.nodeXmlParser)
    expect(built.provenance.nodeXmlParser.version).toBe(JSON.parse(readFileSync(built.provenance.nodeXmlParser.packageJson, 'utf8')).version)
    expect(JSON.parse(readFileSync(built.provenanceFile, 'utf8')).moduleResolutionAnchor).toBe(pathToFileURL(join(harnessRoot, 'eval/benchmark/unified/qualification.ts')).href)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
