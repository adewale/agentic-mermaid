type ServeOptions = Parameters<typeof Bun.serve>[0]

export function serveWithAvailablePort(
  options: ServeOptions & {
    preferredPort: number
    hostname?: string
    maxAttempts?: number
  },
): { server: ReturnType<typeof Bun.serve>; base: string } {
  const {
    preferredPort,
    hostname = '127.0.0.1',
    maxAttempts = 50,
    ...serveOptions
  } = options
  let lastError: unknown

  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset
    try {
      const server = Bun.serve({ ...serveOptions, hostname, port })
      return { server, base: `http://${hostname}:${port}` }
    } catch (error) {
      lastError = error
      const code = (error as { code?: string }).code
      if (code !== 'EADDRINUSE') throw error
    }
  }

  throw new Error(`Could not start test server near port ${preferredPort}: ${String(lastError)}`)
}
