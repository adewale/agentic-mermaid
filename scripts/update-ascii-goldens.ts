#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { renderMermaidASCII } from '../src/ascii/index.ts'
import { parseAsciiGoldenFixture } from './ascii-golden-fixture.ts'

const root = resolve(import.meta.dir, '..')
const testdataDir = join(root, 'src', '__tests__', 'testdata')
const defaultDirs = [join(testdataDir, 'ascii'), join(testdataDir, 'unicode')]

function normalizeGolden(s: string): string {
  return s
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function useAsciiFor(path: string): boolean {
  const parts = resolve(path).split(sep)
  if (parts.includes('ascii')) return true
  if (parts.includes('unicode')) return false
  throw new Error(`cannot infer ASCII/Unicode mode from path: ${path}`)
}

function collectFiles(): string[] {
  const files: string[] = []
  for (const dir of defaultDirs) {
    for (const name of readdirSync(dir).filter(f => f.endsWith('.txt')).sort()) {
      files.push(join(dir, name))
    }
  }
  return files
}

function expandInputs(inputs: string[]): string[] {
  if (inputs.length === 0) return collectFiles()
  const files: string[] = []
  for (const input of inputs) {
    const path = resolve(root, input)
    if (!existsSync(path)) throw new Error(`not found: ${input}`)
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).filter(f => f.endsWith('.txt')).sort()) {
        files.push(join(path, name))
      }
    } else {
      files.push(path)
    }
  }
  return files
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const help = args.includes('--help') || args.includes('-h')
const inputs = args.filter(a => !a.startsWith('-'))

if (help) {
  console.log(`Usage: bun run scripts/update-ascii-goldens.ts [--check] [fixture-or-dir ...]\n\nRegenerates expected output for src/__tests__/testdata/{ascii,unicode}/*.txt.\nFixtures use source above the final line containing only --- and expected output below it.\nUsing the final separator lets Mermaid frontmatter delimiters appear in the source.`)
  process.exit(0)
}

const changed: string[] = []
for (const file of expandInputs(inputs)) {
  const content = readFileSync(file, 'utf-8')
  const tc = parseAsciiGoldenFixture(content)
  const actual = normalizeGolden(renderMermaidASCII(tc.mermaid, {
    useAscii: useAsciiFor(file),
    paddingX: tc.paddingX,
    paddingY: tc.paddingY,
  }))
  const next = `${tc.sourceLines.join('\n').replace(/\n+$/g, '')}\n---\n${actual}\n`
  if (normalizeGolden(tc.expected) !== actual) {
    changed.push(relative(root, file))
    if (!check) writeFileSync(file, next)
  }
}

if (changed.length === 0) {
  console.log(`ASCII/Unicode golden fixtures are up to date (${expandInputs(inputs).length} checked).`)
} else if (check) {
  console.error(`ASCII/Unicode golden fixtures are stale (${changed.length}):`)
  for (const file of changed) console.error(`- ${file}`)
  process.exitCode = 1
} else {
  console.log(`Updated ${changed.length} ASCII/Unicode golden fixture(s):`)
  for (const file of changed) console.log(`- ${file}`)
}
