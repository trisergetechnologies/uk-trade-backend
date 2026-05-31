const {
  buildCatchUpIdempotencyKey,
  getAlreadyCreditedMilestones,
} = require('../scripts/backfill-matching-milestone-catchup');

describe('backfill-matching-milestone-catchup helpers', () => {
  test('buildCatchUpIdempotencyKey is stable', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(buildCatchUpIdempotencyKey(id, 3)).toBe(`matching:milestone-catchup:3:${id}`);
  });

  test('getAlreadyCreditedMilestones reads equal live credits and catch-up keys', async () => {
    const earnerUserId = '507f1f77bcf86cd799439011';
    const findMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            leftActiveUserCount: 2,
            rightActiveUserCount: 2,
            idempotencyKey: 'matching:sub:earner',
          },
          {
            leftActiveUserCount: 5,
            rightActiveUserCount: 5,
            idempotencyKey: buildCatchUpIdempotencyKey(earnerUserId, 5),
          },
          {
            leftActiveUserCount: 3,
            rightActiveUserCount: 2,
            idempotencyKey: 'matching:gate:earner',
          },
        ]),
      }),
    });

    const { MatchingIncomeEvent } = require('../src/models');
    const originalFind = MatchingIncomeEvent.find;
    MatchingIncomeEvent.find = findMock;

    try {
      const milestones = await getAlreadyCreditedMilestones(earnerUserId);
      expect(milestones.has(2)).toBe(true);
      expect(milestones.has(5)).toBe(true);
      expect(milestones.has(3)).toBe(false);
    } finally {
      MatchingIncomeEvent.find = originalFind;
    }
  });
});
