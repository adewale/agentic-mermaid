import { posix } from 'node:path'

const DOCUMENT_ROUTES: Readonly<Record<string, string>> = {
  'docs/api.md': '/docs/api/',
  'docs/api-advanced.md': '/docs/api/advanced/',
}

/** Relocated Markdown keeps repository links usable in both delivered formats. */
export function documentationPage(source: string, file: string) {
  const destination = DOCUMENT_ROUTES[file]
  if (!destination) throw new Error(`No documentation route for ${file}`)
  const link = (href: string): string => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href
    const [, path = '', suffix = ''] = /^([^?#]*)(.*)$/.exec(href)!
    const target = posix.normalize(posix.join(posix.dirname(file), path))
    return `${DOCUMENT_ROUTES[target] ?? `https://github.com/adewale/agentic-mermaid/blob/main/${target}`}${suffix}`
  }
  const rewriteProse = (text: string): string => text.replace(
    /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,
    (match, code: string | undefined, before: string, href: string, after: string) => code ? match : `${before}${link(href)}${after}`,
  )
  let fence = ''
  let prose = ''
  let markdown = ''
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line)
    if (boundary && (!fence || (boundary[1]![0] === fence[0] && boundary[1]!.length >= fence.length && !boundary[2]!.trim()))) {
      markdown += rewriteProse(prose)
      prose = ''
      fence = fence ? '' : boundary[1]!
      markdown += line
    } else if (fence) {
      markdown += line
    } else {
      prose += line
    }
  }
  markdown += rewriteProse(prose)
  const header = /^# ([^\n]+)\n\n([^\n]+)\n\n/.exec(markdown)
  if (!header) throw new Error(`${file} needs a title and a one-paragraph lead`)
  const html = Bun.markdown.html(markdown.slice(header[0].length), { headings: { ids: true } })
    .replace(/<table>/g, '<div class="table-scroll" tabindex="0" role="region" aria-label="API reference table"><table>')
    .replace(/<\/table>/g, '</table></div>')
  return { title: header[1]!, lead: header[2]!, html, markdown, destination }
}
