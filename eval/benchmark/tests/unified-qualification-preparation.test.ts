import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareQualificationRepair } from '../unified/prepare-community-qualification-repair.ts'

const driver = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
test('qualification preparation preserves admitted old bytes and gives every frozen peer a fresh helper proof', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-qualification-asset-'))
  try {
    const base = join(directory, 'base'), out = join(directory, 'fresh'), helper = join(directory, 'qualification.js'), entry = join(directory, 'engine.js')
    mkdirSync(base)
    mkdirSync(out) // Empty logical storage directories are permitted, evidence overwrite is not.
    writeFileSync(helper, 'globalThis.originalAdmittedHelper=true;\n')
    writeFileSync(entry, 'globalThis.actualEngineRemainsUnchanged=true;\n')
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex'), before = digest(helper)
    const peers = Array.from({ length: 84 }, (_, index) => ({ node: { id: `fixture/${index}`, roles: ['renderer'], outputs: ['svg'], benchmark: { adapter: 'fixture', outputs: ['svg'] } }, browserStatus: 'prepared', browser: { root: directory, entry: 'engine.js', kind: 'function', version: 'fixture', artifactSha256: digest(entry), qualificationHelper: helper, files: [{ path: entry, sha256: digest(entry) }, { path: helper, sha256: before }] } }))
    writeFileSync(join(base, 'community-browser-prepared.json'), JSON.stringify(peers))
    const manifest = await prepareQualificationRepair({ base, out, driver, protocol: 'fixture-v3' })
    expect(digest(helper)).toBe(before)
    expect(manifest.freshHelper.path).not.toBe(helper)
    expect(readFileSync(manifest.freshHelper.path, 'utf8')).toContain('inspectSvgText')
    const fresh = JSON.parse(readFileSync(join(out, 'community-browser-prepared.json'), 'utf8'))
    expect(fresh).toHaveLength(84)
    expect(fresh.every((peer: any) => peer.browser.qualificationHelper === manifest.freshHelper.path && peer.browser.files.some((file: any) => file.path === entry && file.sha256 === digest(entry)))).toBe(true)
    await expect(prepareQualificationRepair({ base, out, driver, protocol: 'fixture-v3' })).rejects.toThrow('fresh correction')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
