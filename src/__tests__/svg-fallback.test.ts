import { describe, expect, test } from 'bun:test'
import { createReadOnlySvgRenderer, renderReadOnlyMermaidSVG } from '../svg-fallback.ts'
import { DIAGRAM_WORK_LIMITS, DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { SCENE_VALIDATION_LIMITS } from '../scene/scene-validation.ts'

const source = 'venn-beta\n set Readers\n set Authors\n union Readers,Authors["Contributors"]'
const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Contributors</text></svg>'

describe('opt-in read-only SVG provider', () => {
  test('loads a provider once and returns explicit capabilities without native editing or paint claims', async () => {
    let loads = 0
    const authored: string[] = []
    const render = createReadOnlySvgRenderer(async () => {
      loads++
      return { id: 'host-test', render: text => { authored.push(text); return safeSvg } }
    })
    const [first, second] = await Promise.all([render(source), render(source)])
    expect(loads).toBe(1)
    expect(authored).toEqual([source, source])
    expect(first).toEqual({
      svg: safeSvg, family: 'venn', provider: 'host-test',
      capabilities: { svg: 'read-only', typedEditing: false, layout: false, paintCertification: false },
    })
    expect(second).toEqual(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.capabilities)).toBe(true)
    expect(first).not.toHaveProperty('receipt')
  })

  test('rejects native families, native aliases, external languages and unknown headers before loading', async () => {
    let loads = 0
    const render = createReadOnlySvgRenderer(() => { loads++; return { id: 'never', render: () => safeSvg } })
    for (const text of [
      'flowchart LR\n A --> B', 'flowchart-elk\n A --> B', 'classDiagram-v2\n class A',
      'C4Context\n Person(user,"User")', 'zenuml\n A->B: message', 'info', 'unknown-beta\n A',
    ]) await expect(render(text)).rejects.toThrow(/unsupported Mermaid core family/)
    expect(loads).toBe(0)
  })

  test('does not interpret header-looking text inside frontmatter as the family', async () => {
    let loads = 0
    const render = createReadOnlySvgRenderer(() => { loads++; return { id: 'host-test', render: () => safeSvg } })
    await expect(render('---\nlabel: venn-beta\n---\nflowchart LR\n A --> B')).rejects.toThrow(/unsupported Mermaid core family/)
    const wrapped = `---\ntitle: Example\n---\n%% wrapper comment\n${source}`
    expect((await render(wrapped)).family).toBe('venn')
    expect(loads).toBe(1)
  })

  test('leaves an installed extension in control of an otherwise unsupported header', async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import {createReadOnlySvgRenderer} from ${JSON.stringify(new URL('../svg-fallback.ts', import.meta.url).pathname)};
      import {installLoadedFamilyDescriptor} from ${JSON.stringify(new URL('../agent/family-router.ts', import.meta.url).pathname)};
      installLoadedFamilyDescriptor({id:'family:owned-venn',collisionPriority:1,detect:line=>line.startsWith('venn-beta')});
      let loads=0;const render=createReadOnlySvgRenderer(()=>{loads++;throw Error('unexpected provider load')});
      try{await render(${JSON.stringify(source)});console.log(JSON.stringify({rejected:false,loads}))}
      catch(e){console.log(JSON.stringify({rejected:String(e).includes('unsupported Mermaid core family'),loads}))}
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ rejected: true, loads: 0 })
  })

  test('captures the only option once before loading and rejects ignored options', async () => {
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    let reads = 0
    const security = 'strict' as const
    const render = createReadOnlySvgRenderer(async () => {
      await barrier
      return { id: 'remote', render: () => '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>' }
    })
    const options = { get security() { reads++; return security } }
    const pending = render(source, options)
    Object.defineProperty(options, 'security', { value: 'default' })
    release()
    await expect(pending).rejects.toThrow(/strict verification/)
    expect(reads).toBe(1)
    for (const options of [{ style: 'hand-drawn' }, { layoutSafety: 'strict' }, { security: 'unsafe' }, null]) {
      await expect(render(source, options as never)).rejects.toThrow()
    }
  })

  test('refuses active content in every mode and external references under the strict default', async () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>HTML</div></foreignObject></svg>', '<html>not SVG</html>',
    ]) {
      const render = createReadOnlySvgRenderer(() => ({ id: 'host-test', render: () => svg }))
      await expect(render(source)).rejects.toThrow(/OutputSecurityPolicy/)
      await expect(render(source, { security: 'default' })).rejects.toThrow(/OutputSecurityPolicy/)
    }
    const external = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>'
    const render = createReadOnlySvgRenderer(() => ({ id: 'remote', render: () => external }))
    await expect(render(source)).rejects.toThrow(/strict verification/)
    expect((await render(source, { security: 'default' })).svg).toBe(external)
  })

  test('an inherited security option cannot downgrade the strict default', async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import {createReadOnlySvgRenderer} from ${JSON.stringify(new URL('../svg-fallback.ts', import.meta.url).pathname)};
      const svg='<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>';
      const render=createReadOnlySvgRenderer(()=>({id:'remote',render:()=>svg}));
      Object.defineProperty(Object.prototype,'security',{value:'default',configurable:true});
      try {
        let refused=false;
        try { await render(${JSON.stringify(source)}); }
        catch(e) { refused=String(e).includes('strict verification'); }
        const explicit=await render(${JSON.stringify(source)},{security:'default'});
        console.log(JSON.stringify({refused,explicit:explicit.svg===svg}));
      } finally { delete Object.prototype.security; }
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ refused: true, explicit: true })
  })

  test('bounds source before loading and checks output size and shape before security inspection', async () => {
    let loads = 0
    const render = createReadOnlySvgRenderer(() => { loads++; return { id: 'never', render: () => safeSvg } })
    await expect(render(source + ' '.repeat(DIAGRAM_WORK_LIMITS.sourceCharacters))).rejects.toBeInstanceOf(DiagramWorkLimitError)
    expect(loads).toBe(0)
    for (const svg of [undefined, { svg: safeSvg }, '<svg>' + 'x'.repeat(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) + '</svg>']) {
      const malformed = createReadOnlySvgRenderer(() => ({ id: 'invalid', render: () => svg as string }))
      await expect(malformed(source)).rejects.toThrow()
    }
  })

  test('retries failed loads and propagates provider render failures unchanged', async () => {
    let loads = 0
    const failure = new Error('provider unavailable')
    const render = createReadOnlySvgRenderer(() => {
      if (++loads === 1) throw failure
      return { id: 'recovered', render: () => safeSvg }
    })
    await expect(render(source)).rejects.toBe(failure)
    expect((await render(source)).provider).toBe('recovered')
    expect(loads).toBe(2)
    const failing = createReadOnlySvgRenderer(() => ({ id: 'broken', render: () => { throw failure } }))
    await expect(failing(source)).rejects.toBe(failure)
  })

  test('renders real unsupported Venn and TreeView content using the optional Pele provider', async () => {
    const venn = await renderReadOnlyMermaidSVG(source)
    expect(venn.provider).toBe('pele@1.6.0')
    expect(venn.family).toBe('venn')
    for (const text of ['Readers', 'Authors', 'Contributors']) expect(venn.svg).toContain(text)
    const tree = await renderReadOnlyMermaidSVG('treeView-beta\n my-project/\n     src/\n         index.js')
    expect(tree.family).toBe('treeview')
    for (const text of ['my-project', 'src', 'index.js']) expect(tree.svg).toContain(text)
  })
})
