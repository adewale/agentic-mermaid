export class PeleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly location: { type: string; line: number; column: number },
  ) {
    super(message)
  }
}
export const written = (source: string, offset: number): [string, number] => [source, offset]
export const writtenCodes = (source: string): string => source
export const isBlank = (c: number): boolean => c === 32 || c === 9
export const isDigit = (c: number): boolean => c >= 48 && c <= 57
export const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
export const isHex = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
