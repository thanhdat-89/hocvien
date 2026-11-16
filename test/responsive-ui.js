// Run with browser_run_code_unsafe({ filename: 'test/responsive-ui.js' }) against Vite :5173.
// All API calls are intercepted. Unexpected writes fail without reaching a real server.
async (page) => {
  const base = 'http://127.0.0.1:5173'
  const failures = []
  const results = []
  const writes = []
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const check = (condition, message) => { if (!condition) failures.push(message) }
  await page.unrouteAll({ behavior: 'wait' })
  const fontCache = new Map()
  const serveFont = async route => {
    const url = route.request().url()
    if (!fontCache.has(url)) {
      const response = await route.fetch({ maxRetries: 3 })
      fontCache.set(url, { status: response.status(), headers: response.headers(), body: await response.body() })
    }
    return route.fulfill(fontCache.get(url))
  }
  await page.route('https://fonts.googleapis.com/**', serveFont)
  await page.route('https://fonts.gstatic.com/**', serveFont)
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({ userId: 'ui-test', fullName: 'Quản trị thử nghiệm', role: 'ADMIN' }))
  })
  const student = {
    id: 's-test', fullName: 'Nguyễn Hoàng Minh Anh', gradeLevel: 7, status: 'ACTIVE',
    enrollmentDate: '2026-01-01', school: 'Trường Trung học cơ sở Quảng Trị',
    primaryParent: { fullName: 'Phụ huynh thử nghiệm', phone: '0900000000' },
    parents: [], promotions: [],
    enrollments: [{ id: 'e-test', classId: 'c-test', className: 'Toán 7 - Lớp nâng cao buổi chiều', status: 'ACTIVE' }],
  }
  const classes = [{ id: 'c-test', name: 'Toán 7 - Lớp nâng cao buổi chiều', gradeLevel: 7, status: 'ACTIVE', tuitionRate: 150000, teacherName: 'Giáo viên thử nghiệm', sessionsPerMonth: 8, startDate: '2026-01-01' }]
  const tuitionRows = ['c-test', 'private'].map((classId, index) => ({
    studentId: student.id, studentName: student.fullName, gradeLevel: 7,
    primaryParent: student.primaryParent, classId, className: index ? 'Học riêng' : classes[0].name,
    totalSessions: 8, ratePerSession: 150000, discountAmount: 0, baseAmount: 1200000, finalAmount: 1200000,
    tuitionRecord: { id: `record-${index}`, status: 'PENDING', paidAmount: 0, remainingAmount: 1200000, finalAmount: 1200000 },
  }))
  await page.route('**/api/**', async route => {
    if (!['GET', 'OPTIONS'].includes(route.request().method())) {
      writes.push(`${route.request().method()} ${route.request().url()}`)
      return route.fulfill({ status: 400, json: { message: 'Unexpected write blocked by responsive test' } })
    }
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^.*\/api/, '')
    let data = []
    if (path === '/dashboard') data = { stats: { totalActiveStudents: 120, totalActiveClasses: 12, newStudentsThisMonth: 5, sessionsTodayCount: 8, unscheduledPrivateStudentsThisMonth: 3, unpaidStudentsByMonth: [{ year: 2026, month: 10, count: 6 }] } }
    else if (path === '/students') data = { data: [student], total: 21, totalPages: 2, totalAll: 21, totalActive: 20, nextCursor: null }
    else if (path === '/students/s-test') data = student
    else if (path === '/classes') data = { data: classes }
    else if (path === '/tuition/schedule-summary') data = tuitionRows
    else if (path === '/students/private-schedule/missing') data = { data: [student], version: 'test' }
    else if (path === '/sessions' || path === '/students/private-sessions/all') {
      const today = new Date().toLocaleDateString('en-CA')
      const date = url.searchParams.get('fromDate') || today
      data = [0, 1].map(index => ({ id: `session-${index}`, studentId: student.id, studentName: student.fullName, classId: 'c-test', className: classes[0].name, teacherName: 'Giáo viên thử nghiệm', sessionDate: date, startTime: index ? '17:30' : '14:00', endTime: index ? '19:00' : '15:30', status: index ? 'CANCELLED' : 'SCHEDULED', ratePerSession: 150000 }))
    }
    else if (path === '/activity' || path === '/notifications' || path === '/leads' || path === '/zns/templates' || path === '/zns/logs') data = { data: [], nextCursor: null }
    else if (path === '/notifications/targets') data = { classes, students: [student] }
    else if (path === '/tuition/misa/invoices') data = { rows: [], counts: {}, total: 0, nextCursor: null }
    else if (path === '/monthly-scores' || path === '/reviews') data = { rows: [] }
    else if (path === '/leads/stats') data = { total: 0, new: 0, completed: 0, contacted: 0, enrolled: 0, lost: 0 }
    return route.fulfill({ json: data })
  })
  const visit = async path => {
    await page.goto(base + path)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    const width = page.viewportSize().width
    check(await page.getByText('Có lỗi xảy ra', { exact: true }).count() === 0, `${width} ${path}: error boundary`)
    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return { scroll: root.scrollWidth, viewport: root.clientWidth }
    })
    check(overflow.scroll <= overflow.viewport + 1, `${width} ${path}: document overflow ${JSON.stringify(overflow)}`)
    if (path !== '/login') {
      const main = await page.locator('#main-content').boundingBox()
      check(Math.abs(main.x - (width < 1024 ? 0 : 256)) < 1, `${width} ${path}: content offset ${main.x}`)
      check(await page.getByRole('button', { name: 'Mở menu', exact: true }).isVisible() === (width < 1024), `${width} ${path}: menu visibility`)
    }
    return width
  }
  try {
    for (const width of [320, 360, 390, 768, 820, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/dashboard', '/students', '/students/s-test', '/classes', '/private-schedule', '/tuition', '/tuition/invoices', '/activity', '/holidays', '/exams', '/reviews', '/materials', '/leads', '/notifications', '/zns', '/login']) {
        await visit(path)
        if (['/students', '/tuition', '/classes', '/private-schedule'].includes(path)) await page.screenshot({ path: `/private/tmp/qlhv-responsive-${path.slice(1)}-${width}.png`, fullPage: true })
      }
      await visit('/students')
      const table = page.getByRole('table', { name: 'Danh sách học viên', exact: true })
      check(await table.locator('td[data-label="Học viên"]').count() === 1, `${width}: student row missing`)
      check(await table.evaluate(e => getComputedStyle(e).display) === (width < 768 ? 'block' : 'table'), `${width}: student card/table display`)
      if (width < 1024) {
        const contained = await table.locator('td[data-label="Thao tác"]').evaluateAll(cells => cells.every(cell => {
          const box = cell.getBoundingClientRect()
          return Array.from(cell.querySelectorAll('button, a')).every(button => { const rect = button.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1 })
        }))
        check(contained, `${width}: student actions overlap adjacent columns`)
      }
      if (width < 1024) {
        await page.getByRole('button', { name: 'Mở menu', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Menu chính', exact: true })
        check(await dialog.isVisible(), `${width}: menu did not open`)
        check(await page.locator('#main-content').getAttribute('inert') !== null, `${width}: background is not inert`)
        await page.getByRole('button', { name: /Đăng xuất/ }).focus()
        await page.keyboard.press('Tab')
        check(await page.getByRole('button', { name: 'Đóng menu', exact: true }).evaluate(e => e === document.activeElement), `${width}: focus escaped menu`)
        await page.keyboard.press('Escape')
        check(!await dialog.isVisible(), `${width}: Escape did not close menu`)
        check(await page.getByRole('button', { name: 'Mở menu', exact: true }).evaluate(e => e === document.activeElement), `${width}: focus not restored`)
        await page.getByRole('button', { name: 'Mở menu', exact: true }).click()
        await page.getByRole('link', { name: 'Học phí', exact: false }).first().click()
        check(await page.locator('#main-content').getAttribute('inert') === null, `${width}: route change left background inert`)
      }
      await visit('/tuition')
      check(await page.locator('.tuition-mobile-table tbody tr').count() === 2, `${width}: merged tuition rows missing`)
      if (width < 1024) {
        const contained = await page.locator('.tuition-mobile-table td[data-label="Thao tác"], .tuition-mobile-table td[data-label="Phiếu học phí"]').evaluateAll(cells => cells.every(cell => {
          const box = cell.getBoundingClientRect()
          return Array.from(cell.querySelectorAll('button, a')).every(button => { const rect = button.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1 })
        }))
        check(contained, `${width}: tuition actions overlap adjacent columns`)
      }
      if (width < 768) {
        const filters = page.getByRole('button', { name: /Bộ lọc/ })
        check(await filters.getAttribute('aria-expanded') === 'false', `${width}: filters should start collapsed`)
        await filters.click()
        if (width < 768) await page.getByLabel('Lọc học phí theo khối', { exact: true }).selectOption('7')
        else await page.getByRole('button', { name: 'Lớp 7', exact: true }).click()
        await filters.click()
        check(await page.locator('.tuition-mobile-table tbody tr').count() === 2, `${width}: filtering lost student rows`)
      }
      const payment = page.getByRole('button', { name: `Thanh toán học phí ${student.fullName} (${classes[0].name})`, exact: true })
      await payment.click()
      check(await payment.getAttribute('aria-pressed') === 'true', `${width}: pending payment toggle`)
      check(await page.getByText(/Đang có 1 thay đổi chưa lưu/).isVisible(), `${width}: save bar missing`)
      const bar = await page.locator('.tuition-save-bar').boundingBox()
      check(bar.x >= 0 && bar.x + bar.width <= width, `${width}: save bar outside viewport`)
      await page.getByRole('button', { name: 'Hủy', exact: true }).click()
      check(await payment.getAttribute('aria-pressed') === 'false', `${width}: cancel payment toggle`)
      if (width < 768) {
        for (const path of ['/classes', '/private-schedule']) {
          await visit(path)
          const agenda = page.getByRole('region', { name: 'Lịch học theo ngày', exact: true })
          await agenda.getByRole('button').first().click()
          check(await agenda.getByText('Đã hủy', { exact: true }).isVisible(), `${width} ${path}: cancelled session status missing`)
          await agenda.getByRole('button').filter({ hasText: '14:00' }).click()
          check(await page.locator('.responsive-dialog').isVisible(), `${width} ${path}: session details did not open`)
        }
      }
      await visit('/students')
      await page.getByRole('button', { name: 'Thêm học viên mới', exact: false }).click()
      const studentDialog = page.getByRole('dialog', { name: /Thêm học viên/ })
      check(await studentDialog.isVisible(), `${width}: student form missing`)
      const bounds = await studentDialog.boundingBox()
      check(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900, `${width}: student form outside viewport`)
      results.push({ width, routes: 16, interactions: 'passed' })
      await page.screenshot({ path: `/private/tmp/qlhv-responsive-form-${width}.png`, fullPage: true })
    }
    // Open-menu orientation change must restore the desktop page and scrolling.
    await page.setViewportSize({ width: 390, height: 844 })
    await visit('/dashboard')
    await page.getByRole('button', { name: 'Mở menu', exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForFunction(() => !document.getElementById('main-content').hasAttribute('inert'))
    check(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'resize left body scroll locked')
    check(writes.length === 0, `Unexpected writes: ${writes.join(', ')}`)
    check(errors.length === 0, `Runtime errors: ${errors.join(', ')}`)
    return { results, failures, writes, errors }
  } catch (error) {
    return { results, failures, writes, errors, interrupted: error.message }
  } finally {
    page.off('pageerror', onError)
  }
}
