import { readFileSync, writeFileSync } from 'node:fs'
import {
  SHARED_RENDER_OPTIONS_DOC_END,
  SHARED_RENDER_OPTIONS_DOC_START,
  sharedRenderOptionsMarkdownTable,
} from '../src/render-contract.ts'

const check = process.argv.includes('--check')
const apiPath = new URL('../docs/api.md', import.meta.url)
const current = readFileSync(apiPath, 'utf8')
const generated = `${SHARED_RENDER_OPTIONS_DOC_START}\n${sharedRenderOptionsMarkdownTable()}\n${SHARED_RENDER_OPTIONS_DOC_END}`
const start = current.indexOf(SHARED_RENDER_OPTIONS_DOC_START)
const end = current.indexOf(SHARED_RENDER_OPTIONS_DOC_END)

if (start < 0 || end < start) {
  throw new Error('docs/api.md is missing the generated shared-render-options markers')
}

const next = `${current.slice(0, start)}${generated}${current.slice(end + SHARED_RENDER_OPTIONS_DOC_END.length)}`
if (check) {
  if (next !== current) {
    console.error('docs/api.md shared render-options table is stale; run bun run render-options-docs')
    process.exitCode = 1
  }
} else if (next !== current) {
  writeFileSync(apiPath, next)
  console.log('Updated docs/api.md shared render-options table')
}
