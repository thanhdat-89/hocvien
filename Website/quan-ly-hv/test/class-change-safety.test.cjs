const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('renaming a class preserves sessions; changing a billed schedule is blocked', async () => {
  const original = Module._load
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  const effectiveDate = date.toISOString().slice(0, 10)
  const period = effectiveDate.slice(0, 7)
  const [year, month] = period.split('-').map(Number)
  const tables = {
    classes: [{ id: 'c1', data: { name: 'Toán 6', status: 'ACTIVE', tuitionRate: 150000, updatedAt: 'v1' } }],
    schedules: [{ id: 'sch1', data: { classId: 'c1', dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30', effectiveFrom: '2026-01-01' } }],
    sessions: [{ id: 'sess1', data: { classId: 'c1', scheduleId: 'sch1', sessionDate: effectiveDate, startTime: '18:00', status: 'SCHEDULED' } }],
    tuitionRecords: [{ id: 'bill1', data: { classId: 'c1', billingYear: year, billingMonth: month, status: 'PAID' } }],
  }
  const writes = []
  const doc = (name, row) => ({ id: row?.id, exists: !!row, data: () => row?.data,
    ref: { id: row?.id, path: `${name}/${row?.id}` } })
  const collection = (name, filters = []) => ({
    where(field, op, value) { return collection(name, [...filters, [field, op, value]]) },
    doc(id) { return { id, path: `${name}/${id}`,
      get: async () => doc(name, (tables[name] || []).find(row => row.id === id)),
      update: async value => writes.push({ type: 'update', path: `${name}/${id}`, value }) } },
    async get() {
      const docs = (tables[name] || []).filter(row => filters.every(([field, op, value]) => op === '==' && row.data[field] === value))
        .map(row => doc(name, row))
      return { docs, empty: docs.length === 0 }
    },
  })
  const firebase = { db: { collection, runTransaction: async callback => callback({
    get: ref => ref.get(), update: (ref, value) => writes.push({ type: 'update', path: ref.path, value }),
    delete: ref => writes.push({ type: 'delete', path: ref.path }),
    set: (ref, value) => writes.push({ type: 'set', path: ref.path, value }),
  }) }, C: { CLASSES: 'classes', SCHEDULES: 'schedules', SESSIONS: 'sessions',
    TUITION_RECORDS: 'tuitionRecords', HOLIDAYS: 'holidays' } }
  const loaded = []
  Module._load = function (name, parent, isMain) {
    if (name.endsWith('/lib/firebase')) return firebase
    return original.apply(this, arguments)
  }
  try {
    const path = require.resolve('../dist/services/classChange')
    delete require.cache[path]
    loaded.push(path)
    const { prepareClassChange, applyClassChange, renameClass, classRateForMonth } = require(path)
    await renameClass('c1', 'Toán 6 mới')
    assert.deepEqual(writes, [{ type: 'update', path: 'classes/c1', value: { name: 'Toán 6 mới' } }])
    writes.length = 0
    const unchanged = { scope: 'schedule', effectiveDate,
      days: [{ dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:30' }] }
    const plan = await prepareClassChange('c1', unchanged)
    assert.equal(plan.summary.scheduleChanged, false)
    assert.equal(plan.summary.removeSessions, 0)
    assert.equal(plan.summary.createSessions, 0)
    await applyClassChange('c1', { ...unchanged, previewToken: plan.token })
    assert.deepEqual(writes.map(write => `${write.type}:${write.path}`), ['update:classes/c1'])
    assert.deepEqual(writes[0].value, { updatedAt: writes[0].value.updatedAt })
    await assert.rejects(prepareClassChange('c1', { ...unchanged,
      days: [{ dayOfWeek: 'TUESDAY', startTime: '19:00', endTime: '20:30' }] }), err => err.status === 409)
    await assert.rejects(prepareClassChange('c1', { ...unchanged, name: 'Tên mới' }), err => err.status === 400)
    tables.tuitionRecords = []
    writes.length = 0
    const nextMonthDate = new Date()
    nextMonthDate.setUTCDate(1)
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1)
    const rateInput = { scope: 'rate', tuitionRate: 180000, rateEffectiveMonth: nextMonthDate.toISOString().slice(0, 7) }
    const ratePlan = await prepareClassChange('c1', rateInput)
    assert.equal(ratePlan.summary.scheduleChanged, false)
    await applyClassChange('c1', { ...rateInput, previewToken: ratePlan.token })
    assert.deepEqual(writes.map(write => `${write.type}:${write.path}`), ['update:classes/c1'])
    assert.deepEqual(Object.keys(writes[0].value).sort(), ['tuitionRate', 'tuitionRateEffectiveMonth', 'tuitionRateHistory', 'updatedAt'])
    assert.equal(classRateForMonth({ tuitionRate: 200000, tuitionRateHistory: [
      { effectiveMonth: '2000-01', rate: 150000 }, { effectiveMonth: '2026-11', rate: 200000 },
    ] }, 10, 2026), 150000)
    assert.equal(classRateForMonth({ tuitionRate: 200000, tuitionRateHistory: [
      { effectiveMonth: '2000-01', rate: 150000 }, { effectiveMonth: '2026-11', rate: 200000 },
    ] }, 11, 2026), 200000)
  } finally {
    Module._load = original
    loaded.forEach(path => delete require.cache[path])
  }
})
