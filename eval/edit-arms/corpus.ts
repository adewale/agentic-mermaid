// Loader for the held-out edit-arms corpus (corpus/manifest.json + corpus/tasks.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EditTask } from './score.ts'

export const CORPUS_DIR = join(import.meta.dir, 'corpus')

export interface CorpusDiagram {
  id: string
  family: string
  file: string
  source: { repository: string; path: string; commit: string; line: number; url: string; embedding: string }
  license: { spdx: string; file: string }
  retrieved: string
  lines: number
  features: Record<string, boolean>
}

export interface Corpus {
  diagrams: Map<string, CorpusDiagram & { text: string }>
  tasks: EditTask[]
}

export function loadCorpus(dir = CORPUS_DIR): Corpus {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { diagrams: CorpusDiagram[] }
  const diagrams = new Map(manifest.diagrams.map(d => [d.id, { ...d, text: readFileSync(join(dir, d.file), 'utf8') }]))
  const raw = JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8')) as { tasks: Array<Omit<EditTask, 'family'>> }
  const ids = new Set<string>()
  const tasks = raw.tasks.map(t => {
    const diagram = diagrams.get(t.diagram)
    if (!diagram) throw new Error(`Task ${t.id} names unknown diagram ${t.diagram}`)
    if (ids.has(t.id)) throw new Error(`Duplicate task id ${t.id}`)
    ids.add(t.id)
    return { ...t, family: diagram.family }
  })
  return { diagrams, tasks }
}
