export interface AsciiGoldenFixture {
  sourceLines: string[]
  mermaid: string
  expected: string
  paddingX: number
  paddingY: number
}

/** Parse the option prelude, Mermaid source, and expected output shared by the
 * ASCII/Unicode golden tests, regeneration script, and whole-corpus audit. */
export function parseAsciiGoldenFixture(content: string): AsciiGoldenFixture {
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  const paddingRegex = /^(?:padding([xy]))\s*=\s*(\d+)\s*$/i
  let separatorIndex = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index] === '---') {
      separatorIndex = index
      break
    }
  }
  if (separatorIndex < 0) throw new Error('golden fixture is missing --- separator')

  const fixture: AsciiGoldenFixture = {
    sourceLines: lines.slice(0, separatorIndex),
    mermaid: '',
    expected: separatorIndex < lines.length ? lines.slice(separatorIndex + 1).join('\n') : '',
    paddingX: 5,
    paddingY: 5,
  }

  let mermaidStarted = false
  const mermaidLines: string[] = []
  for (const line of fixture.sourceLines) {
    const trimmed = line.trim()
    if (!mermaidStarted) {
      if (trimmed === '') continue
      const match = trimmed.match(paddingRegex)
      if (match) {
        const value = Number.parseInt(match[2]!, 10)
        if (match[1]!.toLowerCase() === 'x') fixture.paddingX = value
        else fixture.paddingY = value
        continue
      }
    }
    mermaidStarted = true
    mermaidLines.push(line)
  }

  fixture.mermaid = `${mermaidLines.join('\n')}\n`
  return fixture
}
