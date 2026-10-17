// Compatibility facade for family callers that need a wrapped string. New
// layouts retain the prepared block so renderers never reinterpret it.
import { preparePixelText } from './prepared-text.ts'

export function wrapLabelToWidth(text: string, maxWidth: number, fontSize: number, fontWeight: number, letterSpacing = 0, literalText = false): string {
  return preparePixelText(text, { display: literalText ? 'literal' : 'formatted', maxWidth, fontSize, fontWeight, letterSpacing }).text
}

export function breakWordToWidth(word: string, maxWidth: number, fontSize: number, fontWeight: number, letterSpacing = 0, literalText = false): string {
  return wrapLabelToWidth(word, maxWidth, fontSize, fontWeight, letterSpacing, literalText)
}

export function isFullwidthChar(char: string): boolean {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{2FA1F}]|\p{Extended_Pictographic}|\uFE0F|\u200D/u.test(char)
}
