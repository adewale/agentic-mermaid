import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communityCliCacheIdentity, observeCommunityResourceTool, rankCommunityCliResources, runCommunityCliSuite, runCommunityResourceDiagnostic } from '../unified/community-cli.ts'
import { communityCoreWorkloads } from '../unified/community.ts'
import { readBenchmarkDocument } from '../portable/project-records.ts'

test('explicit observer identity is bound and invalid artifacts retain actual resource costs without qualifying', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-resource-observer-'))
  try {
    const observer = join(directory, 'observer.cjs'),
      invalid = join(directory, 'invalid.cjs')
    writeFileSync(
      observer,
      `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');if(process.argv.includes('--version')){console.log('fixture (GNU Time) UNKNOWN');process.exit(0)}const args=process.argv.slice(2),out=args[args.indexOf('-o')+1],start=args.indexOf('--')+1;const child=cp.spawnSync(args[start],args.slice(start+1),{input:fs.readFileSync(0),encoding:'utf8'});fs.writeFileSync(out,'user_seconds=0.00\\nsystem_seconds=0.00\\npeak_rss_kib=1234\\n');process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');process.exit(child.status||0);`,
    )
    chmodSync(observer, 0o755)
    writeFileSync(invalid, `console.log('<svg>broken output</svg>')`)
    const observed = observeCommunityResourceTool(observer)
    expect(observed.error).toBeUndefined()
    expect(observed.version).toBe('fixture (GNU Time) UNKNOWN')
    expect(observed.sha256).toHaveLength(64)
    const variant = {
      prepared: { node: { id: 'fixture/invalid', roles: ['renderer'], outputs: ['svg'], benchmark: { adapter: 'fixture', outputs: ['svg'] } }, artifact: { kind: 'cli' as const, executable: process.execPath, args: [invalid], version: 'fixture' } },
      variantOf: 'fixture/invalid',
      variant: 'public-cli',
      outputs: ['svg'],
    }
    const workload = { id: 'core:flow5', family: 'flowchart', source: 'flowchart LR\nA[Start]', expectedLabels: ['Start'], features: ['core-graph-batch'], provenance: 'authored resource admission regression' }
    const result = runCommunityResourceDiagnostic(variant, 'svg', workload, observed, directory)
    expect(result.status).toBe('failed')
    expect(result.samplesMs).toBeUndefined()
    expect(result.metrics).toMatchObject({ userCpuMs: 0, systemCpuMs: 0, cpuBelowResolution: true, totalCpuUpperBoundMs: 20, peakRssBytes: 1234 * 1024 })
    expect(rankCommunityCliResources([variant], [result], [workload])[0]?.qualified).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a configured observer is the one community updates bind and run, not the host default', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-configured-observer-'))
  try {
    const observer = join(directory, 'gtime')
    writeFileSync(observer, `#!${process.execPath}\nconsole.log('fixture (GNU Time) configured')`)
    chmodSync(observer, 0o755)
    const identity = communityCliCacheIdentity({ target: process.cwd(), packageRoot: process.cwd(), observerExecutable: observer }, [])
    expect(identity.observer).toMatchObject({ path: realpathSync(observer), version: 'fixture (GNU Time) configured' })
    expect(communityCliCacheIdentity({ target: process.cwd(), packageRoot: process.cwd(), observerExecutable: join(directory, 'other') }, []).observer).not.toEqual(identity.observer)
    const community = join(directory, 'community')
    mkdirSync(community)
    writeFileSync(join(community, 'community-prepared.json'), JSON.stringify([{ node: { id: 'owner/api', roles: [], outputs: ['svg'], benchmark: { adapter: 'published-extra', outputs: ['svg'] } }, artifact: { kind: 'node', version: '1.0' } }]))
    writeFileSync(join(community, 'community-inputs.json'), JSON.stringify({ workloads: communityCoreWorkloads() }))
    writeFileSync(join(community, 'community-result.json'), JSON.stringify({ id: 'community', finishedAt: 'done', observations: [] }))
    await runCommunityCliSuite({ out: join(directory, 'community-cli'), root: process.cwd(), profile: 'smoke', rounds: 1, observerExecutable: observer })
    expect(readBenchmarkDocument(join(directory, 'community-cli', 'community-cli-result.json')).evidence.resourceObserver).toEqual(identity.observer)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
