const {
  grossEligibleForSubscription,
  firstDayAfterWithdrawalCycleK,
  newlyUnlockedTradeForSubscriptionOnDate,
  computeNewlyUnlockedTradeDelta,
} = require('../src/services/eligibility.service');
const { addIstDays } = require('../src/utils/date-utils');

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

  test('computeNewlyUnlockedTradeDelta — only positive deltas count', () => {
    expect(computeNewlyUnlockedTradeDelta(55000, 50000)).toBe(5000);
    expect(computeNewlyUnlockedTradeDelta(50000, 55000)).toBe(0);
    expect(computeNewlyUnlockedTradeDelta(100, null)).toBe(0);
  });

  test('Plan B (W=31) — daily credits stay locked until full cycle completes on gate day', () => {
    const planB = { cycleDaysW: 31 };
    const D0 = '2026-06-01';
    const sub = { withdrawalDay1Ist: D0, status: 'active' };
    const dailyAmount = 2500;
    const credits = [];
    for (let day = 0; day < 22; day += 1) {
      credits.push({
        cycleNumber: 1,
        creditDateIst: addIstDays(D0, day),
        amount: dailyAmount,
      });
    }

    const gateDay = firstDayAfterWithdrawalCycleK(D0, 31, 1);
    const dayBeforeGate = addIstDays(gateDay, -1);

    expect(grossEligibleForSubscription(sub, planB, credits, dayBeforeGate)).toBe(0);
    expect(grossEligibleForSubscription(sub, planB, credits, gateDay)).toBe(22 * dailyAmount);
    expect(newlyUnlockedTradeForSubscriptionOnDate(sub, planB, credits, dayBeforeGate)).toBe(0);
    expect(newlyUnlockedTradeForSubscriptionOnDate(sub, planB, credits, gateDay)).toBe(22 * dailyAmount);

    const midCycleDay = addIstDays(D0, 10);
    expect(newlyUnlockedTradeForSubscriptionOnDate(sub, planB, credits, midCycleDay)).toBe(0);
  });
});
