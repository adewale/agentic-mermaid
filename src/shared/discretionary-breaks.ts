/** Authored line-break hints occupy no ink unless a soft hyphen is selected. */
export function discretionaryBreakKind(text: string): 'hyphen' | 'wrap' | undefined {
  return text === '\u00ad' ? 'hyphen' : text === '\u200b' ? 'wrap' : undefined
}

export function stripDiscretionaryBreaks(text: string): string {
  return text.replace(/[\u00ad\u200b]/g, '')
}
