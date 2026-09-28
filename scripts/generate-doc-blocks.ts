// Regenerate the generated blocks in every maintained Markdown file
// (scripts/docs/doc-blocks.ts). `--check` reports stale blocks without writing.

import { maintainedMarkdownFiles, REPO_ROOT } from '../src/__tests__/helpers/maintained-docs.ts'
import { syncDocBlocks } from './docs/doc-blocks.ts'

const check = process.argv.includes('--check')
const problems = syncDocBlocks(REPO_ROOT, maintainedMarkdownFiles(), !check)
const unknown = problems.filter(problem => problem.problem === 'unknown')
const stale = problems.filter(problem => problem.problem === 'stale')

for (const problem of unknown) console.error(`${problem.file}: unknown generated block "${problem.block}"`)
if (check) for (const problem of stale) console.error(`${problem.file}: generated block "${problem.block}" is stale; run bun run doc-blocks`)
if (unknown.length > 0 || (check && stale.length > 0)) process.exit(1)
console.log(!check && stale.length > 0 ? `Regenerated ${stale.length} doc block(s).` : 'Doc blocks are current.')
