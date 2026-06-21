const {
  buildIdempotencyKey,
  calculateMatchingPayout,
  calculateConsiderable,
  splitByFirstBranch,
  isSubscriptionActiveAsOf,
} = require('../src/services/matching.service');

describe('matching.service (unit)', () => {
  test('buildIdempotencyKey is stable per trigger+earner pair', () => {
    expect(buildIdempotencyKey('sub123', 'user456')).toBe('matching:sub123:user456');
  });

  describe('calculateMatchingPayout (re-exported from engine)', () => {
    test('caps at max package when below 30k threshold', () => {
      const result = calculateMatchingPayout({
        considerableAmount: 10000000,
        matchingPercent: 4,
        maxPackageAmount: 25000,
        capThreshold: 30000,
      });
      expect(result.rawPayoutAmount).toBe(400000);
      expect(result.payoutCreditedAmount).toBe(25000);
      expect(result.packageCapApplied).toBe(true);
    });

    test('pays full 4% when max package at/above threshold', () => {
      const result = calculateMatchingPayout({
        considerableAmount: 100000,
        matchingPercent: 4,
        maxPackageAmount: 35000,
        capThreshold: 30000,
      });
      expect(result.rawPayoutAmount).toBe(4000);
      expect(result.payoutCreditedAmount).toBe(4000);
      expect(result.packageCapApplied).toBe(false);
    });

    test('pays full 4% when raw below package cap', () => {
      const result = calculateMatchingPayout({
        considerableAmount: 10000,
        matchingPercent: 4,
        maxPackageAmount: 25000,
        capThreshold: 30000,
      });
      expect(result.rawPayoutAmount).toBe(400);
      expect(result.payoutCreditedAmount).toBe(400);
    });
  });

  test('isSubscriptionActiveAsOf respects purchase and completion boundaries', () => {
    const asOf = new Date('2026-01-15T12:00:00.000Z');
    expect(
      isSubscriptionActiveAsOf(
        { purchaseAtUtc: new Date('2026-01-10'), status: 'active', completedAtUtc: null },
        asOf
      )
    ).toBe(true);
    expect(
      isSubscriptionActiveAsOf(
        {
          purchaseAtUtc: new Date('2026-01-10'),
          status: 'completed',
          completedAtUtc: new Date('2026-01-20'),
        },
        asOf
      )
    ).toBe(true);
    expect(
      isSubscriptionActiveAsOf(
        {
          purchaseAtUtc: new Date('2026-01-10'),
          status: 'completed',
          completedAtUtc: new Date('2026-01-12'),
        },
        asOf
      )
    ).toBe(false);
    expect(
      isSubscriptionActiveAsOf(
        { purchaseAtUtc: new Date('2026-01-20'), status: 'active', completedAtUtc: null },
        asOf
      )
    ).toBe(false);
  });

  test('splitByFirstBranch places descendants under first left/right branch', () => {
    const rootUserId = 'U1';
    const descendants = [
      { userId: 'L1', parentUserId: 'U1', side: 'left' },
      { userId: 'R1', parentUserId: 'U1', side: 'right' },
      { userId: 'L2', parentUserId: 'L1', side: 'left' },
      { userId: 'R2', parentUserId: 'R1', side: 'right' },
    ];
    const split = splitByFirstBranch(rootUserId, descendants);
    expect(split.left.map((x) => x.userId).sort()).toEqual(['L1', 'L2']);
    expect(split.right.map((x) => x.userId).sort()).toEqual(['R1', 'R2']);
  });

  describe('calculateConsiderable (volume-based)', () => {
    test('first matching bundle on right leg', () => {
      const result = calculateConsiderable({
        V: 200,
        leftVolume: 1100,
        rightVolume: 550,
        matched: 0,
        legAtEarner: 'right',
        firstMatchingDone: false,
        parentAmount: 550,
      });
      expect(result.considerable).toBe(750);
      expect(result.firstMatchingDoneAfter).toBe(true);
    });

    test('ongoing short right leg', () => {
      const result = calculateConsiderable({
        V: 90,
        leftVolume: 1100,
        rightVolume: 750,
        matched: 750,
        legAtEarner: 'right',
        firstMatchingDone: true,
        parentAmount: 0,
      });
      expect(result.considerable).toBe(90);
    });

    test('ongoing long left leg → zero', () => {
      const result = calculateConsiderable({
        V: 180,
        leftVolume: 1100,
        rightVolume: 995,
        matched: 995,
        legAtEarner: 'left',
        firstMatchingDone: true,
        parentAmount: 0,
      });
      expect(result.considerable).toBe(0);
    });

    test('payout is 4% of considerable not trigger amount', () => {
      const considerable = 750;
      const result = calculateMatchingPayout({
        considerableAmount: considerable,
        matchingPercent: 4,
        maxPackageAmount: 100000,
        capThreshold: 30000,
      });
      expect(result.rawPayoutAmount).toBe(30);
      expect(result.payoutCreditedAmount).toBe(30);
    });
  });
});
