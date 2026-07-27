import { readFileSync } from 'node:fs'

type WranglerOutputEntry = Record<string, unknown>

function parseEntry(line: string, index: number): WranglerOutputEntry {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new Error(`Wrangler output line ${index + 1} is not valid JSON`, { cause: error })
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Wrangler output line ${index + 1} is not a JSON object`)
  }
  return value as WranglerOutputEntry
}

export function resolveWranglerVersionUpload(ndjson: string, expectedWorkerName: string): string {
  const entries = ndjson
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(parseEntry)

  const uploads = entries.filter(entry => entry.type === 'version-upload' && entry.version === 1 && entry.worker_name === expectedWorkerName)

  if (uploads.length !== 1) {
    throw new Error(`Expected exactly one Wrangler version-upload event for ${expectedWorkerName}; found ${uploads.length}`)
  }

  const versionId = uploads[0]!.version_id
  if (typeof versionId !== 'string' || versionId.length === 0) {
    throw new Error(`Wrangler version-upload event for ${expectedWorkerName} has no version_id`)
  }
  return versionId
}

if (import.meta.main) {
  const [outputPath, expectedWorkerName] = process.argv.slice(2)
  if (!outputPath || !expectedWorkerName) {
    throw new Error('Usage: bun run scripts/ci/resolve-wrangler-version-upload.ts <output.ndjson> <worker-name>')
  }
  process.stdout.write(resolveWranglerVersionUpload(readFileSync(outputPath, 'utf8'), expectedWorkerName))
}
