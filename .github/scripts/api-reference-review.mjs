import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const [root, output, label] = process.argv.slice(2)
const { chromium } = createRequire(resolve(root, 'package.json'))('playwright')
mkdirSync(output, { recursive: true })
const publicRoot = join(root, 'website/public')
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const file = join(publicRoot, path.endsWith('/') ? `${path}index.html` : path)
  if (!existsSync(file)) { res.writeHead(404).end(); return }
  res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
}).listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ headless: true, ...(process.env.AM_REVIEW_CHROMIUM ? { executablePath: process.env.AM_REVIEW_CHROMIUM } : {}) })
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`http://127.0.0.1:${server.address().port}/docs/api/`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(output, `${label}-api-top-${viewport.width}.png`) })
    const focus = await page.locator('#vocabulary').count() ? '#vocabulary' : '#versions'
    await page.locator(focus).evaluate(element => element.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: join(output, `${label}-vocabulary-${viewport.width}.png`) })
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}
