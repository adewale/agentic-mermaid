import { harnessFile } from 'trident/unified/harness-paths.ts'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { newerFamilies, requiredExternalFamilyCases } from 'trident/portable/cohorts.ts'
import { MERMAID_ORACLE_PIN, mermaidUpstreamDirectory } from 'trident/portable/mermaid-oracle.ts'
import { type CommunityCorpus } from 'trident/unified/corpus.ts'
import type { UnifiedWorkload } from 'trident/unified/types.ts'

type AgenticWorkloads = Pick<CommunityCorpus, 'core' | 'profiles' | 'workloads'>

/** Run the workload owners in their actual Agentic Mermaid checkout. */
async function agenticWorkloads(unified: string): Promise<AgenticWorkloads> {
  const owner = (file: string) => import(pathToFileURL(join(unified, file)).href)
  const { communityCoreWorkloads } = await import('trident/unified/community.ts')
  const { unifiedWorkloads, getWorkloadEvidence } = await owner('workloads.ts')
  const full: UnifiedWorkload[] = unifiedWorkloads('full'),
    smoke: UnifiedWorkload[] = unifiedWorkloads('smoke')
  return {
    core: communityCoreWorkloads(),
    profiles: { smoke: smoke.map(workload => workload.id), full: full.map(workload => workload.id) },
    workloads: full.map(workload => ({ ...workload, evidence: getWorkloadEvidence(workload.id) ?? null })),
  }
}

import { mermaidDocsWorkloads } from 'trident/unified/docs-corpus.ts'

/** Freeze an Agentic Mermaid checkout's community workload corpus into Trident, with the
 * newer families' documented examples. Agentic owns its inputs (its family registry,
 * portfolios and imported Mermaid suites). Agentic owns these workload producers; Trident consumes the explicit frozen export. Labels are not copied: each run
 * derives them from the pinned Mermaid oracle. */
export function importCommunityCorpus(agentic: string, out: string, upstream = mermaidUpstreamDirectory()): CommunityCorpus {
  if (JSON.parse(readFileSync(join(agentic, 'package.json'), 'utf8')).name !== 'agentic-mermaid') throw Error('Corpus import needs an Agentic Mermaid checkout: ' + agentic)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: agentic, encoding: 'utf8' }).trim()
  // The workspace also refuses changes, but name the import's own reason first.
  if (git('status', '--porcelain', '--', 'eval', 'src')) throw Error('Import the corpus from committed Agentic sources, so its recorded commit describes it')
  const commit = git('rev-parse', 'HEAD')
  const workloads = (() => {
    const result = spawnSync(process.execPath, ['run', harnessFile(agentic, 'eval/benchmark/unified/corpus-import.ts'), '--emit'], { cwd: agentic, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] })
    if (result.error) throw result.error
    if (result.status !== 0) throw Error(`Corpus owners failed in the Agentic checkout (exit ${result.status})`)
    return JSON.parse(result.stdout) as AgenticWorkloads
  })()
  const docs = mermaidDocsWorkloads(upstream)
  const external = requiredExternalFamilyCases().map(testCase => ({ id: testCase.id, family: testCase.family, source: testCase.source, expectedLabels: testCase.expected.labels, features: ['authored-required-external-family'], provenance: 'Independent authored required external family representative; full semantics remain in the dedicated fidelity suite', evidence: null }))
  const corpus: CommunityCorpus = {
    schemaVersion: 1,
    source: { repository: 'adewale/agentic-mermaid', commit, dirty: false },
    upstream: docs.upstream,
    core: workloads.core,
    profiles: { smoke: [...workloads.profiles.smoke, ...docs.smoke, ...external.map(workload => workload.id)], full: [...workloads.profiles.full, ...docs.workloads.map(workload => workload.id), ...external.map(workload => workload.id)] },
    workloads: [...workloads.workloads, ...docs.workloads, ...external],
  }
  writeFileSync(out, JSON.stringify(corpus, null, 1) + '\n')
  return corpus
}

if (import.meta.main) {
  if (process.argv[2] === '--emit') process.stdout.write(JSON.stringify(await agenticWorkloads(import.meta.dirname)))
  else {
    const agentic = resolve(import.meta.dirname, '../../..')
    if (!agentic) throw Error('Set TRIDENT_AGENTIC_ROOT to the Agentic Mermaid checkout whose corpus to import')
    const output = process.argv.indexOf('--out')
    if (output < 0 || !process.argv[output + 1]) throw Error('Use --out FILE to export the product corpus; the pinned Trident library is read-only')
    const corpus = importCommunityCorpus(resolve(agentic), resolve(process.argv[output + 1]!))
    console.log(JSON.stringify({ file: resolve(process.argv[output + 1]!), source: corpus.source, core: corpus.core.length, smoke: corpus.profiles.smoke.length, full: corpus.profiles.full.length }))
  }
}
