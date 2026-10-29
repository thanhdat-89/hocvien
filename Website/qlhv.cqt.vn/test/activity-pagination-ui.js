// Run through browser_run_code_unsafe. Every API is mocked; no live data is changed.
async page => {
  const results = []
  for (const width of [390, 1152, 1440]) {
    const ctx = await page.context().browser().newContext({ viewport: { width, height: 900 } })
    const p = await ctx.newPage()
    const calls = []
    const logs = Array.from({ length: 25 }, (_, i) => ({
      id: `log${i}`, createdAt: '2026-10-15T07:00:00.000Z', userId: 'test', userName: 'Quản trị thử nghiệm', userRole: 'ADMIN',
      action: 'UPDATE', resourceType: 'tuition', description: `Thay đổi thử nghiệm ${String(i).padStart(2, '0')}`, method: 'PUT', path: '/api/test', statusCode: 200,
    }))
    await p.addInitScript(() => localStorage.setItem('user', JSON.stringify({ userId: 'test', fullName: 'Test', role: 'ADMIN' })))
    await p.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') throw Error('Unexpected write')
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith('/activity')) return route.fulfill({ json: [] })
      if (url.searchParams.get('limit') !== '10') throw Error('Must request exactly ten records')
      calls.push(url.search)
      const offset = Number(url.searchParams.get('cursor') || 0)
      const type = url.searchParams.get('resourceType')
      if (type === 'classes') await new Promise(resolve => setTimeout(resolve, 250))
      const data = logs.slice(offset, offset + 10).map(log => ({ ...log, description: type ? `${type} ${log.description}` : log.description }))
      try { await route.fulfill({ json: { data, nextCursor: offset + 10 < logs.length ? String(offset + 10) : null } }) } catch { /* canceled stale filter request */ }
    })
    const rows = p.getByRole('table', { name: 'Lịch sử hoạt động' }).locator('tbody tr')
    const waitRows = async count => {
      await p.waitForFunction(n => document.querySelectorAll('table[aria-label="Lịch sử hoạt động"] tbody tr').length === n, count)
    }
    const assert = (value, message) => { if (!value) throw Error(`${width}: ${message}`) }
    await p.goto('http://127.0.0.1:5173/settings/activity')
    await p.getByText('Thay đổi thử nghiệm 00', { exact: true }).waitFor()
    await waitRows(10)
    assert(await p.getByRole('button', { name: 'Trang trước', exact: true }).isDisabled(), 'first page previous disabled')
    await p.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await p.getByText('Thay đổi thử nghiệm 10', { exact: true }).waitFor()
    await waitRows(10)
    const requests = calls.length
    await p.getByRole('button', { name: 'Trang trước', exact: true }).click()
    await p.getByText('Thay đổi thử nghiệm 00', { exact: true }).waitFor()
    assert(calls.length === requests, 'previous page must use cache')
    await p.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await p.getByText('Thay đổi thử nghiệm 10', { exact: true }).waitFor()
    assert(calls.length === requests, 'visited next page must use cache')
    await p.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await p.getByText('Thay đổi thử nghiệm 20', { exact: true }).waitFor()
    await waitRows(5)
    assert(await p.getByRole('button', { name: 'Trang sau', exact: true }).isDisabled(), 'last page next disabled')
    const beforeSearch = calls.length
    await p.getByLabel('Tìm trong trang hiện tại', { exact: true }).fill('24')
    await p.getByText('Thay đổi thử nghiệm 24', { exact: true }).waitFor()
    await waitRows(1)
    assert(calls.length === beforeSearch, 'local search must not scan Firestore')
    await p.getByRole('button', { name: 'Tải mới nhất', exact: true }).click()
    await p.getByText('Thay đổi thử nghiệm 00', { exact: true }).waitFor()
    await waitRows(10)
    assert(calls.length === beforeSearch + 1, 'refresh exactly one read query')
    await p.getByLabel('Loại hoạt động', { exact: true }).selectOption('classes')
    await p.getByLabel('Loại hoạt động', { exact: true }).selectOption('tuition')
    await p.getByText('tuition Thay đổi thử nghiệm 00', { exact: true }).waitFor()
    await p.waitForTimeout(300)
    assert(await rows.first().innerText().then(text => text.includes('tuition')), 'late request must not overwrite current filter')
    assert(!new URLSearchParams(calls.at(-1)).has('cursor'), 'filter change must restart page one')
    results.push({ width, rowsPerPage: 10, cachedNavigation: true, lastPage: 5, staleResponseProtected: true })
    await ctx.close()
  }
  return results
}
