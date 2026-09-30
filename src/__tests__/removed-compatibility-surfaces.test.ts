import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as rootApi from '../index.ts'
import * as agentApi from '../agent/index.ts'
import * as asciiApi from '../ascii/index.ts'
import { parseMcpCliOptions } from '../mcp/mcp-cli.ts'
import { knownStyles, resolveStyleReference } from '../scene/style-registry.ts'
import { FAMILY_DESCRIPTOR_CONTRACT_VERSION, getFamily } from '../agent/families.ts'
import { registerFamily } from '../agent/family-registration.ts'
import { RENDER_CONTRACT_VERSION, RENDER_OUTPUT_DESCRIPTORS } from '../render-contract.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('removed compatibility surfaces stay removed', () => {
  test('deprecated product/API exports are absent at runtime', () => {
    for (const name of [
      'renderMermaidSync',
      'renderMermaid',
      'renderMermaidAscii',
      'HOSTED_FONT_FACES',
      'HOSTED_FONT_FILES',
      'THEMES',
      'registerCompatibilityAlias',
      'stateIneffectiveConfigFields',
      'resolvedStateVisualOf',
    ]) {
      expect(Object.hasOwn(rootApi, name), name).toBe(false)
    }
    expect(Object.hasOwn(asciiApi, 'renderMermaidAscii')).toBe(false)
    expect(Object.hasOwn(agentApi, 'parseMermaid')).toBe(false)
    expect(Object.hasOwn(agentApi, 'parseRegisteredMermaid')).toBe(true)
  })

  test('removed MCP and Style aliases fail closed', () => {
    expect(() => parseMcpCliOptions(['--http'])).toThrow('unknown option: --http')
    expect(() => parseMcpCliOptions(['--bogus'])).toThrow('unknown option: --bogus')
    expect(resolveStyleReference('default')).toBeUndefined()
    expect(resolveStyleReference('tufte')).toBeUndefined()
    expect(resolveStyleReference('palette:tufte')).toBeUndefined()
    expect(resolveStyleReference('look:tufte')?.canonicalId).toBe('look:tufte')
    expect(knownStyles()).not.toContain('default')
    expect(knownStyles()).not.toContain('tufte')
  })

  test('editor share links and drafts accept only the canonical codec and tab-scoped storage', async () => {
    // Evaluate the shipped editor script against in-memory storage. The
    // share-link codec and storage behaviour are covered in depth by
    // editor-security-closures.test.ts and, for the live page (including the
    // absent draft-privacy toggle), by website-browser-a11y.test.ts.
    const memoryStorage = () => {
      const values = new Map<string, string>()
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)) },
        removeItem: (key: string) => { values.delete(key) },
      }
    }
    const localStorage = memoryStorage()
    const sessionStorage = memoryStorage()
    const persistedDraft = JSON.stringify({ source: 'flowchart TD\n  Persisted --> Draft' })
    localStorage.setItem('bm-editor-draft', persistedDraft)
    const sharing = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')
    const editor = new Function('localStorage', 'sessionStorage', 'editor', 'state', `${sharing}
      return { decodeSource, readEditorDraft, saveEditorDraft, get hashDecodeFailure() { return hashDecodeFailure } };`,
    )(localStorage, sessionStorage, { value: 'flowchart TD\n  Current --> Tab' }, { style: 'crisp', config: {} })

    // The retired plain-base64 share link fails closed instead of decoding.
    expect(await editor.decodeSource(Buffer.from(JSON.stringify({ source: 'flowchart TD\n  A --> B' })).toString('base64'))).toBe('')
    expect(editor.hashDecodeFailure).toBe('corrupt')

    // A draft persisted by the retired browser-wide mode is dropped, never restored.
    expect(editor.readEditorDraft()).toBeNull()
    expect(localStorage.getItem('bm-editor-draft')).toBeNull()
    editor.saveEditorDraft()
    expect(localStorage.getItem('bm-editor-draft')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('bm-editor-draft')!)).toMatchObject({ source: 'flowchart TD\n  Current --> Tab' })
    expect(editor.readEditorDraft()).toMatchObject({ source: 'flowchart TD\n  Current --> Tab' })
  })

  test('a v1 family descriptor is refused at registration', () => {
    // The descriptor contract is the one version a caller negotiates at
    // runtime. The same descriptor fails on the version alone at v1, and gets
    // past that check (to a later, unrelated admission rule) at v2.
    const id = 'family:acme/contract-probe'
    const identity = createExtensionIdentity({ id, kind: 'family', version: '1.0.0', compatibility: { core: '^0.4.0' }, provenance: { owner: 'acme', source: 'test' } })
    const descriptor = { ...getFamily('flowchart')!, id, identity, headers: ['contractProbe'], aliases: [] }
    expect(() => registerFamily({ ...descriptor, contractVersion: 1 } as never)).toThrow(/uses an unsupported descriptor contract/)
    expect(() => registerFamily({ ...descriptor, contractVersion: FAMILY_DESCRIPTOR_CONTRACT_VERSION } as never)).not.toThrow(/unsupported descriptor contract/)
  })

  test('render output evidence names only the current render contract', () => {
    for (const descriptor of RENDER_OUTPUT_DESCRIPTORS) {
      expect(descriptor.evidence).toContain(`render-contract@${RENDER_CONTRACT_VERSION}`)
      expect(descriptor.evidence).not.toContain('render-contract@1')
    }
  })
})
