const {
  calculateConsiderable,
  calculateMatchingPayout,
  splitByFirstBranch,
  determineLegAtEarner,
} = require('../src/services/matching-engine');
const { ALL_TABLES, SCENARIOS } = require('./fixtures/matching-tables.fixture');

describe('matching-engine (unit)', () => {
  describe('golden regression — Tables A, B, C, D', () => {
    for (const table of ALL_TABLES) {
      describe(`Table ${table.id}`, () => {
        test.each(table.rows.map((r) => [r.row, r]))('row %i considerable', (rowNum, row) => {
          const result = calculateConsiderable({
            V: row.V,
            leftVolume: row.leftBefore,
            rightVolume: row.rightBefore,
            matched: row.matchedBefore,
            legAtEarner: row.legAtEarner,
            firstMatchingDone: row.firstMatchingDone,
            parentAmount: row.parentAmount,
          });
          expect(result.considerable).toBe(row.expectedConsiderable);
          expect(result.matchedAfter).toBe(row.expectedMatchedAfter);
        });

        test('sequential sum matches expected total', () => {
          let sum = 0;
          for (const row of table.rows) {
            const result = calculateConsiderable({
              V: row.V,
              leftVolume: row.leftBefore,
              rightVolume: row.rightBefore,
              matched: row.matchedBefore,
              legAtEarner: row.legAtEarner,
              firstMatchingDone: row.firstMatchingDone,
              parentAmount: row.parentAmount,
            });
            expect(result.considerable).toBe(row.expectedConsiderable);
            sum += result.considerable;
          }
          if (table.expectedTotal != null) {
            expect(sum).toBe(table.expectedTotal);
          }
        });
      });
    }
  });

  describe('scenario matrix S1–S13', () => {
    for (const [key, scenario] of Object.entries(SCENARIOS)) {
      if (scenario.inputs) {
        test(`${key}: ${scenario.description}`, () => {
          scenario.inputs.forEach((input, i) => {
            const result = calculateConsiderable(input);
            expect(result.considerable).toBe(scenario.expectedConsiderables[i]);
          });
        });
      } else {
        test(`${key}: ${scenario.description}`, () => {
          const result = calculateConsiderable(scenario.input);
          expect(result.considerable).toBe(scenario.expectedConsiderable);
        });
      }
    }
  });

  describe('first-matching exception', () => {
    test('Table A row 1 — bundle 750', () => {
      const r = calculateConsiderable({
        V: 200,
        leftVolume: 1100,
        rightVolume: 550,
        matched: 0,
        legAtEarner: 'right',
        firstMatchingDone: false,
        parentAmount: 550,
      });
      expect(r.considerable).toBe(750);
      expect(r.rule).toBe('first-bundle');
    });

    test('Table D row 1 — bundle exceeds opposite → 500', () => {
      const r = calculateConsiderable({
        V: 150,
        leftVolume: 800,
        rightVolume: 500,
        matched: 0,
        legAtEarner: 'left',
        firstMatchingDone: false,
        parentAmount: 800,
      });
      expect(r.considerable).toBe(500);
    });

    test('depth-2 parent — parentAmount sum used in bundle', () => {
      const r = calculateConsiderable({
        V: 195,
        leftVolume: 900,
        rightVolume: 420,
        matched: 0,
        legAtEarner: 'right',
        firstMatchingDone: false,
        parentAmount: 420,
      });
      expect(r.considerable).toBe(615);
    });
  });

  describe('calculateMatchingPayout — 30k package cap threshold', () => {
    test('maxPkg=25000, raw=400000 → capped at 25000', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 10000000,
        matchingPercent: 4,
        maxPackageAmount: 25000,
        capThreshold: 30000,
      });
      expect(r.rawPayoutAmount).toBe(400000);
      expect(r.payoutCreditedAmount).toBe(25000);
      expect(r.packageCapApplied).toBe(true);
    });

    test('maxPkg=35000, raw=400000 → full payout', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 10000000,
        matchingPercent: 4,
        maxPackageAmount: 35000,
        capThreshold: 30000,
      });
      expect(r.payoutCreditedAmount).toBe(400000);
      expect(r.packageCapApplied).toBe(false);
    });

    test('maxPkg=29999 → capped', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 1000000,
        matchingPercent: 4,
        maxPackageAmount: 29999,
        capThreshold: 30000,
      });
      expect(r.payoutCreditedAmount).toBe(29999);
      expect(r.packageCapApplied).toBe(true);
    });

    test('maxPkg=30000 → no cap at threshold', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 1000000,
        matchingPercent: 4,
        maxPackageAmount: 30000,
        capThreshold: 30000,
      });
      expect(r.payoutCreditedAmount).toBe(40000);
      expect(r.packageCapApplied).toBe(false);
    });

    test('maxPkg=25000, raw=400 → full small payout', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 10000,
        matchingPercent: 4,
        maxPackageAmount: 25000,
        capThreshold: 30000,
      });
      expect(r.payoutCreditedAmount).toBe(400);
      expect(r.packageCapApplied).toBe(false);
    });

    test('maxPkg=0 → zero payout', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 100000,
        matchingPercent: 4,
        maxPackageAmount: 0,
        capThreshold: 30000,
      });
      expect(r.payoutCreditedAmount).toBe(0);
    });

    test('custom threshold honored', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 100000,
        matchingPercent: 4,
        maxPackageAmount: 15000,
        capThreshold: 20000,
      });
      expect(r.payoutCreditedAmount).toBe(4000);
      expect(r.packageCapApplied).toBe(false);
    });

    test('below custom threshold → capped', () => {
      const r = calculateMatchingPayout({
        considerableAmount: 100000,
        matchingPercent: 4,
        maxPackageAmount: 15000,
        capThreshold: 20000,
      });
      expect(r.payoutCreditedAmount).toBe(4000);
    });
  });

  describe('invariants', () => {
    const cases = ALL_TABLES.flatMap((t) => t.rows);

    test('considerable <= V for ongoing rows (first bundle may exceed V)', () => {
      for (const row of cases) {
        if (!row.firstMatchingDone) continue;
        const r = calculateConsiderable({
          V: row.V,
          leftVolume: row.leftBefore,
          rightVolume: row.rightBefore,
          matched: row.matchedBefore,
          legAtEarner: row.legAtEarner,
          firstMatchingDone: row.firstMatchingDone,
          parentAmount: row.parentAmount,
        });
        expect(r.considerable).toBeLessThanOrEqual(row.V);
      }
    });

    test('matchedAfter = matchedBefore + considerable', () => {
      for (const row of cases) {
        const r = calculateConsiderable({
          V: row.V,
          leftVolume: row.leftBefore,
          rightVolume: row.rightBefore,
          matched: row.matchedBefore,
          legAtEarner: row.legAtEarner,
          firstMatchingDone: row.firstMatchingDone,
          parentAmount: row.parentAmount,
        });
        expect(r.matchedAfter).toBe(row.matchedBefore + r.considerable);
      }
    });

    test('long leg → considerable = 0', () => {
      const longLegRows = cases.filter(
        (r) => r.expectedConsiderable === 0 && r.firstMatchingDone && r.V > 0
      );
      expect(longLegRows.length).toBeGreaterThan(0);
      for (const row of longLegRows) {
        const r = calculateConsiderable({
          V: row.V,
          leftVolume: row.leftBefore,
          rightVolume: row.rightBefore,
          matched: row.matchedBefore,
          legAtEarner: row.legAtEarner,
          firstMatchingDone: row.firstMatchingDone,
          parentAmount: row.parentAmount,
        });
        expect(r.considerable).toBe(0);
      }
    });
  });

  describe('splitByFirstBranch + determineLegAtEarner', () => {
    test('places descendants under first left/right branch', () => {
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
      expect(determineLegAtEarner('L2', split)).toBe('left');
      expect(determineLegAtEarner('R2', split)).toBe('right');
    });
  });
});
