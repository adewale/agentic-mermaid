import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../cli/index.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const SOURCE = `---
config:
  state:
    titleTopMargin: 10
---
stateDiagram-v2
  A --> B
`
const LEGIBILITY_SOURCE = 'flowchart LR\n  A[Start] -- go --> B[Finish]\n'

const temp = useTempDirs('am-config-warning-')

function fixture(): { source: string; png: string } {
  const dir = temp.dir()
  const source = join(dir, 'state.mmd')
  writeFileSync(source, SOURCE)
  return { source, png: join(dir, 'state.png') }
}


describe('CLI render config diagnostics', () => {
  test('SVG warns on stderr and includes the qualified warning in --json', () => {
    const { source } = fixture()
    const plain = capture(() => runCli(['render', source]))
    expect(plain.code).toBe(0)
    expect(plain.err).toContain('INEFFECTIVE_CONFIG (state.titleTopMargin)')

    const json = capture(() => runCli(['render', source, '--json']))
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out).warnings).toContainEqual(expect.objectContaining({ field: 'state.titleTopMargin' }))
  })

  test('PNG combines source config diagnostics with raster warnings in its JSON envelope', () => {
    const { source, png } = fixture()
    const result = capture(() => runCli(['render', source, '--format', 'png', '--output', png, '--json']))
    expect(result.code).toBe(0)
    expect(result.err.match(/state\.titleTopMargin/g)).toHaveLength(1)
    expect(JSON.parse(result.out).warnings).toContainEqual(expect.objectContaining({ field: 'state.titleTopMargin' }))
  })

  test('PNG reports a below-floor label warning on stderr and in JSON', () => {
    const dir = temp.dir('am-legibility-warning-')
    const source = join(dir, 'flow.mmd')
    writeFileSync(source, LEGIBILITY_SOURCE)

    const plain = capture(() => runCli([
      'render', source, '--format', 'png', '--output', join(dir, 'plain.png'), '--fit-width', '100',
    ]))
    expect(plain.code).toBe(0)
    expect(plain.err).toContain('BELOW_READABLE_SIZE')

    const json = capture(() => runCli([
      'render', source, '--format', 'png', '--output', join(dir, 'json.png'), '--fit-width', '100', '--json',
    ]))
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out).warnings).toContainEqual(expect.objectContaining({
      code: 'BELOW_READABLE_SIZE',
      cause: 'fitTo',
      floorPx: 9,
      effectiveMinLabelPx: expect.any(Number),
    }))
  })
})
