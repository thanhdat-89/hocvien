// All business APIs are mocked. Resizing/hovering must never cause API calls.
async page => {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } })
  const p = await ctx.newPage()
  let reads = 0
  const errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.addInitScript(() => localStorage.setItem('user', JSON.stringify({ userId: 'test', role: 'ADMIN', fullName: 'Quản trị thử nghiệm' })))
  await p.route('**/api/**', route => {
    if (route.request().method() !== 'GET') throw Error('Unexpected business write')
    reads++
    const url = route.request().url()
    const row = { studentId: 's1', studentName: 'Học viên thử nghiệm', gradeLevel: 7, classId: 'c1', className: 'Toán 7', primaryParent: null, totalSessions: 8, ratePerSession: 100000, discountAmount: 0, baseAmount: 800000, finalAmount: 800000, tuitionRecord: null }
    return route.fulfill({ json: url.includes('schedule-summary') ? [row] : url.includes('/students?') ? { data: [], total: 0, totalPages: 1 } : [] })
  })
  const assert = (condition, message) => { if (!condition) throw Error(message) }
  const state = async () => p.locator('#main-navigation').evaluate(el => ({ width: el.getBoundingClientRect().width, expanded: el.dataset.expanded, main: document.getElementById('main-content').getBoundingClientRect().x, inert: document.getElementById('main-content').inert }))
  let stage = 0
  const waitState = async (compact, expanded) => { stage++; try { await p.waitForFunction(({ compact, expanded }) => document.querySelector('.app-shell')?.dataset.compactSidebar === String(compact) && document.getElementById('main-navigation')?.dataset.expanded === String(expanded), { compact, expanded }, {timeout: 3000}) } catch { throw Error('stage '+stage+' expected '+compact+'/'+expanded+' state '+JSON.stringify(await state())+' events '+JSON.stringify(await p.evaluate(()=>window.sidebarEvents))) } }
  try {
    await p.goto('http://127.0.0.1:5173/tuition')
    await p.getByRole('button', { name: 'Tạo phiếu', exact: true }).waitFor()
    await waitState(true, false)
    await p.waitForTimeout(220)
    const initial = await state()
    assert(initial.width === 72 && initial.main === 72, '1280 tuition must reserve 72px')
    await p.screenshot({path:'/private/tmp/qlhv-sidebar-icon.png'})
    await p.evaluate(() => { window.sidebarEvents = []; const el = document.getElementById('main-navigation'); for (const type of ['pointerenter','pointerleave']) el.addEventListener(type, e => window.sidebarEvents.push([type, e.clientX, e.clientY, document.elementFromPoint(e.clientX,e.clientY)?.outerHTML.slice(0,160)])) })
    const apiReads = reads
    const tuition = p.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Học phí', exact: true })
    const iconBefore = await tuition.locator('.material-symbols-outlined').boundingBox()
    await p.mouse.move(500, 100)
    await tuition.locator('.material-symbols-outlined').hover()
    await waitState(true, true)
    await p.waitForTimeout(220)
    await p.screenshot({path:'/private/tmp/qlhv-sidebar-hover.png'})
    let current = await state()
    const iconAfter = await tuition.locator('.material-symbols-outlined').boundingBox()
    assert(current.width === 256 && current.main === initial.main && !current.inert, 'overlay must not move/disable content')
    assert(iconBefore.x === iconAfter.x, 'icon moved during hover')
    await p.mouse.move(235, iconAfter.y + 8)
    await p.waitForTimeout(300)
    assert((await state()).expanded === 'true', 'menu must remain open over labels: '+JSON.stringify(await state())+' events '+JSON.stringify(await p.evaluate(()=>window.sidebarEvents)))
    await p.keyboard.press('Escape')
    await waitState(true, false)
    await p.mouse.move(500, 100)
    await waitState(true, false)
    await tuition.focus()
    await waitState(true, true)
    await p.keyboard.press('Escape')
    await waitState(true, false)
    await p.waitForTimeout(300)
    assert((await state()).expanded === 'false', 'Escape must stay dismissed')
    await p.locator('h2').first().click()
    await p.getByRole('button', { name: 'Mở rộng menu', exact: true }).click()
    await waitState(true, true)
    await p.getByRole('button', { name: 'Thu gọn menu', exact: true }).click()
    await waitState(true, false)
    for (const width of [1340, 1350, 1340, 1366]) {
      await p.setViewportSize({ width, height: 800 })
      await p.waitForTimeout(100)
      assert((await state()).main === 72, 'hysteresis failed near threshold')
    }
    await p.setViewportSize({ width: 1440, height: 900 })
    await waitState(false, false)
    assert((await state()).main === 256, 'wide desktop must retain full menu')
    await p.setViewportSize({ width: 1152, height: 600 })
    await waitState(true, false)
    await p.getByRole('button', { name: 'Mở rộng menu', exact: true }).click()
    await waitState(true, true)
    await p.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Lịch sử hoạt động', exact: true }).scrollIntoViewIfNeeded()
    const logout = await p.getByRole('button', { name: 'Đăng xuất', exact: true }).boundingBox()
    assert(logout.y + logout.height <= 600, 'logout inaccessible in short window')
    const interactionReads = reads - apiReads
    assert(interactionReads === 0, 'hover/focus/resize must not fetch business data')
    await p.setViewportSize({ width: 390, height: 844 })
    await waitState(false, false)
    await p.getByRole('button', { name: 'Mở menu', exact: true }).click()
    assert((await state()).inert, 'mobile drawer must still trap interaction')
    await p.getByRole('button', { name: 'Đóng menu', exact: true }).click()
    assert(!(await state()).inert, 'mobile drawer did not restore interaction')
    await p.setViewportSize({ width: 1280, height: 800 })
    await waitState(true, false)
    await tuition.focus()
    await waitState(true, true)
    await p.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Học viên', exact: true }).click()
    await p.waitForURL('**/students')
    await waitState(false, false)
    await p.waitForTimeout(150)
    assert((await state()).main === 256, 'student table must allow full menu at 1280')
    assert(errors.length === 0, errors.join('\n'))
    return { pass: true, hoverOverlayStable: true, keyboardEscape: true, resizeHysteresis: true, shortWindow: true, mobileDrawer: true, extraReads: interactionReads }
  } finally { await ctx.close() }
}
