import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { communityCoreWorkloads, runCommunitySuite } from '../unified/community.ts'

test('a community tool that rejects a family canonical source runs none of that family, and keeps failures elsewhere', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-family-support-'))
  try {
    const cli = join(directory, 'flow-only'),
      calls = join(directory, 'calls.txt')
    // Draws flowcharts (badly: it echoes no labels); exits nonzero for every other header.
    writeFileSync(cli, `#!${process.execPath}\nconst fs=require('node:fs'),source=fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(calls)},source.split('\\n')[0]+'\\n');if(!/^(flowchart|graph)\\b/.test(source)){console.error('unsupported graph type');process.exit(1)}console.log('[box]')`)
    chmodSync(cli, 0o755)
    const node = { id: 'fixture/flow-only', roles: ['renderer'], outputs: ['terminal'], benchmark: { adapter: 'fixture', outputs: ['terminal'] } }
    const files = { catalog: join(directory, 'catalog.json'), prepared: join(directory, 'prepared.json'), browser: join(directory, 'browser.json'), inputs: join(directory, 'inputs.json') }
    writeFileSync(files.catalog, JSON.stringify({ nodes: [node] }))
    writeFileSync(files.prepared, JSON.stringify([{ node, artifact: { kind: 'cli', executable: cli, sha256: createHash('sha256').update(readFileSync(cli)).digest('hex'), version: '1.0.0', runtime: 'fixture' } }]))
    writeFileSync(files.browser, JSON.stringify([{ node, browserStatus: 'not-applicable', browserDetail: 'CLI fixture' }]))
    const features = [
      { id: 'feature:pie', family: 'pie', source: 'pie\n"Alpha" : 1', expectedLabels: ['Alpha'], features: [], provenance: 'authored family-support fixture' },
      { id: 'feature:flowchart', family: 'flowchart', source: 'flowchart LR\nA[Alpha] --> B[Beta]', expectedLabels: ['Alpha', 'Beta'], features: [], provenance: 'authored family-support fixture' },
    ]
    writeFileSync(files.inputs, JSON.stringify({ workloads: [...communityCoreWorkloads(), ...features] }))
    const root = resolve(import.meta.dir, '../../..')
    const result = await runCommunitySuite({ root, harnessRoot: root, out: join(directory, 'out'), profile: 'smoke', rounds: 1, communityProjects: [node.id], communityCatalogFile: files.catalog, communityPreparedFile: files.prepared, communityBrowserPreparedFile: files.browser, communityInputsFile: files.inputs })
    const rows = (caseId: string) => result.observations.filter(row => row.caseId === caseId).map(row => ({ operation: row.operation, status: row.status }))
    expect(rows('family-support:pie')).toEqual([{ operation: 'family-support', status: 'unsupported' }])
    expect(rows('feature:pie')).toEqual([{ operation: 'render', status: 'unsupported' }])
    expect(result.observations.find(row => row.caseId === 'feature:pie')!.detail).toContain('family-support:pie')
    // An accepted probe keeps the family supported: its unqualified output is a failure, not unsupported.
    expect(rows('family-support:flowchart')).toEqual([{ operation: 'family-support', status: 'failed' }])
    expect(rows('feature:flowchart')).toEqual([{ operation: 'render', status: 'failed' }])
    // The only pie source the tool saw was its probe.
    expect(readFileSync(calls, 'utf8').split('\n').filter(line => line.startsWith('pie'))).toHaveLength(1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)

test('an error that says unsupported, inside a supported family, is a failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-unsupported-message-'))
  try {
    const module = join(directory, 'fixture.mjs')
    // Renders flowcharts, but one feature's error names itself "unsupported".
    writeFileSync(module, `globalThis.fixtureRender=source=>{if(!source.startsWith('flowchart'))throw Error('Invalid mermaid header');if(source.includes('~~~'))throw Error('unsupported graph direction');return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Alpha</text><text>Beta</text><text>Gamma</text></svg>'}`)
    const node = { id: 'fixture/flow-only-api', roles: ['renderer'], outputs: ['svg'], benchmark: { adapter: 'fixture', outputs: ['svg'] } }
    const files = { catalog: join(directory, 'catalog.json'), prepared: join(directory, 'prepared.json'), browser: join(directory, 'browser.json'), inputs: join(directory, 'inputs.json') }
    writeFileSync(files.catalog, JSON.stringify({ nodes: [node] }))
    writeFileSync(files.prepared, JSON.stringify([{ node, artifact: { kind: 'global', module, global: 'fixtureRender', sha256: createHash('sha256').update(readFileSync(module)).digest('hex'), version: '1.0.0' } }]))
    writeFileSync(files.browser, JSON.stringify([{ node, browserStatus: 'not-applicable', browserDetail: 'Node fixture' }]))
    const feature = { id: 'feature:invisible-link', family: 'flowchart', source: 'flowchart LR\nA[Alpha] ~~~ B[Beta]', expectedLabels: ['Alpha', 'Beta'], features: [], provenance: 'authored unsupported-message fixture' }
    writeFileSync(files.inputs, JSON.stringify({ workloads: [...communityCoreWorkloads(), feature] }))
    const root = resolve(import.meta.dir, '../../..')
    const result = await runCommunitySuite({ root, harnessRoot: root, out: join(directory, 'out'), profile: 'smoke', rounds: 1, communityProjects: [node.id], communityCatalogFile: files.catalog, communityPreparedFile: files.prepared, communityBrowserPreparedFile: files.browser, communityInputsFile: files.inputs })
    const row = result.observations.find(row => row.caseId === feature.id)!
    expect({ status: row.status, detail: row.detail }).toEqual({ status: 'failed', detail: 'Error: unsupported graph direction' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)
