/** Header-relative physical rows keep whitespace inside the family's text tokens. */
export function familyParserLines(source: { familyBody: string; familyLines: readonly string[] }): string[] {
  const raw = source.familyBody.split(/\r?\n/)
  const header = raw.findIndex(line => line.trim() === source.familyLines[0])
  return [raw[header]?.trim() ?? source.familyLines[0] ?? '', ...raw.slice(header + 1)]
}
