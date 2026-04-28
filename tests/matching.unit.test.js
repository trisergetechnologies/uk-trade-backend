const { buildIdempotencyKey, calculateMatchingPayout, splitByFirstBranch } = require('../src/services/matching.service');

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
});
