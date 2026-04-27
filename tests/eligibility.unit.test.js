const { grossEligibleForSubscription, firstDayAfterWithdrawalCycleK } = require('../src/services/eligibility.service');

describe('eligibility.engine (unit)', () => {
  const plan = { cycleDaysW: 15 };
  const D0 = '2026-01-01';

  test('firstDayAfterWithdrawalCycleK for cycle 1', () => {
    expect(firstDayAfterWithdrawalCycleK(D0, 15, 1)).toBe('2026-01-16');
  });

  test('no credits before cycle gate', () => {
    const sub = { withdrawalDay1Ist: D0, status: 'active' };
    const credits = [{ cycleNumber: 1, creditDateIst: '2026-01-05', amount: 10 }];
    expect(grossEligibleForSubscription(sub, plan, credits, '2026-01-10')).toBe(0);
  });

  test('credits in cycle 1 eligible on or after first day after cycle', () => {
    const sub = { withdrawalDay1Ist: D0, status: 'active' };
    const credits = [{ cycleNumber: 1, creditDateIst: '2026-01-05', amount: 10 }];
    expect(grossEligibleForSubscription(sub, plan, credits, '2026-01-16')).toBe(10);
  });

  test('partial last cycle unlocks all credits in final cycle when completed', () => {
    const sub = { withdrawalDay1Ist: D0, status: 'completed' };
    const credits = [
      { cycleNumber: 1, creditDateIst: '2026-01-05', amount: 10 },
      { cycleNumber: 2, creditDateIst: '2026-01-20', amount: 5 },
    ];
    const nominalEndCycle2 = '2026-01-30';
    expect(grossEligibleForSubscription(sub, plan, credits, '2026-01-20')).toBeGreaterThanOrEqual(5);
    const lastCredit = credits[credits.length - 1].creditDateIst;
    expect(lastCredit < nominalEndCycle2).toBe(true);
    expect(grossEligibleForSubscription(sub, plan, credits, '2026-01-20')).toBe(15);
  });
});
