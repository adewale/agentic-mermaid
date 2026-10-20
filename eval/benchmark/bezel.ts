import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Engine } from './release-browser-bench.ts'

/** Admit the actual wrapper bytes before any installation or browser work. */
export function bezelEngine(directory: string): Engine {
  const root = resolve(directory)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { revision: string; version: string; bundleSha256: string }
  if (!/^[a-f0-9]{40}$/.test(manifest.revision) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid Bezel revision/version')
  const sha256 = createHash('sha256').update(readFileSync(join(root, 'bezel.js'))).digest('hex')
  if (sha256 !== manifest.bundleSha256) throw new Error('Bezel bundle SHA-256 mismatch')
  return { label: 'bezel', name: 'bezel-mermaid', version: manifest.version, root, kind: 'bezel', bundle: 'bezel.js', global: 'bezelRender',
    identity: { integrity: `sha256-${Buffer.from(sha256, 'hex').toString('base64')}`, bundleSha256: sha256, revision: manifest.revision } }
}
