// Execute the reader's shell blocks, not a second inventory of CLI examples.
import { expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeHTML } from 'entities'
import { Resvg } from '@resvg/resvg-js'
import { decodePng } from '../../src/__tests__/helpers/png-pixels.ts'

const STEP_TIMEOUT_MS = 120_000
const MCP_INPUT = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'getting-started-ci', version: '1.0.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
].map(request => JSON.stringify(request)).join('\n') + '\n'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function shellCommands(blocks: string[]): string[] {
  return blocks.flatMap(block => {
    const lines = block.trim().split('\n')
    const commands: string[] = []
    for (let i = 0; i < lines.length; i++) {
      let command = lines[i]!.trim()
      if (!command || command.startsWith('#')) continue
      const heredoc = command.match(/<<\s*['"]?(\w+)['"]?/)
      if (heredoc) {
        const delimiter = heredoc[1]!
        do {
          if (++i >= lines.length) throw new Error(`Unterminated heredoc: ${command}`)
          command += `\n${lines[i]}`
        } while (lines[i] !== delimiter)
      } else {
        while (command.endsWith('\\')) {
          if (++i >= lines.length) throw new Error(`Unterminated shell continuation: ${command}`)
          command += `\n${lines[i]}`
        }
      }
      commands.push(command)
    }
    return commands
  })
}

function markdownShellBlocks(markdown: string): string[] {
  // The repository-development alternative builds from Git, rather than using
  // the packed package. All consumer bash blocks run, in document order.
  let repositoryDevelopment = false
  const blocks: string[] = []
  for (const match of markdown.matchAll(/^#{2,3} .+$|^```(\w*)\n([\s\S]*?)^```/gm)) {
    if (match[0].startsWith('#')) repositoryDevelopment = match[0] === '### Repository development'
    else if (match[1] === 'bash' && !repositoryDevelopment) blocks.push(match[2]!)
  }
  return blocks
}

function expectSvg(svg: string): void {
  // resvg independently parses XML and requires an SVG root.
  const document = new Resvg(svg, { font: { loadSystemFonts: false } })
  expect(document.width).toBeGreaterThan(0)
  expect(document.height).toBeGreaterThan(0)
}

function expectMcp(stdout: string): void {
  const responses = stdout.trim().split('\n').map(line => JSON.parse(line))
  expect(responses).toHaveLength(2)
  const initialized = responses.find(response => response.id === 1)
  expect(initialized?.jsonrpc).toBe('2.0')
  expect(initialized?.error).toBeUndefined()
  expect(initialized?.result?.protocolVersion).toBe('2025-11-25')
  expect(initialized?.result?.serverInfo?.name).toBeTruthy()
  const listed = responses.find(response => response.id === 2)
  expect(listed?.jsonrpc).toBe('2.0')
  expect(listed?.error).toBeUndefined()
  expect(listed?.result?.tools?.length).toBeGreaterThan(0)
  expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain('execute')
}

function runPage(source: string, blocks: string[], tarball: string, mcpConfig?: { command: string; args: string[] }, version?: string): void {
  const commands = shellCommands(blocks)
  expect(commands.length, source).toBeGreaterThan(0)
  const directory = mkdtempSync(join(tmpdir(), 'am-getting-started-'))
  // Keep installed-package commands offline: only the documented install step
  // may fetch dependencies. The pinned MCP config uses this same local tarball.
  const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
  let step = 0
  function runStep(original: string, command: string, mcp = false, install = false): void {
    step++
    try {
      const output = original.match(/--output\s+(\S+)/)?.[1]
      if (output) rmSync(join(directory, output), { force: true })
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
        cwd: directory,
        env: { ...env, npm_config_offline: install ? 'false' : 'true' },
        input: mcp ? MCP_INPUT : undefined,
        encoding: 'utf8',
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        killSignal: 'SIGKILL',
      })
      if (result.status !== 0) throw new Error(`exit=${result.status} signal=${result.signal}\n${result.error ?? ''}\n${result.stderr}\n${result.stdout}`)
      if (mcp) expectMcp(result.stdout)
      else if (/\bverify\b/.test(original)) expect(JSON.parse(result.stdout).ok).toBe(true)
      else if (/\bstyles\b/.test(original)) {
        const names = JSON.parse(result.stdout).map((style: { name: string }) => style.name)
        for (const name of ['publication-figure', 'ops-schematic', 'nord-light']) expect(names).toContain(name)
      } else if (/--format\s+svg\b/.test(original)) expectSvg(output ? readFileSync(join(directory, output), 'utf8') : result.stdout)
      else if (/--format\s+png\b/.test(original)) {
        expect(output).toBeDefined()
        const png = decodePng(readFileSync(join(directory, output!)))
        expect(png.width).toBeGreaterThan(0)
        expect(png.height).toBeGreaterThan(0)
      } else if (/--format\s+(?:ascii|unicode)\b/.test(original)) expect(result.stdout.trim().length).toBeGreaterThan(0)
    } catch (error) {
      throw new Error(`${source}, step ${step}:\n${original}\n\n${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  try {
    for (const command of commands) {
      const install = /^npm\s+(?:i|install)\s/.test(command)
      // The registry package spec is the sole substitution in shell examples.
      const executable = install ? command.replace(/\bagentic-mermaid\b/, shellQuote(tarball)) : command
      runStep(command, executable, /\smcp\s*$/.test(command), install)
    }
    if (mcpConfig) {
      const original = [mcpConfig.command, ...mcpConfig.args].join(' ')
      const label = `${source}, step ${step + 1}:\n${original}`
      expect(mcpConfig.command, label).toBe('npx')
      expect(mcpConfig.args, label).toContain(`agentic-mermaid@${version}`)
      // Preserve the package name: npx treats a bare .tgz path as a command.
      const executable = [mcpConfig.command, ...mcpConfig.args.map(arg => shellQuote(arg === `agentic-mermaid@${version}` ? `agentic-mermaid@file:${tarball}` : arg))].join(' ')
      runStep(original, executable, true)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function runGettingStartedCommands(repo: string, tarball: string): void {
  const site = mkdtempSync(join(tmpdir(), 'am-getting-started-site-'))
  try {
    const build = spawnSync('bun', ['run', 'website/build.ts'], {
      cwd: repo,
      env: { ...process.env, SITE_NPM_STATUS: 'published', AM_WEBSITE_PUBLIC_DIR: site },
      encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    })
    if (build.status !== 0) throw new Error(`Getting Started website build failed: ${build.error ?? ''}\n${build.stderr}\n${build.stdout}`)
    const page = readFileSync(join(site, 'docs/getting-started/index.html'), 'utf8')
    const blocks = [...page.matchAll(/<pre\b[^>]*>\s*<code class="language-bash">([\s\S]*?)<\/code><\/pre>/g)].map(match => decodeHTML(match[1]!))
    const config = page.match(/<code id="getting-started-mcp-config">([\s\S]*?)<\/code>/)
    expect(config, 'Getting Started MCP config card').not.toBeNull()
    const mcpConfig = JSON.parse(decodeHTML(config![1]!)).mcpServers['agentic-mermaid']
    expect(mcpConfig, 'Getting Started MCP server entry').toBeDefined()
    const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
    runPage('website /docs/getting-started/', blocks, tarball, mcpConfig, version)
    runPage('docs/getting-started.md', markdownShellBlocks(readFileSync(join(repo, 'docs/getting-started.md'), 'utf8')), tarball)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
}
