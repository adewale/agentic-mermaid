import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'bun:test'

function packageVersion(entryPath: string): string {
  let directory = dirname(entryPath)
  const root = parse(directory).root
  while (directory !== root) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
      if (typeof manifest.version === 'string') return manifest.version
    }
    directory = dirname(directory)
  }
  throw new Error(`could not resolve package version for ${entryPath}`)
}

describe('dependency security overrides', () => {
  test('express-rate-limit resolves the patched ip-address implementation', () => {
    const rootRequire = createRequire(import.meta.url)
    const consumerRequire = createRequire(rootRequire.resolve('express-rate-limit'))
    const ipAddressEntry = consumerRequire.resolve('ip-address')
    const { Address4 } = consumerRequire('ip-address') as {
      Address4: new (address: string) => unknown
    }

    expect(packageVersion(ipAddressEntry)).toBe('10.3.1')
    expect(() => new Address4('127.0.0.01')).toThrow()
  })
})
