/** A self-contained raster reference, not a claim that its pixels decode or paint. */
export function isInlinePng(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,iVBORw0KGgo')) return false
  const payload = value.slice(22)
  return payload.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(payload)
    && /^[A-Za-z0-9+/]+={0,2}$/.exec(payload)?.[0].length === payload.length
}
