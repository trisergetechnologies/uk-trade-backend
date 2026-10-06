const { computeSpendableForPackagesFromLedgerEntries } = require('../src/services/wallet.service');

function row(day, direction, contextType, amount) {
  return {
    createdAt: new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`),
    direction,
    contextType,
    amount,
  };
}

describe('spendableForPackages (unit)', () => {
  test('full balance is trade → spendable 0', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [row(1, 'credit', 'trade_income', 8340)],
        8340
      )
    ).toMatchObject({
      tradeReservedInWallet: 8340,
      spendableForPackages: 0,
    });
  });

  test('deposit can buy packages; trade cannot', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [row(1, 'credit', 'fund_request_approval', 50000), row(2, 'credit', 'trade_income', 10000)],
        60000
      )
    ).toMatchObject({
      tradeReservedInWallet: 10000,
      spendableForPackages: 50000,
    });
  });

  test('admin credit and incoming transfer can buy packages', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [row(1, 'credit', 'admin_credit', 4000), row(2, 'credit', 'fund_transfer_in', 6000)],
        10000
      )
    ).toMatchObject({
      spendableForPackages: 10000,
      adminLeft: 4000,
      transferInLeft: 6000,
    });
  });

  test('sponsor and matching cannot buy packages', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [row(1, 'credit', 'sponsor_income', 5000), row(2, 'credit', 'matching_income', 8000)],
        13000
      )
    ).toMatchObject({
      spendableForPackages: 0,
    });
  });

  test('package purchase consumes deposit then admin then transfer', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [
          row(1, 'credit', 'fund_request_approval', 6000),
          row(2, 'credit', 'fund_transfer_in', 24000),
          row(3, 'debit', 'package_purchase', 30000),
          row(4, 'credit', 'admin_credit', 2280),
        ],
        2280
      )
    ).toMatchObject({
      spendableForPackages: 2280,
      adminLeft: 2280,
    });
  });

  test('withdrawals consume trade then leftover admin, so leftover locked trade cannot buy', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [
          row(1, 'credit', 'admin_credit', 41400),
          row(2, 'debit', 'package_purchase', 30000),
          row(3, 'credit', 'sponsor_income', 12540),
          row(4, 'credit', 'matching_income', 36400),
          row(5, 'debit', 'package_purchase', 6000),
          row(6, 'credit', 'trade_income', 29400),
          row(7, 'debit', 'withdrawal_approved', 59980),
        ],
        23760
      )
    ).toMatchObject({
      spendableForPackages: 0,
    });
  });

  test('approved withdrawals of trade leave deposit spendable', () => {
    expect(
      computeSpendableForPackagesFromLedgerEntries(
        [
          row(1, 'credit', 'fund_request_approval', 50000),
          row(2, 'credit', 'trade_income', 10000),
          row(3, 'debit', 'withdrawal_approved', 10000),
        ],
        50000
      )
    ).toMatchObject({
      tradeReservedInWallet: 0,
      spendableForPackages: 50000,
    });
  });
});
