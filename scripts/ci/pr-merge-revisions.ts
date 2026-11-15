// Comparisons must use the base of the checked-out PR merge, not stale event metadata.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const head = process.argv[2]
if (!head || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Expected the full PR head SHA')
const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
// Revision walking hides parents at a shallow boundary; the commit object does not.
const header = execFileSync('git', ['cat-file', '-p', checkout], { encoding: 'utf8' }).split('\n\n', 1)[0]!
const parents = header.split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7))
if (parents.length !== 2 || parents[1] !== head) {
  throw new Error(`Checkout ${checkout} is not the expected PR merge for ${head}; parents: ${parents.join(', ')}`)
}
const base = parents[0]!
console.log(`Tested PR merge ${checkout}: base ${base}, head ${head}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\nhead=${head}\ncheckout=${checkout}\n`)
