import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runLiveAgentUsageEval, runLiveSkillComparison, type LiveModelConfig, type LiveTranscript, type LiveRequest } from '../../eval/agent-usage/live.ts'
import { DEFAULT_CASES } from '../../eval/agent-usage/run.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()
const example = DEFAULT_CASES[0]!
const config: LiveModelConfig = { provider: 'openai-compatible', apiKey: 'test-only', model: 'test-model', maxTokens: 1234, temperature: 0 }

describe('live runner measurements', () => {
  for (const provider of ['openai-compatible', 'anthropic'] as const) {
    test(`${provider} captures provider counters at the first successful diagram call`, async () => {
      const request = (async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.max_tokens).toBe(1234)
        return Response.json(provider === 'anthropic'
          ? { content: [{ type: 'text', text: example.script }], usage: { input_tokens: 20, cache_creation_input_tokens: 60, cache_read_input_tokens: 40, output_tokens: 30 } }
          : { choices: [{ message: { content: example.script } }], usage: { prompt_tokens: 120, completion_tokens: 30 } })
      }) as LiveRequest
      const summary = await runLiveAgentUsageEval({ ...config, provider }, { outDir: temp.dir(), caseIds: [example.id], request })
      expect(summary.ok).toBe(true)
      expect(summary.discoveryObservedCases).toBe(1)
      const transcript = JSON.parse(readFileSync(summary.transcripts[0]!, 'utf8')) as LiveTranscript
      expect(transcript.metrics!.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
      const discovery = transcript.metrics!.discovery!
      expect(discovery.turnsBeforeFirstProductiveCall).toBe(1)
      expect(discovery.inputTokensBeforeFirstProductiveCall).toBe(120)
      expect(discovery.outputTokensBeforeFirstProductiveCall).toBe(30)
      expect(discovery.elapsedMsToFirstProductiveCall).toBeGreaterThanOrEqual(transcript.metrics!.generationMs)
      expect(discovery.elapsedMsToFirstProductiveCall).toBeLessThanOrEqual(transcript.metrics!.totalMs)
    })
  }

  test('missing usage and a failed parse cannot become zero-cost productive observations', async () => {
    for (const [script, usage] of [[example.script, undefined], ['mermaid.parseRegisteredMermaid(""); return 42', { prompt_tokens: 10, completion_tokens: 5 }]] as const) {
      const request = (async () => Response.json({ choices: [{ message: { content: script } }], usage })) as LiveRequest
      const summary = await runLiveAgentUsageEval(config, { outDir: temp.dir(), caseIds: [example.id], request })
      const transcript = JSON.parse(readFileSync(summary.transcripts[0]!, 'utf8')) as LiveTranscript
      expect(summary.discoveryObservedCases).toBe(0)
      expect(transcript.metrics!.discovery).toBeNull()
    }
  })

  test('invalid cache counters make Anthropic usage unavailable', async () => {
    for (const cache of [-1, 0.5, '100', null]) {
      const request = (async () => Response.json({ content: [{ type: 'text', text: example.script }], usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: cache } })) as LiveRequest
      const summary = await runLiveAgentUsageEval({ ...config, provider: 'anthropic' }, { outDir: temp.dir(), caseIds: [example.id], request })
      const transcript = JSON.parse(readFileSync(summary.transcripts[0]!, 'utf8')) as LiveTranscript
      expect(transcript.metrics!.usage).toBeNull()
      expect(transcript.metrics!.discovery).toBeNull()
    }
  })

  test('paired skill comparison uses identical tasks, alternates order, and grades task success independently', async () => {
    const cases = DEFAULT_CASES.slice(0, 2)
    const seen: Array<{ user: string; skill: boolean }> = []
    const request = (async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const user = body.messages[1].content as string
      const skill = (body.messages[0].content as string).includes('# Agentic Mermaid — diagram workflow')
      seen.push({ user, skill })
      const script = skill ? cases.find(c => user.includes(`Task ID: ${c.id}\n`))!.script : 'return 42'
      return Response.json({ choices: [{ message: { content: script } }], usage: { prompt_tokens: 120, completion_tokens: 30 } })
    }) as LiveRequest
    const outDir = temp.dir()
    const comparison = await runLiveSkillComparison(config, { outDir, caseIds: cases.map(c => c.id), request })
    expect(seen.map(c => c.skill)).toEqual([false, true, true, false])
    expect(seen[0]!.user).toBe(seen[1]!.user)
    expect(seen[2]!.user).toBe(seen[3]!.user)
    expect(comparison.noneTaskPassed).toBe(0)
    expect(comparison.skillTaskPassed).toBe(2)
    expect(comparison.skillOnlyPassed).toEqual(cases.map(c => c.id))
    expect(JSON.parse(readFileSync(join(outDir, 'comparison.json'), 'utf8')).totalPairs).toBe(2)
  })
})
