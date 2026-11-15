import { decodeXML } from 'entities'

/** Check actual emitted text independently of layout metadata. */
export function missingSvgLabels(svg: string, expected: readonly string[] = [], fieldPrefixes: readonly string[] = []): string[] {
  const labels = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
  return expected.filter(label => !labels.includes(label) && !fieldPrefixes.some(prefix => labels.includes(`${prefix}${label}`)))
}
