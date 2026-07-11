import { describe, expect, test } from 'bun:test'
import { parseMermaid, verifyMermaid } from '../agent/index.ts'
import { STATE_CONFIG_FIELDS, stateIneffectiveConfigFields } from '../state/config.ts'

const SOURCE = 'stateDiagram-v2\n  A --> B'

function warnings(config: string) {
  const parsed = parseMermaid(`---\nconfig:\n  state:\n${config}\n---\n${SOURCE}`)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return []
  return verifyMermaid(parsed.value).warnings
}

describe('state runtime config is wire-or-warn', () => {
  test('every documented state key is explicitly classified as ineffective', () => {
    const fields = stateIneffectiveConfigFields([{ nodeSpacing: 40, radius: 8, defaultRenderer: 'elk' }])
    expect(fields).toEqual(['defaultRenderer', 'nodeSpacing', 'radius'])
    expect(new Set(STATE_CONFIG_FIELDS).size).toBe(STATE_CONFIG_FIELDS.length)
  })

  test('frontmatter names documented but unwired fields', () => {
    expect(warnings('    nodeSpacing: 40\n    radius: 8')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'nodeSpacing' }),
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'radius' }),
    ]))
  })

  test('init directives use the same classifier', () => {
    const parsed = parseMermaid('%%{init: {"state": {"forkWidth": 70}}}%%\n' + SOURCE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'INEFFECTIVE_CONFIG', field: 'forkWidth',
    }))
  })
})
