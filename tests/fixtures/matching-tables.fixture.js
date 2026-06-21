/**
 * Golden regression fixtures from docs/MATCHING-INCOME-PATTERN-DISCOVERY.md
 * Rows with considerable=0 are included; row 0 (setup) is excluded.
 */

const TABLE_A = [
  { row: 1, V: 200, legAtEarner: 'right', leftBefore: 1100, rightBefore: 550, matchedBefore: 0, firstMatchingDone: false, parentAmount: 550, expectedConsiderable: 750, expectedMatchedAfter: 750 },
  { row: 2, V: 90, legAtEarner: 'right', leftBefore: 1100, rightBefore: 750, matchedBefore: 750, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 90, expectedMatchedAfter: 840 },
  { row: 3, V: 155, legAtEarner: 'right', leftBefore: 1100, rightBefore: 840, matchedBefore: 840, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 155, expectedMatchedAfter: 995 },
  { row: 4, V: 180, legAtEarner: 'left', leftBefore: 1100, rightBefore: 995, matchedBefore: 995, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 995 },
  { row: 5, V: 230, legAtEarner: 'right', leftBefore: 1280, rightBefore: 995, matchedBefore: 995, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 230, expectedMatchedAfter: 1225 },
  { row: 6, V: 520, legAtEarner: 'right', leftBefore: 1280, rightBefore: 1225, matchedBefore: 1225, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 55, expectedMatchedAfter: 1280 },
  { row: 7, V: 130, legAtEarner: 'left', leftBefore: 1280, rightBefore: 1745, matchedBefore: 1280, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 130, expectedMatchedAfter: 1410 },
  { row: 8, V: 245, legAtEarner: 'left', leftBefore: 1410, rightBefore: 1745, matchedBefore: 1410, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 245, expectedMatchedAfter: 1655 },
  { row: 9, V: 175, legAtEarner: 'left', leftBefore: 1655, rightBefore: 1745, matchedBefore: 1655, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 90, expectedMatchedAfter: 1745 },
  { row: 10, V: 38, legAtEarner: 'left', leftBefore: 1830, rightBefore: 1745, matchedBefore: 1745, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1745 },
  { row: 11, V: 45, legAtEarner: 'left', leftBefore: 1868, rightBefore: 1745, matchedBefore: 1745, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1745 },
  { row: 12, V: 70, legAtEarner: 'left', leftBefore: 1913, rightBefore: 1745, matchedBefore: 1745, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1745 },
  { row: 13, V: 310, legAtEarner: 'right', leftBefore: 1983, rightBefore: 1745, matchedBefore: 1745, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 238, expectedMatchedAfter: 1983 },
  { row: 14, V: 95, legAtEarner: 'left', leftBefore: 1983, rightBefore: 2055, matchedBefore: 1983, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 72, expectedMatchedAfter: 2055 },
  { row: 15, V: 400, legAtEarner: 'right', leftBefore: 2078, rightBefore: 2055, matchedBefore: 2055, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 23, expectedMatchedAfter: 2078 },
];

const TABLE_B = [
  { row: 1, V: 170, legAtEarner: 'right', leftBefore: 950, rightBefore: 480, matchedBefore: 0, firstMatchingDone: false, parentAmount: 480, expectedConsiderable: 650, expectedMatchedAfter: 650 },
  { row: 2, V: 110, legAtEarner: 'right', leftBefore: 950, rightBefore: 650, matchedBefore: 650, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 110, expectedMatchedAfter: 760 },
  { row: 3, V: 140, legAtEarner: 'right', leftBefore: 950, rightBefore: 760, matchedBefore: 760, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 140, expectedMatchedAfter: 900 },
  { row: 4, V: 360, legAtEarner: 'right', leftBefore: 950, rightBefore: 900, matchedBefore: 900, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 50, expectedMatchedAfter: 950 },
  { row: 5, V: 220, legAtEarner: 'left', leftBefore: 950, rightBefore: 1260, matchedBefore: 950, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 220, expectedMatchedAfter: 1170 },
  { row: 6, V: 210, legAtEarner: 'left', leftBefore: 1170, rightBefore: 1260, matchedBefore: 1170, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 90, expectedMatchedAfter: 1260 },
  { row: 7, V: 155, legAtEarner: 'right', leftBefore: 1380, rightBefore: 1260, matchedBefore: 1260, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 120, expectedMatchedAfter: 1380 },
  { row: 8, V: 95, legAtEarner: 'left', leftBefore: 1380, rightBefore: 1415, matchedBefore: 1380, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 35, expectedMatchedAfter: 1415 },
  { row: 9, V: 330, legAtEarner: 'left', leftBefore: 1475, rightBefore: 1415, matchedBefore: 1415, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1415 },
  { row: 10, V: 85, legAtEarner: 'right', leftBefore: 1805, rightBefore: 1415, matchedBefore: 1415, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 85, expectedMatchedAfter: 1500 },
  { row: 11, V: 260, legAtEarner: 'left', leftBefore: 1805, rightBefore: 1500, matchedBefore: 1500, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1500 },
  { row: 12, V: 125, legAtEarner: 'right', leftBefore: 2065, rightBefore: 1500, matchedBefore: 1500, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 125, expectedMatchedAfter: 1625 },
  { row: 13, V: 410, legAtEarner: 'right', leftBefore: 2065, rightBefore: 1625, matchedBefore: 1625, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 410, expectedMatchedAfter: 2035 },
  { row: 14, V: 185, legAtEarner: 'left', leftBefore: 2065, rightBefore: 2035, matchedBefore: 2035, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 2035 },
  { row: 15, V: 170, legAtEarner: 'left', leftBefore: 2250, rightBefore: 2035, matchedBefore: 2035, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 2035 },
  { row: 16, V: 290, legAtEarner: 'left', leftBefore: 2420, rightBefore: 2035, matchedBefore: 2035, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 2035 },
];

const TABLE_C = [
  { row: 1, V: 195, legAtEarner: 'right', leftBefore: 900, rightBefore: 420, matchedBefore: 0, firstMatchingDone: false, parentAmount: 420, expectedConsiderable: 615, expectedMatchedAfter: 615 },
  { row: 2, V: 145, legAtEarner: 'right', leftBefore: 900, rightBefore: 615, matchedBefore: 615, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 145, expectedMatchedAfter: 760 },
  { row: 3, V: 125, legAtEarner: 'right', leftBefore: 900, rightBefore: 760, matchedBefore: 760, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 125, expectedMatchedAfter: 885 },
  { row: 4, V: 185, legAtEarner: 'left', leftBefore: 900, rightBefore: 885, matchedBefore: 885, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 885 },
  { row: 5, V: 420, legAtEarner: 'right', leftBefore: 1085, rightBefore: 885, matchedBefore: 885, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 200, expectedMatchedAfter: 1085 },
  { row: 6, V: 95, legAtEarner: 'right', leftBefore: 1085, rightBefore: 1305, matchedBefore: 1085, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1085 },
  { row: 7, V: 210, legAtEarner: 'left', leftBefore: 1085, rightBefore: 1400, matchedBefore: 1085, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 210, expectedMatchedAfter: 1295 },
  { row: 8, V: 330, legAtEarner: 'left', leftBefore: 1295, rightBefore: 1400, matchedBefore: 1295, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 105, expectedMatchedAfter: 1400 },
  { row: 9, V: 72, legAtEarner: 'left', leftBefore: 1625, rightBefore: 1400, matchedBefore: 1400, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1400 },
  { row: 10, V: 48, legAtEarner: 'left', leftBefore: 1697, rightBefore: 1400, matchedBefore: 1400, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1400 },
  { row: 11, V: 155, legAtEarner: 'left', leftBefore: 1745, rightBefore: 1400, matchedBefore: 1400, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1400 },
  { row: 12, V: 270, legAtEarner: 'right', leftBefore: 1900, rightBefore: 1400, matchedBefore: 1400, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 270, expectedMatchedAfter: 1670 },
  { row: 13, V: 88, legAtEarner: 'right', leftBefore: 1900, rightBefore: 1670, matchedBefore: 1670, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 88, expectedMatchedAfter: 1758 },
  { row: 14, V: 395, legAtEarner: 'right', leftBefore: 1900, rightBefore: 1758, matchedBefore: 1758, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 142, expectedMatchedAfter: 1900 },
  { row: 15, V: 105, legAtEarner: 'left', leftBefore: 1900, rightBefore: 2153, matchedBefore: 1900, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 105, expectedMatchedAfter: 2005 },
  { row: 16, V: 225, legAtEarner: 'left', leftBefore: 2005, rightBefore: 2153, matchedBefore: 2005, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 148, expectedMatchedAfter: 2153 },
];

const TABLE_D = [
  { row: 1, V: 150, legAtEarner: 'left', leftBefore: 800, rightBefore: 500, matchedBefore: 0, firstMatchingDone: false, parentAmount: 800, expectedConsiderable: 500, expectedMatchedAfter: 500 },
  { row: 2, V: 120, legAtEarner: 'right', leftBefore: 950, rightBefore: 500, matchedBefore: 500, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 120, expectedMatchedAfter: 620 },
  { row: 3, V: 110, legAtEarner: 'left', leftBefore: 1060, rightBefore: 620, matchedBefore: 620, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 620 },
  { row: 4, V: 400, legAtEarner: 'right', leftBefore: 1060, rightBefore: 620, matchedBefore: 620, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 400, expectedMatchedAfter: 1020 },
  { row: 5, V: 280, legAtEarner: 'left', leftBefore: 1340, rightBefore: 1020, matchedBefore: 1020, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1020 },
  { row: 6, V: 95, legAtEarner: 'right', leftBefore: 1340, rightBefore: 1020, matchedBefore: 620, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 95, expectedMatchedAfter: 715 },
  { row: 7, V: 350, legAtEarner: 'left', leftBefore: 1060, rightBefore: 1115, matchedBefore: 715, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 350, expectedMatchedAfter: 1065 },
  { row: 8, V: 520, legAtEarner: 'right', leftBefore: 1410, rightBefore: 1115, matchedBefore: 1065, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 345, expectedMatchedAfter: 1410 },
  { row: 9, V: 60, legAtEarner: 'left', leftBefore: 1700, rightBefore: 1695, matchedBefore: 1410, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 0, expectedMatchedAfter: 1410 },
  { row: 10, V: 180, legAtEarner: 'left', leftBefore: 1590, rightBefore: 1695, matchedBefore: 1410, firstMatchingDone: true, parentAmount: 0, expectedConsiderable: 180, expectedMatchedAfter: 1590 },
];

const ALL_TABLES = [
  { id: 'A', rows: TABLE_A, expectedTotal: 2078 },
  { id: 'B', rows: TABLE_B, expectedTotal: 2035 },
  { id: 'C', rows: TABLE_C, expectedTotal: 2153 },
  { id: 'D', rows: TABLE_D, expectedTotal: 1990 },
];

/** Scenario cases S1–S13 (explicit expected values from discovery doc) */
const SCENARIOS = {
  S1_first_overlap: {
    description: 'First bundle overlap',
    input: { V: 200, legAtEarner: 'right', leftVolume: 1100, rightVolume: 550, matched: 0, firstMatchingDone: false, parentAmount: 550 },
    expectedConsiderable: 750,
  },
  S2_full_join_short_leg: {
    description: 'Full join on short leg',
    input: { V: 110, legAtEarner: 'right', leftVolume: 950, rightVolume: 650, matched: 650, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 110,
  },
  S3_partial_join: {
    description: 'Partial join — room smaller than V',
    input: { V: 520, legAtEarner: 'right', leftVolume: 1280, rightVolume: 1225, matched: 1225, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 55,
  },
  S4_long_leg: {
    description: 'Long leg — zero considerable',
    input: { V: 180, legAtEarner: 'left', leftVolume: 1100, rightVolume: 995, matched: 995, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 0,
  },
  S5_leg_flip: {
    description: 'After leader flip — short leg pays',
    input: { V: 220, legAtEarner: 'left', leftVolume: 950, rightVolume: 1260, matched: 950, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 220,
  },
  S6_leg_flip_partial: {
    description: 'Partial after flip',
    input: { V: 360, legAtEarner: 'right', leftVolume: 950, rightVolume: 900, matched: 900, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 50,
  },
  S7_deep_join_leg_at_earner: {
    description: 'Join deep under branch — leg @ earner is left (K under E-right)',
    input: { V: 175, legAtEarner: 'left', leftVolume: 1655, rightVolume: 1745, matched: 1655, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 90,
  },
  S8_large_join_tiny_gap: {
    description: 'Large join vs tiny gap',
    input: { V: 395, legAtEarner: 'right', leftVolume: 1900, rightVolume: 1758, matched: 1758, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 142,
  },
  S9_tiny_join_large_gap: {
    description: 'Tiny join vs large gap — full V',
    input: { V: 88, legAtEarner: 'right', leftVolume: 1900, rightVolume: 1670, matched: 1670, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 88,
  },
  S10_nearly_equal: {
    description: 'Nearly equal legs — small partial',
    input: { V: 400, legAtEarner: 'right', leftVolume: 2078, rightVolume: 2055, matched: 2055, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 23,
  },
  S11_pending_pair: {
    description: 'Two joins same leg under internal node',
    input: { V: 48, legAtEarner: 'left', leftVolume: 1697, rightVolume: 1400, matched: 1400, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 0,
  },
  S12_second_partial: {
    description: 'Second partial while matched already high',
    input: { V: 225, legAtEarner: 'left', leftVolume: 2005, rightVolume: 2153, matched: 2005, firstMatchingDone: true, parentAmount: 0 },
    expectedConsiderable: 148,
  },
  S13_long_leg_streak: {
    description: 'Long leg streak — multiple zeros',
    inputs: [
      { V: 38, legAtEarner: 'left', leftVolume: 1830, rightVolume: 1745, matched: 1745, firstMatchingDone: true, parentAmount: 0 },
      { V: 45, legAtEarner: 'left', leftVolume: 1868, rightVolume: 1745, matched: 1745, firstMatchingDone: true, parentAmount: 0 },
      { V: 70, legAtEarner: 'left', leftVolume: 1913, rightVolume: 1745, matched: 1745, firstMatchingDone: true, parentAmount: 0 },
    ],
    expectedConsiderables: [0, 0, 0],
  },
};

module.exports = {
  TABLE_A,
  TABLE_B,
  TABLE_C,
  TABLE_D,
  ALL_TABLES,
  SCENARIOS,
};
