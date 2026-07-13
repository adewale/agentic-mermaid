export function dependencyStartupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/i.test(message)) {
    return 'source checkout dependencies are not installed. Run `bun install` in the repository root, then retry.'
  }
  return message.split('\n')[0]!
}
