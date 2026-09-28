// The one SVG normaliser for test comparisons.
//
// Golden snapshots compare with the default (whitespace-only) form: CRLF is
// folded to LF, trailing spaces are dropped per line, and the document is
// trimmed, so an editor's line endings or a final newline never turns a golden
// red while every byte of geometry, paint and text still counts.

export function normalizeSvg(svg: string): string {
  return svg
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}
