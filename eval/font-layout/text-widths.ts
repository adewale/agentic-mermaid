import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const input = JSON.parse(readFileSync(0, 'utf8')) as { root: string; bundled: boolean; labels: string[] }
const load = (path: string) => import(pathToFileURL(resolve(input.root, path)).href)
const { measureTextWidth } = await load('src/text-metrics.ts')
const { createTextMeasurementExecution, withTextMeasurementExecution } = await load('src/text-measurement-profile.ts')
const profile = input.bundled ? (await load('src/inter-metrics.ts')).BUNDLED_INTER_TEXT_MEASUREMENT : undefined
const execution = createTextMeasurementExecution(profile, 'Inter')
console.log(JSON.stringify(withTextMeasurementExecution(execution, () => [400, 500, 600, 700].flatMap(weight => input.labels.map(text => ({ text, weight, measuredPx: measureTextWidth(text, 16, weight) }))))))
