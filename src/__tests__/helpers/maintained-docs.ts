// The Markdown files that make claims about the current product. Checks that
// scan documentation for drift use this one set, so "which docs count" is
// decided once: history (the archive, CHANGELOG, research notes, recorded eval
// transcripts) and text synced verbatim from upstream Mermaid are excluded.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..')

const EXCLUDED = [
  /^docs\/project\/archive\//,
  /^CHANGELOG\.md$/,
  /^research\//,
  /^eval\/.*\/(?:transcripts|runs|results|__fixtures__)\//,
  /\/references\/upstream\//,
  /^THIRD_PARTY_NOTICES\.md$/,
  /FONT-LICENSES\.md$/,
]

/** Repository-relative paths of every tracked, maintained Markdown file. */
export function maintainedMarkdownFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  return tracked.filter(path => !EXCLUDED.some(pattern => pattern.test(path))).sort()
}

const GENERATED_BLOCK = /<!-- BEGIN GENERATED[\s\S]*?<!-- END GENERATED[^>]*-->/g

/** The text a person maintains by hand: generated blocks are blanked, keeping line numbers. */
export function handMaintainedText(markdown: string): string {
  return markdown.replace(GENERATED_BLOCK, block => block.replace(/[^\n]/g, ''))
}
