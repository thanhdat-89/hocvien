const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('renamed class labels follow ID across reads without rewriting enrollment snapshots', async () => {
  const originalLoad = Module._load
  let revision = 'first'
  let className = 'Toán 6'
  let classReads = 0
  const storedEnrollment = { classId: 'class-6', className: 'Toán 6' }
  const db = { collection(name) {
    return { doc(id) {
      return { async get() {
        if (name === 'readViewRevisions') return { data: () => ({ revision }) }
        assert.equal(id, 'class-6')
        classReads += 1
        return { id, exists: true, data: () => ({ name: className }) }
      } }
    } }
  } }
  Module._load = function (name, parent, isMain) {
    if (name === './firebase' && parent?.filename.endsWith('/classDisplayNames.js')) return { db, C: { CLASSES: 'classes' } }
    return originalLoad.apply(this, arguments)
  }
  const path = require.resolve('../dist/lib/classDisplayNames')
  delete require.cache[path]
  try {
    const { currentClassNames, displayClassName } = require(path)
    const initial = await currentClassNames(['class-6', 'class-6'])
    assert.equal(displayClassName(storedEnrollment, initial).className, 'Toán 6')
    assert.equal(classReads, 1)
    className = 'Toán 6 - CQT01'
    assert.equal((await currentClassNames(['class-6'])).get('class-6'), 'Toán 6')
    assert.equal(classReads, 1)
    revision = 'after-rename'
    const refreshed = await currentClassNames(['class-6'])
    assert.equal(displayClassName(storedEnrollment, refreshed).className, 'Toán 6 - CQT01')
    assert.equal(storedEnrollment.className, 'Toán 6')
    assert.equal(classReads, 2)
  } finally {
    Module._load = originalLoad
    delete require.cache[path]
  }
})
