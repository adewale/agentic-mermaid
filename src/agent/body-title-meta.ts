import { parseMermaidYaml, readYamlMappingRanges } from '../shared/mermaid-yaml.ts'
import { matchMermaidFrontmatter } from '../mermaid-source-wrapper.ts'
import type { ValidDiagramMeta } from './types.ts'

/** Change only the owned title scalar; keep unrelated wrapper bytes intact. */
export function withBodyTitleMeta(title: string | undefined, meta: ValidDiagramMeta, preserveCoupledTitle = false): ValidDiagramMeta {
  const previous = meta.frontmatter?.title
  if (title === previous || (title === undefined && typeof previous !== 'string')) return meta
  const frontmatter = { ...meta.frontmatter }
  if (title === undefined) delete frontmatter.title
  else frontmatter.title = title
  if (meta.wrapperSource === undefined) return { ...meta, frontmatter }
  const wrapper = meta.wrapperSource
  const match = matchMermaidFrontmatter(wrapper)
  if (!match) return { ...meta, frontmatter, wrapperSource: title === undefined ? wrapper : `---\ntitle: ${JSON.stringify(title)}\n---\n${wrapper}` }
  const range = readYamlMappingRanges(match.yaml).find(field => field.name === 'title')
  let yaml = match.yaml
  if (range) {
    if (title === undefined) {
      let start = range.keyStart, end = range.valueEnd
      if (yaml.trimStart().startsWith('{')) {
        const comma = yaml.slice(end).match(/^\s*,/)
        if (comma) end += comma[0].length
        else {
          const preceding = yaml.slice(0, start).match(/,\s*$/)
          if (preceding) start -= preceding[0].length
        }
      }
      yaml = yaml.slice(0, start) + yaml.slice(end)
    }
    else yaml = yaml.slice(0, range.valueStart) + JSON.stringify(title) + (/[\r\n]$/.test(yaml.slice(range.valueStart, range.valueEnd)) ? '\n' : '') + yaml.slice(range.valueEnd)
  } else if (title !== undefined) yaml = `title: ${JSON.stringify(title)}\n${yaml}`
  // YAML aliases can couple the title scalar to unrelated configuration.
  // Never commit an apparently local edit that changes another resolved value.
  const unrelated = (source: string) => {
    const parsed = parseMermaidYaml(source)
    if (!parsed.ok) throw Error(parsed.message)
    if (parsed.value == null) return '{}'
    if (typeof parsed.value !== 'object' || Array.isArray(parsed.value)) throw Error('Expected metadata mapping')
    const rest = { ...parsed.value } as Record<string, unknown>
    delete rest.title
    return JSON.stringify(rest)
  }
  const originalValues = unrelated(match.yaml)
  try {
    if (originalValues !== unrelated(yaml)) throw Error('Title edit would change unrelated YAML metadata through an alias')
  } catch (error) {
    // An already-authored in-body title can override an aliased wrapper title.
    // Saving or editing another field must retain both authored meanings.
    if (preserveCoupledTitle && typeof title === 'string' && !/[\r\n]/.test(title)) return meta
    throw error
  }
  const yamlStart = match.source.indexOf('\n') + 1
  return { ...meta, frontmatter, wrapperSource: wrapper.slice(0, yamlStart) + yaml + wrapper.slice(yamlStart + match.yaml.length) }
}
