#!/usr/bin/env bun
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const DIST = join(ROOT, 'dist')
const LAZY_OUTPUT = join(DIST, 'browser-lazy')
const METAFILE = join(DIST, 'metafile-esm.json')

if (dirname(LAZY_OUTPUT) !== DIST || dirname(METAFILE) !== DIST) {
  throw new Error('Refusing to clean lazy browser outputs outside dist')
}

rmSync(LAZY_OUTPUT, { recursive: true, force: true })
rmSync(METAFILE, { force: true })
