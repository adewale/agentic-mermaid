/** Lexical policy for inline line-paint parsing. Semantic paint admission and
 * final output security separately check functions and external references. */
const SAFE_VALUE = /^[#\w][\w#(),.%\s/-]*$/
export function isSafeInlinePaintValue(value: string): boolean { return SAFE_VALUE.test(value) }

/** Overridden lexical history must not introduce a fetch or active function
 * that is absent from the final semantic paint. */
export function isSafeShadowedInlinePaintValue(value: string): boolean {
  return isSafeInlinePaintValue(value) && !/(?:url|expression|behavior|(?:-webkit-)?(?:image-set|cross-fade))\s*\(/i.test(value)
}
