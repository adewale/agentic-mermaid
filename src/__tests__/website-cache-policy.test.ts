import { describe, expect, test } from 'bun:test'
import { classifyWebsiteAssetCache, type WebsiteAssetCacheInput } from '../../website/src/worker-core.ts'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const base: WebsiteAssetCacheInput = {
  pathname: '/editor/editor-abcdef123456.js',
  method: 'GET',
  status: 200,
  contentType: 'text/javascript; charset=utf-8',
}

function classify(overrides: Partial<WebsiteAssetCacheInput> = {}) {
  return classifyWebsiteAssetCache({ ...base, ...overrides })
}

describe('website static asset cache authority', () => {
  test('admits only complete successful recognized hashed assets as immutable', () => {
    for (const [pathname, contentType] of [
      ['/editor/editor-abcdef123456.js', 'text/javascript'],
      ['/editor/editor-app-abcdef123456.js', 'application/javascript'],
      ['/editor/editor-renderer-abcdef123456.js', 'text/javascript'],
      ['/vendor/mermaid-abcdef123456.min.js', 'text/javascript'],
      ['/examples/fragments/style-palette-abcdef123456', 'text/html; charset=utf-8'],
      ['/examples/fragments/corpus-abcdef123456', 'text/html'],
      ['/examples-abcdef123456.js', 'text/javascript'],
      ['/examples-abcdef123456.css', 'text/css'],
      ['/generated/inline-abcdef123456.js', 'text/javascript'],
      ['/fonts/Inter-Regular.subset-abcdef123456.woff2', 'font/woff2'],
      ['/fonts/Inter-Medium.subset-abcdef123456.woff2', 'font/woff2'],
      ['/fonts/Inter-SemiBold.subset-abcdef123456.woff2', 'font/woff2'],
      ['/fonts/Inter-Bold.subset-abcdef123456.woff2', 'font/woff2'],
    ] as const) {
      expect(classify({ pathname, contentType }), pathname).toBe(IMMUTABLE)
      expect(classify({ pathname, contentType, method: 'HEAD' }), `${pathname} HEAD`).toBe(IMMUTABLE)
    }
  })

  test('fails closed for every incomplete or untrusted hashed response dimension', () => {
    for (const status of [206, 301, 302, 404, 410, 500, 503]) {
      expect(classify({ status }), `status ${status}`).toBe('no-store')
    }
    expect(classify({ method: 'POST' })).toBe('no-store')
    expect(classify({ method: 'OPTIONS' })).toBe('no-store')
    expect(classify({ contentType: 'text/html' })).toBe('no-store')
    expect(classify({ contentType: 'text/javascript-invalid' })).toBe('no-store')
    expect(classify({ contentType: 'text/html; profile=text/javascript' })).toBe('no-store')
    expect(classify({ pathname: '/examples-abcdef123456.css', contentType: 'text/javascript' })).toBe('no-store')
    expect(classify({ contentType: '' })).toBe('no-store')
    expect(classify({ hasSetCookie: true })).toBe('no-store')

    const fragment = '/examples/fragments/corpus-deadbeefdead'
    expect(classify({ pathname: fragment, status: 404, contentType: 'text/html' })).toBe('no-store')
    expect(classify({ pathname: fragment, status: 500, contentType: 'text/html' })).toBe('no-store')
  })

  test('never promotes malformed or stable-name assets to immutable', () => {
    expect(classify({ pathname: '/editor/editor-short.js' })).toBe('public, max-age=3600')
    expect(classify({ pathname: '/editor/editor-abcdef12345g.js' })).toBe('public, max-age=3600')
    expect(classify({ pathname: '/fonts/Inter-Regular.subset.woff2', contentType: 'font/woff2' })).toBe('public, max-age=3600')
    expect(classify({ pathname: '/examples/fragments/corpus-abcdef123456.html', contentType: 'text/html' })).toBe('no-cache')
    expect(classify({ pathname: '/styles.css', contentType: 'text/css' })).toBe('public, max-age=3600')
    expect(classify({ pathname: '/styles.css', contentType: 'text/css', method: 'POST' })).toBe('no-store')
    expect(classify({ pathname: '/styles.css', contentType: 'text/css', hasSetCookie: true })).toBe('no-store')
    expect(classify({ pathname: '/index.html', contentType: 'text/html' })).toBe('no-cache')
    expect(classify({ pathname: '/index.html', contentType: 'text/html', hasSetCookie: true })).toBe('no-store')
    expect(classify({ pathname: '/index.html', contentType: 'text/html', status: 500 })).toBe('no-store')
    expect(classify({ pathname: '/data.unknown', contentType: 'application/octet-stream' })).toBe('no-cache')
  })

  test('keeps machine-readable success cacheable but never caches its errors', () => {
    expect(classify({ pathname: '/capabilities.json', contentType: 'application/json' })).toBe('public, max-age=300')
    expect(classify({ pathname: '/capabilities.json', contentType: 'application/json', status: 500 })).toBe('no-store')
    expect(classify({ pathname: '/capabilities.json', contentType: 'application/json', hasSetCookie: true })).toBe('no-store')
    expect(classify({ pathname: '/llms.txt', contentType: 'text/plain', method: 'POST' })).toBe('no-store')
  })
})
