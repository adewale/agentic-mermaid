import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { FAMILY_CONFORMANCE_PROFILES } from './helpers/family-conformance-profiles.ts'

const entry = new URL('../ascii.ts', import.meta.url).pathname

async function isolated(script: string, input: unknown = null) {
  const child = Bun.spawn([process.execPath, '-e', script], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  child.stdin.write(JSON.stringify(input))
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(exitCode, stderr).toBe(0)
  return stdout
}

describe('focused source-to-text entry', () => {
  test('preserves complete source rendering and failures for every built-in family', async () => {
    const cases = knownBuiltinFamilies().flatMap(id => {
      const witness = FAMILY_CONFORMANCE_PROFILES[id].citizenship
      return [getFamily(id)!.example, witness.source].map(source => ({ id, source, options: { ...witness.options, colorMode: 'none' as const, ganttToday: '2026-10-05' } }))
    })
    const expected = cases.map(({ source, options }) => {
      try { return { text: renderMermaidASCII(source, options) } }
      catch (error) { return { error: String(error) } }
    })
    const stdout = await isolated(`
      import { renderMermaidASCII } from ${JSON.stringify(entry)};
      const cases = JSON.parse(await Bun.stdin.text());
      console.log(JSON.stringify(cases.map(({source, options}) => {
        try { return {text: renderMermaidASCII(source, options)} }
        catch (error) { return {error: String(error)} }
      })));
    `, cases)
    expect(JSON.parse(stdout)).toEqual(expected)
  }, 30_000)

  test.each([['ascii.ts', 'svg.ts'], ['svg.ts', 'ascii.ts']])('retains both output hooks after importing %s then %s', async (first, second) => {
    await isolated(`
      await import(${JSON.stringify(new URL('../', import.meta.url).pathname)} + ${JSON.stringify(first)});
      await import(${JSON.stringify(new URL('../', import.meta.url).pathname)} + ${JSON.stringify(second)});
      const {renderMermaidASCII} = await import(${JSON.stringify(entry)});
      const {renderMermaidSVG} = await import(${JSON.stringify(new URL('../svg.ts', import.meta.url).pathname)});
      const source = ${JSON.stringify('flowchart LR\n A[Source] --> B[Target]')};
      for (let i = 0; i < 2; i++) {
        const text = renderMermaidASCII(source, {colorMode: 'none'});
        const svg = renderMermaidSVG(source);
        if (!text.includes('Source') || !text.includes('Target') || !svg.includes('<svg')) throw Error('output hook lost');
      }
      const full = await import(${JSON.stringify(new URL('../index.ts', import.meta.url).pathname)});
      const parsed = full.parseRegisteredMermaid(source);
      if (!parsed.ok) throw Error('parse failed');
      const rendered = full.renderMermaidASCIIWithReceipt(parsed.value, {colorMode: 'none'});
      if (rendered.text !== renderMermaidASCII(source, {colorMode: 'none'}) || !JSON.stringify(rendered.receipt)) throw Error('complete entry changed');
    `)
  })

  test('keeps arbitrary and changed-identity descriptor replacements authoritative', async () => {
    await isolated(`
      await import(${JSON.stringify(entry)});
      await import(${JSON.stringify(new URL('../svg.ts', import.meta.url).pathname)});
      const {getInstalledFamilyDescriptor, installLoadedFamilyDescriptor} = await import(${JSON.stringify(new URL('../agent/family-router.ts', import.meta.url).pathname)});
      const {enrollOwnedFamily} = await import(${JSON.stringify(new URL('../experimental/owned-family.ts', import.meta.url).pathname)});
      const prior = getInstalledFamilyDescriptor('flowchart');
      const arbitrary = {...prior, renderAscii: undefined};
      installLoadedFamilyDescriptor(arbitrary);
      if (getInstalledFamilyDescriptor('flowchart') !== arbitrary) throw Error('arbitrary replacement was merged');
      installLoadedFamilyDescriptor(prior);
      const changed = Object.freeze({...prior, identity: Object.freeze({...prior.identity}), renderAscii: undefined});
      enrollOwnedFamily(changed);
      installLoadedFamilyDescriptor(changed);
      if (getInstalledFamilyDescriptor('flowchart') !== changed) throw Error('changed identity was merged');
    `)
  })

  test('rejects parsed input and diagnostic callbacks while the complete entry retains both', async () => {
    await isolated(`
      const focused = await import(${JSON.stringify(entry)});
      let rejected = 0;
      try { focused.renderMermaidASCII({kind:'flowchart'}) } catch (error) { if (/source text/.test(String(error))) rejected++ }
      try { focused.renderMermaidASCII('graph TD; A-->B', {onProjectionDiagnostic(){}}) } catch (error) { if (/complete package entry/.test(String(error))) rejected++ }
      if (rejected !== 2) throw Error('source-only contract was not enforced');
      const full = await import(${JSON.stringify(new URL('../index.ts', import.meta.url).pathname)});
      const diagnostics = [];
      const source = ${JSON.stringify('flowchart TD\n A["hello\u0007"]')};
      const rendered = full.renderMermaidASCIIWithReceipt(source, {colorMode:'none', onProjectionDiagnostic(value){diagnostics.push(value)}});
      if (!rendered.text.includes('hello?') || !diagnostics.some(d => d.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')) throw Error('complete diagnostic callback lost');
      if (!JSON.stringify(rendered.receipt)) throw Error('complete receipt lost');
    `)
  })
})
