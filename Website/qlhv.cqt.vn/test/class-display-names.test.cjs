const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prisma, reset, seed } = require('./helpers/pg.cjs')
const { currentClassNames, displayClassName } = require('../dist/lib/classDisplayNames')

before(reset)
after(() => prisma.$disconnect())

test('renamed class labels follow the class ID immediately without rewriting stored rows', async () => {
  const cls = await seed.klass({ id: 'class-6', name: 'Toán 6' })
  const storedRow = { classId: cls.id, className: 'Toán 6' }

  const initial = await currentClassNames([cls.id, cls.id, 'private'])
  assert.deepEqual([...initial], [['class-6', 'Toán 6']], 'Bỏ trùng và bỏ "private"')
  assert.equal(displayClassName(storedRow, initial).className, 'Toán 6')

  await prisma.class.update({ where: { id: cls.id }, data: { name: 'Toán 6 - CQT01' } })
  const refreshed = await currentClassNames([cls.id])
  assert.equal(displayClassName(storedRow, refreshed).className, 'Toán 6 - CQT01')
  assert.equal(storedRow.className, 'Toán 6', 'Không ghi đè bản ghi gốc')
  assert.equal(displayClassName({ classId: 'missing', className: 'Cũ' }, refreshed).className, 'Cũ', 'Lớp đã xoá giữ tên lưu')
})
