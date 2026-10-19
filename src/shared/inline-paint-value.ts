/** Closed lexical policy for ordered inline line-paint declarations. A value
 * cannot terminate its declaration/attribute or introduce a fetching URL. */
const SAFE_VALUE = /^[#\w][\w#(),.%\s/-]*$/
export function isSafeInlinePaintValue(value: string): boolean { return SAFE_VALUE.test(value) }
