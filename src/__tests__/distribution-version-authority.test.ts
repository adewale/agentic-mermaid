import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const json = (path: string): any => JSON.parse(readFileSync(join(root, path), 'utf8'))

describe('package version authority', () => {
  test('all committed distribution projections match package.json', () => {
    const pkg = json('package.json')
    const local = json('server.json')
    const hosted = json('website/source/mcp-registry/server.json')
    const llms = readFileSync(join(root, 'llms.txt'), 'utf8')
    expect(local.name).toBe(pkg.mcpName)
    expect(local.version).toBe(pkg.version)
    expect(local.packages.filter((entry: any) => entry.identifier === pkg.name)).toEqual([
      expect.objectContaining({ identifier: pkg.name, version: pkg.version }),
    ])
    expect(hosted.version).toBe(pkg.version)
    expect(llms).toContain(`\nVersion: ${pkg.version}\n`)
  })
})
