import { readBenchmarkDocument } from '../portable/project-records.ts'
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admitPreparedFidelityEngine, runCommunityFidelitySuite } from '../fidelity/community.ts'
import type { PreparedCommunityBrowser } from '../unified/community-browser.ts'

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function fixture(root: string): PreparedCommunityBrowser {
  const entry = join(root, 'bundle.js'), asset = join(root, 'engine.wasm')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fidelity-test-engine', version: '1.0.0' }))
  writeFileSync(entry, 'globalThis.fidelityTestEngine=()=>"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"')
  writeFileSync(asset, 'actual frozen asset bytes')
  return { node: { id: 'test/fidelity-engine', roles: ['peer'], outputs: ['svg'] }, artifact: { kind: 'global', root, module: entry, version: '1.0.0' }, browserStatus: 'prepared', browser: { root, entry: 'bundle.js', global: 'fidelityTestEngine', kind: 'function', version: '1.0.0', artifactSha256: sha(entry), files: [entry, asset].map(path => ({ path, sha256: sha(path) })) } }
}

test('community admission checks actual executable bytes, missing assets, installed versions and tool-set pins', () => {
  const root = mkdtempSync(join(tmpdir(), 'fidelity-admission-'))
  try {
    let peer = fixture(root)
    expect(admitPreparedFidelityEngine(peer).files.length).toBe(2)
    writeFileSync(join(root, 'bundle.js'), 'changed executable')
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('bytes changed')
    peer = fixture(root); unlinkSync(join(root, 'engine.wasm'))
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('disappeared')
    peer = fixture(root); writeFileSync(join(root, 'engine.wasm'), 'changed dependency')
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('asset changed')
    peer = fixture(root); writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.0' }))
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('package version')
    peer = fixture(root); peer.browser!.version = '2.0.0'
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('versions disagree')
    peer = fixture(root); peer.node.id = 'obsidianmd/pele'; peer.artifact!.version = peer.browser!.version = '1.8.0'; writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.8.0' }))
    expect(() => admitPreparedFidelityEngine(peer)).toThrow('1.9.0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('project selection precedes admission and returned SVG cannot forge observer labels with event handlers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fidelity-selected-'))
  try {
    const peer = fixture(root), entry = join(root, 'bundle.js')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" onload="document.querySelector('#payload').textContent='Alpha'"><rect x="1" y="1" width="190" height="90" fill="white"/><text id="payload" x="10" y="20">Wrong</text><text x="10" y="40">Beta</text><text x="10" y="60">Gamma</text></svg>`
    writeFileSync(entry, `globalThis.fidelityTestEngine=()=>${JSON.stringify(svg)}`)
    peer.browser!.artifactSha256 = sha(entry); peer.browser!.files![0]!.sha256 = sha(entry)
    const excluded = { ...peer, node: { ...peer.node, id: 'test/unselected-engine' }, browser: { ...peer.browser!, entry: 'missing.js' } }
    const catalog = join(root, 'catalog.json'), prepared = join(root, 'prepared.json'), out = join(root, 'out')
    writeFileSync(catalog, JSON.stringify({ nodes: [peer.node, excluded.node] })); writeFileSync(prepared, JSON.stringify([peer, excluded]))
    const result = await runCommunityFidelitySuite({ root: process.cwd(), harnessRoot: process.cwd(), out, profile: 'full', rounds: 1, fidelityDiagnostic: true, fidelityCaseIds: ['meaning:family:flowchart'], communityProjects: [peer.node.id], communityBrowserPreparedFile: prepared, communityCatalogFile: catalog, communityFidelityPng: 'none' })
    expect(result.observations.every(row => row.metrics?.implementation === peer.node.id)).toBe(true)
    const report = readBenchmarkDocument(join(out, 'community-fidelity-report.json'))
    expect(report.boundaries.find((row: any) => row.project === excluded.node.id).status).toBe('not-selected')
    const receipt = JSON.parse(readFileSync(result.artifacts!.find(path => path.endsWith('community-fidelity-cases.json'))!, 'utf8'))
    expect(receipt.initialized).toBe(true)
    const labels = receipt.rows[0].findings.find((item: any) => item.criterion === 'visible-authored-labels')
    expect(labels.actual.find((item: any) => item.label === 'Alpha').count).toBe(0)
    expect(result.observations.filter(row => row.surface === 'native-public-api').every(row => row.status === 'blocked')).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
