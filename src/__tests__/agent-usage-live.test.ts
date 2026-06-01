import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLiveEvalSystemPrompt, buildLiveEvalUserPrompt, extractCodeModeScript, resolveLiveModelConfig, runLiveAgentUsageEval, type LiveTranscript } from '../../eval/agent-usage/live.ts'
import { DEFAULT_CASES, runAgentUsageEval } from '../../eval/agent-usage/run.ts'

const TRANSCRIPT_DIR = join(import.meta.dir, '..', '..', 'eval', 'agent-usage', 'transcripts', 'pi-subagent-2026-05-26')

describe('live agent-usage eval harness', () => {
  test('extracts fenced Code Mode JavaScript without markdown', () => {
    const script = extractCodeModeScript('Here you go:\n```js\nconst r = mermaid.parseMermaid(\'flowchart TD\\n A --> B\')\nreturn r\n```')
    expect(script).toContain('mermaid.parseMermaid')
    expect(script).not.toContain('```')
  })

  test('unwraps common Cloudflare-style arrow-function responses into our execute body', () => {
    const script = extractCodeModeScript('async () => {\n  const r = mermaid.parseMermaid(\'flowchart TD\\n A --> B\')\n  return r\n};')
    expect(script.startsWith('const r = mermaid.parseMermaid')).toBe(true)
    expect(script).toContain('return r')
    expect(script).not.toContain('async () =>')
  })

  test('system prompt makes the local synchronous Code Mode contract explicit', () => {
    const prompt = buildLiveEvalSystemPrompt('# guide')
    expect(prompt).toContain('Return ONLY the JavaScript body')
    expect(prompt).toContain('synchronously')
    expect(prompt).toContain('do not use async/await')
    expect(prompt).toContain('SDK declaration')
  })

  test('user prompt includes task id and exact input source', () => {
    const c = DEFAULT_CASES[0]!
    const prompt = buildLiveEvalUserPrompt(c)
    expect(prompt).toContain(c.id)
    expect(prompt).toContain(c.prompt)
    expect(prompt).toContain(c.input!)
  })

  test('config resolver fails closed without a live API key', () => {
    expect(() => resolveLiveModelConfig({}, ['--provider', 'anthropic', '--model', 'test-model'])).toThrow('Missing API key')
  })

  test('live runner rejects unknown case ids instead of producing a green zero-task run', async () => {
    await expect(runLiveAgentUsageEval({ provider: 'anthropic', model: 'unused', apiKey: 'unused', maxTokens: 1, temperature: 0 }, { caseIds: ['nope'] })).rejects.toThrow('Unknown live eval case')
  })

  test('committed live-model transcripts replay through the deterministic oracle', async () => {
    expect(existsSync(join(TRANSCRIPT_DIR, 'summary.json'))).toBe(true)
    const transcripts = DEFAULT_CASES.map(c => JSON.parse(readFileSync(join(TRANSCRIPT_DIR, `${c.id}.json`), 'utf8')) as LiveTranscript)
    expect(transcripts.map(t => t.caseId)).toEqual(DEFAULT_CASES.map(c => c.id))
    expect(transcripts.every(t => t.provider === 'pi-subagent' && t.result.ok)).toBe(true)
    const replayCases = DEFAULT_CASES.map(c => ({ ...c, script: transcripts.find(t => t.caseId === c.id)!.script }))
    const replay = await runAgentUsageEval(replayCases)
    expect(replay.ok).toBe(true)
    expect(replay.passed).toBe(replay.total)
    expect(replay.safePathRate).toBe(1)
    expect(replay.structuredPathRate).toBe(1)
  })
})
