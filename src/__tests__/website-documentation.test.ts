import { describe, expect, test } from 'bun:test'
import { documentationPage } from '../../website/build/documentation.ts'

const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } }

describe('delivered library reference', () => {
  test('source prose, headings and tables produce readable HTML and Markdown', () => {
    const source = '# Library API\n\nRender a diagram.\n\n## Returned artwork\n\nNew source guidance.\n\n| Field | Meaning |\n|---|---|\n| `parts` | Painted parts |\n'
    const page = documentationPage(source, 'docs/api.md')
    const document = new JSDOM(page.html).window.document
    expect(page.title).toBe('Library API')
    expect(page.lead).toBe('Render a diagram.')
    expect(document.querySelector('h1')).toBeNull()
    expect(document.querySelector('#returned-artwork')?.textContent).toBe('Returned artwork')
    expect(document.querySelector('p')?.textContent).toBe('New source guidance.')
    expect(document.querySelector('table tbody td')?.textContent).toBe('parts')
    expect(document.querySelector('.table-scroll')?.getAttribute('tabindex')).toBe('0')
    expect(page.markdown).toBe(source)
  })

  test('relocated links reach published pages or repository files without changing code', () => {
    const page = documentationPage('# Advanced API\n\nHost rendering.\n\n[API](./api.md#editing), [types](../src/types.ts), [fonts](./custom-fonts.md), [local](#host).\n\n`[API](./api.md)` and ``a `tick`\n[API](./api.md)``\n\n```ts\n```not-a-closing-fence\nconst link = "[API](./api.md)"\n```\n', 'docs/api-advanced.md')
    const document = new JSDOM(page.html).window.document
    expect([...document.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual([
      '/docs/api/#editing',
      'https://github.com/adewale/agentic-mermaid/blob/main/src/types.ts',
      'https://github.com/adewale/agentic-mermaid/blob/main/docs/custom-fonts.md',
      '#host',
    ])
    expect(document.querySelector('code')?.textContent).toContain('[API](./api.md)')
    expect(page.markdown).toContain('[API](/docs/api/#editing)')
    expect(page.markdown).toContain('`[API](./api.md)` and ``a `tick`\n[API](./api.md)``')
    expect(page.markdown).toContain('const link = "[API](./api.md)"')
  })
})
