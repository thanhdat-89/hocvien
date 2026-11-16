// All APIs are mocked; no real invoices or payments are changed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    for (const failure of [false, true]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      let updated = false
      const reads = [], posts = []
      const row = (id, refId) => ({ id, refId, studentId: id, studentName: `Học viên ${id}`, className: 'Toán 10',
        finalAmount: 1000000, status: updated ? 'SENT_TO_TAX' : 'DRAFT_CREATED' })
      await page.addInitScript(() => localStorage.setItem('user', JSON.stringify({ userId: 'test', role: 'ADMIN', fullName: 'Test' })))
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url())
        if (request.method() === 'POST') {
          assert.match(url.pathname, /\/invoices\/[^/]+\/refresh-status$/)
          posts.push(url.pathname)
          updated = true
          return route.fulfill({ status: failure && posts.length === 1 ? 502 : 200, json: { message: 'MISA unavailable' } })
        }
        if (url.pathname.endsWith('/misa/invoices')) {
          const cursor = url.searchParams.get('cursor')
          reads.push(cursor)
          return route.fulfill({ json: { rows: cursor ? [row('b', 'shared'), row('c', 'other')] : [row('a', 'shared')],
            counts: updated ? { SENT_TO_TAX: 3 } : { DRAFT_CREATED: 3 }, total: 3, nextCursor: cursor ? null : 'next' } })
        }
        return route.fulfill({ json: [] })
      })
      await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5188/tuition/invoices')
      await page.waitForLoadState('networkidle')
      if (!await page.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).count()) {
        throw new Error(`Invoice page did not load: ${(await page.locator('body').innerText()).slice(0, 2500)}`)
      }
      await page.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click()
      await page.getByText(failure ? /1 hóa đơn chưa đọc được từ MISA/ : 'Đã đồng bộ trạng thái 2 hóa đơn từ MISA.', { exact: !failure }).waitFor()
      assert.equal(posts.length, 2)
      assert.equal(reads.filter(value => value === 'next').length, 1)
      const issuedCard = page.getByText('Đã phát hành', { exact: true }).locator('..')
      assert.equal(await issuedCard.locator('p').last().textContent(), '3')
      console.log(`PASS: month sync, grouped RefIDs, issued count${failure ? ', partial failure' : ''}`)
      await context.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
