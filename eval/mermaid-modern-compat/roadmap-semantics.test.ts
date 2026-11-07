import { afterAll, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getFamily } from '../../src/agent/core.ts'
import { parseNativeModel } from './grammar-agentic.ts'
import { projectNativeSemantic, projectReferenceSemantic } from './grammar-native-semantics.ts'
import { startGrammarReference } from './grammar-reference.ts'

const upstream = process.env.MERMAID_UPSTREAM_DIR ?? resolve(import.meta.dir, '../../../mermaid')
const reference = process.env.MERMAID_REFERENCE_DIR ?? resolve(import.meta.dir, '../../../mermaid-reference')
const oracle = startGrammarReference(reference, upstream)
afterAll(() => oracle.close())
for (const family of ['treeview', 'usecase', 'swimlane', 'agentflow', 'wardley', 'cynefin', 'venn', 'railroad'] as const) {
  test(`${family} production model agrees with pinned Mermaid's independent selected semantic scope`, async () => {
    const source = getFamily(family)!.example
    await oracle.prepare(family, source)
    const reply = await oracle.parse(family, source)
    expect(reply.accepted).toBe(true)
    const native = projectNativeSemantic(family, parseNativeModel(family, source))
    const upstream = projectReferenceSemantic(family, reply)
    expect(native).toBeDefined()
    expect(upstream).toBeDefined()
    expect(native!.fields).toEqual(upstream!.fields)
    expect(native!.value).toEqual(upstream!.value)
  }, 30000)
}
