// Minimum Bun for Code Mode. The node:vm sandbox relies on `timeout` bounding
// only the run that armed it. Bun releases before 1.4.0 get that wrong: up to
// 1.2.14 they ignore `timeout`, so a runaway script never stops, and 1.2.15
// through 1.3.14 leave its deadline armed after the call returns, so host work
// that follows — a render_png sent beside execute (#298) — is terminated and
// the process crashes or hangs. Bun 1.4.0 fixed it (oven-sh/bun#38660). Node
// is unaffected. Keep in step with `engines.bun` in package.json.
export const MIN_BUN_VERSION = '1.4.0'

/** Why `version` cannot run Code Mode, or undefined when it can. Not on Bun → undefined. */
export function unsupportedBunReason(version: string | undefined = process.versions.bun): string | undefined {
  if (version === undefined) return undefined
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  const minimum = MIN_BUN_VERSION.split('.').map(Number)
  if (found) {
    const delta = [1, 2, 3].map(i => Number(found[i]) - minimum[i - 1]!).find(d => d !== 0) ?? 0
    if (delta >= 0) return undefined
  }
  return `Code Mode requires Bun ${MIN_BUN_VERSION} or later (found ${version}): earlier Bun mishandles node:vm timeouts, which can hang or crash the server. Run \`bun upgrade\`.`
}
