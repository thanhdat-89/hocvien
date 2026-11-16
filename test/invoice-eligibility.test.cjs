const { test } = require('node:test')
const assert = require('node:assert/strict')
const { invoicePeriodEligible, assertInvoicePeriod, InvoicePeriodError } = require('../dist/services/invoiceEligibility')

test('invoice rollout applies from tuition period October 2026 inclusive', () => {
  for (const [month, year] of [[1, 2026], [9, 2026], [12, 2025], [0, 2027], [13, 2027], [10, NaN]]) {
    assert.equal(invoicePeriodEligible(month, year), false)
    assert.throws(() => assertInvoicePeriod(month, year), error => error instanceof InvoicePeriodError && error.status === 409)
  }
  for (const [month, year] of [[10, 2026], [11, 2026], [12, 2026], [1, 2027]]) {
    assert.equal(invoicePeriodEligible(month, year), true)
    assert.doesNotThrow(() => assertInvoicePeriod(month, year))
  }
})
