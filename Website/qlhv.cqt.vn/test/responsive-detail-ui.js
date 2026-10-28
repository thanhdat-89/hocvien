// Run with browser_run_code_unsafe({ filename: 'test/responsive-detail-ui.js' }).
// Uses isolated browser storage and mock APIs; every server write is blocked.
async (page) => {
  const base = 'http://127.0.0.1:5173'
  const phase = 'after'
  const context = await page.context().browser().newContext()
  const p = await context.newPage()
  const failures = [], errors = [], writes = [], results = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  p.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => localStorage.setItem('user', JSON.stringify({ userId: 'test', role: 'ADMIN', fullName: 'Quản trị thử nghiệm' })))
  const now = new Date(), month = now.getMonth() + 1, year = now.getFullYear()
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const cls = { id: 'class-7-long-id-test', name: 'Toán 7 nâng cao - Lớp chiều thứ hai và thứ năm', gradeLevel: 7, status: 'ACTIVE', tuitionRate: 150000, sessionsPerMonth: 8, teacherName: 'Giáo viên thử nghiệm', startDate: '2026-01-01' }
  const enrollment = { id: 'enrollment', classId: cls.id, className: cls.name, status: 'ACTIVE' }
  const student = { id: 'detail-test', fullName: 'Nguyễn Hoàng Minh Anh', gradeLevel: 7, status: 'ACTIVE', school: 'Trường Trung học cơ sở Quảng Trị', notes: 'https://example.test/tai-lieu/' + 'chuongtrinhtoannangcao'.repeat(8), enrollmentDate: '2026-01-01', enrollments: [enrollment], parents: [{ id: 'parent', fullName: 'Phụ huynh thử nghiệm', phone: '0900000000', email: 'phuhuynh.nguyenhoangminhanh.quangtri@example.test', isPrimaryContact: true }] }
  const session = { id: 'private-test', studentId: student.id, sessionDate: `${monthKey}-10`, startTime: '14:00', endTime: '15:30', status: 'SCHEDULED', className: cls.name, teacherName: 'Giáo viên thử nghiệm', ratePerSession: 150000 }
  const tuition = { monthKey, month, year, classId: cls.id, className: cls.name, totalSessions: 8, ratePerSession: 150000, baseAmount: 120000000, finalAmount: 120000000, discountAmount: 12000000, tuitionRecord: { id: 'record', finalAmount: 120000000, paidAmount: 0, remainingAmount: 120000000, status: 'PENDING' } }
  const material = { id: 'material', title: 'Tài liệu ôn tập Toán 7 - Chương trình nâng cao', type: 'LINK', url: 'https://example.test/material', audienceType: 'CLASS', audienceIds: [cls.id], uploaderId: 'test', uploaderName: 'Giáo viên thử nghiệm', createdAt: now.toISOString() }
  const fontCache = new Map()
  const serveFont = async route => {
    const url = route.request().url()
    if (!fontCache.has(url)) { const r = await route.fetch({ maxRetries: 3 }); fontCache.set(url, { status: r.status(), headers: r.headers(), body: await r.body() }) }
    return route.fulfill(fontCache.get(url))
  }
  await context.route('https://fonts.googleapis.com/**', serveFont)
  await context.route('https://fonts.gstatic.com/**', serveFont)
  const serveApi = route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^.*\/api/, '')
    if (!['GET', 'OPTIONS'].includes(route.request().method())) { writes.push({ path, method: route.request().method() }); return route.fulfill({ status: 400, json: {} }) }
    if (path === '/leads' || path === '/leads/stats') return route.fulfill({ status: 503, json: { message: 'Test unavailable' } })
    let data = []
    if (path === `/students/${student.id}`) data = student
    else if (path === '/students') data = { data: [student], total: 1, totalPages: 1, totalAll: 1, totalActive: 1 }
    else if (path === '/classes') data = { data: [cls] }
    else if (path === '/schedules') data = [{ classId: cls.id, dayOfWeek: 'MONDAY' }, { classId: cls.id, dayOfWeek: 'THURSDAY' }]
    else if (path.endsWith('/private-schedule') || path.endsWith('/schedule')) data = [session]
    else if (path.endsWith('/tuition-summary')) data = [tuition]
    else if (path === '/materials') data = [material]
    else if (path === '/reviews') data = { rows: [{ studentId: student.id, studentName: student.fullName, gradeLevel: 7, classes: [{ classId: cls.id, className: cls.name }], review: { content: 'Học viên tiến bộ tốt. https://example.test/' + 'baitaptoan'.repeat(12), teacherName: session.teacherName } }] }
    else if (path.startsWith('/reviews/')) data = [{ id: 'review', month: monthKey, content: 'Học viên tiến bộ tốt. https://example.test/' + 'baitaptoan'.repeat(12), teacherName: session.teacherName }]
    else if (path.startsWith('/monthly-scores/student/')) data = [{ id: 'score', month, year, className: cls.name, scores: [8, 9, 7.5], notes: 'Tiếp tục luyện tập.' }]
    return route.fulfill({ json: data })
  }
  await context.route('**/api/**', serveApi)
  const settle = async () => { await p.waitForLoadState('networkidle'); await p.evaluate(() => document.fonts.ready) }
  const inspect = async label => {
    const width = p.viewportSize().width
    check(!await p.getByText('Có lỗi xảy ra', { exact: true }).count(), `${width} ${label}: runtime boundary`)
    const overflow = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }))
    check(overflow.scroll <= overflow.width + 1, `${width} ${label}: document overflow ${JSON.stringify(overflow)}`)
    if (overflow.scroll > overflow.width + 1 && ['info', 'reviews'].includes(label)) {
      failures.push(await p.evaluate(() => ({ label: 'overflow details', profileClass: document.querySelector('.page-content')?.className, wrap: getComputedStyle(document.querySelector('.page-content')).overflowWrap, offenders: [...document.querySelectorAll('.page-content *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 }).slice(-8).map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.slice(0, 45), x: e.getBoundingClientRect().x, width: e.getBoundingClientRect().width, wrap: getComputedStyle(e).overflowWrap })) })))
    }
    if (width === 1440) await p.screenshot({ path: `/private/tmp/qlhv-detail-${phase}-${label}.png`, fullPage: true })
  }
  try {
    for (const width of [320, 390, 820, 1440]) {
      await p.setViewportSize({ width, height: 900 })
      await p.goto(`${base}/students/${student.id}`); await settle()
      for (const [index, label] of ['info', 'schedule', 'private', 'tuition', 'reviews', 'scores'].entries()) {
        await p.locator('.responsive-tabs > button').nth(index).click(); await settle(); await inspect(label)
      }
      await p.locator('.responsive-tabs > button').nth(2).click(); await settle()
      const deleteButton = p.locator('.profile-table-container tbody button').last()
      if (width < 1024) check(await deleteButton.evaluate(e => getComputedStyle(e).opacity) === '1', `${width}: private delete hidden without hover`)
      await p.getByRole('button', { name: /Thêm lịch học/ }).click(); await settle()
      const dialog = p.getByRole('dialog', { name: /Thêm lịch học/ })
      const box = await dialog.boundingBox()
      check(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900, `${width}: private dialog outside viewport`)
      const days = dialog.locator('button[aria-label][aria-pressed]')
      const datesFit = await days.evaluateAll(buttons => buttons.every(button => { const r = button.getBoundingClientRect(), grid = button.parentElement.getBoundingClientRect(); return r.right <= grid.right + 1 && r.left >= grid.left - 1 }))
      check(datesFit, `${width}: date buttons overflow calendar`)
      if (width < 768) await p.screenshot({ path: `/private/tmp/qlhv-detail-${phase}-calendar-${width}.png`, fullPage: true })
      await dialog.getByRole('button', { name: /Lặp lại tự động/ }).click()
      check(await dialog.locator('#private-from-month').isVisible(), `${width}: repeating schedule fields missing`)
      await dialog.getByRole('button', { name: /Đóng cửa sổ thêm lịch/ }).click()
      await p.goto(`${base}/classes`); await settle()
      await p.locator('.responsive-tabs button').nth(1).click(); await settle(); await inspect('class-list')
      if (width < 768) check(await p.locator('table').evaluate(e => getComputedStyle(e).display) === 'block', `${width}: class list still requires horizontal scrolling`)
      for (const path of ['/materials', '/reviews']) {
        await p.goto(base + path); await settle(); await inspect(path.slice(1))
        if (width < 1024) {
          const actions = p.locator('tbody .group-hover\\:opacity-100').first()
          check(await actions.evaluate(e => getComputedStyle(e).opacity) === '1', `${width} ${path}: actions hidden without hover`)
        }
        if (path === '/materials') {
          await p.getByTitle('Sửa', { exact: true }).click()
          const panel = p.locator('.responsive-dialog > div').first()
          const modalBox = await panel.boundingBox()
          check(modalBox.x >= 0 && modalBox.x + modalBox.width <= width && modalBox.y >= 0 && modalBox.y + modalBox.height <= 900, `${width}: material editor outside viewport`)
          await p.locator('.responsive-dialog').getByRole('button', { name: /Huỷ|Hủy|Hủy bỏ/ }).click()
        } else {
          await p.getByTitle('Xoá nhận xét', { exact: true }).click()
          check(await p.locator('.responsive-dialog').isVisible(), `${width}: delete confirmation missing`)
          await p.locator('.responsive-dialog').getByRole('button', { name: /Huỷ|Hủy|Hủy bỏ/ }).click()
        }
      }
      await p.goto(base + '/leads'); await settle(); await inspect('lead-error')
      const toast = p.locator('.app-toasts')
      const toastBox = await toast.boundingBox()
      check(toastBox && toastBox.x >= 0 && toastBox.x + toastBox.width <= width, `${width}: toast outside viewport`)
      while (await p.getByRole('button', { name: 'Đóng thông báo', exact: true }).count()) await p.getByRole('button', { name: 'Đóng thông báo', exact: true }).first().click()
      check(!await toast.count(), `${width}: toast did not dismiss`)
      results.push({ width, views: 10 })
    }
    const touch = await page.context().browser().newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, storageState: await context.storageState() })
    try {
      await touch.route('**/api/**', serveApi)
      await touch.route('https://fonts.googleapis.com/**', serveFont)
      await touch.route('https://fonts.gstatic.com/**', serveFont)
      const tablet = await touch.newPage()
      for (const path of ['/materials', '/reviews', `/students/${student.id}`]) {
        await tablet.goto(base + path); await tablet.waitForLoadState('networkidle')
        if (path.includes('/students/')) { await tablet.locator('.responsive-tabs > button').nth(2).click(); await tablet.waitForLoadState('networkidle') }
        const actions = tablet.locator('.touch-actions').first()
        check(await actions.evaluate(e => getComputedStyle(e).opacity) === '1', `1024 touch ${path}: hover action hidden`)
      }
      results.push({ width: 1024, pointer: 'touch', views: 3 })
    } finally { await touch.close() }
    check(writes.length === 0, `Unexpected writes: ${JSON.stringify(writes)}`)
    check(errors.length === 0, `Runtime errors: ${JSON.stringify(errors)}`)
    return { results, failures, writes, errors }
  } catch (error) { return { results, failures, writes, errors, interrupted: error.message } }
  finally { await context.close() }
}
