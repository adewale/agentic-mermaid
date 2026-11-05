// Loop 11 M4 (#6430): llms.txt agent-discovery digest.

import { describe, test, expect } from 'bun:test'
import { buildLlmsTxt, buildCapabilities, COMMAND_FLAGS, runCli } from '../cli/index.ts'
import { knownStyleDescriptors } from '../scene/style-registry.ts'

import pkg from '../../package.json'
import { captureCli } from './helpers/cli-capture.ts'

describe('#6430 llms.txt', () => {
  // The verb set comes from the CLI's own command table, and each verb must
  // open a bullet in the "CLI verbs" list (a bare substring check passed for
  // `parse` because the prose mentions parsing).
  const listsVerb = (txt: string, verb: string) => new RegExp(`^- ${verb.replace(/-/g, '\\-')}\\b`, 'm').test(txt)
  test('lists every CLI verb from the command table as a bullet', () => {
    const txt = buildLlmsTxt()
    const verbs = Object.keys(COMMAND_FLAGS)
    expect(verbs.length).toBeGreaterThan(10)
    expect(verbs.filter(verb => !listsVerb(txt, verb))).toEqual([])
  })

  test('contains every output format from capabilities', () => {
    const txt = buildLlmsTxt()
    for (const fmt of buildCapabilities().outputFormats) {
      expect(txt).toContain(fmt)
    }
  })

  test('lists every diagram family from capabilities', () => {
    const txt = buildLlmsTxt()
    for (const f of buildCapabilities().families) {
      expect(txt).toContain(f.id)
    }
  })

  test('llms.txt names the narrower of every advertised family', () => {
    const narrowers = buildCapabilities().families.flatMap(family => family.narrower ? [family.narrower] : [])
    expect(narrowers.length).toBeGreaterThan(0)
    const digest = buildLlmsTxt()
    expect(narrowers.filter(narrower => !digest.includes(narrower))).toEqual([])
    // Onboarding routers point to the installed guide and live discovery.
    // cli-init-agent.test.ts owns that offline delivery contract.
  })

  test('lists every registered built-in look', () => {
    const txt = buildLlmsTxt()
    const looks = knownStyleDescriptors()
      .filter(descriptor => descriptor.kind === 'look')
      .map(descriptor => descriptor.inputName)
    for (const look of looks) expect(txt).toContain(`'${look}'`)
    expect(txt.toLowerCase()).not.toContain('cupertino')
  })

  test('follows the llms.txt convention (H1 + blockquote summary)', () => {
    const txt = buildLlmsTxt()
    expect(txt.startsWith('# ')).toBe(true)
    expect(txt).toMatch(/\n> /)
  })

  test('mentions the agent loop, security posture, and agent onboarding docs', () => {
    const txt = buildLlmsTxt()
    expect(txt).toContain('parse → ')
    expect(txt.toLowerCase()).toContain('security')
    expect(txt).toContain('docs/agent-api-cookbook.md')
    expect(txt).toContain('skills/')
    expect(txt).toContain('skill-evals/')
  })

  test('the CLI emits the discovery digest with the published package version', () => {
    const result = captureCli(() => runCli(['llms-txt']))
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out.startsWith('# Agentic Mermaid\n')).toBe(true)
    expect(result.out).toContain(`\nVersion: ${pkg.version}\n`)
  })
})
