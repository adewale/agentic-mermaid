import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { prepareCommunityBrowsers, runCommunityBrowserSuite } from '../unified/community-browser.ts'
import { qualifyOutput } from '../unified/qualification.ts'

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`
const authored: { id: string; labels: string[]; output: string; accepted: boolean; source?: string }[] = [
  { id: 'decorated', labels: ['Free'], output: svg('<text>Free (60.0%)</text>'), accepted: true },
  { id: 'inert', labels: ['Cache'], output: svg('<defs><text>Cache</text></defs><metadata><text>Cache</text></metadata><text>Database</text>'), accepted: false },
  { id: 'prefix-collision', labels: ['C1'], output: svg('<text>C10</text>'), accepted: false },
  { id: 'angle-text', labels: ['<Customer>'], output: svg('<text>&lt;Customer&gt;</text>'), accepted: true },
  { id: 'decode-once', labels: ['&lt;Customer&gt;'], output: svg('<text>&amp;lt;Customer&amp;gt;</text>'), accepted: true },
  { id: 'prefixed', labels: ['Hello'], output: '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><s:text>Hello</s:text></s:svg>', accepted: true },
  { id: 'foreign-namespace', labels: ['Hello'], output: svg('<f:text xmlns:f="urn:unrelated">Hello</f:text>'), accepted: false },
  { id: 'positioned-lines', labels: ['First Second'], output: svg('<text><tspan x="0" y="10">First</tspan><tspan x="0" y="20">Second</tspan></text>'), accepted: true },
  { id: 'html-break', labels: ['First Second'], output: svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">First<br/>Second</div></foreignObject>'), accepted: true },
  { id: 'prefixed-source-echo', source: 'flowchart LR\n A[Start] --> B[End]', labels: ['Start', 'End'], output: '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><s:text>flowchart LR</s:text><s:text>A[Start] --&gt; B[End]</s:text></s:svg>', accepted: false },
]

const browserTest = process.env.AM_BROWSER_TESTS === '1' ? test : test.skip
browserTest(
  'Node and real browser XML adapters agree on independently authored text-retention cases',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-svg-host-qualification-'))
    try {
      const cases = authored.map(entry => ({ ...entry, source: entry.source ?? `flowchart LR\n %% ${entry.id}\n A[Fixture]` }))
      const workloads = cases.map(entry => ({ id: entry.id, family: 'flowchart', source: entry.source, expectedLabels: entry.labels, features: ['qualification-reader-fixture'], provenance: 'independently authored XML reader expectations; not a renderer benchmark' }))
      const module = join(directory, 'fixture.js')
      await build({ stdin: { contents: `const cases=${JSON.stringify(cases)};globalThis.fixtureRender=source=>cases.find(entry=>entry.source===source).output`, sourcefile: 'authored-qualification-fixture.js' }, outfile: module, bundle: true, format: 'iife', platform: 'browser', minify: true, logLevel: 'silent' })
      const out = join(directory, 'results')
      mkdirSync(out)
      const root = resolve(import.meta.dir, '../../..')
      const options = { root, harnessRoot: root, out, rounds: 1, profile: 'smoke' as const, communityCoverageOnce: true, communityQualificationAssetDir: join(directory, 'versioned-helper'), ...(process.env.AM_CHROMIUM_EXECUTABLE ? { executable: process.env.AM_CHROMIUM_EXECUTABLE } : {}) }
      const prepared = await prepareCommunityBrowsers([{ node: { id: 'authored-reader-fixture', roles: [], outputs: ['svg'], benchmark: { adapter: 'dart', outputs: ['svg'] } }, artifact: { kind: 'global', root: directory, module, global: 'fixtureRender', version: 'authored-fixture' } }], options)
      const result = await runCommunityBrowserSuite(prepared, workloads, options)
      for (const entry of cases) {
        const workload = workloads.find(row => row.id === entry.id)!
        expect(qualifyOutput(workload, entry.output, 'svg').ok).toBe(entry.accepted)
        const rows = result.observations.filter(row => row.caseId === entry.id)
        expect(rows).toHaveLength(1)
        expect(rows[0]!.status === 'passed').toBe(entry.accepted)
        expect(rows[0]!.samplesMs).toBeUndefined()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
