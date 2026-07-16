import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as rootApi from '../index.ts'
import * as agentApi from '../agent/index.ts'
import * as asciiApi from '../ascii/index.ts'
import { parseMcpCliOptions } from '../mcp/mcp-cli.ts'
import { knownStyles, resolveStyleReference } from '../scene/style-registry.ts'
import { FAMILY_DESCRIPTOR_CONTRACT_VERSION, FAMILY_CONFORMANCE_VERSION } from '../agent/families.ts'
import { RENDER_CONTRACT_VERSION, RENDER_OUTPUT_DESCRIPTORS } from '../render-contract.ts'
import { SCENE_CONTRACT_VERSION } from '../scene/version.ts'
import { SCENE_VALIDATION_VERSION } from '../scene/scene-validation.ts'

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

  test('editor persistence and share links expose only canonical storage and codecs', () => {
    const sharing = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')
    const editorHtml = readFileSync(join(ROOT, 'editor/html/left-panel.html'), 'utf8')
    expect(sharing).not.toContain('function encodeSource(')
    expect(sharing).not.toContain('function base64ToUtf8(')
    expect(sharing).not.toContain('DRAFT_MODE_PERSISTENT')
    expect(sharing).not.toContain('DRAFT_MODE_SESSION')
    expect(sharing).toContain('return sessionStorage;')
    expect(editorHtml).not.toContain('draft-privacy-btn')
    expect(editorHtml).not.toContain('Autosave: this browser')
  })

  test('breaking contract generations reject v1 negotiation', () => {
    expect(RENDER_CONTRACT_VERSION).toBe(2)
    expect(SCENE_CONTRACT_VERSION).toBe(2)
    expect(SCENE_VALIDATION_VERSION).toBe(2)
    expect(FAMILY_DESCRIPTOR_CONTRACT_VERSION).toBe(2)
    expect(FAMILY_CONFORMANCE_VERSION).toBe(2)
    for (const descriptor of RENDER_OUTPUT_DESCRIPTORS) {
      expect(descriptor.evidence).toContain(`render-contract@${RENDER_CONTRACT_VERSION}`)
      expect(descriptor.evidence).not.toContain('render-contract@1')
    }
  })
})
