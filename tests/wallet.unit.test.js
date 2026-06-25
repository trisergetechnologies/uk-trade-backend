const {
  computeEligibleBonusFromLedgerEntries,
} = require('../src/services/wallet.service');

describe('wallet.service (unit)', () => {
  test('computeEligibleBonusFromLedgerEntries — admin credit consumed by package purchase', () => {
    const bonus = computeEligibleBonusFromLedgerEntries([
      {
        direction: 'credit',
        contextType: 'admin_credit',
        amount: 51000,
        createdAt: new Date('2026-06-24T13:52:21.304Z'),
      },
      {
        direction: 'debit',
        contextType: 'package_purchase',
        amount: 51000,
        createdAt: new Date('2026-06-24T13:53:00.047Z'),
      },
    ]);
    expect(bonus).toBe(0);
  });

  test('computeEligibleBonusFromLedgerEntries — partial package spend leaves remainder', () => {
    const bonus = computeEligibleBonusFromLedgerEntries([
      {
        direction: 'credit',
        contextType: 'admin_credit',
        amount: 51000,
        createdAt: new Date('2026-06-24T13:52:21.304Z'),
      },
      {
        direction: 'debit',
        contextType: 'package_purchase',
        amount: 25000,
        createdAt: new Date('2026-06-24T13:53:00.047Z'),
      },
    ]);
    expect(bonus).toBe(26000);
  });

  test('computeEligibleBonusFromLedgerEntries — trade income does not add bonus', () => {
    const bonus = computeEligibleBonusFromLedgerEntries([
      {
        direction: 'credit',
        contextType: 'trade_income',
        amount: 510,
        createdAt: new Date('2026-06-25T18:38:14.970Z'),
      },
    ]);
    expect(bonus).toBe(0);
  });
});
