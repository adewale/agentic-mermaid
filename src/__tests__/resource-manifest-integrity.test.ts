import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { HOSTED_FONT_RESOURCES, RESOURCE_MANIFEST, validateResourceManifest } from '../font-manifest.ts'
import {
  NodeResourceResolver,
  ResourceResolutionError,
} from '../node-resource-resolver.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { snapshotResourceManifest, verifyResourceBytes, type ResourceManifest, type ResourceManifestEntry } from '../resource-manifest.ts'

const roots: string[] = []
const PACKAGE_VERSION = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')).version as string
const ESCAPED_PACKAGE_VERSION = PACKAGE_VERSION.replaceAll('.', '\\.')
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-resource-'))
  roots.push(root)
  mkdirSync(join(root, 'assets', 'fonts'), { recursive: true })
  writeFileSync(join(root, 'LICENSE.txt'), 'fixture licence')
  return root
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixtureEntry(
  path: string,
  bytes: Uint8Array,
  overrides: Partial<Omit<ResourceManifestEntry, 'identity' | 'path'>> = {},
): ResourceManifestEntry {
  return {
    identity: createExtensionIdentity({
      id: 'resource:test/fixture.ttf',
      kind: 'resource',
      version: '1.0.0',
      provenance: { owner: 'test', source: 'fixture' },
    }),
    path,
    mediaType: 'font/ttf',
    sha256: digest(bytes),
    bytes: bytes.byteLength,
    license: { spdx: 'OFL-1.1', noticePath: 'LICENSE.txt' },
    required: true,
    network: 'forbidden',
    ...overrides,
  }
}

function manifest(entry: ResourceManifestEntry): ResourceManifest {
  return { version: 1, resources: [entry] }
}

function trueTypeFixture(...tail: number[]): Uint8Array {
  return new Uint8Array([0x00, 0x01, 0x00, 0x00, ...tail])
}

function expectCode(run: () => unknown, code: ResourceResolutionError['code']): void {
  try {
    run()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError)
    expect((error as ResourceResolutionError).code).toBe(code)
  }
}

describe('content-addressed installed resource manifest', () => {
  test('the shipped font manifest is structurally valid and every declared byte verifies', () => {
    expect(validateResourceManifest()).toEqual([])
    const root = join(import.meta.dir, '..', '..')
    const result = new NodeResourceResolver(root, RESOURCE_MANIFEST).verifyInstalled()
    expect(result.diagnostics).toEqual([])
    expect(result.resources.map(resource => resource.entry.identity.id)).toEqual(
      HOSTED_FONT_RESOURCES.map(resource => resource.identity.id),
    )
    for (const resource of result.resources) {
      const first = resource.readBytes()
      const second = resource.readBytes()
      expect(first).not.toBe(second)
      expect(first.byteLength).toBe(resource.entry.bytes)
      first[0] = 0xff
      expect(second[0]).toBe(0x00)
    }
  })

  test('plain Node verifies shipped resources when /dev/fd realpath is not canonical', async () => {
    const node = (() => {
      for (const candidate of [process.env.NODE_BINARY, 'node'].filter((value): value is string => Boolean(value))) {
        try { if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate } catch {}
      }
      return undefined
    })()
    if (!node) return

    // Bundle the resolver itself so this regression exercises plain Node, not
    // Bun's macOS /dev/fd canonicalization and not a possibly stale dist/ tree.
    const outdir = mkdtempSync(join(tmpdir(), 'agentic-mermaid-node-resolver-'))
    roots.push(outdir)
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, '..', 'node-resource-resolver.ts')],
      outdir,
      target: 'node',
      format: 'esm',
      naming: 'resolver.js',
    })
    expect(build.success, build.logs.map(log => log.message).join('\n')).toBe(true)
    const resolverUrl = pathToFileURL(build.outputs[0]!.path).href
    const packageRoot = join(import.meta.dir, '..', '..')
    const script = `
      const { NodeResourceResolver } = await import(${JSON.stringify(resolverUrl)});
      const result = new NodeResourceResolver(
        ${JSON.stringify(packageRoot)},
        ${JSON.stringify(RESOURCE_MANIFEST)}
      ).verifyInstalled();
      process.stdout.write(JSON.stringify({
        resources: result.resources.length,
        diagnostics: result.diagnostics.length,
      }));
    `
    const run = spawnSync(node, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({
      resources: HOSTED_FONT_RESOURCES.length,
      diagnostics: 0,
    })
  })

  test('rejects traversal and absolute paths before touching the filesystem', () => {
    const bytes = trueTypeFixture(1)
    for (const path of ['../outside.ttf', '/tmp/outside.ttf', 'assets//bad.ttf', 'assets/./bad.ttf']) {
      const bad = manifest(fixtureEntry(path, bytes))
      expect(validateResourceManifest(bad)).toContain(`unsafe resource path: resource:test/fixture.ttf`)
      expectCode(() => new NodeResourceResolver(fixtureRoot(), bad), 'INVALID_RESOURCE_MANIFEST')
    }
  })

  test('validates untrusted shapes and delegates identity rules to the shared authority', () => {
    expect(validateResourceManifest(null)).toEqual(['resource manifest must be a plain object'])
    expect(validateResourceManifest({ version: 1, resources: null })).toEqual(['resource manifest resources must be an array'])

    const bytes = trueTypeFixture(1)
    const entry = fixtureEntry('assets/fonts/fixture.ttf', bytes)
    expect(validateResourceManifest({ version: 1, resources: [entry], futureMode: true }).join('\n'))
      .toContain('unknown resource manifest field "futureMode"')
    expect(validateResourceManifest({ version: 1, resources: [{ ...entry, executable: true }] }).join('\n'))
      .toContain('unknown resource entry field "executable"')
    const wrongNamespace = {
      version: 1,
      resources: [{ ...entry, identity: { ...entry.identity, id: 'look:not-a-resource' } }],
    }
    expect(validateResourceManifest(wrongNamespace).join('\n')).toContain('must use the "resource:" namespace')

    const badVersion = {
      version: 1,
      resources: [{ ...entry, identity: { ...entry.identity, version: 'tomorrow' } }],
    }
    expect(validateResourceManifest(badVersion).join('\n')).toContain('requires a semantic version')

    const badProvenance = {
      version: 1,
      resources: [{
        ...entry,
        identity: { ...entry.identity, provenance: { owner: '', source: '' } },
      }],
    }
    expect(validateResourceManifest(badProvenance).join('\n')).toContain('requires a provenance owner')
    const incompatibleCore = {
      version: 1,
      resources: [{
        ...entry,
        identity: { ...entry.identity, compatibility: { core: '^99.0.0' } },
      }],
    }
    expect(validateResourceManifest(incompatibleCore).join('\n'))
      .toMatch(new RegExp(`incompatible requirements.*core.*\\^99\\.0\\.0.*host version ${ESCAPED_PACKAGE_VERSION}`, 'i'))
    expect(() => snapshotResourceManifest(badVersion)).toThrow('INVALID_RESOURCE_MANIFEST')
    expect(() => snapshotResourceManifest(incompatibleCore)).toThrow('INVALID_RESOURCE_MANIFEST')
  })

  test('checks duplicate identities and paths from admitted snapshots, never re-read caller records', () => {
    const accessorEntry = (index: number) => {
      const reads = { id: 0, path: 0 }
      const identity: Record<string, unknown> = {
        kind: 'resource',
        version: '1.0.0',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'test', source: 'getter-sabotage' },
      }
      Object.defineProperty(identity, 'id', {
        enumerable: true,
        get() {
          reads.id++
          return reads.id === 1 ? 'resource:test/shared.ttf' : `resource:test/bookkeeping-${index}.ttf`
        },
      })
      const entry: Record<string, unknown> = {
        identity,
        mediaType: 'font/ttf',
        sha256: '0'.repeat(64),
        bytes: 4,
        license: { spdx: 'OFL-1.1', noticePath: 'LICENSE.txt' },
        required: true,
        network: 'forbidden',
      }
      Object.defineProperty(entry, 'path', {
        enumerable: true,
        get() {
          reads.path++
          return reads.path === 1 ? 'assets/fonts/shared.ttf' : `assets/fonts/bookkeeping-${index}.ttf`
        },
      })
      return { entry, reads }
    }
    const first = accessorEntry(1)
    const second = accessorEntry(2)
    const candidate = { version: 1, resources: [first.entry, second.entry] }

    expect(validateResourceManifest(candidate)).toEqual([
      'duplicate resource id: resource:test/shared.ttf',
      'duplicate resource path: assets/fonts/shared.ttf',
    ])
    expect(first.reads).toEqual({ id: 1, path: 1 })
    expect(second.reads).toEqual({ id: 1, path: 1 })
    const snapshotFirst = accessorEntry(1)
    const snapshotSecond = accessorEntry(2)
    expect(() => snapshotResourceManifest({
      version: 1,
      resources: [snapshotFirst.entry, snapshotSecond.entry],
    })).toThrow(/duplicate resource id: resource:test\/shared\.ttf/)
  })

  test('takes a deeply immutable manifest snapshot before filesystem resolution', () => {
    const root = fixtureRoot()
    const bytes = trueTypeFixture(7, 8)
    writeFileSync(join(root, 'assets', 'fonts', 'fixture.ttf'), bytes)
    const original = fixtureEntry('assets/fonts/fixture.ttf', bytes)
    const mutable = {
      version: 1,
      resources: [{
        ...original,
        identity: {
          ...original.identity,
          compatibility: { ...original.identity.compatibility },
          provenance: { ...original.identity.provenance },
        },
        license: { ...original.license },
      }],
    }
    const resolver = new NodeResourceResolver(root, mutable)

    mutable.version = 2
    mutable.resources[0]!.path = 'assets/fonts/replaced.ttf'
    mutable.resources[0]!.identity.id = 'resource:test/replaced.ttf'
    mutable.resources[0]!.identity.provenance.owner = 'mutated'
    mutable.resources[0]!.license.noticePath = 'MISSING.txt'

    const listed = resolver.list()[0]!
    expect(listed.path).toBe('assets/fonts/fixture.ttf')
    expect(listed.identity.id).toBe('resource:test/fixture.ttf')
    expect(listed.identity.provenance.owner).toBe('test')
    expect(Object.isFrozen(resolver.list())).toBe(true)
    expect(Object.isFrozen(listed)).toBe(true)
    expect(Object.isFrozen(listed.identity)).toBe(true)
    expect(Object.isFrozen(listed.identity.provenance)).toBe(true)
    expect(Object.isFrozen(listed.license)).toBe(true)
    expect(resolver.resolve('resource:test/fixture.ttf').readBytes()).toEqual(bytes)
  })

  test('rejects a symlink even when its target remains inside the package root', () => {
    const root = fixtureRoot()
    const bytes = trueTypeFixture(2)
    writeFileSync(join(root, 'assets', 'fonts', 'target.ttf'), bytes)
    symlinkSync('target.ttf', join(root, 'assets', 'fonts', 'link.ttf'))
    const resolver = new NodeResourceResolver(root, manifest(fixtureEntry('assets/fonts/link.ttf', bytes)))
    expectCode(() => resolver.resolve('resource:test/fixture.ttf'), 'RESOURCE_SYMLINK_REJECTED')
  })

  test('rejects declared-size, host-limit, media-type, digest, and licence failures', () => {
    const bytes = trueTypeFixture(3, 4, 5)

    const sizeRoot = fixtureRoot()
    writeFileSync(join(sizeRoot, 'assets', 'fonts', 'fixture.ttf'), bytes)
    const wrongSize = fixtureEntry('assets/fonts/fixture.ttf', bytes, { bytes: bytes.byteLength + 1 })
    expectCode(() => new NodeResourceResolver(sizeRoot, manifest(wrongSize)).resolve(wrongSize.identity.id), 'RESOURCE_SIZE_MISMATCH')
    expectCode(() => new NodeResourceResolver(sizeRoot, manifest(fixtureEntry('assets/fonts/fixture.ttf', bytes)), { maxResourceBytes: 4 }).resolve('resource:test/fixture.ttf'), 'RESOURCE_SIZE_LIMIT')

    const mimeRoot = fixtureRoot()
    const nonFont = new Uint8Array([0x4e, 0x4f, 0x50, 0x45])
    writeFileSync(join(mimeRoot, 'assets', 'fonts', 'fixture.ttf'), nonFont)
    expectCode(() => new NodeResourceResolver(mimeRoot, manifest(fixtureEntry('assets/fonts/fixture.ttf', nonFont))).resolve('resource:test/fixture.ttf'), 'RESOURCE_MEDIA_TYPE_MISMATCH')

    const digestRoot = fixtureRoot()
    writeFileSync(join(digestRoot, 'assets', 'fonts', 'fixture.ttf'), bytes)
    const wrongDigest = fixtureEntry('assets/fonts/fixture.ttf', bytes, { sha256: '0'.repeat(64) })
    expectCode(() => new NodeResourceResolver(digestRoot, manifest(wrongDigest)).resolve(wrongDigest.identity.id), 'RESOURCE_DIGEST_MISMATCH')

    const licenceRoot = fixtureRoot()
    writeFileSync(join(licenceRoot, 'assets', 'fonts', 'fixture.ttf'), bytes)
    const missingNotice = fixtureEntry('assets/fonts/fixture.ttf', bytes, { license: { spdx: 'OFL-1.1', noticePath: 'MISSING.txt' } })
    expectCode(() => new NodeResourceResolver(licenceRoot, manifest(missingNotice)).resolve(missingNotice.identity.id), 'RESOURCE_LICENSE_NOTICE_MISSING')
  })

  test('required resources fail closed while optional absence is a stable offline diagnostic', () => {
    const root = fixtureRoot()
    const bytes = trueTypeFixture(9)
    const required = fixtureEntry('assets/fonts/missing.ttf', bytes)
    expectCode(() => new NodeResourceResolver(root, manifest(required)).verifyInstalled(), 'RESOURCE_MISSING')

    const optional = { ...required, required: false }
    const result = new NodeResourceResolver(root, manifest(optional)).verifyInstalled()
    expect(result.resources).toEqual([])
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'OPTIONAL_RESOURCE_MISSING',
      resourceId: optional.identity.id,
    })])
    expect(optional.network).toBe('forbidden')
  })

  test('the Worker/browser verifier enforces the same bytes, media type, and digest', async () => {
    const entry = HOSTED_FONT_RESOURCES[0]!
    const installed = new NodeResourceResolver(join(import.meta.dir, '..', '..'), RESOURCE_MANIFEST).resolve(entry.identity.id)
    const bytes = installed.readBytes()
    await expect(verifyResourceBytes(entry, bytes, { digest: async value => digest(value) })).resolves.toBeUndefined()
    await expect(verifyResourceBytes(null as never, bytes)).rejects.toThrow(/^INVALID_RESOURCE_ENTRY:/)
    await expect(verifyResourceBytes(entry, null as never)).rejects.toThrow('INVALID_RESOURCE_BYTES')
    await expect(verifyResourceBytes(entry, bytes, null as never)).rejects.toThrow('INVALID_RESOURCE_VERIFY_OPTIONS')
    const symbolOptions = { digest: async (value: Uint8Array) => digest(value) } as Record<PropertyKey, unknown>
    symbolOptions[Symbol('extra')] = true
    await expect(verifyResourceBytes(entry, bytes, symbolOptions as never)).rejects.toThrow('unknown option Symbol(extra)')

    const changed = bytes.slice()
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 0xff
    await expect(verifyResourceBytes(entry, changed, { digest: async value => digest(value) })).rejects.toThrow('RESOURCE_DIGEST_MISMATCH')
    await expect(verifyResourceBytes({ ...entry, mediaType: 'image/png' }, bytes, { digest: async value => digest(value) })).rejects.toThrow('RESOURCE_MEDIA_TYPE_MISMATCH')
    await expect(verifyResourceBytes({ ...entry, bytes: entry.bytes + 1 }, bytes, { digest: async value => digest(value) })).rejects.toThrow('RESOURCE_SIZE_MISMATCH')
  })

  test('verified resources expose bytes, not a path that consumers can re-read', () => {
    const root = fixtureRoot()
    const bytes = trueTypeFixture(4, 5, 6)
    const path = join(root, 'assets', 'fonts', 'fixture.ttf')
    writeFileSync(path, bytes)
    const resolver = new NodeResourceResolver(root, manifest(fixtureEntry('assets/fonts/fixture.ttf', bytes)))
    const verified = resolver.resolve('resource:test/fixture.ttf')

    writeFileSync(path, trueTypeFixture(9, 9, 9))
    expect(verified.readBytes()).toEqual(bytes)
    expect('absolutePath' in verified).toBe(false)
    expectCode(() => resolver.resolve('resource:test/fixture.ttf'), 'RESOURCE_DIGEST_MISMATCH')

    const websiteBuild = readFileSync(join(import.meta.dir, '..', '..', 'website', 'build.ts'), 'utf8')
    expect(websiteBuild).not.toContain('verified.absolutePath')
    expect(websiteBuild).toContain('Buffer.from(verified.readBytes())')
  })
})
