const {
  grossEligibleForSubscription,
  firstDayAfterWithdrawalCycleK,
  newlyUnlockedTradeForSubscriptionOnDate,
  computeNewlyUnlockedTradeDelta,
  resolveTradeAutoWithdrawAmount,
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

  test('resolveTradeAutoWithdrawAmount — gate day does not re-fire after baseline (hourly recalc fix)', () => {
    const cycleUnlock = 57500;
    expect(resolveTradeAutoWithdrawAmount(0, null, 0)).toBe(0);
    expect(resolveTradeAutoWithdrawAmount(57500, null, cycleUnlock)).toBe(cycleUnlock);
    expect(resolveTradeAutoWithdrawAmount(57500, 0, cycleUnlock)).toBe(57500);
    expect(resolveTradeAutoWithdrawAmount(57500, 57500, cycleUnlock)).toBe(0);
    expect(resolveTradeAutoWithdrawAmount(115000, 57500, 0)).toBe(57500);
  });

  test('computeNetEligibleToWithdraw adds matching like sponsor and subtracts matchingPaidByAdmin', () => {
    const {
      computeNetEligibleToWithdraw,
      computeAvailableIncomeStreams,
      resolveMatchingPaidByAdmin,
    } = require('../src/services/eligibility.service');
    const { matchingPaidByAdminForUserCode } = require('../src/constants/matching-paid-by-admin');

    expect(computeNetEligibleToWithdraw({ matchingGross: 4000 })).toBe(4000);

    expect(
      computeNetEligibleToWithdraw({
        tradeGross: 0,
        sponsorGross: 8640,
        matchingGross: 13680,
        bonus: 8760,
        matchingPaidByAdmin: 8760,
        approved: 15690,
        pending: 0,
      })
    ).toBe(6630);

    expect(
      computeNetEligibleToWithdraw({
        tradeGross: 0,
        sponsorGross: 0,
        matchingGross: 5200,
        bonus: 5200,
        matchingPaidByAdmin: 5200,
        approved: 5200,
        pending: 0,
      })
    ).toBe(0);

    expect(
      computeNetEligibleToWithdraw({
        tradeGross: 0,
        sponsorGross: 0,
        matchingGross: 1200,
        bonus: 2550,
        matchingPaidByAdmin: 2550,
        approved: 2550,
        pending: 0,
      })
    ).toBe(0);

    // Outbound user fund transfers permanently reduce Eligible (admin bonus would
    // otherwise reappear on every eligibility recalc).
    expect(
      computeNetEligibleToWithdraw({
        tradeGross: 0,
        sponsorGross: 0,
        matchingGross: 0,
        bonus: 100000,
        fundTransferOut: 30000,
      })
    ).toBe(70000);

    expect(
      computeNetEligibleToWithdraw({
        bonus: 50000,
        fundTransferIn: 10000,
        fundTransferOut: 40000,
      })
    ).toBe(20000);

    expect(
      computeAvailableIncomeStreams({
        tradeGross: 0,
        sponsorGross: 8640,
        matchingGross: 13680,
        bonus: 8760,
        matchingPaidByAdmin: 8760,
        approved: 15690,
        pending: 0,
        fundTransferOut: 1710,
      })
    ).toEqual({ sponsorAvailable: 0, matchingAvailable: 4920 });

    expect(
      computeAvailableIncomeStreams({
        tradeGross: 0,
        sponsorGross: 8640,
        matchingGross: 13680,
        bonus: 8760,
        matchingPaidByAdmin: 8760,
        approved: 15690,
        pending: 0,
      })
    ).toEqual({ sponsorAvailable: 1710, matchingAvailable: 4920 });

    expect(
      computeAvailableIncomeStreams({
        sponsorGross: 1000,
        matchingGross: 500,
      })
    ).toEqual({ sponsorAvailable: 1000, matchingAvailable: 500 });

    expect(
      computeAvailableIncomeStreams({
        sponsorGross: 1000,
        matchingGross: 500,
        approved: 1500,
      })
    ).toEqual({ sponsorAvailable: 0, matchingAvailable: 0 });

    expect(matchingPaidByAdminForUserCode('88531')).toBe(8760);
    expect(matchingPaidByAdminForUserCode('99999')).toBe(0);
    expect(resolveMatchingPaidByAdmin({ matchingPaidByAdmin: 0 }, '88531')).toBe(8760);
    expect(resolveMatchingPaidByAdmin({ matchingPaidByAdmin: 8760 }, '88531')).toBe(8760);
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
