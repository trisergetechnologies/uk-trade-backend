const {
  buildIdempotencyKey,
  calculateMatchingPayout,
  splitByFirstBranch,
  isSubscriptionActiveAsOf,
  evaluateMatchingEligibility,
} = require('../src/services/matching.service');

describe('matching.engine (unit)', () => {
  test('buildIdempotencyKey is stable per trigger+earner pair', () => {
    expect(buildIdempotencyKey('sub123', 'user456')).toBe('matching:sub123:user456');
  });

  test('calculateMatchingPayout computes raw payout and clamps to remaining cap', () => {
    const result = calculateMatchingPayout({
      considerableAmount: 10000,
      matchingPercent: 4,
      capBaseAmount: 1000,
      alreadyPaidAmount: 700,
    });
    expect(result.rawPayoutAmount).toBe(400);
    expect(result.capRemainingBeforeAmount).toBe(300);
    expect(result.payoutCreditedAmount).toBe(300);
    expect(result.capRemainingAfterAmount).toBe(0);
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

  describe('evaluateMatchingEligibility (first-gate vs equality)', () => {
    test('first payout: gate satisfied (both directs + deeper purchaser) is eligible even when unequal', () => {
      const snapshot = {
        leftActiveUserCount: 2,
        rightActiveUserCount: 1,
        directLeftActivePurchaser: true,
        directRightActivePurchaser: true,
        hasDeeperActivePurchaser: true,
      };
      const result = evaluateMatchingEligibility(snapshot, false);
      expect(result.eligible).toBe(true);
      expect(result.reason).toBe('first-gate-satisfied');
    });

    test('first payout: missing a direct purchaser fails the gate', () => {
      const snapshot = {
        leftActiveUserCount: 3,
        rightActiveUserCount: 3,
        directLeftActivePurchaser: true,
        directRightActivePurchaser: false,
        hasDeeperActivePurchaser: true,
      };
      const result = evaluateMatchingEligibility(snapshot, false);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('first-gate-not-satisfied');
    });

    test('first payout: both directs but no deeper purchaser fails the gate', () => {
      const snapshot = {
        leftActiveUserCount: 1,
        rightActiveUserCount: 1,
        directLeftActivePurchaser: true,
        directRightActivePurchaser: true,
        hasDeeperActivePurchaser: false,
      };
      const result = evaluateMatchingEligibility(snapshot, false);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('first-gate-not-satisfied');
    });

    test('subsequent payout: requires left == right regardless of gate signals', () => {
      const equalSnapshot = {
        leftActiveUserCount: 3,
        rightActiveUserCount: 3,
        directLeftActivePurchaser: false,
        directRightActivePurchaser: false,
        hasDeeperActivePurchaser: false,
      };
      const equal = evaluateMatchingEligibility(equalSnapshot, true);
      expect(equal.eligible).toBe(true);
      expect(equal.reason).toBe('left-right-active-count-equal');

      const unequal = evaluateMatchingEligibility(
        { ...equalSnapshot, rightActiveUserCount: 2 },
        true
      );
      expect(unequal.eligible).toBe(false);
      expect(unequal.reason).toBe('left-right-active-count-not-equal');
    });
  });

  test('calculateMatchingPayout applies 4% to the trigger purchase amount', () => {
    const triggerPurchaseAmount = 9000;
    const result = calculateMatchingPayout({
      considerableAmount: triggerPurchaseAmount,
      matchingPercent: 4,
      capBaseAmount: 10000,
      alreadyPaidAmount: 0,
    });
    expect(result.rawPayoutAmount).toBe(360);
    expect(result.payoutCreditedAmount).toBe(360);
  });
});
