import { describe, expect, it } from 'bun:test'

const packageJson = require('../../package.json')

describe('package exports', () => {
  it('defines a default export fallback for runtimes resolving conditional exports', () => {
    expect(packageJson.exports['.']).toMatchObject({
      bun: './src/index.ts',
      import: './dist/index.js',
      types: './dist/index.d.ts',
      default: './dist/index.js',
    })
  })
})
