import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBalancedPortfolio, portfolioProvenance } from '../../mermaid-family-portfolio/build.ts'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('Usage: portfolio.ts --out DIRECTORY')
const out = resolve(args[1]),
  root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const portfolio = buildBalancedPortfolio(root)
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'corpus.json'), JSON.stringify(portfolio, null, 2) + '\n')
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ status: 'passed', scope: 'Registry-derived corpus preparation, not renderer qualification', ...portfolioProvenance(portfolio) }, null, 2) + '\n')
console.log(`Prepared ${portfolio.length} portfolio inputs without rewriting tracked corpus files`)
