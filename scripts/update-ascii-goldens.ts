#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { renderMermaidAscii } from '../src/ascii/index.ts'

interface TestCase {
  sourceLines: string[]
  mermaid: string
  expected: string
  paddingX: number
  paddingY: number
}

const root = resolve(import.meta.dir, '..')
const testdataDir = join(root, 'src', '__tests__', 'testdata')
const defaultDirs = [join(testdataDir, 'ascii'), join(testdataDir, 'unicode')]

function parseFixture(content: string): TestCase {
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  const paddingRegex = /^(?:padding([xy]))\s*=\s*(\d+)\s*$/i
  let separatorIndex = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === '---') {
      separatorIndex = i
      break
    }
  }
  if (separatorIndex < 0) separatorIndex = lines.length

  const tc: TestCase = {
    sourceLines: lines.slice(0, separatorIndex),
    mermaid: '',
    expected: separatorIndex < lines.length ? lines.slice(separatorIndex + 1).join('\n') : '',
    paddingX: 5,
    paddingY: 5,
  }

  let mermaidStarted = false
  const mermaidLines: string[] = []
  for (const line of tc.sourceLines) {
    const trimmed = line.trim()
    if (!mermaidStarted) {
      if (trimmed === '') continue
      const match = trimmed.match(paddingRegex)
      if (match) {
        const value = parseInt(match[2]!, 10)
        if (match[1]!.toLowerCase() === 'x') tc.paddingX = value
        else tc.paddingY = value
        continue
      }
    }
    mermaidStarted = true
    mermaidLines.push(line)
  }

  tc.mermaid = mermaidLines.join('\n') + '\n'
  return tc
}

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
  const tc = parseFixture(content)
  const actual = normalizeGolden(renderMermaidAscii(tc.mermaid, {
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
