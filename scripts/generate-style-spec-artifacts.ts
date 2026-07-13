import { styleSpecFieldReferenceMarkdown, styleSpecJsonSchema } from '../src/scene/style-spec.ts'

const CHECK = process.argv.includes('--check')
const ROOT = new URL('../', import.meta.url)
const SCHEMA_URL = new URL('docs/schemas/style-spec.schema.json', ROOT)
const DOC_URL = new URL('docs/style-authoring.md', ROOT)
const START = '<!-- BEGIN GENERATED STYLE SPEC FIELDS -->'
const END = '<!-- END GENERATED STYLE SPEC FIELDS -->'

async function updateFile(url: URL, expected: string): Promise<boolean> {
  const current = await Bun.file(url).text()
  if (current === expected) return false
  if (CHECK) {
    console.error(`${url.pathname.replace(ROOT.pathname, '')} is stale; run bun run style-spec-artifacts`)
    process.exitCode = 1
    return true
  }
  await Bun.write(url, expected)
  return true
}

const schema = `${JSON.stringify(styleSpecJsonSchema(), null, 2)}\n`
await updateFile(SCHEMA_URL, schema)

const currentDoc = await Bun.file(DOC_URL).text()
const start = currentDoc.indexOf(START)
const end = currentDoc.indexOf(END)
if (start < 0 || end < start) {
  throw new Error(`docs/style-authoring.md must contain ${START} and ${END}`)
}
const generatedRegion = `${START}\n${styleSpecFieldReferenceMarkdown()}\n${END}`
const expectedDoc = currentDoc.slice(0, start) + generatedRegion + currentDoc.slice(end + END.length)
await updateFile(DOC_URL, expectedDoc)

if (!process.exitCode) console.log(CHECK ? 'StyleSpec artifacts are current.' : 'Generated StyleSpec artifacts.')
