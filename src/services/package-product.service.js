const { PackageProduct, Plan } = require('../models');
const { logger } = require('../utils/logger');

/** 4 plans (A–D) — W = withdrawal cycle (IST calendar days), N = max working days of trade credits */
const DEMO_PLANS = [
  {
    code: 'A',
    name: 'Plan A — Balanced',
    dailyPercent: 0.8,
    cycleDaysW: 15,
    maxWorkingDaysN: 800,
    sponsorPercent: 5,
    summary: 'Faster W cycles, longest income runway',
    detailHelp:
      'Daily trade income = principal × daily% on each working day (not weekends / market holidays, per calendar). ' +
      'After N working days of credits, this plan stops. Withdrawal cycles are W calendar days (IST): ' +
      'income from a full cycle becomes eligible when that cycle ends. Last partial cycle still unlocks earned amounts (BUSINESS-LOGIC §3.4). ' +
      'Sponsor % applies on referred package purchases; cap uses referrer’s max active package.',
  },
  {
    code: 'B',
    name: 'Plan B — Steady',
    dailyPercent: 0.7,
    cycleDaysW: 20,
    maxWorkingDaysN: 700,
    sponsorPercent: 5,
    summary: 'Slightly lower daily %, longer cycle window',
    detailHelp:
      'Lower daily % than A, but same rules: trade credits only on working days, W-day withdrawal cycles in IST, N caps total working-day credits. ' +
      'Principal is not returned; only daily income and sponsor (when applicable).',
  },
  {
    code: 'C',
    name: 'Plan C — Growth',
    dailyPercent: 0.6,
    cycleDaysW: 30,
    maxWorkingDaysN: 650,
    sponsorPercent: 5,
    summary: 'Wider W window; good if you withdraw less often',
    detailHelp:
      'Larger W means each withdrawal cycle holds more calendar days. Eligible balance stacks as cycles complete. ' +
      'Choose based on how often you want new chunks to become withdrawable vs daily rate.',
  },
  {
    code: 'D',
    name: 'Plan D — Endurance',
    dailyPercent: 0.5,
    cycleDaysW: 45,
    maxWorkingDaysN: 600,
    sponsorPercent: 5,
    summary: 'Largest W cycles, lowest daily %, shorter N',
    detailHelp:
      'Lowest daily% in the demo set; N is lower so total program length is shorter in working-day count. ' +
      'First income day = next working day after purchase (IST); cycle 1 for withdrawals starts the calendar day after purchase (IST).',
  },
];

const DEMO_PACKAGES = [
  {
    code: 'P01',
    name: 'Starter',
    amount: 5_000,
    sortOrder: 1,
    shortDescription: 'Entry point',
    features: ['Fixed amount', 'Wallet purchase only', 'Sponsor to referrer (if they have an active package)'],
    detailHelp:
      'You can buy multiple packages over time. Each purchase debits this exact amount from your one wallet. ' +
      'Pick a plan (A–D) per purchase: it sets daily %, W, and N for that subscription only.',
  },
  {
    code: 'P02',
    name: 'Silver',
    amount: 10_000,
    sortOrder: 2,
    shortDescription: 'Popular first step',
    features: ['10k principal slot', 'Same plan rules as other tiers'],
    detailHelp: 'Principal is not repaid as a lump sum; returns are via daily trade credits and sponsor (when rules apply), per BUSINESS-LOGIC.',
  },
  {
    code: 'P03',
    name: 'Silver Plus',
    amount: 15_000,
    sortOrder: 3,
    shortDescription: 'Mid range',
    features: ['Larger cap base for sponsor rules vs smaller tiers', 'IST dates for all cycles'],
    detailHelp: 'Sponsor cap for your referrer is tied to their highest active package, not the sum of packages (BUSINESS-LOGIC §7).',
  },
  {
    code: 'P04',
    name: 'Gold',
    amount: 20_000,
    sortOrder: 4,
    shortDescription: 'Standard gold tier',
    features: ['20k slot', 'Combine with any plan A–D'],
    detailHelp: 'Purchase order in app: (1) fund wallet via add fund + admin approval, (2) choose this package, (3) pick plan, (4) confirm checkout.',
  },
  {
    code: 'P05',
    name: 'Gold Plus',
    amount: 25_000,
    sortOrder: 5,
    shortDescription: 'Between gold and platinum',
    features: ['25k', 'All trade math in IST'],
    detailHelp: 'We store UTC; purchase date and cycles use India time for product rules.',
  },
  {
    code: 'P06',
    name: 'Platinum',
    amount: 30_000,
    sortOrder: 6,
    shortDescription: 'Higher commitment',
    features: ['30k', 'You may hold many subscriptions'],
    detailHelp: 'Each buy creates a separate subscription with its own principal, plan, and N/W behavior.',
  },
  {
    code: 'P07',
    name: 'Diamond',
    amount: 50_000,
    sortOrder: 7,
    shortDescription: 'Strong portfolio slot',
    features: ['50k', 'Suitable for active referrers'],
    detailHelp: 'Referrers with no active package receive 0 sponsor for that sale; cap uses max active package when they do.',
  },
  {
    code: 'P08',
    name: 'Diamond Plus',
    amount: 75_000,
    sortOrder: 8,
    shortDescription: 'Pre-elite',
    features: ['75k'],
    detailHelp: 'If wallet balance is lower than this amount, add funds and wait for admin approval first.',
  },
  {
    code: 'P09',
    name: 'Elite',
    amount: 100_000,
    sortOrder: 9,
    shortDescription: 'High tier',
    features: ['100k'],
    detailHelp: 'No principal return: withdrawing only what eligibility allows after W cycles, plus normal withdrawal rules.',
  },
  {
    code: 'P10',
    name: 'Crown',
    amount: 150_000,
    sortOrder: 10,
    shortDescription: 'Top public tier (demo)',
    features: ['150k', 'Demo dataset for testing only'],
    detailHelp: 'Replace amounts and copy with your production catalog when you go live.',
  },
];

async function seedPackageCatalog() {
  for (const p of DEMO_PLANS) {
    await Plan.findOneAndUpdate(
      { code: p.code },
      { $set: { ...p, isActive: true } },
      { upsert: true }
    );
  }
  for (const pkg of DEMO_PACKAGES) {
    const { code, name, amount, shortDescription, detailHelp, features, sortOrder } = pkg;
    await PackageProduct.findOneAndUpdate(
      { code },
      { $set: { name, amount, shortDescription, detailHelp, features, sortOrder, isActive: true } },
      { upsert: true, returnDocument: 'after' }
    );
  }
  logger.info({ plans: DEMO_PLANS.length, packages: DEMO_PACKAGES.length }, 'Seeded package catalog (plans + products)');
}

module.exports = {
  seedPackageCatalog,
  DEMO_PLANS,
  DEMO_PACKAGES,
};
