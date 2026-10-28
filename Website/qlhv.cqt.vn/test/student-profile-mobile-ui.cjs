// Run against a local dev server. APIs are mocked; live payments and messages are never sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const run=async (page) => {
  const base = 'http://127.0.0.1:5173'
  const phase = 'profile-mobile-fix'
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
    else if (path.endsWith('/tuition-summary')) data = [tuition, {...tuition, classId:'paid', className:'Toán 6 - CQT01', tuitionRecord:{...tuition.tuitionRecord, id:'paid-record', remainingAmount:0, status:'PAID'}}, {...tuition, classId:'unbilled', className:'Học riêng', tuitionRecord:null}]
    else if (path === '/tuition/student-promotions') data = [{ id: 'promo', promotionType: 'PERCENTAGE', promotionValue: 10, className: cls.name, appliedFrom: '2026-08-01' }]
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
    for (const width of [320, 360, 390, 430, 768, 820, 1440]) {
      console.log('Checking viewport',width); await p.setViewportSize({ width, height: 900 })
      await p.goto(`${process.env.TEST_BASE || base}/students/${student.id}`); await settle()
      for (const [index, label] of ['info', 'schedule', 'private', 'tuition', 'reviews', 'scores'].entries()) {
        await p.locator('.responsive-tabs > button').nth(index).click(); await settle(); if(label==='tuition') await p.locator('.profile-tuition-table tbody tr').nth(2).waitFor(); await p.waitForTimeout(150); await inspect(label)
        if(width === 390) await p.screenshot({ path:`/private/tmp/qlhv-profile-mobile-${label}.png`, fullPage:true })
        if(['schedule','private'].includes(label) && width<768) {
          const table=p.locator('.profile-session-table'); await table.locator('tbody tr').first().waitFor()
          check(await table.evaluate(e=>getComputedStyle(e).display)==='block', `${width} ${label}: session table not reflowed`)
          const fit=await table.locator('tbody td').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().width>=90))
          check(fit,`${width} ${label}: squeezed or overflowing session cells`)
        }
        if(label === 'tuition') {
          const table=p.locator('.profile-tuition-table')
          check(await table.locator('tbody tr').count()===3, `${width}: tuition rows missing`)
          if(width<768) {
            check(await table.evaluate(e=>getComputedStyle(e).display)==='block', `${width}: tuition not reflowed`)
            const cells=await table.locator('tbody td').evaluateAll(els=>els.map(e=>({label:e.dataset.label,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})))
            check(cells.every(c=>c.w>=90 && c.h<200), `${width}: squeezed tuition cells ${JSON.stringify(cells)}`)
            check(await p.getByText('10%',{exact:true}).evaluate(e=>e.getBoundingClientRect().height<30),`${width}: promotion value split`)
          }
          if(width===390) await p.getByRole('heading',{name:'Học phí cá nhân',exact:true}).locator('..').locator('..').screenshot({path:'/private/tmp/qlhv-profile-mobile-tuition-card.png'});
          await p.getByRole('button',{name:/Thêm khuyến mại/}).click(); await settle()
          const panel=p.locator('.responsive-dialog > div.relative').last()
          const box=await panel.boundingBox()
          check(box && box.x>=0 && box.x+box.width<=width+1 && box.height<=900,`${width}: promo modal outside screen`)
          await panel.getByRole('button',{name:'close',exact:true}).click()
          await p.getByRole('button',{name:'Xác nhận thanh toán',exact:true}).click(); await settle()
          const payment=p.locator('.responsive-dialog > div.relative').last()
          const paymentBox=await payment.boundingBox()
          check(paymentBox && paymentBox.x>=0 && paymentBox.x+paymentBox.width<=width+1 && paymentBox.height<=900,`${width}: payment modal outside screen`)
          await payment.getByRole('button',{name:'close',exact:true}).click()
        }
      }
      await p.locator('.responsive-tabs > button').nth(2).click(); await settle()
      await p.getByRole('button',{name:/Thêm lịch học riêng/}).click(); await settle()
      const dialog=p.getByRole('dialog')
      const box=await dialog.boundingBox()
      check(box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=900,`${width}: private modal outside screen`)
      await dialog.getByRole('button',{name:/Đóng cửa sổ/}).click()
      results.push({width,tabs:6})
    }
    check(errors.length===0,`Runtime errors: ${errors.join('; ')}`)
    check(writes.length===0,`Unexpected writes: ${JSON.stringify(writes)}`)
    return {results,failures,errors,writes}
  } finally { await context.close() }
}
;
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});try{const page=await browser.newPage();const result=await run(page);console.log(JSON.stringify(result,null,2));if(result.failures.length)process.exitCode=1}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
