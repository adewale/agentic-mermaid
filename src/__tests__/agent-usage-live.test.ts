import { describe, test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildLiveEvalSystemPrompt, buildLiveEvalUserPrompt, extractCodeModeScript, resolveLiveModelConfig, runLiveAgentUsageEval, type LiveTranscript } from '../../eval/agent-usage/live.ts'
import { buildSubagentPromptEvalRequest, finalizeSubagentPromptEval, prepareSubagentPromptEval } from '../../eval/agent-usage/capture-subagent-prompt-eval.ts'
import { DEFAULT_CASES, checkAgentUsageTaskSource, runAgentUsageEval } from '../../eval/agent-usage/run.ts'
import { AGENT_USAGE_SUPPORTED_FAMILIES } from '../../eval/agent-usage/render-quality.ts'
import { parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../agent/index.ts'

const TRANSCRIPT_ROOT = join(import.meta.dir, '..', '..', 'eval', 'agent-usage', 'transcripts')
const REQUIRED_RELEASE_TRANSCRIPT_DIR = 'pi-subagent-release-2026-06-10'
const REQUIRED_ALL_FAMILY_CHAT_TRANSCRIPT_DIR = 'pi-subagent-all-families-2026-06-27-chat'

function committedTranscriptDirs(): string[] {
  return readdirSync(TRANSCRIPT_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('pi-subagent'))
    .map(entry => join(TRANSCRIPT_ROOT, entry.name))
    .sort()
}

describe('live agent-usage eval harness', () => {
  test('extracts fenced Code Mode JavaScript without markdown', () => {
    const script = extractCodeModeScript('Here you go:\n```js\nconst r = mermaid.parseRegisteredMermaid(\'flowchart TD\\n A --> B\')\nreturn r\n```')
    expect(script).toContain('mermaid.parseRegisteredMermaid')
    expect(script).not.toContain('```')
  })

  test('unwraps common Cloudflare-style arrow-function responses into our execute body', () => {
    const script = extractCodeModeScript('async () => {\n  const r = mermaid.parseRegisteredMermaid(\'flowchart TD\\n A --> B\')\n  return r\n};')
    expect(script.startsWith('const r = mermaid.parseRegisteredMermaid')).toBe(true)
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

  test('subagent prompt capture prepares harness-agnostic requests and gates responses with the oracle', async () => {
    const c = DEFAULT_CASES[0]!
    const dir = mkdtempSync(join(tmpdir(), 'am-subagent-prompt-eval-'))
    const manifest = prepareSubagentPromptEval({ outDir: dir, provider: 'pi-subagent', model: 'delegate-test', surface: 'homepage', caseIds: [c.id], capturedAt: '2026-06-30T00:00:00.000Z' })
    const request = readFileSync(manifest.requests[0]!.requestPath, 'utf8')
    expect(request).toContain('Use one fresh subagent per request')
    expect(request).toContain('Task prompt under test:')
    expect(request).toContain(c.prompt)
    expect(request).toContain('Return only executable synchronous Code Mode JavaScript')
    expect(request).toContain('on success return an object with { source }')
    expect(request).toContain('Do not return the public prompt')
    expect(request).toContain('SDK declaration available in Code Mode')
    expect(buildSubagentPromptEvalRequest(c, 'skill')).toContain('skills/agentic-mermaid-diagram-workflow/SKILL.md')

    writeFileSync(manifest.requests[0]!.responsePath, `The subagent should not add prose, but the extractor tolerates fences.\n\`\`\`js\n${c.script}\n\`\`\`\n`)
    const summary = await finalizeSubagentPromptEval({ runDir: dir })
    expect(summary.ok).toBe(true)
    expect(summary.provider).toBe('pi-subagent')
    expect(summary.total).toBe(1)
    expect(summary.passed).toBe(1)
    const transcript = JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8')) as LiveTranscript & { surface?: string }
    expect(transcript.provider).toBe('pi-subagent')
    expect(transcript.prompts.user).toContain(c.prompt)
    expect(transcript.result.ok).toBe(true)
    expect(existsSync(join(dir, 'summary.json'))).toBe(true)
  })

  test('subagent prompt capture can gate raw chat prompt responses separately from Code Mode', async () => {
    const c = DEFAULT_CASES.find(c => c.id === 'author_api_sequence_source')!
    const dir = mkdtempSync(join(tmpdir(), 'am-subagent-chat-eval-'))
    const manifest = prepareSubagentPromptEval({ outDir: dir, provider: 'claude-subagent', model: 'weakest-test', surface: 'homepage', mode: 'chat', caseIds: [c.id], capturedAt: '2026-06-30T00:00:00.000Z' })
    const request = readFileSync(manifest.requests[0]!.requestPath, 'utf8')
    expect(request).toContain('Mode: raw chat prompt')
    expect(request).toContain('Return the human-facing response requested by the prompt')
    expect(request).not.toContain('SDK declaration available in Code Mode')
    writeFileSync(manifest.requests[0]!.responsePath, `## Updated Mermaid\n\n\`\`\`mermaid\nsequenceDiagram\n    actor User\n    participant App\n    participant API\n    User->>App: Export request\n    App->>API: Render SVG\n    API-->>App: SVG string\n    App-->>User: Download\n\`\`\`\n\n## Verification\nRan parseMermaid and verifyMermaid successfully; ok: true, warnings: [].\n\n## Trace\nAuthored a new sequence diagram from context, then ran parseMermaid and verifyMermaid. No mutate was used because this is a new diagram.\n`)
    const summary = await finalizeSubagentPromptEval({ runDir: dir })
    expect(summary.ok).toBe(true)
    expect(summary.mode).toBe('chat')
    const transcript = JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8')) as LiveTranscript & { mode?: string; extractedSource?: string }
    expect(transcript.mode).toBe('chat')
    expect(transcript.extractedSource).toContain('sequenceDiagram')
    expect(transcript.script).toBe('')
    expect(transcript.result.ok).toBe(true)
  })

  test('new-diagram authoring via buildMermaid or the CLI satisfies the chat trace check; no-tool does not', async () => {
    // The canonical guide authors new diagrams with buildMermaid/createMermaid
    // (no parse) or verifies via the CLI; the chat trace check must accept those
    // safe paths, not just literal parseMermaid+verifyMermaid, while still
    // rejecting hand-written Mermaid produced without engaging the tool.
    const id = 'author_state_source'
    const source = 'stateDiagram-v2\n  [*] --> Red\n  Red --> Green\n  Green --> Yellow\n  Yellow --> Red'
    const body = (verification: string, trace: string) =>
      `## Updated Mermaid\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n## Verification\n${verification}\n\n## Trace\n${trace}\n`
    const run = async (response: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'am-trace-eval-'))
      const manifest = prepareSubagentPromptEval({ outDir: dir, provider: 'claude-subagent', model: 't', surface: 'homepage', mode: 'chat', caseIds: [id], capturedAt: '2026-06-30T00:00:00.000Z' })
      writeFileSync(manifest.requests[0]!.responsePath, response)
      await finalizeSubagentPromptEval({ runDir: dir })
      return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).result as { ok: boolean; taskOk: boolean; traceOk: boolean }
    }
    // buildMermaid authoring, no parseMermaid — the endorsed new-diagram path.
    const built = await run(body('verifyMermaid returned ok: true, warnings: [].', "Built the diagram with buildMermaid('state', [...]) via the library, then verifyMermaid (ok) and serializeMermaid. A new diagram from typed ops, no mutate."))
    expect({ ok: built.ok, taskOk: built.taskOk, traceOk: built.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
    // CLI verification of authored source — the CLI parses the source itself.
    const cli = await run(body('Verified with `bun run bin/am.ts verify traffic.mmd --json`: ok true, warnings [].', 'Authored the source from Context and verified with the am CLI (am verify). No mutate — new diagram.'))
    expect({ ok: cli.ok, taskOk: cli.taskOk, traceOk: cli.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
    // Hosted MCP verification — the third-party channel (no repo, no npm). The
    // /mcp verify tool parses the source itself; no verifyMermaid/am verify token.
    const mcp = await run(body('Verified via the hosted MCP: the /mcp verify tool returned ok true, warnings [].', 'Authored the source from Context and verified it with the hosted MCP verify tool at agentic-mermaid.dev/mcp. No mutate — new diagram.'))
    expect({ ok: mcp.ok, taskOk: mcp.taskOk, traceOk: mcp.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
    // Hand-written with no tool engagement — must still fail the trace check.
    const naive = await run(body('Looks correct.', 'Wrote this state diagram directly from the description.'))
    expect({ taskOk: naive.taskOk, traceOk: naive.traceOk, ok: naive.ok }).toEqual({ taskOk: true, traceOk: false, ok: false })
  })

  test('the declarative edit path (am mutate / MCP mutate / applyOps) satisfies the chat trace check', async () => {
    // The prompt now recommends the declarative mutate/build tools: they apply a
    // JSON op list and return { ok, family, source, verify }, verifying
    // internally (and the CLI emits source only when verify succeeds). So using
    // one is BOTH verification and structured-mutation evidence — the grader must
    // credit it for a structured-mutation case, not just literal am verify.
    const id = 'class_add_duck'
    const source = 'classDiagram\n  class Animal\n  class Duck {\n    +quack()\n  }'
    const body = (trace: string) =>
      `## Updated Mermaid\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n## Verification\nok: true, warnings: [].\n\n## Trace\n${trace}\n`
    const run = async (response: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'am-decl-eval-'))
      const manifest = prepareSubagentPromptEval({ outDir: dir, provider: 'claude-subagent', model: 't', surface: 'homepage', mode: 'chat', caseIds: [id], capturedAt: '2026-06-30T00:00:00.000Z' })
      writeFileSync(manifest.requests[0]!.responsePath, response)
      await finalizeSubagentPromptEval({ runDir: dir })
      return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).result as { ok: boolean; taskOk: boolean; traceOk: boolean }
    }
    // CLI declarative: `am mutate --ops` applies the ops and verifies internally.
    const cli = await run(body('Channel: CLI. Ran `bun run bin/am.ts mutate animal.mmd --ops ops.json --json` with ops [{ kind: "add_class", id: "Duck" }, { kind: "add_member", class: "Duck", text: "+quack()" }]; it returned ok with the verified source.'))
    expect({ ok: cli.ok, taskOk: cli.taskOk, traceOk: cli.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
    // Hosted MCP declarative tool.
    const mcp = await run(body('Channel: hosted MCP. tools/call {"name":"mutate","arguments":{"source":"classDiagram...","ops":[...]}} at /mcp returned { ok, family, source, verify }.'))
    expect({ ok: mcp.ok, taskOk: mcp.taskOk, traceOk: mcp.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
    // Library declarative applyOps.
    const lib = await run(body('Channel: library. applyOps({ source, ops: [{ kind: "add_class", id: "Duck" }, { kind: "add_member", class: "Duck", text: "+quack()" }] }) from ./src/agent returned { ok, family, source, verify }.'))
    expect({ ok: lib.ok, taskOk: lib.taskOk, traceOk: lib.traceOk }).toEqual({ ok: true, taskOk: true, traceOk: true })
  })

  test('config resolver fails closed without a live API key', () => {
    expect(() => resolveLiveModelConfig({}, ['--provider', 'anthropic', '--model', 'test-model'])).toThrow('Missing API key')
  })

  test('live runner rejects unknown case ids instead of producing a green zero-task run', async () => {
    await expect(runLiveAgentUsageEval({ provider: 'anthropic', model: 'unused', apiKey: 'unused', maxTokens: 1, temperature: 0 }, { caseIds: ['nope'] })).rejects.toThrow('Unknown live eval case')
  })

  test('committed live-model transcripts remain honest across the parser API break', async () => {
    const dirs = committedTranscriptDirs()
    const dirNames = dirs.map(d => basename(d))
    expect(dirNames).toContain(REQUIRED_RELEASE_TRANSCRIPT_DIR)
    expect(dirNames).toContain(REQUIRED_ALL_FAMILY_CHAT_TRANSCRIPT_DIR)
    const byId = new Map(DEFAULT_CASES.map(c => [c.id, c]))
    for (const dir of dirs) {
      expect(existsSync(join(dir, 'summary.json'))).toBe(true)
      const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { mode?: 'code' | 'chat'; total?: number; transcripts: string[] }
      expect(summary.transcripts.length).toBeGreaterThanOrEqual(6)
      const transcripts = summary.transcripts.map((p) => JSON.parse(readFileSync(join(import.meta.dir, '..', '..', p), 'utf8')) as LiveTranscript & { mode?: 'code' | 'chat'; extractedSource?: string })
      expect(transcripts.every(t => t.provider === 'pi-subagent' && t.result.ok)).toBe(true)
      const mode = summary.mode ?? transcripts[0]?.mode ?? 'code'
      if (basename(dir) === REQUIRED_ALL_FAMILY_CHAT_TRANSCRIPT_DIR) {
        // Immutable June evidence predates Mindmap/GitGraph/Radar. Keep it
        // honest rather than fabricating live-model responses when the current
        // registry grows; deterministic DEFAULT_CASES cover the new families.
        expect(summary.total).toBe(transcripts.length)
        expect(new Set(transcripts.map(t => t.caseId))).toEqual(new Set(DEFAULT_CASES
          .filter(c => c.family !== 'mindmap' && c.family !== 'gitgraph' && c.family !== 'radar')
          .map(c => c.id)))
        const families = new Set(transcripts.map(t => byId.get(t.caseId)?.family).filter(Boolean))
        expect(AGENT_USAGE_SUPPORTED_FAMILIES.filter(family => !families.has(family)).sort()).toEqual(['gitgraph', 'mindmap', 'radar'])
      }
      if (mode === 'chat') {
        for (const t of transcripts) {
          const source = t.extractedSource
          expect(typeof source).toBe('string')
          expect(checkAgentUsageTaskSource(t.caseId, source!)).toBe(true)
          const parsed = parseMermaid(source!)
          expect(parsed.ok).toBe(true)
          if (parsed.ok) expect(verifyMermaid(parsed.value).ok).toBe(true)
        }
        continue
      }
      // Code-mode evidence captured before parseRegisteredMermaid became the
      // sole public parser remains immutable evidence of the API at capture
      // time. Do not rewrite or adapt those scripts in memory: doing so would
      // reintroduce the removed parseMermaid compatibility surface into the
      // current evaluator.
      const removedParserScripts = transcripts.filter(t => /\bmermaid\.parseMermaid\s*\(/.test(t.script))
      if (removedParserScripts.length > 0) {
        expect(removedParserScripts).toHaveLength(transcripts.length)
        expect(removedParserScripts.every(t => t.result.ok)).toBe(true)
        continue
      }
      const replayCases = transcripts.map(t => {
        const c = byId.get(t.caseId)
        expect(c).toBeDefined()
        return { ...c!, script: t.script }
      })
      const replay = await runAgentUsageEval(replayCases)
      expect(replay.ok).toBe(true)
      expect(replay.passed).toBe(replay.total)
      expect(replay.safePathRate).toBe(1)
      expect(replay.structuredPathRate).toBe(1)
    }
  })
})
