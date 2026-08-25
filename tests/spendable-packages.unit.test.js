const {
  computeSpendableForPackagesFromTotals,
} = require('../src/services/wallet.service');

describe('spendableForPackages (unit)', () => {
  test('full balance is trade → spendable 0', () => {
    expect(
      computeSpendableForPackagesFromTotals({
        balance: 8340,
        tradeIncomeCredited: 139500,
        approvedWithdrawals: 0,
      })
    ).toMatchObject({
      tradeReservedInWallet: 8340,
      spendableForPackages: 0,
    });
  });

  test('fund deposit above trade can buy packages', () => {
    expect(
      computeSpendableForPackagesFromTotals({
        balance: 60000,
        tradeIncomeCredited: 10000,
        approvedWithdrawals: 0,
      })
    ).toMatchObject({
      tradeReservedInWallet: 10000,
      spendableForPackages: 50000,
    });
  });

  test('approved withdrawals free trade reservation', () => {
    expect(
      computeSpendableForPackagesFromTotals({
        balance: 50000,
        tradeIncomeCredited: 10000,
        approvedWithdrawals: 10000,
      })
    ).toMatchObject({
      tradeReservedInWallet: 0,
      spendableForPackages: 50000,
    });
  });

  test('partial withdrawal leaves remaining trade reserved', () => {
    expect(
      computeSpendableForPackagesFromTotals({
        balance: 55000,
        tradeIncomeCredited: 10000,
        approvedWithdrawals: 5000,
      })
    ).toMatchObject({
      tradeReservedInWallet: 5000,
      spendableForPackages: 50000,
    });
  });
});
