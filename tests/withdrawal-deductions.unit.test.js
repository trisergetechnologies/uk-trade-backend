const {
  computeWithdrawalDeductions,
  resolveWithdrawalDeductions,
} = require('../src/utils/withdrawal-deductions');

describe('withdrawal-deductions (unit)', () => {
  test('5% TDS + 5% handling on gross', () => {
    const r = computeWithdrawalDeductions(57500);
    expect(r.tdsAmount).toBe(2875);
    expect(r.handlingAmount).toBe(2875);
    expect(r.netPayable).toBe(51750);
  });

  test('resolveWithdrawalDeductions backfills legacy rows', () => {
    const r = resolveWithdrawalDeductions({ amount: 1000, netPayable: 0 });
    expect(r.netPayable).toBe(900);
    expect(r.tdsAmount).toBe(50);
    expect(r.handlingAmount).toBe(50);
  });
});
