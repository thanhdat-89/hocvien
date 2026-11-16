// Mock all business APIs: these checks never create a real fee or invoice.
async (page) => {
  const results = []
  for (const outcome of ['DRAFT_CREATED', 'OUTCOME_UNKNOWN', 'LOST_RESPONSE']) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const p = await ctx.newPage()
    const row = { studentId: 's1', studentName: 'Học viên thử nghiệm', gradeLevel: 7, classId: 'c1', className: 'Toán 7', primaryParent: null, totalSessions: 8, ratePerSession: 100000, discountAmount: 0, baseAmount: 800000, finalAmount: 800000, tuitionRecord: null }
    let posts = 0, reconciles = 0
    await p.addInitScript(() => localStorage.setItem('user', JSON.stringify({ userId: 'test', role: 'ADMIN', fullName: 'Test' })))
    await p.route('**/api/**', async route => {
      const url = route.request().url()
      if (route.request().method() === 'POST') {
        if (!url.endsWith('/tuition/calculate')) throw Error('Unexpected write')
        posts++
        if (outcome === 'LOST_RESPONSE') return route.abort('failed')
        return route.fulfill({ json: { id: 'fee1', invoiceDraft: { enabled: true, status: outcome, refId: 'ref-test' } } })
      }
      if (url.includes('/workflow-result')) {
        reconciles++
        return route.fulfill({ json: { recordId: 'fee1', invoiceDraft: { enabled: true, status: 'DRAFT_CREATED', refId: 'ref-test' } } })
      }
      return route.fulfill({ json: url.includes('schedule-summary') ? [row] : [] })
    })
    await p.goto('http://127.0.0.1:5173/tuition')
    await p.getByRole('button', { name: 'Tạo phiếu', exact: true }).tap()
    const dialog = p.getByRole('dialog')
    await dialog.getByText(outcome === 'OUTCOME_UNKNOWN' ? 'Cần kiểm tra trạng thái' : 'Đã tạo hóa đơn chưa phát hành', { exact: true }).waitFor()
    if (posts !== 1 || reconciles !== (outcome === 'LOST_RESPONSE' ? 1 : 0)) throw Error('Invoice request replayed or reconciliation missing')
    if (!await dialog.getByText('ref-test', { exact: true }).isVisible()) throw Error('RefID missing')
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).tap()
    results.push({ outcome, posts, reconciles, pass: true })
    await ctx.close()
  }
  return results
}
