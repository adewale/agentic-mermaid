type FetchHandler = (
  request: Request,
  server: Bun.Server<unknown>,
) => Response | Promise<Response>

export function serveWithAvailablePort(
  options: {
    preferredPort: number
    hostname?: string
    maxAttempts?: number
    fetch: FetchHandler
  },
): { server: ReturnType<typeof Bun.serve>; base: string } {
  const {
    preferredPort,
    hostname = '127.0.0.1',
    maxAttempts = 50,
    fetch,
  } = options
  let lastError: unknown

  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset
    try {
      const server = Bun.serve({ hostname, port, fetch })
      return { server, base: `http://${hostname}:${port}` }
    } catch (error) {
      lastError = error
      const code = (error as { code?: string }).code
      if (code !== 'EADDRINUSE') throw error
    }
  }

  throw new Error(`Could not start test server near port ${preferredPort}: ${String(lastError)}`)
}
