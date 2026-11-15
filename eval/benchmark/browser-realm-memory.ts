import type { Browser, Page } from 'playwright'

/** Retained JS heap after forced GC, separately for each renderer realm.
 * Excludes DOM/native allocations, renderer RSS, code cache and Blob backing. */
export async function realmMemory(browser: Browser, page: Page) {
  const main = await page.context().newCDPSession(page)
  await main.send('HeapProfiler.collectGarbage')
  const mainHeap = await main.send('Runtime.getHeapUsage')
  await main.detach()
  const cdp = await browser.newBrowserCDPSession()
  const workers = []
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    for (const target of targetInfos.filter(t => t.type === 'worker')) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
      let nextId = 0
      const send = (method: string) => new Promise<any>((done, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Worker CDP timeout: ${method}`)) }, 10_000)
        const listener = (event: { sessionId: string; message: string }) => {
          if (event.sessionId !== sessionId) return
          const message = JSON.parse(event.message)
          if (message.id !== id) return
          clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener)
          if (message.error) reject(new Error(JSON.stringify(message.error))); else done(message.result)
        }
        cdp.on('Target.receivedMessageFromTarget', listener)
        cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method }) }).catch(error => { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener); reject(error) })
      })
      try {
        await send('HeapProfiler.collectGarbage')
        workers.push({ url: target.url, ...await send('Runtime.getHeapUsage') })
      } finally { await cdp.send('Target.detachFromTarget', { sessionId }) }
    }
    return { main: mainHeap, workers, totalUsedJSHeap: mainHeap.usedSize + workers.reduce((n, w) => n + w.usedSize, 0) }
  } finally { await cdp.detach() }
}
