import { expect, test } from 'bun:test'
import { scanSvgStartTags, svgRootStartTag } from '../svg-structure.ts'
import { withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { applyOutputSecurityPolicy, verifyNoExternalRefs } from '../output-security.ts'

test('inspection evidence is immutable, exact-byte keyed, and mode independent', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>safe</text></a></svg>'
  withSvgInspectionCache(() => {
    const tags = scanSvgStartTags(source)
    expect(Object.isFrozen(tags[1])).toBe(true)
    expect(Object.isFrozen(tags[1]!.attributes[0])).toBe(true)
    expect(() => { (tags[1]!.attributes[0] as { value: string }).value = '#local' }).toThrow()
    const findings = verifyNoExternalRefs(source)
    findings.refs.length = 0
    expect(verifyNoExternalRefs(source).ok).toBe(false)
    expect(applyOutputSecurityPolicy(source).diagnostics.length).toBeGreaterThan(0)
    expect(() => applyOutputSecurityPolicy(source, 'strict')).toThrow(/strict/)
    const rewritten = source.replace('https://example.com', 'javascript:alert(1)')
    expect(() => applyOutputSecurityPolicy(rewritten)).toThrow(/active content/)
    expect(() => applyOutputSecurityPolicy(source.replace('</svg>', ''))).toThrow(/envelope/)
  })
  expect(svgRootStartTag('<!--not a root--><svg></svg>')).toBeUndefined()
  expect(svgRootStartTag(' <svg data-label="a > b"><text>ok</text></svg>')?.attributes[0]?.value).toBe('a > b')
})
