#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface ReleaseIdentity {
  tag: string
  packageVersion: string
  serverVersion: string
  packageServerVersion: string
  head: string
  tagCommit: string
}

export function validateReleaseIdentity(identity: ReleaseIdentity): void {
  const expectedTag = `v${identity.packageVersion}`
  if (identity.tag !== expectedTag) throw new Error(`Release tag ${identity.tag} does not match package version ${expectedTag}`)
  if (identity.serverVersion !== identity.packageVersion) throw new Error(`server.json version ${identity.serverVersion} does not match package version ${identity.packageVersion}`)
  if (identity.packageServerVersion !== identity.packageVersion) throw new Error(`server.json package version ${identity.packageServerVersion} does not match package version ${identity.packageVersion}`)
  if (identity.tagCommit !== identity.head) throw new Error(`Release tag ${identity.tag} points to ${identity.tagCommit}, not checked-out HEAD ${identity.head}`)
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..', '..')
  const tag = process.env.RELEASE_TAG?.trim()
  if (!tag) throw new Error('RELEASE_TAG is required')
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const serverJson = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
    version: string
    packages: Array<{ version: string }>
  }
  const identity: ReleaseIdentity = {
    tag,
    packageVersion: packageJson.version,
    serverVersion: serverJson.version,
    packageServerVersion: serverJson.packages[0]?.version ?? '',
    head: git(root, ['rev-parse', 'HEAD']),
    tagCommit: git(root, ['rev-list', '-n', '1', tag]),
  }
  validateReleaseIdentity(identity)
  console.log(`Release identity verified: ${identity.tag} -> ${identity.head}`)
}
