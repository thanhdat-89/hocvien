const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('completing sessions and changing teachers do not create attendance', async () => {
  const originalLoad = Module._load
  const calls = []
  const session = {
    classId: 'class-1', className: 'Toán 6', sessionDate: '2020-01-01',
    status: 'SCHEDULED', teacherId: 'teacher-old', teacherName: 'Giáo viên cũ',
  }
  const db = {
    collection(name) {
      calls.push(['collection', name])
      if (name === 'sessions') return {
        doc(id) {
          return {
            id,
            async update(patch) { calls.push(['update', id, patch]); Object.assign(session, patch) },
            async get() { return { id, exists: true, data: () => session } },
          }
        },
        where() { return { async get() { return { docs: [{ id: 'session-1', data: () => session }] } } } },
      }
      if (name === 'teachers') return {
        doc() { return { async get() { return { exists: true, data: () => ({ fullName: 'Giáo viên mới' }) } } } },
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  }
  Module._load = function (request, parent, isMain) {
    if (request === '../lib/firebase' && parent?.filename.endsWith('/routes/sessions.js')) {
      return { db, C: { SESSIONS: 'sessions', TEACHERS: 'teachers' }, s: value => value,
        toDocs: snap => snap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        toObj: doc => ({ id: doc.id, ...doc.data() }) }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const router = require('../dist/routes/sessions').default
    const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle
    const invoke = async (path, method, req) => {
      let body
      let failure
      await handler(path, method)(req, { json(value) { body = value } }, err => { failure = err })
      if (failure) throw failure
      return body
    }
    const auth = { user: { role: 'ADMIN' } }
    const completed = await invoke('/:id/complete', 'put', { ...auth, params: { id: 'session-1' }, body: {} })
    assert.equal(completed.session.status, 'COMPLETED')
    assert.equal(completed.message, 'Đã hoàn thành buổi học')

    session.status = 'SCHEDULED'
    const bulk = await invoke('/complete-past', 'post', auth)
    assert.equal(bulk.count, 1)

    await invoke('/:id', 'put', { ...auth, params: { id: 'session-1' }, body: { teacherId: 'teacher-new' } })
    assert.equal(session.teacherName, 'Giáo viên mới')
    assert.deepEqual([...new Set(calls.filter(call => call[0] === 'collection').map(call => call[1]))].sort(), ['sessions', 'teachers'])
    assert.equal(router.stack.some(layer => layer.route?.path === '/auto-init-attendance'), false)
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve('../dist/routes/sessions')]
  }
})
