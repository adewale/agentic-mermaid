// Execute the documented examples through an isolated, packed consumer install.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'agentic-quickstarts-'));
const run = (command, args, cwd = scratch) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, env: process.env, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
};
try {
  const tarball = process.env.AM_TEST_TARBALL
    ? resolve(process.env.AM_TEST_TARBALL)
    : join(scratch, JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root))[0].filename);
  writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--no-audit', '--no-fund', tarball]);
  const guide = readFileSync(join(root, 'docs/getting-started.md'), 'utf8');
  let examples = 0;
  for (const match of guide.matchAll(/```(?:ts|js)\n([\s\S]*?)```/g)) {
    const path = join(scratch, `example-${++examples}.mts`);
    writeFileSync(path, match[1]);
    run('node', [path]);
  }
  assert(examples > 0, 'The guide must expose executable examples');
  writeFileSync(join(scratch, 'diagram.mmd'), 'flowchart LR\n  A[Start] --> B[Finish]\n');
  for (const match of guide.matchAll(/^npx --no-install agentic-mermaid (.+)$/gm)) {
    const args = match[1].trim().split(/\s+/);
    const outputIndex = args.indexOf('--output');
    const outputPath = outputIndex < 0 ? undefined : join(scratch, args[outputIndex + 1]);
    // Each documented command must produce its own artifact. Earlier library
    // examples deliberately use the same filenames.
    if (outputPath) rmSync(outputPath, { force: true });
    const output = run('npx', ['--no-install', 'agentic-mermaid', ...args]);
    if (match[1].includes('--format png')) {
      assert(outputPath, 'PNG CLI example must name its output');
      assert.equal(readFileSync(outputPath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    if (match[1].includes('--format svg')) assert(output.includes('<svg'));
    if (match[1].includes('--format ascii')) assert(output.includes('Start') && output.includes('Finish'));
  }
  run('npx', ['--no-install', 'agentic-mermaid', '--help']);
  console.log(`Installed tarball: ${examples} documented JS/TS examples, CLI exports, package-runner help, and PNG signature passed`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
